// ============================================================================
// Zoom AI Companion meeting-summary ingestion — EPIC-0036
// ============================================================================
// Ported from plasiv/bin/pull-zoom-summaries.py (424 lines, stdlib-only Python).
// The Python stays where it is: a crontab entry outside that repo still points
// at its path, and its fate is Ben's call, not this port's.
//
// This is a REWRITE, not a translation. The nightly cron driving the original
// has never once succeeded — 18 log lines, all "Operation not permitted", from
// cron lacking macOS TCC Full Disk Access to /Volumes/Ashitaka plus
// /usr/bin/python3 resolving through the Xcode shim. Every summary on disk was
// pulled by hand, and the routed path has been run manually about once. So the
// source is a specification, not a proven implementation, and the four things
// it got wrong (no token refresh, no backoff, uuid-only dedup, first-rule-wins
// routing) are fixed here rather than carried across.
//
// What IS carried across byte-identically, because dedup depends on it: the
// five frontmatter keys, the filename convention, and the practice of reading
// meeting_uuid back out of the first 600 characters of each file on disk.
// Change any of those and a re-pull duplicates everything already written.
//
// Zero new npm deps — Node >=18 global fetch plus fs.
// ============================================================================

import fs from 'fs';
import path from 'path';
import os from 'os';
import { loadConfig } from '../daemonConfig.js';

const API = 'https://api.zoom.us/v2';
const TOKEN_URL = 'https://zoom.us/oauth/token';

/** How much of each file to read when hunting for its meeting_uuid. Matches the
 *  Python's 600, which is comfortably past the end of a five-key frontmatter
 *  block and short enough that indexing a full directory stays cheap. */
const FRONTMATTER_SCAN_BYTES = 600;

// ============================================================================
// Types
// ============================================================================

export interface ZoomCredentials {
  account_id: string;
  client_id: string;
  client_secret: string;
}

/** One entry from GET /meetings/meeting_summaries. Only the fields the port
 *  actually reads are typed; Zoom sends more. */
export interface MeetingSummary {
  meeting_uuid?: string;
  meeting_id?: number | string;
  meeting_topic?: string;
  meeting_start_time?: string;
  summary_start_time?: string;
  [key: string]: unknown;
}

/** GET /meetings/{uuid}/meeting_summary. Two shapes: the modern single
 *  markdown blob, and a deprecated split. See renderSummary. */
export interface MeetingDetail {
  summary_content?: string;
  summary_overview?: string;
  summary_details?: Array<{ label?: string; summary?: string }>;
  next_steps?: unknown[];
  [key: string]: unknown;
}

export interface ZoomRoute {
  /** Decibel project id */
  id: string;
  /** Lowercased topic needles, longest first (see loadRoutes) */
  match: string[];
  /** Absolute output directory */
  out: string;
}

export interface SyncOptions {
  from?: string;
  to?: string;
  days?: number;
  /** Single output directory. Ignored when route is true. */
  out?: string;
  /** Fan out across the project registry instead of one directory. */
  route?: boolean;
  /** Only topics containing this substring (case-insensitive). */
  match?: string;
  force?: boolean;
  dryRun?: boolean;
  status?: string;
  noFrontmatter?: boolean;
}

export interface SyncResult {
  from: string;
  to: string;
  returned: number;
  in_range: number;
  written: number;
  skipped: number;
  empty: number;
  unrouted: number;
  reclaimed: number;
  dry_run: boolean;
  routes?: Array<{ id: string; match: string[]; out: string }>;
  files: Array<{ name: string; dest: string; project: string | null; action: string }>;
  notes: string[];
}

export class ZoomError extends Error {
  code: string;
  hint?: string;
  constructor(code: string, message: string, hint?: string) {
    super(message);
    this.name = 'ZoomError';
    this.code = code;
    this.hint = hint;
  }
}

// ============================================================================
// Credentials
// ============================================================================

function credentialsFile(): string {
  return path.join(os.homedir(), '.decibel', 'zoom-credentials.json');
}

function legacyCredentialsFile(): string {
  return path.join(os.homedir(), '.config', 'zoom-summaries', 'credentials.json');
}

/**
 * Resolution order: environment, then the config.yaml `zoom` block, then the
 * standalone JSON file, then the legacy path.
 *
 * The JSON file is where plasiv's credentials actually live today (mode 600),
 * so it stays supported rather than being migrated out from under a working
 * setup. config.yaml is the location EPIC-0036 asks for and is preferred for
 * anything new — it is the same file the daemon already reads secrets from.
 *
 * Environment wins only when ALL THREE values are present. A half-set
 * environment falling through to a complete file beats erroring on a partial
 * override, and mixing the two sources produces an account_id from one Zoom app
 * with a secret from another, which fails at the token call with a message that
 * blames the wrong thing.
 */
export function loadCredentials(): ZoomCredentials {
  const env = {
    account_id: process.env.ZOOM_ACCOUNT_ID,
    client_id: process.env.ZOOM_CLIENT_ID,
    client_secret: process.env.ZOOM_CLIENT_SECRET,
  };
  if (env.account_id && env.client_id && env.client_secret) {
    return env as ZoomCredentials;
  }

  const found: Partial<ZoomCredentials> = { ...stripUndefined(env) };

  const fromConfig = loadConfig().zoom;
  if (fromConfig) {
    found.account_id = found.account_id || fromConfig.account_id;
    found.client_id = found.client_id || fromConfig.client_id;
    found.client_secret = found.client_secret || fromConfig.client_secret;
  }

  for (const file of [credentialsFile(), legacyCredentialsFile()]) {
    if (found.account_id && found.client_id && found.client_secret) break;
    if (!fs.existsSync(file)) continue;
    try {
      const onDisk = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<ZoomCredentials>;
      found.account_id = found.account_id || onDisk.account_id;
      found.client_id = found.client_id || onDisk.client_id;
      found.client_secret = found.client_secret || onDisk.client_secret;
    } catch (err) {
      throw new ZoomError(
        'credentials_unreadable',
        `${file} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
        'Expected {"account_id": "...", "client_id": "...", "client_secret": "..."}'
      );
    }
  }

  const trimmed: Partial<ZoomCredentials> = {};
  for (const [k, v] of Object.entries(found)) {
    if (typeof v === 'string' && v.trim()) trimmed[k as keyof ZoomCredentials] = v.trim();
  }

  const missing = (['account_id', 'client_id', 'client_secret'] as const).filter(k => !trimmed[k]);
  if (missing.length > 0) {
    throw new ZoomError(
      'credentials_missing',
      `Missing Zoom credentials: ${missing.join(', ')}`,
      `Set ZOOM_ACCOUNT_ID / ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET, add a zoom block to ~/.decibel/config.yaml, or write them to ${credentialsFile()}`
    );
  }

  // The original ships a credentials template with PASTE_ placeholders. Catching
  // them here turns "Zoom rejected the token request (400)" into something that
  // names the actual problem.
  const placeholder = (Object.keys(trimmed) as Array<keyof ZoomCredentials>)
    .filter(k => trimmed[k]!.startsWith('PASTE_'));
  if (placeholder.length > 0) {
    throw new ZoomError(
      'credentials_placeholder',
      `Credential values are still placeholders: ${placeholder.join(', ')}`,
      `Fill them in at ${credentialsFile()} or in ~/.decibel/config.yaml`
    );
  }

  return trimmed as ZoomCredentials;
}

function stripUndefined(obj: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) if (v) out[k] = v;
  return out;
}

// ============================================================================
// Token — with refresh
// ============================================================================

interface CachedToken {
  token: string;
  /** epoch ms */
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;

/** Refresh this long before the token actually expires, so a request in flight
 *  when the clock rolls over doesn't 401. */
const TOKEN_SKEW_MS = 60_000;

/**
 * Server-to-Server OAuth. The original fetched one token per run and never
 * looked at it again; S2S tokens last an hour, so a backfill long enough to
 * matter outlives its own credential and dies partway through with a 401 that
 * looks like a permissions problem. This caches with an expiry and refetches.
 */
export async function getToken(creds: ZoomCredentials, now = Date.now()): Promise<string> {
  if (cachedToken && cachedToken.expiresAt - TOKEN_SKEW_MS > now) {
    return cachedToken.token;
  }

  const basic = Buffer.from(`${creds.client_id}:${creds.client_secret}`).toString('base64');
  const url = `${TOKEN_URL}?${new URLSearchParams({
    grant_type: 'account_credentials',
    account_id: creds.account_id,
  })}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}` },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ZoomError(
      'token_rejected',
      `Zoom rejected the token request (${res.status} ${res.statusText}). ${body}`,
      'Common causes: the app is created but not Activated; account_id is a user ID rather than the Account ID on the App Credentials tab; or a client_id/secret typo.'
    );
  }

  const payload = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!payload.access_token) {
    throw new ZoomError('token_missing', 'Zoom returned no access_token', `Response keys: ${Object.keys(payload).join(', ')}`);
  }

  cachedToken = {
    token: payload.access_token,
    expiresAt: now + (payload.expires_in ?? 3600) * 1000,
  };
  return cachedToken.token;
}

/** Test seam, and the escape hatch after a credential change mid-process. */
export function clearTokenCache(): void {
  cachedToken = null;
}

// ============================================================================
// HTTP — with backoff
// ============================================================================

const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 500;

export interface ApiGetDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * The original had no retry, no backoff, no 429 handling and no concurrency
 * cap — a serial loop issuing one detail call per meeting. Its clean log proves
 * nothing, because it has only ever run at hand-driven volume; an account-wide
 * backfill is the first time this would meet a rate limit.
 *
 * Retries 429 and 5xx with exponential backoff, honouring Retry-After when Zoom
 * sends one. 4xx other than 429 is not retried — a 401 or a 404 does not get
 * better by asking again.
 */
export async function apiGet<T>(
  urlPath: string,
  token: string,
  params?: Record<string, string | number>,
  deps: ApiGetDeps = {}
): Promise<T> {
  const doFetch = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;

  let url = API + urlPath;
  if (params) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
    url += `?${qs}`;
  }

  let lastError = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await doFetch(url, { headers: { Authorization: `Bearer ${token}` } });

    if (res.ok) return (await res.json()) as T;

    const body = await res.text().catch(() => '');
    lastError = `GET ${urlPath} -> ${res.status} ${body}`;

    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === MAX_ATTEMPTS) {
      throw new ZoomError(
        res.status === 429 ? 'rate_limited' : 'api_error',
        lastError,
        res.status === 429
          ? 'Zoom rate limit reached after retries. Narrow the date window and run again.'
          : undefined
      );
    }

    const retryAfter = Number(res.headers.get('retry-after'));
    const wait = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : BASE_BACKOFF_MS * 2 ** (attempt - 1);
    await sleep(wait);
  }

  throw new ZoomError('api_error', lastError);
}

// ============================================================================
// UUID encoding
// ============================================================================

/**
 * Zoom requires meeting UUIDs to be DOUBLE URL-encoded when they start with "/"
 * or contain "//", and single-encoded otherwise.
 *
 * UNVERIFIED AGAINST REAL DATA: none of the 26 files on the plasiv disk carry a
 * uuid that triggers the double branch, so that path comes from Zoom's docs
 * rather than from a case anyone here has seen. The single branch is confirmed —
 * it produces the same %3D%3D that appears inside the task permalinks Zoom
 * embeds in its own summary markdown.
 */
export function encodeMeetingUuid(uuid: string): string {
  const once = encodeURIComponent(uuid);
  if (uuid.startsWith('/') || uuid.includes('//')) {
    return encodeURIComponent(once);
  }
  return once;
}

// ============================================================================
// List
// ============================================================================

/**
 * The list envelope is documented as `summaries`. When that key is absent this
 * falls back to whatever list-of-dicts the payload does carry and says so,
 * because the failure mode being defended against is a silent zero-result run:
 * an envelope rename would otherwise read as "no meetings", which is
 * indistinguishable from a quiet week.
 */
export function extractSummaryList(
  payload: Record<string, unknown>,
  notes: string[] = []
): MeetingSummary[] {
  if (Array.isArray(payload.summaries)) return payload.summaries as MeetingSummary[];

  for (const [key, value] of Object.entries(payload)) {
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object' && value[0] !== null) {
      notes.push(`summaries arrived under '${key}', expected 'summaries'`);
      return value as MeetingSummary[];
    }
  }

  if (payload.total_records) {
    notes.push(
      `API reported ${payload.total_records} records but no list was found. Raw keys: ${Object.keys(payload).sort().join(', ')}`
    );
  }
  return [];
}

export async function listSummaries(
  token: string,
  from: string,
  to: string,
  notes: string[] = [],
  deps: ApiGetDeps = {}
): Promise<MeetingSummary[]> {
  const summaries: MeetingSummary[] = [];
  let pageToken = '';

  // Bounded rather than while(true): a next_page_token that never clears is a
  // hang with no output, which is the worst failure shape for a sync.
  for (let page = 0; page < 200; page++) {
    const params: Record<string, string | number> = { from, to, page_size: 300 };
    if (pageToken) params.next_page_token = pageToken;

    const payload = await apiGet<Record<string, unknown>>('/meetings/meeting_summaries', token, params, deps);
    summaries.push(...extractSummaryList(payload, notes));

    pageToken = (payload.next_page_token as string) || '';
    if (!pageToken) return summaries;
  }

  notes.push('stopped after 200 pages — next_page_token never cleared');
  return summaries;
}

// ============================================================================
// Rendering
// ============================================================================

/**
 * Zoom returns the whole summary as markdown in `summary_content` on modern
 * accounts. The split fields are the deprecated shape.
 *
 * UNVERIFIED AGAINST REAL DATA: the split branch has never been exercised here.
 * Every one of the 26 files on the plasiv disk orders its sections Quick recap,
 * Next steps, per-person groups, Collaboration, Summary — and the split branch
 * structurally cannot put next_steps second, because it appends them last. That
 * ordering is the proof the account is on summary_content. The split branch
 * below is written from Zoom's field names, not from anything observed, and is
 * kept only so an older account degrades into readable output instead of an
 * empty file.
 */
export function renderSummary(detail: MeetingDetail): string {
  const content = (detail.summary_content || '').trim();
  if (content) return content;

  const parts: string[] = [];

  const overview = (detail.summary_overview || '').trim();
  if (overview) parts.push(`## Quick recap\n\n${overview}`);

  for (const section of detail.summary_details || []) {
    const label = (section.label || '').trim();
    const body = (section.summary || '').trim();
    if (!body) continue;
    parts.push(label ? `### ${label}\n\n${body}` : body);
  }

  const steps = detail.next_steps || [];
  if (steps.length > 0) {
    // Coerced rather than assumed to be strings: on this account next steps
    // arrive as markdown bullets inside summary_content and this array is never
    // populated, so its element type is genuinely unknown.
    parts.push(`## Next steps\n\n${steps.map(s => `- ${String(s).trim()}`).join('\n')}`);
  }

  return parts.join('\n\n').trim();
}

// ============================================================================
// Frontmatter and filenames — carried across byte-identically
// ============================================================================

export function startOf(summary: MeetingSummary): string {
  return summary.meeting_start_time || summary.summary_start_time || '';
}

/**
 * Zoom ignores from/to on the summaries list endpoint, so the window has to be
 * enforced here or it is a lie. An entry with no start time is kept rather than
 * dropped — a missing timestamp is a reason to look at it, not to hide it.
 */
export function inRange(summary: MeetingSummary, from: string, to: string): boolean {
  const start = startOf(summary).slice(0, 10);
  if (!start) return true;
  return from <= start && start <= to;
}

/** Five keys, same order, same spelling as the Python. The dedup index reads
 *  meeting_uuid back out of this block, so the format is load-bearing. */
export function buildFrontmatter(summary: MeetingSummary, status: string): string {
  return [
    '---',
    'source: zoom-ai-companion',
    `topic: "${(summary.meeting_topic || '').replace(/"/g, "'")}"`,
    `start: ${startOf(summary)}`,
    `meeting_uuid: ${summary.meeting_uuid || ''}`,
    `status: ${status}`,
    '---',
    '',
  ].join('\n');
}

/**
 * "{topic} {YYYY-MM-DD HH_MM}Z.md", topic stripped of characters that are
 * illegal in a filename on some filesystem or other. Verified against the real
 * file in the unrouted bucket: this produces "Ben - Pete 2026-08-12 17_04Z.md".
 */
export function filenameFor(summary: MeetingSummary): string {
  const topic = summary.meeting_topic || 'Zoom meeting';
  const start = startOf(summary);

  let stamp = '';
  if (start) {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/.exec(start);
    if (match) {
      const [, y, mo, d, h, mi] = match;
      stamp = ` ${y}-${mo}-${d} ${h}_${mi}Z`;
    } else {
      stamp = ` ${start.slice(0, 10)}`;
    }
  }

  const safe = topic.replace(/[/\\:*?"<>|]/g, '-').trim();
  return `${safe}${stamp}.md`;
}

// ============================================================================
// Routing
// ============================================================================

function registryPath(): string {
  return process.env.DECIBEL_REGISTRY_PATH || path.join(os.homedir(), '.decibel', 'projects.json');
}

export function unroutedDir(): string {
  return path.join(os.homedir(), '.decibel', 'meetings', 'unrouted');
}

/**
 * Projects carrying a `zoom` block in the registry:
 *
 *   "zoom": { "match": ["plasiv"], "out": "meetings/raw" }
 *
 * Aliases are deliberately NOT matched. They are tool-call addresses — "dt",
 * "dv" — and a two-letter needle matches almost any meeting title.
 *
 * Needles are sorted longest-first so routing is deterministic by specificity.
 * The original took the first rule that matched in registry order, which means
 * a project whose needle is a substring of another project's needle silently
 * stole its meetings depending on file ordering.
 */
export function loadRoutes(): ZoomRoute[] {
  const file = registryPath();
  if (!fs.existsSync(file)) return [];

  const data = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
    projects?: Array<{ id: string; path: string; zoom?: { match?: string[]; out?: string } }>;
  };

  const routes: ZoomRoute[] = [];
  for (const entry of data.projects || []) {
    const needles = (entry.zoom?.match || []).filter(Boolean).map(n => n.toLowerCase());
    if (needles.length === 0) continue;
    routes.push({
      id: entry.id,
      match: needles.sort((a, b) => b.length - a.length),
      out: path.join(entry.path, entry.zoom?.out || 'meetings/raw'),
    });
  }

  // Longest single needle first, so "plasiv design" beats "plasiv".
  return routes.sort((a, b) => (b.match[0]?.length || 0) - (a.match[0]?.length || 0));
}

export function routeFor(summary: MeetingSummary, routes: ZoomRoute[]): ZoomRoute | null {
  const topic = (summary.meeting_topic || '').toLowerCase();
  let best: { route: ZoomRoute; length: number } | null = null;

  for (const route of routes) {
    for (const needle of route.match) {
      if (topic.includes(needle) && (!best || needle.length > best.length)) {
        best = { route, length: needle.length };
      }
    }
  }
  return best?.route ?? null;
}

// ============================================================================
// Dedup — ISS-0152
// ============================================================================

export interface KnownMeeting {
  file: string;
  uuid: string;
}

/**
 * Index meeting_uuid out of the first 600 bytes of every .md in the given
 * directories, keyed on uuid AND start time.
 *
 * Two deliberate departures from the original:
 *
 * 1. UUID ALONE IS NOT THE KEY. If Zoom reuses a uuid across occurrences of a
 *    recurring meeting, a uuid-keyed index silently skips the second occurrence
 *    as already-seen. Nobody has observed that here and the Python does not
 *    defend against it; keying on uuid+start costs nothing and closes it.
 *
 * 2. THE UNROUTED BUCKET IS NOT INDEXED HERE. See reclaim handling in
 *    syncMeetings — an unrouted entry is UNCLAIMED, not SEEN.
 */
export function indexKnownMeetings(dirs: string[]): Map<string, KnownMeeting> {
  const seen = new Map<string, KnownMeeting>();

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.md')) continue;
      const file = path.join(dir, name);

      let head: string;
      try {
        const fd = fs.openSync(file, 'r');
        const buf = Buffer.alloc(FRONTMATTER_SCAN_BYTES);
        const read = fs.readSync(fd, buf, 0, FRONTMATTER_SCAN_BYTES, 0);
        fs.closeSync(fd);
        head = buf.subarray(0, read).toString('utf-8');
      } catch {
        continue;
      }

      const uuid = /^meeting_uuid:\s*(\S+)\s*$/m.exec(head)?.[1];
      if (!uuid) continue;
      const start = /^start:\s*(\S+)\s*$/m.exec(head)?.[1] || '';
      seen.set(dedupKey(uuid, start), { file, uuid });
    }
  }

  return seen;
}

export function dedupKey(uuid: string, start: string): string {
  return `${uuid}|${start}`;
}

/** The stub left in the unrouted bucket. Carries enough to see what is waiting
 *  — and nothing else.
 *
 *  ISS-0123: a routed run does not merely READ non-client meetings, it WRITES
 *  them. The bucket on the plasiv machine holds a personal two-person meeting
 *  with its full body on disk, put there by a single hand-run. Storing a stub
 *  keeps the "never silently dropped" guarantee without spilling the content of
 *  every meeting in the account onto the filesystem as a side effect of pulling
 *  client ones.
 *
 *  This is only safe BECAUSE the unrouted bucket is excluded from the dedup
 *  index. A stub in a seen-index would satisfy dedup forever and the real body
 *  would never arrive. Privacy stub and dedup fix are one change, not two. */
export function buildUnroutedStub(summary: MeetingSummary): string {
  return [
    '---',
    'source: zoom-ai-companion',
    `topic: "${(summary.meeting_topic || '').replace(/"/g, "'")}"`,
    `start: ${startOf(summary)}`,
    `meeting_uuid: ${summary.meeting_uuid || ''}`,
    'status: unrouted',
    '---',
    '',
    'No project routing rule matched this meeting, so only its identity is',
    'recorded here — the summary body was deliberately not written to disk.',
    '',
    'Add a match rule to the project in ~/.decibel/projects.json:',
    '',
    '    "zoom": { "match": ["<needle>"], "out": "meetings/raw" }',
    '',
    'and run the sync again. The full summary will be fetched into the project',
    'and this stub removed.',
    '',
  ].join('\n');
}

// ============================================================================
// Sync
// ============================================================================

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface SyncDeps extends ApiGetDeps {
  credentials?: ZoomCredentials;
  token?: string;
  routes?: ZoomRoute[];
  now?: Date;
}

/**
 * Pull summaries and write them where they belong.
 *
 * The routed path is the interesting one and the least exercised — one manual
 * run in its life — so it is written here from the spec rather than trusted
 * from the source.
 */
export async function syncMeetings(opts: SyncOptions = {}, deps: SyncDeps = {}): Promise<SyncResult> {
  const notes: string[] = [];
  const now = deps.now ?? new Date();

  const to = opts.to || isoDay(now);
  const from = opts.from || isoDay(new Date(now.getTime() - (opts.days ?? 30) * 86_400_000));
  const status = opts.status || 'new';

  const token = deps.token ?? (await getToken(deps.credentials ?? loadCredentials()));

  const all = await listSummaries(token, from, to, notes, deps);
  const returned = all.length;

  let summaries = all.filter(s => inRange(s, from, to));
  if (returned !== summaries.length) {
    notes.push(
      `API returned ${returned} records ignoring from/to; ${summaries.length} fall in range (Zoom does not honour the window on this endpoint)`
    );
  }

  if (opts.match) {
    const needle = opts.match.toLowerCase();
    summaries = summaries.filter(s => (s.meeting_topic || '').toLowerCase().includes(needle));
  }

  const routes = opts.route ? (deps.routes ?? loadRoutes()) : [];
  if (opts.route && routes.length === 0) {
    throw new ZoomError(
      'no_routes',
      `No projects in ${registryPath()} carry a zoom block`,
      'Add one: "zoom": { "match": ["plasiv"], "out": "meetings/raw" }'
    );
  }

  const singleOut = path.resolve(opts.out || path.join(process.cwd(), 'meetings', 'raw'));

  // ISS-0152: the seen-index covers real destinations ONLY. The unrouted bucket
  // is indexed separately, as a claim list rather than a skip list.
  const destinations = opts.route ? routes.map(r => r.out) : [singleOut];
  const seen = indexKnownMeetings(destinations);
  const unclaimed = opts.route ? indexKnownMeetings([unroutedDir()]) : new Map<string, KnownMeeting>();

  const result: SyncResult = {
    from, to, returned,
    in_range: summaries.length,
    written: 0, skipped: 0, empty: 0, unrouted: 0, reclaimed: 0,
    dry_run: !!opts.dryRun,
    routes: opts.route ? routes.map(r => ({ id: r.id, match: r.match, out: r.out })) : undefined,
    files: [],
    notes,
  };

  for (const summary of summaries) {
    const uuid = String(summary.meeting_uuid || summary.meeting_id || '');
    const key = dedupKey(uuid, startOf(summary));

    const route = opts.route ? routeFor(summary, routes) : null;
    const dest = opts.route ? (route ? route.out : unroutedDir()) : singleOut;
    const filename = filenameFor(summary);
    const target = path.join(dest, filename);

    if (!route && opts.route) result.unrouted++;

    // A stub sitting in the unrouted bucket for a meeting that NOW routes
    // somewhere is the reclaim case. It must not count as seen, or adding the
    // routing rule would never pull the body in — the bug this port exists to
    // fix.
    const stub = unclaimed.get(key);
    const reclaiming = !!(route && stub);

    if (!reclaiming && seen.has(key) && !opts.force) {
      result.skipped++;
      continue;
    }
    if (!reclaiming && fs.existsSync(target) && !opts.force) {
      result.skipped++;
      continue;
    }
    // An unrouted meeting that is STILL unrouted needs no second stub.
    if (!route && opts.route && stub && !opts.force) {
      result.skipped++;
      continue;
    }

    const action = reclaiming ? 'reclaim' : !route && opts.route ? 'stub' : 'write';

    if (opts.dryRun) {
      result.files.push({ name: filename, dest, project: route?.id ?? null, action: `would ${action}` });
      result.written++;
      if (reclaiming) result.reclaimed++;
      continue;
    }

    // Unrouted meetings are never fetched in detail. Not fetching is the point:
    // the body is what should not be on disk.
    if (!route && opts.route) {
      fs.mkdirSync(dest, { recursive: true });
      fs.writeFileSync(target, buildUnroutedStub(summary));
      result.files.push({ name: filename, dest, project: null, action: 'stub' });
      result.written++;
      continue;
    }

    const detail = await apiGet<MeetingDetail>(
      `/meetings/${encodeMeetingUuid(uuid)}/meeting_summary`,
      token,
      undefined,
      deps
    );
    const body = renderSummary(detail);

    // A meeting with no AI Companion summary yet is expected, not a failure.
    // Writing an empty file would poison the dedup index against the real one.
    if (!body) {
      result.empty++;
      result.files.push({ name: filename, dest, project: route?.id ?? null, action: 'empty' });
      continue;
    }

    fs.mkdirSync(dest, { recursive: true });
    const head = opts.noFrontmatter ? '' : buildFrontmatter(summary, status);
    fs.writeFileSync(target, head + body + '\n');

    // Remove the stub only after the real file is safely written, so a crash
    // between the two leaves the meeting claimable rather than lost.
    if (reclaiming && stub) {
      try {
        fs.unlinkSync(stub.file);
        result.reclaimed++;
      } catch {
        notes.push(`wrote ${filename} but could not remove the unrouted stub at ${stub.file}`);
      }
    }

    result.files.push({ name: filename, dest, project: route?.id ?? null, action });
    result.written++;
  }

  if (result.unrouted > 0) {
    notes.push(
      `${result.unrouted} meeting(s) matched no project rule. Identity recorded in ${unroutedDir()}, body deliberately not written. Add a zoom.match entry in ${registryPath()} and re-run to claim them.`
    );
  }

  return result;
}
