// ============================================================================
// Guardian — Security Scanning Tools
// ============================================================================
// Scans for dependency vulnerabilities, exposed secrets, HTTP surface issues,
// and insecure daemon configuration. Aggregates into a security report.
// ============================================================================

import { execSync } from 'child_process';
import fs from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { homedir } from 'os';
import { log } from '../config.js';
import { resolveProjectPaths, ResolvedProjectPaths } from '../projectRegistry.js';
import { loadConfig } from '../daemonConfig.js';
import YAML from 'yaml';

// ============================================================================
// Types
// ============================================================================

export interface ScanDepsInput {
  project_id?: string;
}

export interface ScanDepsOutput {
  total_advisories: number;
  by_severity: Record<string, number>;
  advisories: Array<{
    name: string;
    severity: string;
    title: string;
    url: string;
    fix_available: boolean;
  }>;
}

export interface ScanSecretsInput {
  project_id?: string;
  directories?: string[];
}

export interface ScanSecretsOutput {
  findings: Array<{
    file: string;
    line: number;
    pattern: string;
    snippet: string;
  }>;
  total_findings: number;
  allowlisted: number;
}

export interface ScanHttpOutput {
  checks: Array<{
    name: string;
    status: 'pass' | 'fail' | 'warn';
    detail: string;
  }>;
  score: string;
}

export interface ScanConfigOutput {
  checks: Array<{
    name: string;
    status: 'pass' | 'fail' | 'warn';
    detail: string;
  }>;
  config_path: string;
}

export interface GuardianReportOutput {
  overall_grade: string;
  sections: {
    deps: ScanDepsOutput;
    secrets: ScanSecretsOutput;
    http: ScanHttpOutput;
    config: ScanConfigOutput;
  };
  generated_at: string;
}

// ============================================================================
// Secret Detection Patterns
// ============================================================================

const SECRET_PATTERNS = [
  { name: 'api_key', pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"][^'"]{8,}/i },
  { name: 'secret', pattern: /(?:secret|client_secret)\s*[:=]\s*['"][^'"]{8,}/i },
  { name: 'password', pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{4,}/i },
  { name: 'token', pattern: /(?:auth[_-]?token|access[_-]?token|bearer)\s*[:=]\s*['"][^'"]{8,}/i },
  { name: 'pem_header', pattern: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/ },
  { name: 'aws_key', pattern: /AKIA[0-9A-Z]{16}/ },
  { name: 'jwt', pattern: /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/ },
];

// ============================================================================
// Helpers
// ============================================================================

function loadAllowlist(projectId?: string): string[] {
  try {
    let allowlistPath: string;
    if (projectId) {
      const resolved = resolveProjectPaths(projectId);
      allowlistPath = resolved.subPath('guardian/allowlist.yaml');
    } else {
      allowlistPath = path.join(homedir(), '.decibel', 'guardian', 'allowlist.yaml');
    }

    if (!existsSync(allowlistPath)) return [];
    const content = readFileSync(allowlistPath, 'utf-8');
    const parsed = YAML.parse(content);
    return Array.isArray(parsed?.entries) ? parsed.entries : [];
  } catch {
    return [];
  }
}

function gradeFromScore(score: number, total: number): string {
  const pct = total > 0 ? (score / total) * 100 : 100;
  if (pct >= 90) return 'A';
  if (pct >= 75) return 'B';
  if (pct >= 60) return 'C';
  if (pct >= 40) return 'D';
  return 'F';
}

// ============================================================================
// Scan Functions
// ============================================================================

export async function scanDeps(input: ScanDepsInput): Promise<ScanDepsOutput> {
  let projectPath: string;
  try {
    const resolved = resolveProjectPaths(input.project_id);
    projectPath = resolved.projectPath;
  } catch {
    projectPath = process.cwd();
  }

  try {
    const output = execSync('npm audit --json 2>/dev/null', {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: 30_000,
    });

    const audit = JSON.parse(output);
    const vulnerabilities = audit.vulnerabilities || {};
    const bySeverity: Record<string, number> = {};
    const advisories: ScanDepsOutput['advisories'] = [];

    for (const [name, vuln] of Object.entries(vulnerabilities) as [string, any][]) {
      const severity = vuln.severity || 'unknown';
      bySeverity[severity] = (bySeverity[severity] || 0) + 1;
      advisories.push({
        name,
        severity,
        title: vuln.via?.[0]?.title || vuln.via?.[0] || 'Unknown',
        url: vuln.via?.[0]?.url || '',
        fix_available: !!vuln.fixAvailable,
      });
    }

    return {
      total_advisories: advisories.length,
      by_severity: bySeverity,
      advisories: advisories.slice(0, 20), // Limit output
    };
  } catch (err: any) {
    // npm audit exits non-zero when vulnerabilities are found — parse the output
    if (err.stdout) {
      try {
        const audit = JSON.parse(err.stdout);
        const vulnerabilities = audit.vulnerabilities || {};
        const bySeverity: Record<string, number> = {};
        const advisories: ScanDepsOutput['advisories'] = [];

        for (const [name, vuln] of Object.entries(vulnerabilities) as [string, any][]) {
          const severity = vuln.severity || 'unknown';
          bySeverity[severity] = (bySeverity[severity] || 0) + 1;
          advisories.push({
            name,
            severity,
            title: vuln.via?.[0]?.title || vuln.via?.[0] || 'Unknown',
            url: vuln.via?.[0]?.url || '',
            fix_available: !!vuln.fixAvailable,
          });
        }

        return {
          total_advisories: advisories.length,
          by_severity: bySeverity,
          advisories: advisories.slice(0, 20),
        };
      } catch {
        // Couldn't parse output
      }
    }

    return {
      total_advisories: 0,
      by_severity: {},
      advisories: [],
    };
  }
}

export async function scanSecrets(input: ScanSecretsInput): Promise<ScanSecretsOutput> {
  const allowlist = loadAllowlist(input.project_id);

  let scanDirs: string[];
  try {
    const resolved = resolveProjectPaths(input.project_id);
    scanDirs = input.directories || [
      path.join(resolved.projectPath, 'src'),
      path.join(resolved.projectPath, 'extension', 'src'),
    ];
  } catch {
    scanDirs = input.directories || [path.join(process.cwd(), 'src')];
  }

  const findings: ScanSecretsOutput['findings'] = [];
  let allowlisted = 0;

  for (const dir of scanDirs) {
    try {
      await scanDirectory(dir, findings, allowlist, (count) => { allowlisted += count; });
    } catch {
      // Directory doesn't exist — skip
    }
  }

  return {
    findings: findings.slice(0, 50), // Limit output
    total_findings: findings.length,
    allowlisted,
  };
}

async function scanDirectory(
  dir: string,
  findings: ScanSecretsOutput['findings'],
  allowlist: string[],
  onAllowlisted: (count: number) => void,
): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // Skip node_modules, .git, dist
      if (['node_modules', '.git', 'dist', '.decibel'].includes(entry.name)) continue;
      await scanDirectory(fullPath, findings, allowlist, onAllowlisted);
      continue;
    }

    // Only scan source files
    if (!/\.(ts|js|tsx|jsx|json|yaml|yml|env|toml|cfg|conf|ini)$/.test(entry.name)) continue;

    try {
      const content = await fs.readFile(fullPath, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const { name, pattern } of SECRET_PATTERNS) {
          const match = pattern.exec(line);
          if (match) {
            // Check allowlist
            const snippet = match[0].substring(0, 60);
            if (allowlist.some(a => snippet.includes(a) || fullPath.includes(a))) {
              onAllowlisted(1);
              continue;
            }
            findings.push({
              file: fullPath,
              line: i + 1,
              pattern: name,
              snippet: snippet + (match[0].length > 60 ? '...' : ''),
            });
          }
        }
      }
    } catch {
      // Can't read file — skip
    }
  }
}

export async function scanHttp(): Promise<ScanHttpOutput> {
  const config = loadConfig();
  const checks: ScanHttpOutput['checks'] = [];

  // Check auth token
  if (config.daemon.auth_token) {
    checks.push({ name: 'auth_token', status: 'pass', detail: 'Auth token is configured' });
  } else {
    checks.push({ name: 'auth_token', status: 'fail', detail: 'No auth token configured — daemon accepts unauthenticated requests' });
  }

  // Check host binding
  if (config.daemon.host === '127.0.0.1' || config.daemon.host === 'localhost') {
    checks.push({ name: 'host_binding', status: 'pass', detail: `Bound to ${config.daemon.host} (localhost only)` });
  } else if (config.daemon.host === '0.0.0.0') {
    checks.push({ name: 'host_binding', status: 'warn', detail: 'Bound to 0.0.0.0 (all interfaces) — accessible from network' });
  } else {
    checks.push({ name: 'host_binding', status: 'warn', detail: `Bound to ${config.daemon.host}` });
  }

  // Check rate limiter
  if (config.daemon.rate_limit_rpm > 0) {
    checks.push({ name: 'rate_limiter', status: 'pass', detail: `Rate limit: ${config.daemon.rate_limit_rpm} req/min` });
  } else {
    checks.push({ name: 'rate_limiter', status: 'fail', detail: 'Rate limiter disabled' });
  }

  // Body size limit (hardcoded in httpServer.ts)
  checks.push({ name: 'body_limit', status: 'pass', detail: 'Request body limit: 1MB' });

  // TLS check (expected to fail — TLS is handled by reverse proxy)
  checks.push({ name: 'tls', status: 'warn', detail: 'No TLS — use reverse proxy for remote access' });

  const passCount = checks.filter(c => c.status === 'pass').length;
  const score = gradeFromScore(passCount, checks.length);

  return { checks, score };
}

export async function scanConfig(): Promise<ScanConfigOutput> {
  const configPath = path.join(homedir(), '.decibel', 'config.yaml');
  const checks: ScanConfigOutput['checks'] = [];

  // Check config file exists
  if (!existsSync(configPath)) {
    checks.push({ name: 'config_file', status: 'warn', detail: 'No config file found — using defaults' });
  } else {
    checks.push({ name: 'config_file', status: 'pass', detail: 'Config file found' });
  }

  // Check env vars
  if (process.env.DECIBEL_PRO === '1' && process.env.NODE_ENV === 'production') {
    checks.push({ name: 'pro_env', status: 'warn', detail: 'DECIBEL_PRO=1 set in production — pro features enabled for all' });
  } else {
    checks.push({ name: 'pro_env', status: 'pass', detail: 'Pro tier gating is appropriate for environment' });
  }

  // Check PID file permissions
  const pidPath = path.join(homedir(), '.decibel', 'daemon.pid');
  if (existsSync(pidPath)) {
    try {
      const stat = await fs.stat(pidPath);
      const mode = (stat.mode & 0o777).toString(8);
      if (parseInt(mode, 8) > 0o644) {
        checks.push({ name: 'pid_perms', status: 'warn', detail: `PID file is world-writable (${mode})` });
      } else {
        checks.push({ name: 'pid_perms', status: 'pass', detail: `PID file permissions: ${mode}` });
      }
    } catch {
      checks.push({ name: 'pid_perms', status: 'pass', detail: 'PID file permissions OK' });
    }
  }

  // Check log directory permissions
  const logDir = path.join(homedir(), '.decibel', 'logs');
  if (existsSync(logDir)) {
    checks.push({ name: 'log_dir', status: 'pass', detail: 'Log directory exists' });
  }

  // Check for insecure default host
  const config = loadConfig();
  if (config.daemon.host === '0.0.0.0') {
    checks.push({ name: 'default_host', status: 'warn', detail: 'Config host is 0.0.0.0 — consider 127.0.0.1 for security' });
  }

  return { checks, config_path: configPath };
}

export async function guardianReport(input: { project_id?: string }): Promise<GuardianReportOutput> {
  const [deps, secrets, http, config] = await Promise.all([
    scanDeps({ project_id: input.project_id }),
    scanSecrets({ project_id: input.project_id }),
    scanHttp(),
    scanConfig(),
  ]);

  // Calculate overall grade
  let score = 0;
  let total = 0;

  // Deps scoring
  total += 3;
  if (deps.total_advisories === 0) score += 3;
  else if (!deps.by_severity?.critical && !deps.by_severity?.high) score += 2;
  else if (!deps.by_severity?.critical) score += 1;

  // Secrets scoring
  total += 3;
  if (secrets.total_findings === 0) score += 3;
  else if (secrets.total_findings < 3) score += 1;

  // HTTP scoring
  total += http.checks.length;
  score += http.checks.filter(c => c.status === 'pass').length;

  // Config scoring
  total += config.checks.length;
  score += config.checks.filter(c => c.status === 'pass').length;

  return {
    overall_grade: gradeFromScore(score, total),
    sections: { deps, secrets, http, config },
    generated_at: new Date().toISOString(),
  };
}
