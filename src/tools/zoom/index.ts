// ============================================================================
// Zoom Tools — EPIC-0036
// ============================================================================
// Four verbs over the ingestion logic in ../zoom.ts.
//
// GATING. This facade reaches an account-wide admin Zoom credential:
// meeting_summary:read:admin reads EVERY meeting in the account, personal and
// client alike. Three independent gates, because ISS-0123 is explicit that tier
// alone is not a trustworthy boundary (ISS-0101, the DECIBEL_PRO bypass, is
// still open):
//
//   1. pro tier            — the facade's declared tier
//   2. DECIBEL_ZOOM=1      — fail closed by ABSENCE (see zoomTools below). The
//                            senken.pro deployment that serves this repo's
//                            /call, /batch and /tools unauthenticated will not
//                            have this set, so the facade is not registered
//                            there and dispatch answers "unknown facade"
//                            rather than running.
//   3. localOnly           — rejected over the HTTP transport by the kernel.
//
// Gate 2 is the one that actually holds. The loopback check behind gate 3 is
// weaker than it looks on senken.pro specifically, where a gunicorn front-end
// means a remote request can arrive at this process wearing a 127.0.0.1
// source address.
// ============================================================================

import { ToolSpec } from '../types.js';
import { toolSuccess, toolError } from '../shared/index.js';
import {
  syncMeetings,
  loadRoutes,
  loadCredentials,
  unroutedDir,
  ZoomError,
  type SyncOptions,
} from '../zoom.js';

function settle(err: unknown) {
  if (err instanceof ZoomError) {
    return toolError(err.message, err.hint);
  }
  return toolError(err instanceof Error ? err.message : String(err));
}

const windowProps = {
  days: { type: 'number', description: 'Look back N days from today. Default 30. Ignored when `from` is given.' },
  from: { type: 'string', description: 'Start date YYYY-MM-DD.' },
  to: { type: 'string', description: 'End date YYYY-MM-DD. Defaults to today.' },
  match: { type: 'string', description: 'Only meetings whose topic contains this substring (case-insensitive). A filter on top of routing, not a replacement for it.' },
};

export const zoomSyncTool: ToolSpec = {
  definition: {
    name: 'zoom_sync',
    description:
      'Pull Zoom AI Companion meeting summaries and write them as markdown. Routed by default: each meeting goes to the project whose zoom.match rule its topic matches. Meetings matching no rule have their IDENTITY recorded in the unrouted bucket and their body deliberately left unfetched — add a match rule and re-run to claim them. Dedup is on meeting_uuid + start time, so re-running is safe and cheap.',
    annotations: { title: 'Sync Zoom Summaries', readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        ...windowProps,
        route: { type: 'boolean', description: 'Fan out across the project registry. Default true. Set false with `out` to write everything into one directory.' },
        out: { type: 'string', description: 'Single output directory. Only used when route is false.' },
        dry_run: { type: 'boolean', description: 'Print the routing table and what would be written, touching nothing. Costs one list call and no detail calls.' },
        force: { type: 'boolean', description: 'Re-download and overwrite files already on disk. Rarely what you want — dedup already handles re-runs.' },
        status: { type: 'string', description: 'Value for the status: frontmatter field. Default "new".' },
        no_frontmatter: { type: 'boolean', description: 'Write the summary body alone. Breaks dedup for those files — they become invisible to future runs.' },
      },
    },
  },
  handler: async (args) => {
    try {
      const opts: SyncOptions = {
        days: args.days as number | undefined,
        from: args.from as string | undefined,
        to: args.to as string | undefined,
        match: args.match as string | undefined,
        // Routed is the default. The original had it opt-in with a single
        // directory as the default, which only made sense when the script lived
        // inside the one repo it wrote to.
        route: args.route === undefined ? true : !!args.route,
        out: args.out as string | undefined,
        dryRun: !!args.dry_run,
        force: !!args.force,
        status: args.status as string | undefined,
        noFrontmatter: !!args.no_frontmatter,
      };
      return toolSuccess(await syncMeetings(opts));
    } catch (err) {
      return settle(err);
    }
  },
};

export const zoomListTool: ToolSpec = {
  definition: {
    name: 'zoom_list',
    description:
      'Show what a sync would do without writing anything: the routing table, which meetings land where, and which match no rule. A dry run — one list call, no per-meeting detail fetches.',
    annotations: { title: 'Preview Zoom Sync', readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: { ...windowProps },
    },
  },
  handler: async (args) => {
    try {
      return toolSuccess(await syncMeetings({
        days: args.days as number | undefined,
        from: args.from as string | undefined,
        to: args.to as string | undefined,
        match: args.match as string | undefined,
        route: true,
        dryRun: true,
      }));
    } catch (err) {
      return settle(err);
    }
  },
};

export const zoomRoutesTool: ToolSpec = {
  definition: {
    name: 'zoom_routes',
    description:
      'List the projects carrying a zoom.match rule, in the order routing resolves them (longest needle first). Reads the registry only — no Zoom API call, so it works without credentials.',
    annotations: { title: 'List Zoom Routes', readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: { type: 'object', properties: {} },
  },
  handler: async () => {
    try {
      const routes = loadRoutes();
      return toolSuccess({
        routes: routes.map(r => ({ project: r.id, match: r.match, out: r.out })),
        unrouted_bucket: unroutedDir(),
        count: routes.length,
        hint: routes.length === 0
          ? 'No project carries a zoom block. Add one: "zoom": { "match": ["plasiv"], "out": "meetings/raw" }'
          : 'Routing is by meeting-topic substring, longest needle first. A client name appearing in an unrelated title will still misroute it.',
      });
    } catch (err) {
      return settle(err);
    }
  },
};

export const zoomStatusTool: ToolSpec = {
  definition: {
    name: 'zoom_status',
    description:
      'Report whether Zoom credentials resolve and where they came from, without calling Zoom. Never returns the secret itself.',
    annotations: { title: 'Zoom Status', readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: { type: 'object', properties: {} },
  },
  handler: async () => {
    try {
      const creds = loadCredentials();
      return toolSuccess({
        configured: true,
        account_id: creds.account_id,
        client_id_suffix: creds.client_id.slice(-4),
        scope: 'meeting_summary:read:admin (account-wide — reads every meeting in the account)',
        routes: loadRoutes().length,
        unrouted_bucket: unroutedDir(),
      });
    } catch (err) {
      if (err instanceof ZoomError) {
        // `reason`, not `error`. Reporting "not configured" IS a successful
        // status read, but a payload carrying an `error` key with no failure
        // marker is the exact shape S1 flags: every programmatic consumer that
        // branches on `error` reads this as a failed call.
        return toolSuccess({ configured: false, reason: err.message, hint: err.hint });
      }
      return settle(err);
    }
  },
};

/**
 * Fail closed by absence. Without DECIBEL_ZOOM=1 the tools are never built, so
 * the facade's actions point at nothing and dispatch answers "unknown facade" —
 * the same shape an unallowlisted extension gets. An unregistered facade that
 * returned a zero-shaped result instead would be indistinguishable from a real
 * empty answer, which is exactly how a broken voice inbox once read as
 * "0 messages".
 */
export const zoomTools: ToolSpec[] = process.env.DECIBEL_ZOOM === '1'
  ? [zoomSyncTool, zoomListTool, zoomRoutesTool, zoomStatusTool]
  : [];
