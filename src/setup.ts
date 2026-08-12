// ============================================================================
// Setup Wizard — one-command multi-client install (EPIC-0035 Phase 1)
// ============================================================================
// Detects installed AI clients and writes the Decibel MCP server entry into
// each client's config file, idempotently and without clobbering anything the
// user already had there.
//
//   npx @decibelsystems/tools setup
//   npx @decibelsystems/tools setup --dry-run
//   npx @decibelsystems/tools setup --yes --clients desktop,cursor
//   npx @decibelsystems/tools setup --license DCB-... --daemon
//
// Design notes:
//   - Every write is preceded by a timestamped backup of the original file.
//   - A config we cannot parse is never overwritten — we skip and report.
//   - Claude Desktop on macOS gets the `/bin/zsh -lc` wrapper because Desktop
//     launches with a stripped PATH and cannot find a bare `npx`.
// ============================================================================

import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir, platform as osPlatform } from 'os';
import { spawn } from 'child_process';
import { createInterface } from 'readline/promises';

const PACKAGE_SPEC = '@decibelsystems/tools';
const SERVER_KEY = 'decibel-tools';

// ============================================================================
// Types
// ============================================================================

export type ClientId = 'claude-desktop' | 'claude-code' | 'cursor';

export interface ClientTarget {
  id: ClientId;
  label: string;
  configPath: string;
  detected: boolean;
  /** Desktop on macOS needs a login shell to find node. */
  useLoginShell: boolean;
}

export interface ServerEntry {
  command: string;
  args: string[];
}

export type MergeAction = 'created' | 'added' | 'updated' | 'unchanged';

export interface MergeResult {
  action: MergeAction;
  content: string;
}

export interface ApplyResult {
  client: ClientTarget;
  action: MergeAction | 'skipped';
  backupPath?: string;
  error?: string;
}

export interface SetupOptions {
  home?: string;
  platform?: NodeJS.Platform;
  dryRun?: boolean;
  yes?: boolean;
  clients?: ClientId[];
  license?: string;
  installDaemon?: boolean;
  verify?: boolean;
}

// ============================================================================
// Client Detection
// ============================================================================

/**
 * Resolve the config path for each supported client on this platform.
 * `detected` means the client's own directory exists — i.e. it has been run
 * at least once — not that Decibel is already configured.
 */
export function detectClients(opts: { home?: string; platform?: NodeJS.Platform } = {}): ClientTarget[] {
  const home = opts.home ?? homedir();
  const platform = opts.platform ?? osPlatform();
  const isMac = platform === 'darwin';
  const isWin = platform === 'win32';

  const desktopDir = isMac
    ? join(home, 'Library', 'Application Support', 'Claude')
    : isWin
      ? join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'Claude')
      : join(home, '.config', 'Claude');

  // Claude Code keeps global MCP servers in ~/.claude.json — NOT in
  // ~/.claude/settings.json, which holds model/hooks/plugins. Writing to
  // settings.json produces a config Claude Code silently ignores.
  const claudeCodeConfig = join(home, '.claude.json');
  const claudeCodeDir = join(home, '.claude');
  const cursorDir = join(home, '.cursor');

  return [
    {
      id: 'claude-desktop',
      label: 'Claude Desktop',
      configPath: join(desktopDir, 'claude_desktop_config.json'),
      detected: existsSync(desktopDir),
      useLoginShell: isMac,
    },
    {
      id: 'claude-code',
      label: 'Claude Code',
      configPath: claudeCodeConfig,
      detected: existsSync(claudeCodeConfig) || existsSync(claudeCodeDir),
      useLoginShell: false,
    },
    {
      id: 'cursor',
      label: 'Cursor',
      configPath: join(cursorDir, 'mcp.json'),
      detected: existsSync(cursorDir),
      useLoginShell: false,
    },
  ];
}

/**
 * The MCP server block to write. Desktop on macOS gets the login-shell
 * wrapper; everything else invokes npx directly.
 */
export function buildServerEntry(client: ClientTarget): ServerEntry {
  if (client.useLoginShell) {
    return { command: '/bin/zsh', args: ['-lc', `npx -y ${PACKAGE_SPEC}`] };
  }
  return { command: 'npx', args: ['-y', PACKAGE_SPEC] };
}

// ============================================================================
// Idempotent Merge
// ============================================================================

/**
 * Merge the Decibel server entry into an existing config document.
 *
 * Preserves every other top-level key (Claude Desktop keeps a `preferences`
 * blob next to `mcpServers`) and every other configured MCP server. Returns
 * `unchanged` when the entry already matches, so re-running is a no-op.
 *
 * Throws if `raw` is non-empty and not valid JSON — the caller skips rather
 * than destroying a file it does not understand.
 */
export function mergeConfig(raw: string | null, entry: ServerEntry): MergeResult {
  const isNew = raw === null || raw.trim() === '';

  let doc: Record<string, unknown>;
  if (isNew) {
    doc = {};
  } else {
    const parsed = JSON.parse(raw as string) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('config root is not a JSON object');
    }
    doc = parsed as Record<string, unknown>;
  }

  const existingServers = doc.mcpServers;
  const servers: Record<string, unknown> =
    existingServers && typeof existingServers === 'object' && !Array.isArray(existingServers)
      ? { ...(existingServers as Record<string, unknown>) }
      : {};

  const had = Object.prototype.hasOwnProperty.call(servers, SERVER_KEY);
  const same = had && JSON.stringify(servers[SERVER_KEY]) === JSON.stringify(entry);

  if (same) {
    return { action: 'unchanged', content: serialize(doc) };
  }

  servers[SERVER_KEY] = entry;
  const next = { ...doc, mcpServers: servers };

  return {
    action: isNew ? 'created' : had ? 'updated' : 'added',
    content: serialize(next),
  };
}

function serialize(doc: Record<string, unknown>): string {
  return JSON.stringify(doc, null, 2) + '\n';
}

// ============================================================================
// Apply
// ============================================================================

/**
 * Write the merged config for one client, backing up the original first.
 * `dryRun` computes the action without touching disk.
 */
export function applyToClient(client: ClientTarget, opts: { dryRun?: boolean } = {}): ApplyResult {
  const entry = buildServerEntry(client);
  const exists = existsSync(client.configPath);

  let raw: string | null = null;
  if (exists) {
    try {
      raw = readFileSync(client.configPath, 'utf-8');
    } catch (err) {
      return { client, action: 'skipped', error: `cannot read config: ${errText(err)}` };
    }
  }

  let merged: MergeResult;
  try {
    merged = mergeConfig(raw, entry);
  } catch (err) {
    return {
      client,
      action: 'skipped',
      error: `existing config is not valid JSON (${errText(err)}) — left untouched, fix it by hand and re-run`,
    };
  }

  if (merged.action === 'unchanged' || opts.dryRun) {
    return { client, action: merged.action };
  }

  let backupPath: string | undefined;
  try {
    if (exists && raw !== null && raw.trim() !== '') {
      backupPath = `${client.configPath}.decibel-backup-${timestamp()}`;
      copyFileSync(client.configPath, backupPath);
    }
    mkdirSync(dirname(client.configPath), { recursive: true });
    writeFileSync(client.configPath, merged.content, 'utf-8');
  } catch (err) {
    return { client, action: 'skipped', backupPath, error: `write failed: ${errText(err)}` };
  }

  return { client, action: merged.action, backupPath };
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ============================================================================
// Verification — real MCP handshake over stdio
// ============================================================================

export interface VerifyResult {
  ok: boolean;
  toolCount?: number;
  serverName?: string;
  error?: string;
}

/**
 * Spawn the server exactly as a client would and run initialize + tools/list.
 * This is the difference between "we wrote a file" and "it actually works".
 */
export function verifyServer(entry: ServerEntry, timeoutMs = 90_000): Promise<VerifyResult> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(entry.command, entry.args, { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      resolve({ ok: false, error: `spawn failed: ${errText(err)}` });
      return;
    }

    let settled = false;
    let buffer = '';
    let stderr = '';
    let serverName: string | undefined;

    const finish = (result: VerifyResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({
        ok: false,
        error: `timed out after ${Math.round(timeoutMs / 1000)}s${stderr ? ` — ${stderr.trim().split('\n').pop()}` : ''}`,
      });
    }, timeoutMs);

    const send = (msg: unknown) => child.stdin?.write(JSON.stringify(msg) + '\n');

    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', (err) => finish({ ok: false, error: `spawn failed: ${errText(err)}` }));
    child.on('exit', (code) => {
      finish({
        ok: false,
        error: `server exited early (code ${code})${stderr ? ` — ${stderr.trim().split('\n').pop()}` : ''}`,
      });
    });

    child.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        let msg: { id?: number; result?: Record<string, unknown>; error?: { message?: string } };
        try {
          msg = JSON.parse(line);
        } catch {
          continue; // servers may emit non-JSON banner lines on stdout
        }

        if (msg.error) {
          finish({ ok: false, error: msg.error.message ?? 'server returned an error' });
          return;
        }

        if (msg.id === 1 && msg.result) {
          const info = msg.result.serverInfo as { name?: string } | undefined;
          serverName = info?.name;
          send({ jsonrpc: '2.0', method: 'notifications/initialized' });
          send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
        }

        if (msg.id === 2 && msg.result) {
          const tools = msg.result.tools as unknown[] | undefined;
          finish({ ok: true, toolCount: Array.isArray(tools) ? tools.length : 0, serverName });
          return;
        }
      }
    });

    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'decibel-setup', version: '1.0.0' },
      },
    });
  });
}

// ============================================================================
// CLI Entry
// ============================================================================

const CLIENT_ALIASES: Record<string, ClientId> = {
  desktop: 'claude-desktop',
  'claude-desktop': 'claude-desktop',
  code: 'claude-code',
  'claude-code': 'claude-code',
  cursor: 'cursor',
};

export function parseSetupArgs(args: string[]): SetupOptions {
  const opts: SetupOptions = {
    dryRun: args.includes('--dry-run'),
    yes: args.includes('--yes') || args.includes('-y'),
    installDaemon: args.includes('--daemon'),
    verify: !args.includes('--no-verify'),
  };

  const clientsIdx = args.findIndex(a => a === '--clients' || a.startsWith('--clients='));
  if (clientsIdx !== -1) {
    const raw = args[clientsIdx].includes('=')
      ? args[clientsIdx].split('=')[1]
      : args[clientsIdx + 1];
    if (raw) {
      opts.clients = raw
        .split(',')
        .map(s => CLIENT_ALIASES[s.trim().toLowerCase()])
        .filter((c): c is ClientId => Boolean(c));
    }
  }

  const licenseIdx = args.findIndex(a => a === '--license' || a.startsWith('--license='));
  if (licenseIdx !== -1) {
    opts.license = args[licenseIdx].includes('=')
      ? args[licenseIdx].split('=')[1]
      : args[licenseIdx + 1];
  }

  return opts;
}

const HELP = `
Decibel Tools — setup

  npx ${PACKAGE_SPEC} setup [options]

Detects Claude Desktop, Claude Code, and Cursor, then writes the Decibel MCP
server entry into each one's config file. Existing settings are preserved and
the original file is backed up before any change.

Options:
  --dry-run              Show what would change, write nothing
  --yes, -y              Skip the confirmation prompt
  --clients a,b          Limit to: desktop, code, cursor
  --license <key>        Write a Pro license key to ~/.decibel/config.yaml
  --daemon               Also install the launchd background service (macOS)
  --no-verify            Skip the post-install connection check
  --help                 Show this message
`.trimStart();

/**
 * Run the setup wizard. Returns a process exit code.
 */
export async function runSetup(argv: string[]): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP);
    return 0;
  }

  const opts = parseSetupArgs(argv);
  const all = detectClients();
  const wanted = opts.clients?.length ? all.filter(c => opts.clients!.includes(c.id)) : all;
  const targets = wanted.filter(c => c.detected);

  console.log('\nDecibel Tools — setup\n');

  for (const c of all) {
    const included = targets.includes(c);
    const mark = included ? '✓' : '·';
    const note = c.detected
      ? included ? c.configPath : 'skipped (--clients)'
      : 'not installed';
    console.log(`  ${mark} ${c.label.padEnd(16)} ${note}`);
  }

  if (targets.length === 0) {
    console.log('\nNo supported clients detected. Nothing to do.');
    console.log('Install Claude Desktop, Claude Code, or Cursor and run this again.\n');
    return 1;
  }

  if (opts.dryRun) {
    console.log('\nDry run — no files will be written.\n');
    for (const client of targets) {
      const result = applyToClient(client, { dryRun: true });
      console.log(`  ${client.label}: would be ${describe(result.action)}`);
      if (result.error) console.log(`    ! ${result.error}`);
    }
    console.log('');
    return 0;
  }

  if (!opts.yes) {
    if (!process.stdin.isTTY) {
      console.log('\nRefusing to modify configs without confirmation.');
      console.log('Re-run with --yes (or --dry-run to preview).\n');
      return 1;
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question(`\nWrite Decibel into ${targets.length} client config(s)? [y/N] `)).trim().toLowerCase();
    rl.close();
    if (answer !== 'y' && answer !== 'yes') {
      console.log('Cancelled. Nothing was written.\n');
      return 1;
    }
  }

  console.log('');
  const results: ApplyResult[] = [];
  for (const client of targets) {
    const result = applyToClient(client);
    results.push(result);

    if (result.error) {
      console.log(`  ✗ ${client.label}: ${result.error}`);
    } else {
      console.log(`  ✓ ${client.label}: ${describe(result.action)}`);
      if (result.backupPath) console.log(`      backup: ${result.backupPath}`);
    }
  }

  // Optional license key
  if (opts.license) {
    try {
      const { writeLicenseKey, getConfigPath } = await import('./daemonConfig.js');
      writeLicenseKey(opts.license);
      console.log(`\n  ✓ License key written to ${getConfigPath()}`);
    } catch (err) {
      console.log(`\n  ✗ Could not write license key: ${errText(err)}`);
    }
  }

  // Optional launchd service
  if (opts.installDaemon) {
    if (osPlatform() !== 'darwin') {
      console.log('\n  · --daemon is macOS-only; skipped.');
    } else {
      try {
        const { installLaunchd } = await import('./daemon.js');
        const res = installLaunchd();
        console.log(`\n  ${res.installed ? '✓' : '✗'} ${res.message}`);
      } catch (err) {
        console.log(`\n  ✗ Daemon install failed: ${errText(err)}`);
      }
    }
  }

  // Verify the thing we just configured actually starts
  if (opts.verify) {
    const entry = buildServerEntry({ ...targets[0], useLoginShell: false });
    process.stdout.write('\n  … verifying server starts (first run downloads the package)');
    const check = await verifyServer(entry);
    if (check.ok) {
      console.log(`\r  ✓ Server responds — ${check.toolCount} tools available            `);
    } else {
      console.log(`\r  ✗ Verification failed: ${check.error}    `);
      console.log('    Config was still written; try launching your client to confirm.');
    }
  }

  const wrote = results.filter(r => r.action !== 'skipped' && r.action !== 'unchanged');
  const failed = results.filter(r => r.error);

  console.log('\nNext steps:');
  if (wrote.some(r => r.client.id === 'claude-desktop')) {
    console.log('  1. Fully quit Claude Desktop (⌘Q — closing the window is not enough) and reopen it.');
  }
  console.log('  2. In your client, ask: "Run registry init with path <your project path>"');
  console.log('  3. Then try: "What should I work on?"\n');

  return failed.length > 0 ? 1 : 0;
}

function describe(action: MergeAction | 'skipped'): string {
  switch (action) {
    case 'created': return 'config created';
    case 'added': return 'entry added';
    case 'updated': return 'entry updated';
    case 'unchanged': return 'already configured';
    case 'skipped': return 'skipped';
  }
}
