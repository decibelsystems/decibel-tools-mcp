#!/usr/bin/env tsx
/**
 * EPIC-0038 Phase 5, representation half: convert bare-YAML issue records to
 * the canonical markdown format.
 *
 *   npx tsx scripts/migrate-issue-format.ts [--project <id>]   # dry run
 *   npx tsx scripts/migrate-issue-format.ts --apply
 *
 * Safe to run only because Phase 5's behaviour half landed first: there is one
 * writer now, so nothing re-emits .yml behind this.
 *
 * Conversion goes through the real codec — decodeIssue/encodeIssue — rather
 * than reimplementing either format. The one thing the codec cannot do for us
 * is invent a markdown body: bare YAML keeps prose in `description:`, markdown
 * keeps it under `## Details`, and encode() writes `description` ONLY for
 * format 'yaml'. Flipping the format with an empty body would therefore drop
 * the entire issue text and report success. So the body is built here, in the
 * layout FsIssueRepository.create uses, and then:
 *
 *   EVERY record is re-decoded from its own new bytes and compared field by
 *   field against the original before anything is written. A record that does
 *   not round-trip is skipped and reported, never written.
 *
 * That check is not ceremony. `extractDetails` reads to the next `##` heading,
 * so any issue whose prose contains one would silently truncate — this is how
 * that gets caught rather than discovered later.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { decodeIssue, encodeIssue, type DecodedIssue } from '../src/domain/issueCodec.js';
import type { Issue } from '../src/domain/issue.js';
import { resolveProjectPaths } from '../src/projectRegistry.js';

const APPLY = process.argv.includes('--apply');
const projIdx = process.argv.indexOf('--project');
const PROJECT = projIdx !== -1 ? process.argv[projIdx + 1] : undefined;

/** The markdown writer's layout. Kept in step with FsIssueRepository.create. */
function buildBody(issue: Issue): string {
  const lines = [`# ${issue.title}`, ''];
  if (issue.severity) lines.push(`**Severity:** ${issue.severity}`);
  lines.push(`**Status:** ${issue.status}`);
  if (issue.epicId) lines.push(`**Epic:** ${issue.epicId}`);
  lines.push('', '## Details', '', issue.details ?? '', '');
  return lines.join('\n');
}

/** Fields compared for round-trip equality. Everything the model carries. */
const FIELDS: Array<keyof Issue> = [
  'uid', 'id', 'title', 'status', 'severity', 'priority', 'epicId',
  'project', 'details', 'resolution', 'created_at', 'updated_at', 'closed_at',
];

/**
 * Prose is compared with trailing whitespace normalised, because YAML's `|`
 * keeps the final newline and `|-` strips it, and the markdown reader trims.
 * Three records differ by exactly that one character and nothing else.
 *
 * This is deliberately the ONLY slack in the comparison. Truncation — the
 * failure this check exists to catch — removes whole sections, so it still
 * fails loudly.
 */
const sameProse = (a?: string, b?: string) => (a ?? '').trimEnd() === (b ?? '').trimEnd();

function diffIssues(before: Issue, after: Issue): string[] {
  const problems: string[] = [];
  for (const f of FIELDS) {
    const a = before[f];
    const b = after[f];
    if (f === 'details' || f === 'resolution') {
      if (!sameProse(a as string | undefined, b as string | undefined)) {
        problems.push(
          `${f}: ${(a as string ?? '').length} chars -> ${(b as string ?? '').length} chars`
        );
      }
      continue;
    }
    if ((a ?? undefined) !== (b ?? undefined)) {
      problems.push(`${f}: ${JSON.stringify(a)?.slice(0, 60)} -> ${JSON.stringify(b)?.slice(0, 60)}`);
    }
  }
  const ta = (before.tags ?? []).join(',');
  const tb = (after.tags ?? []).join(',');
  if (ta !== tb) problems.push(`tags: [${ta}] -> [${tb}]`);
  return problems;
}

async function main() {
  const resolved = resolveProjectPaths(PROJECT);
  const dir = resolved.subPath('sentinel', 'issues');
  const files = (await fs.readdir(dir)).filter(f => /\.(yml|yaml)$/i.test(f)).sort();

  console.log('');
  console.log(`  project   ${resolved.id}`);
  console.log(`  directory ${dir}`);
  console.log(`  bare-YAML records ${files.length}`);
  console.log(`  mode      ${APPLY ? 'APPLY — files will be rewritten' : 'DRY RUN — nothing is written'}`);
  console.log('');

  const converted: string[] = [];
  const skipped: Array<{ file: string; why: string[] }> = [];
  const collisions: string[] = [];

  for (const file of files) {
    const src = path.join(dir, file);
    const content = await fs.readFile(src, 'utf-8');
    const decoded = decodeIssue(file, content);

    if (decoded.format !== 'yaml') {
      skipped.push({ file, why: ['already markdown — decoder disagrees with the extension'] });
      continue;
    }
    if (decoded.warnings.length) {
      skipped.push({ file, why: [`decoded with warnings: ${decoded.warnings.join('; ')}`] });
      continue;
    }

    const target = file.replace(/\.(yml|yaml)$/i, '.md');
    const dest = path.join(dir, target);
    try {
      await fs.access(dest);
      collisions.push(`${file} -> ${target} (target exists)`);
      continue;
    } catch { /* free */ }

    const asMarkdown: DecodedIssue = {
      issue: decoded.issue,
      format: 'md',
      // Unknown keys carried through; body rebuilt because bare YAML has none.
      raw: { data: decoded.raw.data, body: buildBody(decoded.issue) },
      warnings: [],
    };
    const encoded = encodeIssue(asMarkdown);

    // Verify against the bytes that would actually land, not against intent.
    const reread = decodeIssue(target, encoded);
    const problems = diffIssues(decoded.issue, reread.issue);
    if (reread.warnings.length) problems.push(`re-read warnings: ${reread.warnings.join('; ')}`);
    if (problems.length) {
      skipped.push({ file, why: problems });
      continue;
    }

    if (APPLY) {
      await fs.writeFile(dest, encoded, 'utf-8');
      await fs.unlink(src);
    }
    converted.push(`${file} -> ${target}`);
  }

  console.log(`  would convert : ${converted.length}`);
  console.log(`  skipped       : ${skipped.length}`);
  console.log(`  collisions    : ${collisions.length}`);
  console.log('');
  if (collisions.length) {
    console.log('  COLLISIONS (nothing written for these):');
    for (const c of collisions) console.log(`    ${c}`);
    console.log('');
  }
  if (skipped.length) {
    console.log('  SKIPPED — these do not round-trip and were left alone:');
    for (const s of skipped) {
      console.log(`    ${s.file}`);
      for (const w of s.why) console.log(`        ${w}`);
    }
    console.log('');
  }
  if (!APPLY && converted.length) {
    console.log('  Re-run with --apply to write. Records are git-tracked, so `git checkout`');
    console.log('  reverts the whole migration.');
    console.log('');
  }

  if (skipped.length || collisions.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('migration failed:', err);
  process.exit(1);
});
