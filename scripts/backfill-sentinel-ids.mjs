#!/usr/bin/env node
/**
 * Backfill ISS-NNNN ids into sentinel issue files that lack one.
 *
 * Project-scoped numbering: each project's issues directory has its own
 * sequence starting from max(existing) + 1. Filenames are preserved
 * (long human-friendly names stay; we only inject `id:` into frontmatter).
 *
 * Idempotent: files that already have an id are skipped.
 *
 * Usage:
 *   node backfill-sentinel-ids.mjs <issues-dir> [--apply]
 *   node backfill-sentinel-ids.mjs --all-projects [--apply]
 */

import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const allProjects = argv.includes('--all-projects');
const dirArg = argv.find((a) => !a.startsWith('--'));

const PROJECTS_FILE = path.join(process.env.HOME, '.decibel', 'projects.json');

function listProjectPaths() {
  if (!fs.existsSync(PROJECTS_FILE)) return [];
  const raw = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf-8'));
  // Tolerate either { projects: [...] } or [...] shapes
  const arr = Array.isArray(raw) ? raw : raw.projects || [];
  return arr.map((p) => p.path).filter(Boolean);
}

function backfillDir(dir) {
  if (!fs.existsSync(dir)) return { dir, skipped: 'no issues dir' };

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md') || f.endsWith('.yml'))
    .sort();
  if (files.length === 0) return { dir, total: 0, missing: 0, written: 0 };

  let maxN = 0;
  const hasId = new Set();
  for (const f of files) {
    const content = fs.readFileSync(path.join(dir, f), 'utf-8');
    const fnMatch = f.match(/^ISS-(\d{4,})/);
    if (fnMatch) {
      maxN = Math.max(maxN, parseInt(fnMatch[1], 10));
      hasId.add(f);
      continue;
    }
    const idMatch = content.split('\n').slice(0, 30).join('\n').match(/^id:\s*ISS-(\d{4,})\s*$/m);
    if (idMatch) {
      maxN = Math.max(maxN, parseInt(idMatch[1], 10));
      hasId.add(f);
    }
  }

  const missing = files.filter((f) => !hasId.has(f));
  function tsKey(f) {
    const m = f.match(/^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/);
    return m ? m[1] : '0000';
  }
  missing.sort((a, b) => tsKey(a).localeCompare(tsKey(b)) || a.localeCompare(b));

  let written = 0;
  let next = maxN + 1;
  for (const f of missing) {
    const newId = `ISS-${String(next).padStart(4, '0')}`;
    next++;
    if (!apply) continue;
    const full = path.join(dir, f);
    const content = fs.readFileSync(full, 'utf-8');
    let updated;
    if (f.endsWith('.md')) {
      updated = content.startsWith('---\n')
        ? content.replace(/^---\n/, `---\nid: ${newId}\n`)
        : `---\nid: ${newId}\n---\n\n${content}`;
    } else {
      updated = `id: ${newId}\n${content}`;
    }
    if (updated !== content) {
      fs.writeFileSync(full, updated, 'utf-8');
      written++;
    }
  }

  return { dir, total: files.length, hadId: hasId.size, missing: missing.length, maxBefore: maxN, written };
}

function main() {
  const dirs = [];
  if (allProjects) {
    for (const p of listProjectPaths()) {
      dirs.push(path.join(p, '.decibel', 'sentinel', 'issues'));
    }
  } else if (dirArg) {
    dirs.push(path.resolve(dirArg));
  } else {
    console.error('Usage: node backfill-sentinel-ids.mjs <dir> [--apply]');
    console.error('       node backfill-sentinel-ids.mjs --all-projects [--apply]');
    process.exit(1);
  }

  let totalFiles = 0;
  let totalMissing = 0;
  let totalWritten = 0;
  const reports = [];

  for (const d of dirs) {
    const r = backfillDir(d);
    reports.push(r);
    if (r.skipped) continue;
    totalFiles += r.total || 0;
    totalMissing += r.missing || 0;
    totalWritten += r.written || 0;
  }

  for (const r of reports) {
    if (r.skipped) {
      console.log(`SKIP  ${r.dir}  (${r.skipped})`);
    } else if (r.total === 0) {
      console.log(`EMPTY ${r.dir}`);
    } else {
      console.log(
        `${r.dir}\n  total=${r.total}  hadId=${r.hadId}  missing=${r.missing}  maxBefore=ISS-${String(r.maxBefore).padStart(4, '0')}  written=${r.written}`,
      );
    }
  }

  console.log('');
  console.log(`TOTAL across ${reports.length} dir(s): files=${totalFiles}  missing=${totalMissing}  written=${totalWritten}`);
  if (!apply) console.log('(dry run — pass --apply to write)');
}

main();
