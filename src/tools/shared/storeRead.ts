// ============================================================================
// Store reads that tell you when they could not look
// ============================================================================
// ISS-0153. Every failure this project has actually shipped returned ok: true.
// The voice inbox was dead for 5½ hours and the digest said `voice 0`. A
// regenerated plist dropped four facades and /health said `status: ok`. Ten of
// thirty-four projects reported zero provenance events while demonstrably
// holding some.
//
// The shape is always the same: a bare `catch {}` around a directory read or a
// parse, returning the empty case. Four genuinely different situations —
//
//     the store is empty
//     the store cannot be read        (permissions)
//     the records cannot be parsed    (corrupt)
//     the project does not resolve    (typo, unregistered)
//
// — collapse into one answer, and the caller cannot tell "nothing to report"
// from "I could not look."
//
// These helpers keep the four apart. The contract a caller can rely on:
//
//   store_status      says WHICH of the four happened
//   unreadable_count  is > 0 whenever records were skipped
//
// A read that reports `store_status: 'ok'` with `unreadable_count: 0` is
// making a positive claim that it saw everything. Nothing else here does.
// ============================================================================

import fs from 'fs/promises';
import path from 'path';

export type StoreStatus =
  /** The read saw the whole store. */
  | 'ok'
  /** The store genuinely holds nothing. */
  | 'empty'
  /** The store exists but could not be opened — permissions, or an I/O error. */
  | 'unreadable'
  /** Records were present; some could not be read or parsed. See unreadable_count. */
  | 'partial'
  /** The project id names nothing this machine knows about. */
  | 'project_unresolved';

export interface StoreListing {
  /** Filenames that survived, relative to the directory. */
  files: string[];
  store_status: StoreStatus;
  /** Records present but skipped. Always 0 unless store_status is 'partial'. */
  unreadable_count: number;
  /** Present when the directory could not be opened at all. */
  reason?: string;
}

export interface StoreRead<T> {
  entries: T[];
  store_status: StoreStatus;
  unreadable_count: number;
  reason?: string;
}

/**
 * List a store directory, distinguishing "not there" from "cannot open it".
 *
 * ENOENT is the empty case and is the ONLY error treated as empty: a directory
 * that has never been created is what an untouched project looks like. Every
 * other errno — EACCES, EPERM, ENOTDIR, EIO — means the data may well exist and
 * this process cannot see it, which is a different answer and must not be
 * reported as emptiness.
 */
export async function listStoreDir(
  dir: string,
  filter: (name: string) => boolean = () => true
): Promise<StoreListing> {
  try {
    const names = await fs.readdir(dir);
    const files = names.filter(filter);
    return {
      files,
      store_status: files.length === 0 ? 'empty' : 'ok',
      unreadable_count: 0,
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return { files: [], store_status: 'empty', unreadable_count: 0 };
    }
    return {
      files: [],
      store_status: 'unreadable',
      unreadable_count: 0,
      reason: `${code ?? 'unknown'}: ${dir}`,
    };
  }
}

/**
 * Read and parse every file in a store directory, COUNTING what it had to skip.
 *
 * A per-record failure does not abort the listing — one corrupt record should
 * not hide the other ninety-nine — but it is counted, because a silently short
 * list is a lie the caller has no way to detect. A parser returning null counts
 * as the same loss as a parser throwing: in both cases a record that exists is
 * missing from the answer.
 */
export async function readStoreDir<T>(
  dir: string,
  parse: (filePath: string, name: string) => Promise<T | null> | T | null,
  filter: (name: string) => boolean = () => true
): Promise<StoreRead<T>> {
  const listing = await listStoreDir(dir, filter);
  if (listing.store_status !== 'ok') {
    return {
      entries: [],
      store_status: listing.store_status,
      unreadable_count: listing.unreadable_count,
      reason: listing.reason,
    };
  }

  const entries: T[] = [];
  let unreadable = 0;

  for (const name of listing.files) {
    try {
      const parsed = await parse(path.join(dir, name), name);
      if (parsed === null || parsed === undefined) unreadable++;
      else entries.push(parsed);
    } catch {
      unreadable++;
    }
  }

  return {
    entries,
    store_status: unreadable > 0 ? 'partial' : entries.length === 0 ? 'empty' : 'ok',
    unreadable_count: unreadable,
  };
}

/**
 * The fields a read should merge into its payload so a caller can tell what it
 * actually got. Keep the names stable — S2 asserts on the DIFFERENCE between
 * situations, but callers branch on these.
 */
export function storeMeta(read: { store_status: StoreStatus; unreadable_count: number; reason?: string }) {
  return {
    store_status: read.store_status,
    unreadable_count: read.unreadable_count,
    ...(read.reason ? { store_reason: read.reason } : {}),
  };
}

/**
 * The fields storeMeta merges in, for output interfaces to extend.
 *
 * Optional because a read that never reached its store — a project that did
 * not resolve, a required argument missing — has nothing truthful to say here,
 * and a default of `{store_status: 'ok', unreadable_count: 0}` would be a
 * positive claim it is in no position to make.
 */
export interface StoreMetaFields {
  store_status?: StoreStatus;
  unreadable_count?: number;
  store_reason?: string;
}

/**
 * storeMeta for the many read sites that walk a directory themselves rather
 * than through readStoreDir — a hand-rolled loop with its own filters, sorting
 * and per-record shaping, where switching to the helper would mean rewriting
 * the read.
 *
 * `parsed` counts records that were understood, BEFORE the caller's filters
 * run: a query that matches nothing is an empty ANSWER from a store that is
 * not empty, and saying `store_status: 'empty'` there would be a second,
 * quieter version of the same lie this module exists to stop.
 */
export function countedStoreMeta(parsed: number, unreadable: number) {
  return storeMeta({
    store_status: unreadable > 0 ? 'partial' : parsed === 0 ? 'empty' : 'ok',
    unreadable_count: unreadable,
  });
}

/**
 * Turn a project-resolution failure into a distinguishable answer rather than
 * an empty one.
 *
 * resolveProjectPaths throws PROJECT_NOT_FOUND with an actionable message. Every
 * read that wraps resolution in a `catch` returning empty converts a typo into
 * "you have no issues" — which is how a caller ends up confidently acting on
 * the wrong project's silence.
 */
export function isProjectUnresolved(err: unknown): boolean {
  return err instanceof Error && err.message.includes('PROJECT_NOT_FOUND');
}


/**
 * Read a store file, distinguishing "not there" from "cannot open it".
 *
 * Returns null ONLY for a file that genuinely does not exist — the shape of an
 * untouched project. Every other errno throws, because `catch { return [] }`
 * around a readFile is the same lie as one around a readdir: the records are
 * on disk and the caller is told there are none.
 */
export async function readStoreFile(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf-8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw new Error(`STORE_UNREADABLE: cannot read ${file} (${code ?? 'unknown'})`);
  }
}

/**
 * A record that is present but cannot be understood. Distinct from absence and
 * from unreadability, and it must not be reported as either.
 */
export function storeUnparseable(file: string, err: unknown): Error {
  const detail = err instanceof Error ? err.message : String(err);
  return new Error(`STORE_UNPARSEABLE: ${file} is present but did not parse (${detail})`);
}

/**
 * Does this path exist — answering false ONLY when we could actually tell.
 *
 * The guard form of this module's contract, and the one that keeps defeating
 * it. `try { await fs.access(p) } catch { return [] }` in front of a read is
 * the commonest shape in this codebase, and it swallows EACCES exactly like
 * the readdir it was meant to make safe: the store is right there, the process
 * cannot open it, and the caller is told the store is empty. Converting the
 * readdir underneath such a guard changes nothing, because the guard returns
 * first — which is how the same fix has now been made twice.
 *
 * ENOENT and ENOTDIR mean genuinely absent. Everything else throws.
 */
export async function pathIsPresent(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return false;
    throw new Error(`STORE_UNREADABLE: cannot access ${target} (${code ?? 'unknown'})`);
  }
}

/**
 * Was this the "I could not look" error, rather than an ordinary failure?
 *
 * listDirOrThrow and the path helpers signal an unopenable store by throwing
 * with this prefix. Read sites that wrap a directory read AND its parse loop
 * in one try/catch need to let that one through while still tolerating a bad
 * record — otherwise converting the readdir accomplishes nothing, because the
 * surrounding catch swallows the throw and returns the empty case again. That
 * is exactly how the first round of this fix came to be reported as landed
 * while every affected read still answered "nothing found".
 */
export function isStoreUnreadable(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith('STORE_UNREADABLE');
}

/**
 * readdir that treats ONLY "not there" as empty and lets everything else
 * propagate.
 *
 * The minimal-change form of this module's contract, for the many read sites
 * whose payload shape cannot easily carry a store_status field. An unreadable
 * store becomes a loud tool failure instead of an empty list, which is the
 * distinction ISS-0153 is about; counting unparseable records still needs
 * readStoreDir.
 */
export async function listDirOrThrow(
  dir: string,
  filter: (name: string) => boolean = () => true
): Promise<string[]> {
  try {
    return (await fs.readdir(dir)).filter(filter);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return [];
    throw new Error(`STORE_UNREADABLE: cannot read ${dir} (${code ?? 'unknown'})`);
  }
}

/** listDirOrThrow for the `withFileTypes: true` call sites. Same contract. */
export async function listDirEntriesOrThrow(dir: string): Promise<import('fs').Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return [];
    throw new Error(`STORE_UNREADABLE: cannot read ${dir} (${code ?? 'unknown'})`);
  }
}
