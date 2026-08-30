import { describe, it, expect } from 'vitest';
import { decodeIssue, encodeIssue, type DecodedIssue } from '../../src/domain/issueCodec.js';

/**
 * The markdown format keeps prose under `## Details`. extractDetails used to
 * stop at the next `##` of any kind, which made the format unable to hold a
 * structured issue — and authors structure issues. 44 records in the store read
 * back truncated at their first `## Problem` / `## Root Cause` / `## Fix`.
 *
 * Only `## Resolution` is model-owned: encode regenerates it from
 * issue.resolution and decode reads it from frontmatter, so including it in
 * details would duplicate it and re-append it on every write.
 */

function md(body: string, frontmatter = 'id: ISS-0001\nstatus: open\n'): string {
  return `---\n${frontmatter}---\n${body}`;
}

const roundTrip = (details: string, resolution?: string) => {
  const body = [
    '# T', '', '**Status:** open', '', '## Details', '', details, '',
  ].join('\n');
  const decoded = {
    issue: { id: 'ISS-0001', title: 'T', status: 'open', details, resolution },
    format: 'md',
    raw: { data: {}, body },
    warnings: [],
  } as unknown as DecodedIssue;
  return decodeIssue('ISS-0001-t.md', encodeIssue(decoded)).issue;
};

describe('details extraction', () => {
  it('keeps prose past an author heading', () => {
    const body = '## Details\n\n## Problem\n\nIt breaks.\n\n## Fix\n\nMend it.\n';
    const d = decodeIssue('ISS-0001-t.md', md(body));
    expect(d.issue.details).toBe('## Problem\n\nIt breaks.\n\n## Fix\n\nMend it.');
  });

  it('keeps every section, not just the first', () => {
    const body = [
      '## Details', '',
      'Intro.', '',
      '## Root Cause', '', 'A race.', '',
      '## Impact', '', 'Data loss.', '',
      '## Required Changes', '', '- do the thing', '',
    ].join('\n');
    const d = decodeIssue('ISS-0001-t.md', md(body));
    expect(d.issue.details).toContain('Intro.');
    expect(d.issue.details).toContain('A race.');
    expect(d.issue.details).toContain('Data loss.');
    expect(d.issue.details).toContain('- do the thing');
  });

  it('excludes the model-owned Resolution section', () => {
    const body = [
      '## Details', '', 'The problem.', '',
      '## Resolution', '', 'Fixed in abc123.', '',
    ].join('\n');
    const d = decodeIssue('ISS-0001-t.md', md(body, 'id: ISS-0001\nstatus: closed\nresolution: Fixed in abc123.\n'));
    expect(d.issue.details).toBe('The problem.');
    expect(d.issue.details).not.toContain('Fixed in abc123.');
    expect(d.issue.resolution).toBe('Fixed in abc123.');
  });

  it('strips the trailing Resolution, keeping one discussed mid-body', () => {
    const body = [
      '## Details', '', 'Intro.', '',
      '## Resolution', '', 'An earlier attempt, described in the prose.', '',
      '## Follow-up', '', 'More detail.', '',
      '## Resolution', '', 'The real one.', '',
    ].join('\n');
    const d = decodeIssue('ISS-0001-t.md', md(body, 'id: ISS-0001\nstatus: closed\nresolution: The real one.\n'));
    expect(d.issue.details).toContain('An earlier attempt');
    expect(d.issue.details).toContain('More detail.');
    expect(d.issue.details).not.toContain('The real one.');
  });

  it('round-trips structured prose without loss', () => {
    const details = '## Problem\n\nThe tool fails.\n\n## Fix\n\nDo the thing.';
    expect(roundTrip(details).details).toBe(details);
  });

  it('round-trips structured prose alongside a resolution', () => {
    const details = '## Problem\n\nBroken.\n\n## Impact\n\nWide.';
    const out = roundTrip(details, 'Shipped in def456.');
    expect(out.details).toBe(details);
    expect(out.resolution).toBe('Shipped in def456.');
  });

  it('still returns undefined for an empty details section', () => {
    const d = decodeIssue('ISS-0001-t.md', md('## Details\n\n'));
    expect(d.issue.details).toBeUndefined();
  });

  it('leaves bare-YAML records alone — their prose is in description', () => {
    const d = decodeIssue('ISS-0001-t.yml', 'id: ISS-0001\nstatus: open\ndescription: |-\n  ## Problem\n\n  Broken.\n');
    expect(d.issue.details).toBe('## Problem\n\nBroken.');
  });
});
