/**
 * Atomic file replacement.
 *
 * `fs.writeFile` truncates the target and then streams bytes into it. A crash,
 * a full disk, or a killed process partway through leaves a truncated file —
 * and for Decibel that means a half-written issue or epic that no longer
 * parses. The store's own history has one class of corruption already
 * (ISS-0129); a partial write is a second, and unlike the first it would not be
 * recoverable by salvage, because there is nothing to salvage from.
 *
 * `rename(2)` within a filesystem is atomic: a concurrent reader sees either
 * the complete old file or the complete new one, never a mixture. So we write
 * a sibling temp file, flush it, and rename over the target.
 *
 * The temp file must live in the **same directory** as the target. `os.tmpdir()`
 * is frequently a different filesystem, where rename degrades to copy+unlink
 * and loses atomicity — silently, which is the worst way to lose it.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';

/**
 * Replace `filePath` with `content` atomically.
 *
 * Preserves the existing file's permissions when there is one, so replacing a
 * record does not quietly widen or narrow its mode.
 */
export async function writeFileAtomic(
  filePath: string,
  content: string,
  encoding: BufferEncoding = 'utf-8'
): Promise<void> {
  const dir = path.dirname(filePath);
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${randomBytes(6).toString('hex')}.tmp`);

  // Capture the current mode before writing so it can be carried over.
  let mode: number | undefined;
  try {
    mode = (await fs.stat(filePath)).mode;
  } catch {
    // New file — let the umask decide.
  }

  let handle: import('fs/promises').FileHandle | undefined;
  try {
    handle = await fs.open(tmpPath, 'wx', mode);
    await handle.writeFile(content, encoding);
    // Flush to disk before the rename. Without this the rename can be durable
    // while the data behind it is not, which on a crash yields an atomically
    // renamed empty file — a worse outcome than the partial write we set out
    // to avoid.
    await handle.sync();
    await handle.close();
    handle = undefined;

    await fs.rename(tmpPath, filePath);
  } catch (err) {
    if (handle) {
      try {
        await handle.close();
      } catch {
        // Already closed or never opened cleanly.
      }
    }
    // Never leave temp files behind for the next directory scan to trip over —
    // the issue store is enumerated by readdir, and a stray .tmp would be
    // treated as a record by anything with a loose filter.
    try {
      await fs.unlink(tmpPath);
    } catch {
      // Nothing to clean up.
    }
    throw err;
  }
}
