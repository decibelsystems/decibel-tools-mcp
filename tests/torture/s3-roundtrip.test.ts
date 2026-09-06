// ============================================================================
// S3 — Round-trip saturation (write/read pairs)
// ============================================================================
// Write a record with EVERY optional field populated, read it back, and assert
// nothing was silently dropped or mutated.
//
// The point is saturation. read_epic lost the notes that update_epic wrote
// (#72) because the round-trip that was tested used a record with the common
// fields set, and notes were not among them. A pair test that only exercises
// the fields everyone remembers proves only that those fields work.
//
// The hostile corpus targets the file format itself. These records live as YAML
// frontmatter inside markdown, so a value can be destroyed three ways: the YAML
// writer can emit something it cannot read back, the YAML reader can retype a
// string into a bool/int/date/null, and the markdown body can be confused with
// the frontmatter fence.
//
// Gate for 3.0: HARD for declared pairs; an unpaired write needs a waiver.
// ============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeSandbox, runInKernel, type SandboxPaths } from './harness.js';

let box: SandboxPaths;

beforeAll(() => { box = makeSandbox('s3'); });
afterAll(() => box?.cleanup());

/**
 * Values chosen to break a YAML round-trip, each with the failure it targets.
 * `label` is what a failure message names, so a red build says which class of
 * value broke rather than just printing the bytes.
 */
const HOSTILE: Array<{ label: string; value: string }> = [
  // YAML metacharacters — a naive writer emits these unquoted and cannot read
  // them back, or reads back only the part before the delimiter.
  { label: 'colon-space', value: 'before: after' },
  { label: 'hash', value: 'value # not a comment' },
  { label: 'document-marker', value: '--- not a new document' },
  { label: 'block-scalar-pipe', value: '| not a block scalar' },
  { label: 'block-scalar-gt', value: '> not a folded scalar' },
  { label: 'anchor', value: '&anchor not an anchor' },
  { label: 'alias', value: '*ref not an alias' },
  { label: 'explicit-tag', value: '!!str not a tag' },
  { label: 'leading-space', value: '   leading spaces' },
  { label: 'trailing-space', value: 'trailing spaces   ' },
  { label: 'single-quote', value: "it's a 'quoted' thing" },
  { label: 'double-quote', value: 'he said "hello" loudly' },

  // Type-ambiguous scalars — YAML 1.1 retypes every one of these unless the
  // writer quotes it. The assertion is that a string stays a string.
  { label: 'bool-true', value: 'true' },
  { label: 'bool-no', value: 'no' },
  { label: 'bool-yes', value: 'yes' },
  { label: 'float', value: '1.0' },
  { label: 'octal', value: '0755' },
  { label: 'date', value: '2026-09-02' },
  { label: 'null-word', value: 'null' },
  { label: 'null-tilde', value: '~' },
  { label: 'int', value: '42' },

  // Shape
  { label: 'multiline', value: 'first line\nsecond line\nthird line' },
  { label: 'crlf', value: 'first\r\nsecond' },
  { label: 'tabs', value: 'col1\tcol2\tcol3' },
  { label: 'very-long', value: 'x'.repeat(10_000) },

  // Unicode
  { label: 'emoji', value: 'ship it 🚢🔥' },
  { label: 'combining-marks', value: 'égalité' },
  { label: 'rtl', value: 'مرحبا بالعالم' },
  { label: 'zero-width-joiner', value: '👨‍👩‍👧' },
  { label: 'nfc-vs-nfd', value: 'é vs é' },

  // Markdown that collides with the on-disk format
  { label: 'frontmatter-fence', value: '---\nfake: frontmatter\n---' },
  { label: 'section-heading', value: '## Resolution' },
  { label: 'h1-heading', value: '# Title Line' },
];

interface RoundTrip {
  label: string;
  wrote: string;
  readBack: unknown;
  ok: boolean;
  note?: string;
}

describe('S3 — round-trip saturation: sentinel issues', () => {
  let results: RoundTrip[];

  beforeAll(() => {
    results = runInKernel<RoundTrip[]>(box.home, `
      const HOSTILE = ${JSON.stringify(HOSTILE)};
      const out: unknown[] = [];

      for (const { label, value } of HOSTILE) {
        const created = await call('sentinel', {
          action: 'create_issue',
          project_id: 'torture',
          severity: 'med',
          title: value,
          details: value,
          priority: 'medium',
          tags: [value],
        });

        const c = created.parsed as { id?: string; issue_id?: string } | undefined;
        const id = c?.issue_id ?? c?.id;
        if (!id) {
          out.push({ label, wrote: value, readBack: null, ok: false, note: 'create_issue returned no id: ' + created.text.slice(0, 160) });
          continue;
        }

        const read = await call('sentinel', { action: 'read_issue', project_id: 'torture', issue_id: id });
        const record = read.parsed as Record<string, unknown> | undefined;
        out.push({
          label,
          wrote: value,
          readBack: record?.title,
          ok: record?.title === value,
          note: read.isError ? 'read_issue failed: ' + read.text.slice(0, 160) : undefined,
        });
      }

      console.log('{RESULT}' + JSON.stringify(out));
    `);
  }, 900_000);

  it('creates and reads back every hostile value', () => {
    const uncreated = results.filter(r => r.note?.startsWith('create_issue returned no id'));
    expect(uncreated.map(r => r.label), 'create_issue refused these values').toEqual([]);
  });

  it('preserves the title exactly, for every hostile value', () => {
    // Deep equality on the written field. A value that reads back as a bool, an
    // int, a date, or a truncated string is data loss reported as success.
    const broken = results
      .filter(r => !r.ok && !r.note)
      .map(r => `${r.label}: wrote ${JSON.stringify(r.wrote.slice(0, 60))}, read ${JSON.stringify(String(r.readBack).slice(0, 60))}`);
    expect(broken, `${broken.length}/${results.length} hostile values did not survive the round trip`).toEqual([]);
  });

  it('reads back a type-ambiguous scalar as a STRING, not a bool/int/date', () => {
    const typed = ['bool-true', 'bool-no', 'bool-yes', 'float', 'octal', 'date', 'null-word', 'null-tilde', 'int'];
    const retyped = results
      .filter(r => typed.includes(r.label))
      .filter(r => typeof r.readBack !== 'string')
      .map(r => `${r.label}: read back as ${typeof r.readBack} (${JSON.stringify(r.readBack)})`);
    expect(retyped, 'YAML retyped a string value').toEqual([]);
  });
});

describe('S3 — round-trip saturation: epic notes (#72)', () => {
  let result: { noteWritten: string; writeOk?: boolean; writeText?: string; noteRead: unknown; titleRead: unknown; ok: boolean; text: string };

  beforeAll(() => {
    result = runInKernel(box.home, `
      const note = '## Resolution\\n\\nvalue: with colon\\n\\n--- not a fence ---\\n\\nemoji 🚢 and "quotes"';

      const created = await call('sentinel', {
        action: 'log_epic',
        project_id: 'torture',
        title: 'Round trip epic',
        summary: 'summary: with a colon',
        motivation: ['because: reasons'],
        outcomes: ['outcome # one'],
        acceptance_criteria: ['- [ ] nested marker'],
        priority: 'high',
        tags: ['tag: with colon', 'true'],
        owner: 'ben',
        squad: 'core',
      });
      // log_epic answers with epic_id; update_epic answers with id. Accept
      // either rather than assuming, since guessing wrong turns a product
      // assertion into a probe bug (it did, on the first run).
      const c = created.parsed as { id?: string; epic_id?: string };
      const id = c.epic_id ?? c.id;
      if (!id) {
        console.log('{RESULT}' + JSON.stringify({ noteWritten: note, noteRead: false, titleRead: null, ok: false, text: 'log_epic returned no id: ' + created.text.slice(0, 300) }));
        process.exit(0);
      }

      // Capture the WRITE result. Judging a read without proving the write ran
      // blames the reader for the writer's failure — which this probe did on
      // its first attempt, and which is exactly the mistake #72 itself was
      // nearly diagnosed as.
      const updated = await call('sentinel', { action: 'update_epic', project_id: 'torture', epic_id: id, note });

      const read = await call('sentinel', { action: 'read_epic', project_id: 'torture', epic_id: id });
      const record = read.parsed as Record<string, unknown>;
      const body = JSON.stringify(record);

      console.log('{RESULT}' + JSON.stringify({
        noteWritten: note,
        writeOk: !updated.isError,
        writeText: updated.text.slice(0, 300),
        noteRead: body.includes('Resolution') && body.includes('not a fence'),
        titleRead: record.title,
        ok: body.includes('Resolution'),
        text: JSON.stringify(record).slice(0, 600),
      }));
    `);
  }, 900_000);

  it('update_epic reports success when writing a note', () => {
    // Asserted FIRST and separately. If the write failed, the read assertion
    // below is meaningless and would send someone hunting in the wrong module.
    expect(result.writeOk, `update_epic failed: ${result.writeText}`).toBe(true);
  });

  it('read_epic returns the notes that update_epic wrote', () => {
    // PR #72 exactly: update_epic wrote the field, read_epic did not return it,
    // and the epic came back well-formed and short by one field. The write
    // succeeded, which is why it went unnoticed.
    expect(result.ok, `notes missing from read_epic. Got: ${result.text}`).toBe(true);
  });

  it('a note containing a frontmatter fence and a heading survives intact', () => {
    expect(result.noteRead, `note content mangled. Got: ${result.text}`).toBe(true);
  });
});
