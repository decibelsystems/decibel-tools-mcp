/**
 * Serialized ISS-NNNN allocation.
 *
 * The defect this closes: `create_issue` picked the next id by scanning the
 * issues directory for the current maximum, then wrote the file many awaits
 * later. Two processes could read the same maximum and both write ISS-0141.
 * Four duplicate-id groups exist on disk from exactly this (ISS-0015, ISS-0028,
 * ISS-0054, ISS-0112), reported independently by the `machina` peer and
 * reproduced locally.
 *
 * Two independent defences, because a lock only protects callers that take it:
 *
 *   1. The lock spans **allocation through successful write**, not just the id
 *      calculation. Serializing only the scan leaves the same race — both
 *      processes still compute 141 before either file lands.
 *
 *   2. The write itself is O_EXCL. If a caller bypasses the lock entirely — an
 *      old client, a migration script, a future mistake — a colliding write
 *      fails loudly with EEXIST instead of silently overwriting a real issue.
 *
 * Both `createIssue` implementations (src/tools/sentinel.ts and
 * src/sentinelIssues.ts) allocate from a single numbering space and write
 * different formats into the same directory, so they must share this path or
 * they race against each other.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { withFileLock } from './fileLock.js';

/** Lock file guarding id allocation, scoped per issues directory. */
const LOCK_FILENAME = '.issue-id.lock';

/** Records the allocator considers when scanning for the current maximum. */
function isRecordFile(filename: string): boolean {
  return /\.(md|yml|yaml)$/i.test(filename);
}

function frontmatterRegion(content: string): string | null {
  const delimited = /^---\n([\s\S]*?)\n---/.exec(content);
  if (delimited) return delimited[1];
  // Bare-YAML records have no delimiters; the whole head is the region.
  if (/^---/.test(content.trimStart())) return null;
  const headingIdx = content.split('\n').findIndex((l) => /^#{1,6}\s/.test(l));
  return headingIdx > 0 ? content.split('\n').slice(0, headingIdx).join('\n') : content;
}

export function formatIssueId(num: number): string {
  return `ISS-${num.toString().padStart(4, '0')}`;
}

/**
 * Highest ISS-NNNN currently present, by filename prefix or frontmatter id.
 *
 * Both sources are checked because the two record formats disagree: ISS-NNNN
 * files carry the id in the name, while timestamp-slug records carry it only in
 * frontmatter. Scanning one source alone under-counts and hands out an id that
 * is already taken.
 */
export async function scanMaxIssueNumber(issuesDir: string): Promise<number> {
  let max = 0;
  let files: string[];
  try {
    files = await fs.readdir(issuesDir);
  } catch {
    return 0; // Directory does not exist yet.
  }

  for (const file of files) {
    const prefixMatch = file.match(/^ISS-(\d+)/i);
    if (prefixMatch) {
      max = Math.max(max, parseInt(prefixMatch[1], 10));
      continue;
    }
    if (!isRecordFile(file)) continue;
    try {
      const content = await fs.readFile(path.join(issuesDir, file), 'utf-8');
      const region = frontmatterRegion(content);
      if (!region) continue;
      const idLine = region.split('\n').find((l) => l.trim().toLowerCase().startsWith('id:'));
      if (!idLine) continue;
      const idVal = idLine.slice(idLine.indexOf(':') + 1).trim();
      const idMatch = idVal.match(/^ISS-(\d+)$/i);
      if (idMatch) max = Math.max(max, parseInt(idMatch[1], 10));
    } catch {
      // Unreadable record — skip rather than abort the whole allocation.
    }
  }
  return max;
}

export interface AllocatedIssue {
  id: string;
  filename: string;
  filePath: string;
}

/**
 * Allocate the next ISS-NNNN and write the record, with both held under one
 * lock so no other process can allocate the same id in between.
 *
 * `buildContent` receives the allocated id because the id appears inside the
 * record body (frontmatter `id:`), so content cannot be built before allocation.
 *
 * On the rare EEXIST — a bypassing writer took the id between our scan and our
 * write — the allocation is retried rather than failed, up to `maxAttempts`.
 * Retrying is correct here: the id is genuinely taken, and the next one up is a
 * valid answer to the caller's request.
 */
export async function allocateAndWriteIssue(
  issuesDir: string,
  extension: 'md' | 'yml',
  slug: string,
  buildContent: (issueId: string) => string,
  options: { maxAttempts?: number; timeoutMs?: number } = {}
): Promise<AllocatedIssue> {
  const maxAttempts = options.maxAttempts ?? 5;
  const lockPath = path.join(issuesDir, LOCK_FILENAME);

  return withFileLock(
    lockPath,
    async () => {
      let next = (await scanMaxIssueNumber(issuesDir)) + 1;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const id = formatIssueId(next);
        const filename = `${id}-${slug}.${extension}`;
        const filePath = path.join(issuesDir, filename);
        try {
          // 'wx' is O_EXCL: fails rather than clobbering an existing record.
          await fs.writeFile(filePath, buildContent(id), { encoding: 'utf-8', flag: 'wx' });
          return { id, filename, filePath };
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
          next++; // Taken by a writer that did not hold the lock. Try the next.
        }
      }

      throw new Error(
        `Could not allocate an unused issue id in ${issuesDir} after ${maxAttempts} attempts ` +
          `(last tried ${formatIssueId(next - 1)}). The directory may contain records written ` +
          `by a process that bypasses id locking.`
      );
    },
    { timeoutMs: options.timeoutMs }
  );
}
