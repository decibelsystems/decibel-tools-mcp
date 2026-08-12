import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  detectClients,
  buildServerEntry,
  mergeConfig,
  applyToClient,
  parseSetupArgs,
  type ClientTarget,
} from '../../src/setup.js';

const ENTRY = { command: 'npx', args: ['-y', '@decibelsystems/tools'] };

describe('setup — client detection', () => {
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'decibel-setup-'));
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('reports clients as undetected when their directories are absent', () => {
    const clients = detectClients({ home, platform: 'darwin' });
    expect(clients).toHaveLength(3);
    expect(clients.every(c => !c.detected)).toBe(true);
  });

  it('detects a client once its directory exists', () => {
    fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
    const cursor = detectClients({ home, platform: 'darwin' }).find(c => c.id === 'cursor');
    expect(cursor?.detected).toBe(true);
    expect(cursor?.configPath).toBe(path.join(home, '.cursor', 'mcp.json'));
  });

  it('targets ~/.claude.json for Claude Code, not settings.json', () => {
    // settings.json holds model/hooks/plugins; MCP servers live in ~/.claude.json
    // and a config written to the wrong file is silently ignored.
    const code = detectClients({ home, platform: 'darwin' }).find(c => c.id === 'claude-code');
    expect(code?.configPath).toBe(path.join(home, '.claude.json'));
  });

  it('detects Claude Code from either ~/.claude.json or ~/.claude/', () => {
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    expect(detectClients({ home, platform: 'darwin' }).find(c => c.id === 'claude-code')?.detected).toBe(true);

    const home2 = fs.mkdtempSync(path.join(os.tmpdir(), 'decibel-setup2-'));
    fs.writeFileSync(path.join(home2, '.claude.json'), '{}');
    expect(detectClients({ home: home2, platform: 'darwin' }).find(c => c.id === 'claude-code')?.detected).toBe(true);
    fs.rmSync(home2, { recursive: true, force: true });
  });

  it('uses the macOS Application Support path for Claude Desktop', () => {
    const desktop = detectClients({ home, platform: 'darwin' }).find(c => c.id === 'claude-desktop');
    expect(desktop?.configPath).toBe(
      path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
    );
    expect(desktop?.useLoginShell).toBe(true);
  });

  it('does not use the login-shell wrapper off macOS', () => {
    const desktop = detectClients({ home, platform: 'linux' }).find(c => c.id === 'claude-desktop');
    expect(desktop?.useLoginShell).toBe(false);
  });
});

describe('setup — server entry', () => {
  it('wraps Desktop on macOS in a login shell to survive PATH stripping', () => {
    const entry = buildServerEntry({ useLoginShell: true } as ClientTarget);
    expect(entry.command).toBe('/bin/zsh');
    expect(entry.args).toEqual(['-lc', 'npx -y @decibelsystems/tools']);
  });

  it('invokes npx directly everywhere else', () => {
    const entry = buildServerEntry({ useLoginShell: false } as ClientTarget);
    expect(entry).toEqual(ENTRY);
  });
});

describe('setup — merge', () => {
  it('creates a config from nothing', () => {
    const result = mergeConfig(null, ENTRY);
    expect(result.action).toBe('created');
    expect(JSON.parse(result.content).mcpServers['decibel-tools']).toEqual(ENTRY);
  });

  it('treats an empty file as new rather than malformed', () => {
    expect(mergeConfig('   \n', ENTRY).action).toBe('created');
  });

  it('preserves unrelated top-level keys such as Desktop preferences', () => {
    const existing = JSON.stringify({
      preferences: { theme: 'dark', nested: { a: 1 } },
      coworkUserFilesPath: '/Users/x/files',
    });
    const parsed = JSON.parse(mergeConfig(existing, ENTRY).content);
    expect(parsed.preferences).toEqual({ theme: 'dark', nested: { a: 1 } });
    expect(parsed.coworkUserFilesPath).toBe('/Users/x/files');
    expect(parsed.mcpServers['decibel-tools']).toEqual(ENTRY);
  });

  it('preserves other MCP servers', () => {
    const existing = JSON.stringify({
      mcpServers: { github: { command: 'npx', args: ['-y', 'server-github'] } },
    });
    const result = mergeConfig(existing, ENTRY);
    expect(result.action).toBe('added');
    const parsed = JSON.parse(result.content);
    expect(parsed.mcpServers.github).toEqual({ command: 'npx', args: ['-y', 'server-github'] });
    expect(parsed.mcpServers['decibel-tools']).toEqual(ENTRY);
  });

  it('is idempotent — a second run reports unchanged', () => {
    const first = mergeConfig(null, ENTRY);
    const second = mergeConfig(first.content, ENTRY);
    expect(second.action).toBe('unchanged');
    expect(second.content).toBe(first.content);
  });

  it('updates a stale decibel entry in place', () => {
    const existing = JSON.stringify({
      mcpServers: { 'decibel-tools': { command: 'node', args: ['/old/path.js'] } },
    });
    const result = mergeConfig(existing, ENTRY);
    expect(result.action).toBe('updated');
    expect(JSON.parse(result.content).mcpServers['decibel-tools']).toEqual(ENTRY);
  });

  it('replaces a non-object mcpServers value rather than crashing', () => {
    const parsed = JSON.parse(mergeConfig(JSON.stringify({ mcpServers: 'oops' }), ENTRY).content);
    expect(parsed.mcpServers['decibel-tools']).toEqual(ENTRY);
  });

  it('throws on malformed JSON so the caller can skip the file', () => {
    expect(() => mergeConfig('{ not json', ENTRY)).toThrow();
  });

  it('throws when the root is an array', () => {
    expect(() => mergeConfig('[]', ENTRY)).toThrow(/not a JSON object/);
  });
});

describe('setup — apply', () => {
  let dir: string;
  let client: ClientTarget;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'decibel-apply-'));
    client = {
      id: 'cursor',
      label: 'Cursor',
      configPath: path.join(dir, 'mcp.json'),
      detected: true,
      useLoginShell: false,
    };
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes a new config and creates missing parent directories', () => {
    client.configPath = path.join(dir, 'deep', 'nested', 'mcp.json');
    const result = applyToClient(client);
    expect(result.action).toBe('created');
    expect(JSON.parse(fs.readFileSync(client.configPath, 'utf-8')).mcpServers['decibel-tools']).toEqual(ENTRY);
  });

  it('backs up an existing config before modifying it', () => {
    const original = JSON.stringify({ preferences: { theme: 'dark' } });
    fs.writeFileSync(client.configPath, original);

    const result = applyToClient(client);
    expect(result.action).toBe('added');
    expect(result.backupPath).toBeDefined();
    expect(fs.readFileSync(result.backupPath!, 'utf-8')).toBe(original);
  });

  it('does not back up or rewrite when already configured', () => {
    applyToClient(client);
    const before = fs.readFileSync(client.configPath, 'utf-8');

    const second = applyToClient(client);
    expect(second.action).toBe('unchanged');
    expect(second.backupPath).toBeUndefined();
    expect(fs.readFileSync(client.configPath, 'utf-8')).toBe(before);
    expect(fs.readdirSync(dir).filter(f => f.includes('backup'))).toHaveLength(0);
  });

  it('leaves a malformed config untouched and reports the reason', () => {
    fs.writeFileSync(client.configPath, '{ broken');
    const result = applyToClient(client);
    expect(result.action).toBe('skipped');
    expect(result.error).toMatch(/not valid JSON/);
    expect(fs.readFileSync(client.configPath, 'utf-8')).toBe('{ broken');
  });

  it('writes nothing in dry-run mode', () => {
    const result = applyToClient(client, { dryRun: true });
    expect(result.action).toBe('created');
    expect(fs.existsSync(client.configPath)).toBe(false);
  });
});

describe('setup — arg parsing', () => {
  it('defaults to verifying and nothing else', () => {
    const opts = parseSetupArgs([]);
    expect(opts).toMatchObject({ dryRun: false, yes: false, installDaemon: false, verify: true });
    expect(opts.clients).toBeUndefined();
  });

  it('accepts --clients in both space and equals form', () => {
    expect(parseSetupArgs(['--clients', 'desktop,cursor']).clients).toEqual(['claude-desktop', 'cursor']);
    expect(parseSetupArgs(['--clients=code']).clients).toEqual(['claude-code']);
  });

  it('drops unknown client names instead of failing', () => {
    expect(parseSetupArgs(['--clients', 'desktop,notaclient']).clients).toEqual(['claude-desktop']);
  });

  it('reads a license key', () => {
    expect(parseSetupArgs(['--license', 'DCB-123']).license).toBe('DCB-123');
    expect(parseSetupArgs(['--license=DCB-456']).license).toBe('DCB-456');
  });

  it('honours --no-verify and -y', () => {
    const opts = parseSetupArgs(['--no-verify', '-y']);
    expect(opts.verify).toBe(false);
    expect(opts.yes).toBe(true);
  });
});
