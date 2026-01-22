// ============================================================================
// Config Scanner - Environment & Secrets Analysis
// ============================================================================
// Detects configuration issues: env drift between environments, exposed secrets,
// missing config documentation, and hardcoded configuration values.
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Types
// ============================================================================

export interface ConfigFinding {
  id: string;
  category: 'config';
  severity: 'critical' | 'high' | 'medium' | 'low';
  type: 'exposed_secret' | 'env_drift' | 'missing_env_example' | 'hardcoded_config' | 'insecure_default';
  title: string;
  description: string;
  file?: string;
  line?: number;
  suggestion?: string;
  metadata?: Record<string, unknown>;
}

export interface ConfigScanInput {
  projectPath: string;
}

export interface EnvComparison {
  file: string;
  variables: string[];
}

export interface ConfigScanResult {
  findings: ConfigFinding[];
  score: number;
  envFiles: EnvComparison[];
  summary: {
    envFilesFound: number;
    secretsDetected: number;
    envDriftIssues: number;
    configIssues: number;
  };
  scanDuration: number;
}

// ============================================================================
// Secret Detection Patterns
// ============================================================================

interface SecretPattern {
  name: string;
  pattern: RegExp;
  severity: 'critical' | 'high' | 'medium';
  description: string;
}

const SECRET_PATTERNS: SecretPattern[] = [
  // API Keys
  {
    name: 'Generic API Key',
    pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"][a-zA-Z0-9_\-]{20,}['"]/gi,
    severity: 'critical',
    description: 'API key exposed in code',
  },
  // AWS
  {
    name: 'AWS Access Key',
    pattern: /AKIA[A-Z0-9]{16}/g,
    severity: 'critical',
    description: 'AWS access key ID',
  },
  {
    name: 'AWS Secret Key',
    pattern: /(?:aws[_-]?secret|secret[_-]?access[_-]?key)\s*[:=]\s*['"][a-zA-Z0-9/+=]{40}['"]/gi,
    severity: 'critical',
    description: 'AWS secret access key',
  },
  // Private Keys
  {
    name: 'Private Key',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
    severity: 'critical',
    description: 'Private key embedded in file',
  },
  // Database
  {
    name: 'Database URL with Password',
    pattern: /(?:postgres|mysql|mongodb|redis):\/\/[^:]+:[^@]+@[^'"]+/gi,
    severity: 'critical',
    description: 'Database connection string with embedded credentials',
  },
  // JWT/Bearer Tokens
  {
    name: 'JWT Token',
    pattern: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    severity: 'high',
    description: 'JWT token (may be expired or for testing)',
  },
  // GitHub
  {
    name: 'GitHub Token',
    pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/g,
    severity: 'critical',
    description: 'GitHub personal access token',
  },
  // Stripe
  {
    name: 'Stripe Key',
    pattern: /(?:sk|pk|rk)_(?:test|live)_[a-zA-Z0-9]{24,}/g,
    severity: 'critical',
    description: 'Stripe API key',
  },
  // Slack
  {
    name: 'Slack Token',
    pattern: /xox[baprs]-[0-9]+-[0-9]+-[a-zA-Z0-9]+/g,
    severity: 'high',
    description: 'Slack API token',
  },
  // Generic Secrets
  {
    name: 'Generic Secret Assignment',
    pattern: /(?:secret|password|passwd|token|auth[_-]?key)\s*[:=]\s*['"][^'"]{8,}['"]/gi,
    severity: 'high',
    description: 'Potential secret or password',
  },
  // Sendgrid
  {
    name: 'SendGrid API Key',
    pattern: /SG\.[a-zA-Z0-9_-]{22}\.[a-zA-Z0-9_-]{43}/g,
    severity: 'critical',
    description: 'SendGrid API key',
  },
  // Twilio
  {
    name: 'Twilio API Key',
    pattern: /SK[a-fA-F0-9]{32}/g,
    severity: 'critical',
    description: 'Twilio API key',
  },
];

// Files to scan for secrets (source code, not env files)
const SOURCE_PATTERNS = [
  '**/*.ts',
  '**/*.js',
  '**/*.tsx',
  '**/*.jsx',
  '**/*.py',
  '**/*.go',
  '**/*.rb',
  '**/*.java',
  '**/*.yaml',
  '**/*.yml',
  '**/*.json',
];

// Exclude patterns
const EXCLUDE_PATTERNS = [
  'node_modules/**',
  'dist/**',
  'build/**',
  '.git/**',
  'vendor/**',
  '**/*.min.js',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
];

// ============================================================================
// File Discovery
// ============================================================================

function matchGlob(filePath: string, pattern: string): boolean {
  const regexPattern = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '<<<GLOBSTAR>>>')
    .replace(/\*/g, '[^/]*')
    .replace(/<<<GLOBSTAR>>>/g, '.*');
  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(filePath);
}

function shouldScanFile(relativePath: string): boolean {
  // Check excludes
  for (const pattern of EXCLUDE_PATTERNS) {
    if (matchGlob(relativePath, pattern)) {
      return false;
    }
  }

  // Check includes
  for (const pattern of SOURCE_PATTERNS) {
    if (matchGlob(relativePath, pattern)) {
      return true;
    }
  }

  return false;
}

function walkForFiles(dir: string, baseDir: string): string[] {
  const files: string[] = [];

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(baseDir, fullPath);

      if (entry.isDirectory()) {
        // Quick check for excluded directories
        if (['node_modules', 'dist', 'build', '.git', 'vendor'].includes(entry.name)) {
          continue;
        }
        files.push(...walkForFiles(fullPath, baseDir));
      } else if (entry.isFile()) {
        if (shouldScanFile(relativePath)) {
          files.push(fullPath);
        }
      }
    }
  } catch {
    // Directory not readable
  }

  return files;
}

// ============================================================================
// Secret Detection
// ============================================================================

function scanFileForSecrets(filePath: string, content: string, baseDir: string): ConfigFinding[] {
  const findings: ConfigFinding[] = [];
  const relativePath = path.relative(baseDir, filePath);
  const lines = content.split('\n');

  // Skip likely test/mock/example files
  const isTestFile = /\.(test|spec|mock|example|sample)\.[a-z]+$/i.test(filePath) ||
                     /\/(tests?|__tests__|mocks?|examples?|samples?)\//i.test(filePath);

  for (const secretPattern of SECRET_PATTERNS) {
    secretPattern.pattern.lastIndex = 0;
    let match;

    while ((match = secretPattern.pattern.exec(content)) !== null) {
      // Find line number
      const upToMatch = content.substring(0, match.index);
      const lineNumber = upToMatch.split('\n').length;
      const line = lines[lineNumber - 1] || '';

      // Skip if in a comment
      const trimmedLine = line.trim();
      if (trimmedLine.startsWith('//') || trimmedLine.startsWith('#') ||
          trimmedLine.startsWith('*') || trimmedLine.startsWith('/*')) {
        continue;
      }

      // Skip if it looks like an env var reference (not a hardcoded value)
      if (/process\.env|os\.environ|getenv|ENV\[/i.test(line)) {
        continue;
      }

      // Lower severity for test files
      const effectiveSeverity = isTestFile ? 'medium' : secretPattern.severity;

      // Mask the detected value
      const matchValue = match[0];
      const maskedValue = matchValue.length > 20
        ? matchValue.substring(0, 8) + '...' + matchValue.substring(matchValue.length - 4)
        : matchValue.substring(0, 4) + '...';

      findings.push({
        id: `secret-${secretPattern.name.toLowerCase().replace(/\s+/g, '-')}-${path.basename(filePath)}-${lineNumber}`,
        category: 'config',
        severity: effectiveSeverity as 'critical' | 'high' | 'medium',
        type: 'exposed_secret',
        title: `${secretPattern.name} detected`,
        description: `${secretPattern.description}. Found: ${maskedValue}`,
        file: relativePath,
        line: lineNumber,
        suggestion: 'Move to environment variable or use a secrets manager. Never commit secrets to version control.',
        metadata: {
          patternName: secretPattern.name,
          isTestFile,
        },
      });

      // Move past this match to avoid duplicates from overlapping patterns
      secretPattern.pattern.lastIndex = match.index + match[0].length;
    }
  }

  return findings;
}

// ============================================================================
// Env File Analysis
// ============================================================================

function findEnvFiles(projectPath: string): string[] {
  const envFiles: string[] = [];
  const candidates = [
    '.env',
    '.env.local',
    '.env.development',
    '.env.production',
    '.env.test',
    '.env.staging',
    '.env.example',
    '.env.sample',
    '.env.template',
  ];

  for (const candidate of candidates) {
    const fullPath = path.join(projectPath, candidate);
    if (fs.existsSync(fullPath)) {
      envFiles.push(fullPath);
    }
  }

  return envFiles;
}

function parseEnvFile(filePath: string): Set<string> {
  const variables = new Set<string>();

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      // Skip comments and empty lines
      if (!trimmed || trimmed.startsWith('#')) continue;

      // Extract variable name
      const match = trimmed.match(/^([A-Z][A-Z0-9_]*)\s*=/);
      if (match) {
        variables.add(match[1]);
      }
    }
  } catch {
    // File not readable
  }

  return variables;
}

function analyzeEnvDrift(envFiles: string[], baseDir: string): ConfigFinding[] {
  const findings: ConfigFinding[] = [];

  // Find example file
  const exampleFile = envFiles.find(f =>
    f.includes('.example') || f.includes('.sample') || f.includes('.template')
  );

  // Find actual env files
  const actualEnvFiles = envFiles.filter(f =>
    !f.includes('.example') && !f.includes('.sample') && !f.includes('.template')
  );

  // Parse all files
  const fileParsed = new Map<string, Set<string>>();
  for (const file of envFiles) {
    fileParsed.set(file, parseEnvFile(file));
  }

  // Check for missing .env.example
  if (!exampleFile && actualEnvFiles.length > 0) {
    findings.push({
      id: 'missing-env-example',
      category: 'config',
      severity: 'medium',
      type: 'missing_env_example',
      title: 'No .env.example file found',
      description: 'Having a .env.example helps document required environment variables for new developers.',
      suggestion: 'Create a .env.example with all required variables (without values).',
      metadata: { envFilesFound: actualEnvFiles.length },
    });
  }

  // Check for drift between env files
  if (exampleFile && actualEnvFiles.length > 0) {
    const exampleVars = fileParsed.get(exampleFile)!;

    for (const envFile of actualEnvFiles) {
      const envVars = fileParsed.get(envFile)!;
      const relativePath = path.relative(baseDir, envFile);

      // Variables in example but not in actual file
      const missingInActual = [...exampleVars].filter(v => !envVars.has(v));
      if (missingInActual.length > 0) {
        findings.push({
          id: `env-drift-missing-${path.basename(envFile)}`,
          category: 'config',
          severity: 'high',
          type: 'env_drift',
          title: `Env drift: ${relativePath} missing ${missingInActual.length} variables`,
          description: `Variables in .env.example but missing from ${relativePath}: ${missingInActual.slice(0, 5).join(', ')}${missingInActual.length > 5 ? '...' : ''}`,
          file: relativePath,
          suggestion: 'Add missing variables to ensure consistent configuration across environments.',
          metadata: { missingVariables: missingInActual },
        });
      }

      // Variables in actual but not in example (might be undocumented)
      const extraInActual = [...envVars].filter(v => !exampleVars.has(v));
      if (extraInActual.length > 0) {
        findings.push({
          id: `env-drift-extra-${path.basename(envFile)}`,
          category: 'config',
          severity: 'low',
          type: 'env_drift',
          title: `Undocumented env vars in ${relativePath}`,
          description: `${extraInActual.length} variables not in .env.example: ${extraInActual.slice(0, 5).join(', ')}${extraInActual.length > 5 ? '...' : ''}`,
          file: relativePath,
          suggestion: 'Add these variables to .env.example for documentation.',
          metadata: { extraVariables: extraInActual },
        });
      }
    }
  }

  // Check for drift between different environment files
  if (actualEnvFiles.length > 1) {
    const allVars = new Set<string>();
    for (const file of actualEnvFiles) {
      for (const v of fileParsed.get(file)!) {
        allVars.add(v);
      }
    }

    for (const variable of allVars) {
      const filesWithVar = actualEnvFiles.filter(f => fileParsed.get(f)!.has(variable));
      const filesWithoutVar = actualEnvFiles.filter(f => !fileParsed.get(f)!.has(variable));

      if (filesWithoutVar.length > 0 && filesWithVar.length > 0) {
        // Variable exists in some files but not others
        findings.push({
          id: `env-inconsistent-${variable}`,
          category: 'config',
          severity: 'medium',
          type: 'env_drift',
          title: `Inconsistent env variable: ${variable}`,
          description: `${variable} exists in ${filesWithVar.map(f => path.basename(f)).join(', ')} but not in ${filesWithoutVar.map(f => path.basename(f)).join(', ')}`,
          suggestion: 'Ensure all environment files have consistent variable sets.',
          metadata: { variable, filesWithVar: filesWithVar.length, filesWithoutVar: filesWithoutVar.length },
        });
      }
    }
  }

  return findings;
}

// ============================================================================
// Insecure Defaults Detection
// ============================================================================

function detectInsecureDefaults(projectPath: string): ConfigFinding[] {
  const findings: ConfigFinding[] = [];

  // Check for common config files
  const configFiles = [
    'config/default.json',
    'config/development.json',
    'settings.py',
    'config.py',
    'application.yml',
    'application.yaml',
  ];

  for (const configFile of configFiles) {
    const fullPath = path.join(projectPath, configFile);
    if (fs.existsSync(fullPath)) {
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');

        // Check for debug mode enabled
        if (/debug\s*[:=]\s*true/i.test(content)) {
          findings.push({
            id: `insecure-debug-${path.basename(configFile)}`,
            category: 'config',
            severity: 'medium',
            type: 'insecure_default',
            title: 'Debug mode enabled in config',
            description: `Debug mode appears to be enabled in ${configFile}. This may expose sensitive information.`,
            file: configFile,
            suggestion: 'Ensure debug mode is disabled in production configurations.',
          });
        }

        // Check for weak/default passwords
        if (/password\s*[:=]\s*['"](?:password|123456|admin|root|test)['"]/i.test(content)) {
          findings.push({
            id: `insecure-password-${path.basename(configFile)}`,
            category: 'config',
            severity: 'high',
            type: 'insecure_default',
            title: 'Weak default password in config',
            description: `A weak or default password was found in ${configFile}.`,
            file: configFile,
            suggestion: 'Remove hardcoded passwords and use environment variables or secrets management.',
          });
        }
      } catch {
        // File not readable
      }
    }
  }

  return findings;
}

// ============================================================================
// Main Scanner
// ============================================================================

export async function scanConfig(input: ConfigScanInput): Promise<ConfigScanResult> {
  const startTime = Date.now();
  const findings: ConfigFinding[] = [];

  // Find and analyze env files
  const envFiles = findEnvFiles(input.projectPath);
  const envComparisons: EnvComparison[] = envFiles.map(f => ({
    file: path.relative(input.projectPath, f),
    variables: [...parseEnvFile(f)],
  }));

  // Check for env drift
  const driftFindings = analyzeEnvDrift(envFiles, input.projectPath);
  findings.push(...driftFindings);

  // Check for insecure defaults
  const insecureFindings = detectInsecureDefaults(input.projectPath);
  findings.push(...insecureFindings);

  // Scan source files for secrets
  const sourceFiles = walkForFiles(input.projectPath, input.projectPath);
  let secretsFound = 0;

  for (const file of sourceFiles) {
    try {
      const content = fs.readFileSync(file, 'utf-8');
      const secretFindings = scanFileForSecrets(file, content, input.projectPath);
      findings.push(...secretFindings);
      secretsFound += secretFindings.length;
    } catch {
      // File not readable
    }
  }

  // Calculate score
  let score = 100;
  for (const finding of findings) {
    switch (finding.severity) {
      case 'critical': score -= 25; break;
      case 'high': score -= 15; break;
      case 'medium': score -= 5; break;
      case 'low': score -= 2; break;
    }
  }
  score = Math.max(0, score);

  return {
    findings,
    score,
    envFiles: envComparisons,
    summary: {
      envFilesFound: envFiles.length,
      secretsDetected: secretsFound,
      envDriftIssues: findings.filter(f => f.type === 'env_drift').length,
      configIssues: findings.filter(f => f.type === 'insecure_default' || f.type === 'hardcoded_config').length,
    },
    scanDuration: Date.now() - startTime,
  };
}
