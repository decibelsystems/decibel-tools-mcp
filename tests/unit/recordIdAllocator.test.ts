import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import {
  allocateAndWriteIssue,
  scanMaxIssueNumber,
  formatIssueId,
} from '../../src/lib/recordIdAllocator.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'decibel-alloc-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('scanMaxIssueNumber', () => {
  it('returns 0 for a directory that does not exist', async () => {
    expect(await scanMaxIssueNumber(path.join(dir, 'nope'))).toBe(0);
  });

  it('returns 0 for an empty directory', async () => {
    expect(await scanMaxIssueNumber(dir)).toBe(0);
  });

  it('reads the id from the filename prefix', async () => {
    writeFileSync(path.join(dir, 'ISS-0042-something.md'), 'x');
    expect(await scanMaxIssueNumber(dir)).toBe(42);
  });

  it('reads the id from frontmatter when the filename carries none', async () => {
    // timestamp-slug records keep their id only in frontmatter. Scanning
    // filenames alone under-counts and re-issues a taken id.
    writeFileSync(
      path.join(dir, '2026-01-01T00-00-00Z-some-slug.md'),
      '---\nid: ISS-0077\nstatus: open\n---\n\n# Title\n'
    );
    expect(await scanMaxIssueNumber(dir)).toBe(77);
  });

  it('reads the id from a bare-YAML record', async () => {
    writeFileSync(path.join(dir, 'legacy.yml'), 'id: ISS-0055\nstatus: open\n');
    expect(await scanMaxIssueNumber(dir)).toBe(55);
  });

  it('takes the maximum across mixed formats and naming schemes', async () => {
    writeFileSync(path.join(dir, 'ISS-0010-a.md'), 'x');
    writeFileSync(path.join(dir, 'legacy.yml'), 'id: ISS-0099\n');
    writeFileSync(
      path.join(dir, '2026-01-01T00-00-00Z-b.md'),
      '---\nid: ISS-0050\n---\n\n# B\n'
    );
    expect(await scanMaxIssueNumber(dir)).toBe(99);
  });

  it('skips unreadable records rather than aborting the scan', async () => {
    writeFileSync(path.join(dir, 'ISS-0007-ok.md'), 'x');
    writeFileSync(path.join(dir, 'garbage.md'), '\0\0not yaml at all');
    expect(await scanMaxIssueNumber(dir)).toBe(7);
  });

  it('ignores non-record files', async () => {
    writeFileSync(path.join(dir, 'ISS-0003-a.md'), 'x');
    writeFileSync(path.join(dir, 'README.txt'), 'id: ISS-9999');
    expect(await scanMaxIssueNumber(dir)).toBe(3);
  });
});

describe('allocateAndWriteIssue', () => {
  it('allocates the first id in an empty directory', async () => {
    const result = await allocateAndWriteIssue(dir, 'md', 'first', (id) => `id: ${id}\n`);
    expect(result.id).toBe('ISS-0001');
    expect(result.filename).toBe('ISS-0001-first.md');
    expect(await fs.readFile(result.filePath, 'utf-8')).toBe('id: ISS-0001\n');
  });

  it('continues from the existing maximum', async () => {
    writeFileSync(path.join(dir, 'ISS-0140-prev.md'), 'x');
    const result = await allocateAndWriteIssue(dir, 'md', 'next', (id) => `id: ${id}\n`);
    expect(result.id).toBe('ISS-0141');
  });

  it('honours the requested extension', async () => {
    const result = await allocateAndWriteIssue(dir, 'yml', 'y', (id) => `id: ${id}\n`);
    expect(result.filename.endsWith('.yml')).toBe(true);
  });

  it('passes the allocated id to the content builder', async () => {
    // The id appears inside the record body, so content cannot be built
    // before allocation.
    const result = await allocateAndWriteIssue(dir, 'md', 's', (id) => `---\nid: ${id}\n---\n`);
    expect(await fs.readFile(result.filePath, 'utf-8')).toContain(result.id);
  });

  it('skips past an id taken by a writer that bypassed the lock', async () => {
    // Simulates an old client or migration script that wrote directly.
    writeFileSync(path.join(dir, 'ISS-0001-squatter.md'), 'x');
    // Scan sees max=1 → tries 2. Pre-take 2 as well to force a second skip.
    writeFileSync(path.join(dir, 'ISS-0002-squatter.md'), 'x');
    const result = await allocateAndWriteIssue(dir, 'md', 's', (id) => `id: ${id}\n`);
    expect(result.id).toBe('ISS-0003');
  });

  it('never overwrites an existing record', async () => {
    const victim = path.join(dir, 'ISS-0001-precious.md');
    writeFileSync(victim, 'ORIGINAL CONTENT');
    await allocateAndWriteIssue(dir, 'md', 'precious', (id) => `id: ${id}\n`);
    expect(await fs.readFile(victim, 'utf-8')).toBe('ORIGINAL CONTENT');
  });

  it('releases the lock when the content builder throws', async () => {
    await expect(
      allocateAndWriteIssue(dir, 'md', 's', () => {
        throw new Error('builder exploded');
      })
    ).rejects.toThrow('builder exploded');

    // A wedged lock would make every later write on this machine time out.
    const after = await allocateAndWriteIssue(dir, 'md', 'ok', (id) => `id: ${id}\n`);
    expect(after.id).toBe('ISS-0001');
  });

  it('assigns distinct ids to concurrent in-process allocations', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        allocateAndWriteIssue(dir, 'md', `c${i}`, (id) => `id: ${id}\n`)
      )
    );
    const ids = results.map((r) => r.id);
    expect(new Set(ids).size).toBe(20);
    // Contiguous 1..20, so nothing was skipped or double-allocated.
    expect([...ids].sort()).toEqual(
      Array.from({ length: 20 }, (_, i) => formatIssueId(i + 1)).sort()
    );
  });
});

describe('allocateAndWriteIssue — cross-process', () => {
  it('assigns distinct ids when separate processes allocate simultaneously', () => {
    // The in-process test above only proves the async lock serializes within
    // one event loop. The actual defect is cross-process: seven MCP servers
    // reading the same maximum. This spawns real processes to prove O_EXCL +
    // the file lock hold across process boundaries.
    // Deliberately the compiled output, not the source: the point is to run
    // real `node` children, and a child cannot import TypeScript. This makes
    // the test depend on a prior build — CI therefore builds before `npm test`
    // (see .github/workflows/ci.yml). Fail with that explanation rather than
    // an opaque ERR_MODULE_NOT_FOUND from inside a child process.
    const allocatorUrl = new URL('../../dist/lib/recordIdAllocator.js', import.meta.url).pathname;
    if (!require('fs').existsSync(allocatorUrl)) {
      throw new Error(
        `Cross-process test requires a build: ${allocatorUrl} is missing. Run \`npm run build\` first.`
      );
    }

    const script = `
      import { allocateAndWriteIssue } from ${JSON.stringify(allocatorUrl)};
      const dir = process.argv[2];
      const tag = process.argv[3];
      const out = [];
      for (let i = 0; i < 5; i++) {
        const r = await allocateAndWriteIssue(dir, 'md', tag + '-' + i, (id) => 'id: ' + id + '\\n');
        out.push(r.id);
      }
      process.stdout.write(JSON.stringify(out));
    `;
    const scriptPath = path.join(dir, 'alloc-child.mjs');
    writeFileSync(scriptPath, script);

    const WORKERS = 4;
    const PER_WORKER = 5;

    // Launch all workers, then collect — execFileSync is blocking, so stagger
    // via a single shell that backgrounds each child and waits.
    const shell = [
      ...Array.from(
        { length: WORKERS },
        (_, w) =>
          `node ${JSON.stringify(scriptPath)} ${JSON.stringify(dir)} w${w} > ${JSON.stringify(
            path.join(dir, `out${w}.json`)
          )} &`
      ),
      'wait',
    ].join('\n');
    execFileSync('/bin/sh', ['-c', shell], { cwd: dir });

    const all: string[] = [];
    for (let w = 0; w < WORKERS; w++) {
      const raw = require('fs').readFileSync(path.join(dir, `out${w}.json`), 'utf-8');
      all.push(...(JSON.parse(raw) as string[]));
    }

    expect(all.length).toBe(WORKERS * PER_WORKER);
    // The whole point: no id handed out twice across processes.
    expect(new Set(all).size).toBe(WORKERS * PER_WORKER);

    // And every record actually landed on disk — an id claimed but not written
    // would be a silent loss.
    const written = require('fs')
      .readdirSync(dir)
      .filter((f: string) => /^ISS-\d+.*\.md$/.test(f));
    expect(written.length).toBe(WORKERS * PER_WORKER);
  }, 30_000);
});
