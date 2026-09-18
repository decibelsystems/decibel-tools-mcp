#!/usr/bin/env node
// Cost of importing a module, observed from outside the process.
//   node scripts/probe-import.mjs yaml ./dist/daemonConfig.js ...
import { spawn, execFileSync } from 'child_process';
import { setTimeout as sleep } from 'timers/promises';

const targets = process.argv.slice(2);
if (!targets.length) {
  console.error('usage: probe-import.mjs <specifier> [...]');
  process.exit(1);
}

async function probe(spec) {
  const code = spec === '-'
    ? 'setInterval(() => {}, 1000)'
    : `import(${JSON.stringify(spec)}).then(() => setInterval(() => {}, 1000), e => { console.error(e.message); process.exit(1); })`;
  const child = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  child.stderr.on('data', d => { err += d; });
  let dead = false;
  child.on('exit', () => { dead = true; });
  await sleep(1800);
  if (dead) return { spec, error: err.trim().split('\n')[0] || 'exited' };
  const kb = Number(execFileSync('ps', ['-o', 'rss=', '-p', String(child.pid)]).toString().trim());
  child.kill('SIGKILL');
  return { spec, mb: kb / 1024 };
}

const rows = [{ spec: '- (bare node)', ...(await probe('-')) }];
for (const t of targets) rows.push(await probe(t));
const base = rows[0].mb;
const w = Math.max(...rows.map(r => r.spec.length));
console.log('');
for (const r of rows) {
  if (r.error) { console.log(`  ${r.spec.padEnd(w)}   —  (${r.error})`); continue; }
  const delta = r.spec.startsWith('-') ? '' : `  +${(r.mb - base).toFixed(1)} MB`;
  console.log(`  ${r.spec.padEnd(w)}   ${r.mb.toFixed(1).padStart(6)} MB${delta}`);
}
console.log('');
