import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createIssue, closeIssue, listRepoIssues } from '../../src/tools/sentinel.js';
import { createTestContext, cleanupTestContext, TestContext } from '../utils/test-context.js';

/**
 * Round-trip and salvage-boundary tests for sentinel records.
 *
 * EPIC-0038 Phase 1c. These pin two behaviours that were previously unpinned:
 *
 *   1. create -> close -> re-read survives on both on-disk formats. 66 sentinel
 *      unit tests passed while `close_issue` was silently corrupting bare-YAML
 *      records, because none of them exercised the full round trip on a .yml
 *      record. The bug shipped, was found by reading data months later, and
 *      left 10 damaged files (ISS-0129).
 *
 *   2. The salvage boundary is column 0. `salvageBareYaml` finds the corrupted
 *      markdown tail with /^#{1,6}\s/ — anchored, no \s*. A legitimate markdown
 *      heading *indented inside* a `description: |-` block must therefore be
 *      left alone. If that regex ever loosens to /^\s*#/, real description
 *      content would be silently truncated. This fixture is the tripwire, and
 *      it exists specifically so Phase 2's repair migration can run against a
 *      pinned parser rather than a trusted one.
 */

describe('sentinel record round-trip', () => {
  let ctx: TestContext;
  let issuesDir: string;

  beforeEach(async () => {
    ctx = await createTestContext();
    issuesDir = path.join(ctx.rootDir, '.decibel', 'sentinel', 'issues');
    await fs.mkdir(issuesDir, { recursive: true });
  });

  afterEach(async () => {
    await cleanupTestContext(ctx);
  });

  it('survives create -> close -> re-read on a markdown record', async () => {
    const created = await createIssue({
      projectId: ctx.rootDir,
      severity: 'med',
      title: 'Round trip markdown',
      details: 'Some details.',
    });
    expect('id' in created).toBe(true);
    const id = (created as { id: string }).id;

    const closed = await closeIssue({
      projectId: ctx.rootDir,
      issue_id: id,
      resolution: 'Fixed by doing the thing.',
      status: 'closed',
    });
    expect('status' in closed && closed.status).toBe('closed');

    const listed = await listRepoIssues({ projectId: ctx.rootDir });
    expect('issues' in listed).toBe(true);
    const result = listed as { issues: Array<{ id: string; status: string }>; degraded?: number };

    // The record must still parse cleanly after being written twice.
    expect(result.degraded ?? 0).toBe(0);
  });

  it('survives create -> close -> re-read on a bare-YAML record', async () => {
    // The format that used to break. close_issue must write YAML fields here,
    // not append a markdown section.
    const file = path.join(issuesDir, 'ISS-0900-bare-yaml.yml');
    await fs.writeFile(
      file,
      ['id: ISS-0900', 'title: Bare yaml record', 'status: open', 'priority: low'].join('\n') + '\n'
    );

    await closeIssue({
      projectId: ctx.rootDir,
      issue_id: 'ISS-0900',
      resolution: 'Resolved cleanly.',
      status: 'closed',
    });

    const raw = await fs.readFile(file, 'utf-8');

    // The failure signature of the old bug: a markdown heading at column 0.
    expect(raw).not.toMatch(/^## Resolution/m);

    const listed = (await listRepoIssues({ projectId: ctx.rootDir })) as {
      issues: Array<{ id: string; status: string }>;
      degraded?: number;
    };
    expect(listed.degraded ?? 0).toBe(0);

    const found = listed.issues.find((i) => i.id.toUpperCase().startsWith('ISS-0900'));
    expect(found?.status).toBe('closed');
  });

  it('leaves an indented markdown heading inside a block scalar intact', async () => {
    // THE TRIPWIRE. A '#' at column 0 marks corruption; a '#' indented inside a
    // block scalar is legitimate content. If the salvage regex ever loosens,
    // this description gets truncated at "# Heading inside the block".
    const description = [
      'description: |-',
      '  Intro line.',
      '',
      '  # Heading inside the block',
      '',
      '  ## Subheading too',
      '',
      '  Trailing prose that must not be lost.',
    ].join('\n');

    const file = path.join(issuesDir, 'ISS-0901-block-scalar.yml');
    await fs.writeFile(
      file,
      ['id: ISS-0901', 'title: Block scalar record', 'status: open', description].join('\n') + '\n'
    );

    const listed = (await listRepoIssues({ projectId: ctx.rootDir })) as {
      issues: Array<{ id: string; title: string }>;
      degraded?: number;
      degraded_files?: string[];
    };

    // Valid YAML — it must parse normally, NOT via the salvage path.
    expect(listed.degraded_files ?? []).not.toContain('ISS-0901-block-scalar.yml');
    expect(listed.degraded ?? 0).toBe(0);

    const found = listed.issues.find((i) => i.id.toUpperCase().startsWith('ISS-0901'));
    expect(found?.title).toBe('Block scalar record');
  });

  it('still flags a genuinely corrupted record as degraded', async () => {
    // The other side of the boundary: heading at column 0, after the scalar.
    // This is the shape the old close_issue produced, and salvage must still
    // recover it rather than dropping the record from the list entirely.
    const file = path.join(issuesDir, 'ISS-0902-corrupted.yml');
    await fs.writeFile(
      file,
      [
        'id: ISS-0902',
        'title: Corrupted record',
        'status: open',
        'description: |-',
        '  Some description.',
        '',
        '## Resolution',
        '',
        'Already implemented.',
      ].join('\n') + '\n'
    );

    const listed = (await listRepoIssues({ projectId: ctx.rootDir })) as {
      issues: Array<{ id: string }>;
      degraded?: number;
      degraded_files?: string[];
    };

    expect(listed.degraded_files ?? []).toContain('ISS-0902-corrupted.yml');
    // Recovered, not dropped — a corrupted record must stay visible.
    expect(listed.issues.some((i) => i.id.toUpperCase().startsWith('ISS-0902'))).toBe(true);
  });
});
