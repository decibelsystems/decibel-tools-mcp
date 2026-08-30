#!/usr/bin/env node
// Measure resident memory of a booted MCP client, observed from OUTSIDE the
// process. `ps` is the observer, not process.memoryUsage(), so the number does
// not depend on the code being measured.
//
//   node scripts/measure-memory.mjs                    # all modes
//   node scripts/measure-memory.mjs --mode thin        # one mode
//   node scripts/measure-memory.mjs --samples 5        # median of N boots
//
// Thin and bridge modes require a runtime on 127.0.0.1:4888.

import { spawn, execFileSync } from 'child_process';
import { setTimeout as sleep } from 'timers/promises';

const arg = (flag, dflt) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : dflt;
};

const SETTLE_MS = Number(arg('--settle', 2500));
const SAMPLES = Number(arg('--samples', 3));
const ONLY = arg('--mode', null);

const MCP_FLOOR = `
  const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  const { ListToolsRequestSchema } = await import('@modelcontextprotocol/sdk/types.js');
  const s = new Server({ name: 'floor', version: '0' }, { capabilities: { tools: {} } });
  s.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));
  await s.connect(new StdioServerTransport());
  setInterval(() => {}, 1000);
`;

const MODES = [
  { name: 'bare node', argv: ['-e', 'setInterval(() => {}, 1000)'] },
  { name: 'mcp sdk imported', argv: ['-e', "import('@modelcontextprotocol/sdk/server/index.js').then(() => setInterval(() => {}, 1000))"] },
  { name: 'mcp stdio server (floor)', argv: ['--input-type=module', '-e', MCP_FLOOR] },
  { name: 'stdio (full)', argv: ['dist/server.js'] },
  { name: 'bridge', argv: ['dist/server.js', '--bridge'] },
  { name: 'thin', argv: ['dist/server.js', '--thin'] },
];

function rssKb(pid) {
  try {
    return Number(execFileSync('ps', ['-o', 'rss=', '-p', String(pid)]).toString().trim());
  } catch {
    return null;
  }
}

async function measureOnce(mode) {
  const child = spawn(process.execPath, mode.argv, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, DECIBEL_PRO: '1', DECIBEL_APPS: '1' },
  });
  let stderr = '';
  child.stderr.on('data', d => { stderr += d.toString(); });
  child.stdout.resume();

  let exited = false;
  child.on('exit', () => { exited = true; });

  await sleep(SETTLE_MS);

  if (exited) {
    const why = stderr.trim().split('\n').filter(Boolean).slice(-2).join(' | ');
    return { error: why || 'exited before settle' };
  }

  const kb = rssKb(child.pid);
  child.kill('SIGKILL');
  return kb === null ? { error: 'process vanished' } : { mb: kb / 1024 };
}

const median = xs => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

const modes = ONLY ? MODES.filter(m => m.name.includes(ONLY)) : MODES;
if (modes.length === 0) {
  console.error(`No mode matching "${ONLY}". Known: ${MODES.map(m => m.name).join(', ')}`);
  process.exit(1);
}

const results = [];
for (const mode of modes) {
  const runs = [];
  let failure = null;
  for (let i = 0; i < SAMPLES; i++) {
    const r = await measureOnce(mode);
    if (r.error) { failure = r.error; break; }
    runs.push(r.mb);
  }
  results.push({ name: mode.name, mb: failure ? null : median(runs), failure });
}

const width = Math.max(...results.map(r => r.name.length));
const baseline = results.find(r => r.name === 'bare node')?.mb;
console.log('');
console.log(`RSS after ${SETTLE_MS}ms, median of ${SAMPLES} boots, observed via ps:`);
console.log('');
for (const r of results) {
  if (r.failure) {
    console.log(`  ${r.name.padEnd(width)}   ${'—'.padStart(8)}   (${r.failure})`);
    continue;
  }
  const over = baseline && r.name !== 'bare node' ? `  +${(r.mb - baseline).toFixed(1)} MB over bare node` : '';
  console.log(`  ${r.name.padEnd(width)}   ${r.mb.toFixed(1).padStart(6)} MB${over}`);
}
console.log('');
