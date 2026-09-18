import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, statSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { writeFileAtomic } from '../../src/lib/atomicWrite.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'decibel-atomic-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('writeFileAtomic', () => {
  it('creates a new file', async () => {
    const target = path.join(dir, 'new.md');
    await writeFileAtomic(target, 'hello\n');
    expect(readFileSync(target, 'utf-8')).toBe('hello\n');
  });

  it('replaces an existing file', async () => {
    const target = path.join(dir, 'existing.md');
    writeFileSync(target, 'old content');
    await writeFileAtomic(target, 'new content');
    expect(readFileSync(target, 'utf-8')).toBe('new content');
  });

  it('leaves no temp files behind on success', async () => {
    // The issues directory is enumerated by readdir; a stray .tmp would be
    // picked up as a record by anything with a loose extension filter.
    const target = path.join(dir, 'clean.md');
    await writeFileAtomic(target, 'x');
    expect(readdirSync(dir)).toEqual(['clean.md']);
  });

  it('leaves no temp files behind when the write fails', async () => {
    // A directory as the target makes rename fail after the temp is written.
    const target = path.join(dir, 'a-directory');
    await fs.mkdir(target);
    await expect(writeFileAtomic(target, 'x')).rejects.toThrow();
    expect(readdirSync(dir)).toEqual(['a-directory']);
  });

  it('does not truncate the original when the write fails', async () => {
    // The whole point: a failed replacement must leave the previous content
    // intact rather than a zero-length file.
    const target = path.join(dir, 'precious.md');
    writeFileSync(target, 'ORIGINAL');
    // Make the containing directory read-only so the temp create fails.
    const sub = path.join(dir, 'ro');
    await fs.mkdir(sub);
    const victim = path.join(sub, 'record.md');
    writeFileSync(victim, 'ORIGINAL');
    await fs.chmod(sub, 0o500);
    try {
      await expect(writeFileAtomic(victim, 'REPLACEMENT')).rejects.toThrow();
      expect(readFileSync(victim, 'utf-8')).toBe('ORIGINAL');
    } finally {
      await fs.chmod(sub, 0o700);
    }
  });

  it('preserves the existing file mode', async () => {
    const target = path.join(dir, 'moded.md');
    writeFileSync(target, 'x');
    await fs.chmod(target, 0o640);
    await writeFileAtomic(target, 'y');
    expect(statSync(target).mode & 0o777).toBe(0o640);
  });

  it('writes the temp file as a sibling, not in os.tmpdir()', async () => {
    // rename(2) is only atomic within one filesystem. A temp in os.tmpdir()
    // silently degrades to copy+unlink across devices.
    const target = path.join(dir, 'sibling.md');
    let sawSibling = false;
    const original = fs.rename.bind(fs);
    // Intercept rename to inspect the source path.
    (fs as unknown as { rename: typeof fs.rename }).rename = async (from, to) => {
      sawSibling = path.dirname(String(from)) === path.dirname(String(to));
      return original(from, to);
    };
    try {
      await writeFileAtomic(target, 'z');
    } finally {
      (fs as unknown as { rename: typeof fs.rename }).rename = original;
    }
    expect(sawSibling).toBe(true);
  });

  it('round-trips content with newlines and unicode intact', async () => {
    const target = path.join(dir, 'unicode.md');
    const content = '---\ntitle: "Ré—sumé ✓"\n---\n\n# Body\n\nLine\twith tab\n';
    await writeFileAtomic(target, content);
    expect(readFileSync(target, 'utf-8')).toBe(content);
  });
});
