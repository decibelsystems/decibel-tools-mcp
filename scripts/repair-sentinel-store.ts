#!/usr/bin/env tsx
/**
 * EPIC-0038 Phase 2 — one-time sentinel store repair.
 *
 * Dry-run by default. Nothing is written without `--apply`.
 *
 * Six independent passes, each reportable and runnable on its own:
 *
 *   1. degraded  — records corrupted by the pre-4ecad91 close_issue, which
 *                  appended a markdown `## Resolution` section at column 0 into
 *                  bare-YAML files. That terminated the description block
 *                  scalar (invalid YAML) and the status write silently
 *                  no-opped, so genuinely-resolved issues still read `open`.
 *                  Repair: lift the markdown tail into a typed `resolution:`
 *                  field and set the status the original close intended.
 *
 *   2. duplicates — ids claimed by more than one record. Writers refuse these
 *                  (AMBIGUOUS_ISSUE_ID), so they are unreachable for update
 *                  until one record gives up the id. Which one is named
 *                  per-group in RETIRE with the evidence behind the choice, not
 *                  derived from a rule — reassigning an id changes an issue's
 *                  identity, and no rule survived contact with these four
 *                  groups. Requires --confirm-retire on top of --apply.
 *
 *   3. project    — `project:` frontmatter holding a stale project name or an
 *                  absolute path instead of the canonical project id.
 *
 *   4. mirror     — markdown records whose `**Status:**` body line disagrees
 *                  with frontmatter. The body is a human-readable mirror of
 *                  derived state; updateIssue changed the frontmatter without
 *                  it, so the record read `open` to a person and `closed` to
 *                  the tools. Frontmatter is authoritative; the mirror is
 *                  rewritten to match, never the reverse.
 *
 *   5. skeleton   — records whose frontmatter was terminated after the first
 *                  key, stranding the rest of it in the body as plain text.
 *                  Everything after the stray `---` was invisible to the
 *                  reader, so the record's real status never took effect.
 *                  Also backfills a title for records that have none, since
 *                  the reader was already displaying the raw filename in its
 *                  place. Found by the Phase 3 codec's corpus test, not by any
 *                  of the passes above.
 *
 *   6. uid       — stamp the stable identifier from the Phase 3 canonical
 *                  model onto records that predate it. ISS-NNNN is a label:
 *                  it is reassigned when duplicates are repaired and allocated
 *                  independently per checkout, which is how one issue became
 *                  ISS-0112 on one volume and ISS-0115 on another with nothing
 *                  in the data connecting them. uid is the identity.
 *
 * Every write goes through writeFileAtomic, so an interrupted migration cannot
 * leave a half-written record — which would be a worse corruption than the one
 * being repaired, because salvage cannot recover from a truncated file.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { writeFileAtomic } from '../src/lib/atomicWrite.js';
import { formatIssueId, scanMaxIssueNumber } from '../src/lib/issueIdAllocator.js';
import { isUid, newUid } from '../src/domain/issue.js';
import { decodeIssue, encodeIssue } from '../src/domain/issueCodec.js';

interface Options {
  issuesDir: string;
  projectId: string;
  apply: boolean;
  passes: Set<string>;
  /** Duplicates are only repaired when explicitly confirmed; see RETIRE. */
  confirmRetire: boolean;
}

interface Action {
  pass: string;
  file: string;
  change: string;
  detail?: string;
}

const RECORD_RE = /\.(md|ya?ml)$/i;

function isBareYaml(filename: string, content: string): boolean {
  return /\.ya?ml$/i.test(filename) && !/^---/.test(content.trimStart());
}

/** Split a bare-YAML record into its YAML head and any markdown tail at column 0. */
function splitBareYaml(content: string): { head: string; tail: string } {
  const lines = content.split('\n');
  const idx = lines.findIndex((l) => /^#{1,6}\s/.test(l));
  if (idx < 0) return { head: content, tail: '' };
  return { head: lines.slice(0, idx).join('\n'), tail: lines.slice(idx).join('\n') };
}

/** Text under a `## Resolution` heading, ignoring any later sections. */
function extractResolution(tail: string): string {
  const m = tail.match(/^##\s+Resolution\s*\n([\s\S]*?)(?=\n##\s|\s*$)/m);
  return m ? m[1].trim() : tail.replace(/^#{1,6}\s.*$/m, '').trim();
}

/**
 * The status the original close_issue call intended. A resolution that merely
 * redirects to another record is still a close — the work is tracked elsewhere,
 * not abandoned — so both land on `closed` rather than `wontfix`, and the
 * pointer survives in the resolution text either way.
 */
function intendedStatus(): 'closed' {
  return 'closed';
}

async function readRecords(dir: string): Promise<Array<{ file: string; content: string }>> {
  const names = (await fs.readdir(dir)).filter((f) => RECORD_RE.test(f));
  const out = [];
  for (const file of names) {
    out.push({ file, content: await fs.readFile(path.join(dir, file), 'utf-8') });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pass 1 — degraded records
// ---------------------------------------------------------------------------

async function passDegraded(opts: Options, actions: Action[]): Promise<void> {
  for (const { file, content } of await readRecords(opts.issuesDir)) {
    if (!isBareYaml(file, content)) continue;
    const { head, tail } = splitBareYaml(content);
    if (!tail.trim()) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = parseYaml(head) as Record<string, unknown>;
    } catch (err) {
      actions.push({
        pass: 'degraded',
        file,
        change: 'SKIP — head does not parse',
        detail: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    if (typeof parsed !== 'object' || parsed === null) continue;

    const resolution = extractResolution(tail);
    const target = intendedStatus();
    const before = String(parsed.status ?? 'unset');

    const changes: string[] = [];
    if (!parsed.resolution && resolution) changes.push('resolution → YAML field');
    if (before !== target) changes.push(`status ${before} → ${target}`);
    if (!parsed.closed_at) changes.push('closed_at stamped');
    if (changes.length === 0) continue;

    actions.push({
      pass: 'degraded',
      file,
      change: changes.join(', '),
      detail: resolution.slice(0, 90).replace(/\n/g, ' '),
    });

    if (opts.apply) {
      if (resolution && !parsed.resolution) parsed.resolution = resolution;
      parsed.status = target;
      parsed.closed_at ??= new Date().toISOString();
      parsed.updated_at = new Date().toISOString();
      await writeFileAtomic(
        path.join(opts.issuesDir, file),
        stringifyYaml(parsed, { lineWidth: 0 })
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Pass 2 — duplicate ids
// ---------------------------------------------------------------------------

/**
 * Which record gives up the id in each duplicate group, and why.
 *
 * This is a manifest rather than a rule on purpose. The first cut of this
 * script offered an `oldest-wins` policy and its own dry run showed the policy
 * picking wrong on at least half the groups — for ISS-0054 it would have
 * renumbered the file actually named ISS-0054 in favour of a test fixture, and
 * for ISS-0112 it would have renumbered the issue cited by ISS-0116 and by
 * oracle output. The four groups do not share a root cause, so they do not
 * share a repair.
 *
 * Read individually, none of them turned out to need a live issue renumbered:
 * every loser is already-closed legacy, a test fixture, or a stray copy. Three
 * of the four predate the ISS-NNNN allocator entirely (introduced 2026-04-28),
 * which is why no lock could have prevented them and why Phase 1's lock is not
 * evidence that these will recur.
 */
const RETIRE: Array<{ file: string; reason: string }> = [
  {
    file: 'ISS-0015-fix-sentinel-silent-fallback.yml',
    reason:
      'Duplicate of ISS-0015 (sentinel-falls-back-to-decibel-mcp-data), which carries the fuller description. Both records were already closed and each names the other as its duplicate; this one gives up the id. Pre-allocator (2025-12-17).',
  },
  {
    file: 'ISS-0028-voice-input-for-decibel-dojo-exp-0001-complete.yml',
    reason:
      'Genuinely distinct from ISS-0028 (package health scanning) but collided with it before ISS-NNNN allocation existed. Already closed as shipped; renumbered so both records stay addressable. Pre-allocator (2025-12-30).',
  },
  {
    file: '2025-12-14T23-20-45.237Z-memory-leak-detected.md',
    reason:
      'Test fixture from the 2025-12-14 seed batch (ISS-0054..ISS-0075), whose cleanup meta-tracker is already closed. It claimed ISS-0054 in frontmatter only; the real ISS-0054 (e2e spawn cost) keeps the id.',
  },
  {
    file: 'ISS-0112-one-click-mac-pc-installer-for-decibel-tools-non-t.md',
    reason:
      'Superseded by ISS-0115, which records the provenance: this issue was filed as ISS-0112 in the /Volumes/Kiki checkout, re-filed here as ISS-0115 because ISS-0112 was independently taken, and the Kiki copy was meant to be retired but was committed instead. Not a second issue — a stray copy.',
  },
];

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/**
 * Parse a record into a typed object plus whatever body follows it, so fields
 * are mutated as data and re-serialized rather than patched with regexes. A
 * migration that string-edits YAML is the same defect class it is repairing.
 */
function parseRecord(content: string): {
  data: Record<string, unknown>;
  body: string;
  delimited: boolean;
} | null {
  const fm = FRONTMATTER_RE.exec(content);
  try {
    if (fm) {
      const data = parseYaml(fm[1]) as Record<string, unknown>;
      if (typeof data !== 'object' || data === null) return null;
      return { data, body: fm[2], delimited: true };
    }
    const { head, tail } = splitBareYaml(content);
    const data = parseYaml(head) as Record<string, unknown>;
    if (typeof data !== 'object' || data === null) return null;
    return { data, body: tail, delimited: false };
  } catch {
    return null;
  }
}

function serializeRecord(rec: {
  data: Record<string, unknown>;
  body: string;
  delimited: boolean;
}): string {
  const yaml = stringifyYaml(rec.data, { lineWidth: 0 });
  if (!rec.delimited) return rec.body.trim() ? `${yaml}\n${rec.body}` : yaml;
  return `---\n${yaml}---\n${rec.body}`;
}

function recordId(file: string, content: string): string | null {
  const fromName = file.match(/^(ISS-\d+)/i);
  if (fromName) return fromName[1].toUpperCase();
  const parsed = parseRecord(content);
  const val = parsed?.data.id;
  return typeof val === 'string' && /^ISS-\d+$/i.test(val) ? val.toUpperCase() : null;
}

async function passDuplicates(opts: Options, actions: Action[]): Promise<void> {
  const records = await readRecords(opts.issuesDir);
  const byId = new Map<string, Array<{ file: string; content: string }>>();
  for (const r of records) {
    const id = recordId(r.file, r.content);
    if (!id) continue;
    byId.set(id, [...(byId.get(id) ?? []), r]);
  }

  // Seed from the live allocator so reassigned ids cannot collide with the next
  // id create_issue would hand out.
  let next = await scanMaxIssueNumber(opts.issuesDir);

  for (const [id, group] of [...byId.entries()].sort()) {
    if (group.length < 2) continue;

    const losers = group.filter((g) => RETIRE.some((r) => r.file === g.file));
    if (losers.length !== group.length - 1) {
      actions.push({
        pass: 'duplicates',
        file: group.map((g) => g.file).join(' + '),
        change: `NEEDS A DECISION — ${group.length} records claim ${id}, ${losers.length} listed in RETIRE`,
        detail: 'add the record that should give up the id to RETIRE, with the evidence for why',
      });
      continue;
    }

    const keeper = group.find((g) => !losers.includes(g))!;
    actions.push({
      pass: 'duplicates',
      file: keeper.file,
      change: `KEEPS ${id}`,
    });

    for (const loser of losers) {
      const reason = RETIRE.find((r) => r.file === loser.file)!.reason;
      const parsed = parseRecord(loser.content);
      if (!parsed) {
        actions.push({
          pass: 'duplicates',
          file: loser.file,
          change: 'SKIP — record does not parse',
        });
        continue;
      }

      const newId = formatIssueId(++next);
      const renamed = loser.file.replace(/^ISS-\d+/i, newId);
      actions.push({
        pass: 'duplicates',
        file: loser.file,
        change: `${id} → ${newId}, status ${String(parsed.data.status ?? 'unset')} → closed`,
        detail: `${renamed === loser.file ? 'frontmatter id only' : `renamed to ${renamed}`}  ·  ${reason.slice(0, 80)}`,
      });

      if (opts.confirmRetire && opts.apply) {
        const now = new Date().toISOString();
        parsed.data.id = newId;
        parsed.data.status = 'closed';
        parsed.data.closed_at ??= now;
        parsed.data.updated_at = now;
        parsed.data.resolution = parsed.data.resolution
          ? `${String(parsed.data.resolution)}\n\n${reason}`
          : reason;
        await writeFileAtomic(path.join(opts.issuesDir, renamed), serializeRecord(parsed));
        if (renamed !== loser.file) await fs.unlink(path.join(opts.issuesDir, loser.file));
      }
    }
  }

  if (opts.apply && !opts.confirmRetire && actions.some((a) => a.pass === 'duplicates')) {
    actions.push({
      pass: 'duplicates',
      file: '(all)',
      change: 'NOT APPLIED — reassigning an id changes an issue\'s identity',
      detail: 'pass --confirm-retire alongside --apply to write the reassignments above',
    });
  }
}

// ---------------------------------------------------------------------------
// Pass 3 — project field normalization
// ---------------------------------------------------------------------------

async function passProject(opts: Options, actions: Action[]): Promise<void> {
  for (const { file, content } of await readRecords(opts.issuesDir)) {
    const m = content.match(/^project:\s*(.+)$/m);
    if (!m) continue;
    const current = m[1].trim().replace(/^["']|["']$/g, '');
    if (current === opts.projectId) continue;

    actions.push({
      pass: 'project',
      file,
      change: `project: ${current} → ${opts.projectId}`,
      detail: current.startsWith('/') ? 'absolute path' : 'stale project name',
    });

    if (opts.apply) {
      await writeFileAtomic(
        path.join(opts.issuesDir, file),
        content.replace(/^project:\s*.+$/m, `project: ${opts.projectId}`)
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Pass 4 — status mirror drift
// ---------------------------------------------------------------------------

async function passMirror(opts: Options, actions: Action[]): Promise<void> {
  for (const { file, content } of await readRecords(opts.issuesDir)) {
    const fm = FRONTMATTER_RE.exec(content);
    if (!fm) continue; // Bare-YAML records have no body mirror to drift.

    const parsed = parseRecord(content);
    const truth = parsed?.data.status;
    if (typeof truth !== 'string') continue;

    const mirror = /^\*\*Status:\*\* (.*)$/m.exec(parsed!.body);
    if (!mirror || mirror[1].trim() === truth) continue;

    actions.push({
      pass: 'mirror',
      file,
      change: `**Status:** ${mirror[1].trim()} → ${truth}`,
      detail: 'frontmatter is authoritative',
    });

    if (opts.apply) {
      await writeFileAtomic(
        path.join(opts.issuesDir, file),
        serializeRecord({
          ...parsed!,
          body: parsed!.body.replace(/^\*\*Status:\*\* .*$/m, `**Status:** ${truth}`),
        })
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Pass 5 — skeletal / truncated records
// ---------------------------------------------------------------------------

/** Frontmatter keys that mark a stray body block as displaced frontmatter. */
const ISSUE_KEYS = ['status', 'severity', 'created_at', 'updated_at', 'projectId', 'project'];

/** "publish-updated-npm-package" -> "Publish updated npm package" */
function titleFromFilename(file: string): string {
  const stem = file
    .replace(/\.(md|ya?ml)$/i, '')
    .replace(/^ISS-\d+-/i, '')
    .replace(/^\d{4}-\d{2}-\d{2}T[\dZ.-]+-/i, '');
  const words = stem.replace(/-+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

async function passSkeleton(opts: Options, actions: Action[]): Promise<void> {
  for (const { file, content } of await readRecords(opts.issuesDir)) {
    const fm = FRONTMATTER_RE.exec(content);
    // Bare-YAML records cannot have displaced frontmatter — there is no
    // delimiter to terminate early — but they can still be missing a title.
    const delimited = fm !== null;
    const split = delimited ? null : splitBareYaml(content);

    let head: Record<string, unknown>;
    try {
      head = (parseYaml(delimited ? fm![1] : split!.head) as Record<string, unknown>) ?? {};
    } catch {
      continue; // Unparseable YAML is a different repair.
    }
    if (typeof head !== 'object' || head === null) continue;

    const changes: string[] = [];
    let body = delimited ? fm![2] : split!.tail;

    // A body that parses as YAML and carries issue keys the frontmatter lacks
    // is displaced frontmatter, not prose. Requiring the frontmatter to be
    // MISSING those keys keeps this off records that legitimately discuss
    // yaml in their body.
    const displacedRaw = delimited ? body.trim() : '';
    if (displacedRaw && !/^[#*]/.test(displacedRaw)) {
      let displaced: Record<string, unknown> | null = null;
      try {
        const parsed = parseYaml(displacedRaw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          displaced = parsed as Record<string, unknown>;
        }
      } catch {
        displaced = null;
      }

      const recovered = displaced
        ? ISSUE_KEYS.filter((k) => k in displaced! && !(k in head))
        : [];

      if (displaced && recovered.length > 0) {
        changes.push(`recovered ${recovered.join(', ')} from the body`);
        head = { ...head, ...displaced };
        body = '';
      }
    }

    // No title anywhere. The reader was already falling back to the raw
    // filename, so writing a readable form of it changes what a human sees,
    // not what the record means.
    const hasHeading = /^#\s+.+$/m.test(body);
    if (!hasHeading && !head.title) {
      const title = titleFromFilename(file);
      changes.push(`title backfilled from filename: "${title}"`);
      head.title = title;
    }

    if (changes.length === 0) continue;

    actions.push({
      pass: 'skeleton',
      file,
      change: changes.join(', '),
      detail: `status reads ${String(head.status ?? 'open')}`,
    });

    if (opts.apply) {
      head.updated_at = new Date().toISOString();
      const yaml = stringifyYaml(head, { lineWidth: 0 });
      // Rebuild in the format the record came in — turning a bare-YAML record
      // into a delimited one would change how every reader parses it.
      const rebuilt = delimited
        ? body.trim()
          ? `---\n${yaml}---\n${body}`
          : `---\n${yaml}---\n`
        : body.trim()
          ? `${yaml}\n${body}`
          : yaml;
      await writeFileAtomic(path.join(opts.issuesDir, file), rebuilt);
    }
  }
}

// ---------------------------------------------------------------------------
// Pass 6 — uid backfill
// ---------------------------------------------------------------------------

async function passUid(opts: Options, actions: Action[]): Promise<void> {
  for (const { file, content } of await readRecords(opts.issuesDir)) {
    const decoded = decodeIssue(file, content);
    if (isUid(decoded.issue.uid)) continue;

    // Seed each uid from the record's real creation time rather than now, so
    // UUIDv7's time ordering reflects when the issue was filed. Records with no
    // usable created_at fall back to the current time; they sort last, which is
    // the honest answer for "we do not know when this was created".
    const seed = Date.parse(decoded.issue.created_at ?? '');
    const uid = newUid(Number.isFinite(seed) ? seed : Date.now());

    actions.push({
      pass: 'uid',
      file,
      change: `uid ${uid}`,
      detail: decoded.issue.created_at
        ? `seeded from created_at ${decoded.issue.created_at}`
        : 'no created_at — seeded from now',
    });

    if (opts.apply) {
      await writeFileAtomic(
        path.join(opts.issuesDir, file),
        encodeIssue({ ...decoded, issue: { ...decoded.issue, uid } })
      );
    }
  }
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const arg = (name: string): string | undefined =>
    argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');

  const projectRoot = arg('project-root') ?? process.cwd();
  const opts: Options = {
    issuesDir: path.join(projectRoot, '.decibel', 'sentinel', 'issues'),
    projectId: arg('project-id') ?? path.basename(projectRoot),
    apply: argv.includes('--apply'),
    passes: new Set((arg('passes') ?? 'degraded,duplicates,project,mirror,skeleton,uid').split(',')),
    confirmRetire: argv.includes('--confirm-retire'),
  };

  const actions: Action[] = [];
  if (opts.passes.has('degraded')) await passDegraded(opts, actions);
  if (opts.passes.has('duplicates')) await passDuplicates(opts, actions);
  if (opts.passes.has('project')) await passProject(opts, actions);
  if (opts.passes.has('mirror')) await passMirror(opts, actions);
  if (opts.passes.has('skeleton')) await passSkeleton(opts, actions);
  if (opts.passes.has('uid')) await passUid(opts, actions);

  const mode = opts.apply ? 'APPLY' : 'DRY RUN — no files written';
  console.log(`\nSentinel store repair — ${mode}`);
  console.log(`  dir:     ${opts.issuesDir}`);
  console.log(`  project: ${opts.projectId}\n`);

  for (const pass of ['degraded', 'duplicates', 'project', 'mirror', 'skeleton', 'uid']) {
    const group = actions.filter((a) => a.pass === pass);
    if (!opts.passes.has(pass)) continue;
    console.log(`── ${pass} (${group.length})`);
    for (const a of group) {
      console.log(`   ${a.file}`);
      console.log(`      ${a.change}${a.detail ? `  ·  ${a.detail}` : ''}`);
    }
    if (group.length === 0) console.log('   nothing to do');
    console.log('');
  }

  const needsPolicy = actions.filter((a) => a.change.startsWith('NEEDS POLICY')).length;
  console.log(`${actions.length} action(s)${needsPolicy ? `, ${needsPolicy} awaiting a policy decision` : ''}`);
  if (!opts.apply && actions.length > 0) console.log('Re-run with --apply to write.\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
