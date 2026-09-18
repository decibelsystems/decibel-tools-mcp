---
uid: 01a001bc-1ce1-7d85-9cbb-590a53865773
id: ISS-0123
projectId: decibel-tools-mcp
severity: high
status: closed
epic_id: EPIC-0036
created_at: 2026-08-14T19:25:00.513Z
updated_at: 2026-09-04T20:16:19.917Z
closed_at: 2026-09-04T20:16:19.373Z
resolution: "Resolved by commit 5df82f1: sentinel: close ISS-0123 and ISS-0152,
  EPIC-0036 in progress"
linked_commits:
  - sha: 8325d3a82dbed2802d07ef581e9bf49db8e14bbb
    shortSha: 8325d3a
    message: "sentinel: close ISS-0123 and ISS-0152, EPIC-0036 in progress"
    relationship: closes
    linked_at: 2026-09-04T20:14:24.339Z
    linked_by: ai:claude
  - sha: 5df82f1e3945a996b3767cc27bd5bdcfc9db5d07
    shortSha: 5df82f1
    message: "sentinel: close ISS-0123 and ISS-0152, EPIC-0036 in progress"
    relationship: closes
    linked_at: 2026-09-04T20:16:19.917Z
    linked_by: ai:claude

---

# Keep the zoom facade local/stdio-only until hosted MCP auth is fixed

**Severity:** high
**Status:** closed
**Epic:** EPIC-0036

## Details

The zoom facade holds an account-wide admin-scoped Zoom credential (meeting_summary:read:admin reads every meeting in the account). Exposing a sync/list/read action on an unauthenticated hosted daemon means anyone who can reach it pulls all company and client meeting summaries.

This is not hypothetical. senken.pro runs this repo as a submodule and serves /call, /batch and /tools unauthenticated. There is an open CRITICAL issue on exactly this: "Hosted MCP runs unauthenticated + queueForAgent service-role write with spoofable caller ids" (2026-06-04T23-51-33Z), plus the related high issue "Hosted (--http) mode serves /call,/connect,/batch,/events unauthenticated — make it fail closed" (2026-06-07T18-52-35Z).

ACTION: gate the zoom facade so it is unavailable over the HTTP transport until those are closed. Do not rely on tier gating alone — ISS-0101 (DECIBEL_PRO env var bypass) and the open issue on tier gating leaking pro+apps facades when NODE_ENV is unset both mean pro-tier is not currently a trustworthy boundary.

Blocks the sync/sync_all work from being considered shippable beyond a local stdio setup.

[2026-09-04] Confirmed with the plasiv peer 2026-09-04: the credential is Server-to-Server OAuth at account level with meeting_summary:read:admin (granular meeting:read:summary:admin) and does read every meeting in the account. Stored at ~/.decibel/zoom-credentials.json mode 600, with env override; no 1Password.

Additional exposure not captured when this issue was filed: a routed run does not only fetch client meetings, it WRITES the non-matching ones. Every meeting whose topic matches no project rule is written to ~/.decibel/meetings/unrouted, so personal and unrelated internal meeting summaries land on disk as a side effect of pulling client ones. That is a data-at-rest privacy problem on top of the read-scope problem, and it argues for the unrouted bucket storing a stub (uuid + topic + start) rather than the full summary body until a routing rule claims it.

[2026-09-04] Exposure confirmed as actual, not theoretical (plasiv peer, 2026-09-04): ~/.decibel/meetings/unrouted currently holds exactly one file — a personal two-person meeting — with its full summary body on disk. One hand-run of --route was enough to put it there.

Caveat on the stub remedy proposed above: it cannot be implemented on its own. The dedup index treats the unrouted bucket as "seen" globally, so writing a stub there would satisfy dedup permanently and the real body would never arrive even after a routing rule was added. Privacy stub and dedup fix ship together or not at all. Tracked as a separate high issue against EPIC-0036.

## Resolution

Resolved by commit 5df82f1: sentinel: close ISS-0123 and ISS-0152, EPIC-0036 in progress



Three independent gates, in order of the weight each actually carries:

1. DECIBEL_ZOOM=1 — fail closed by ABSENCE. Without it the tools are never constructed, the facade is never registered, and dispatch answers "unknown facade" rather than running. This is the gate that holds on senken.pro, which will not have the variable set. Verified against the built artifact: dist/server.js returns {"error":"Unknown tool: zoom"} without it and dispatches normally with it.
2. FacadeSpec.localOnly (new) — the kernel rejects the facade over transport 'http', for the facade name AND for direct internal tool calls via the exact reverse map, and getMcpToolDefinitions filters it out of an HTTP tools listing so it is never advertised-then-refused. Transport is set by the adapter and never read from caller-supplied _meta or request context, so a remote caller cannot claim to be stdio.
3. pro tier, as declared.

Gate 2 is explicitly documented as defence in depth rather than a boundary: senken.pro fronts this process with gunicorn, so a remote request there can arrive wearing a loopback source address. That is why gate 1 exists and why it is not a convenience switch.

The write-side exposure raised on this issue is also closed: unrouted meetings now record identity only (uuid, topic, start) and their detail is NEVER fetched, so a routed run no longer spills the bodies of personal and unrelated internal meetings onto disk. That was only safe once the dedup collision was fixed — see ISS-0152.

Six gating tests in tests/integration/zoomGating.test.ts, each in its own child process because the env var is read at module load.

NOT claimed by this closure: the underlying hosted-auth issues remain open on their own tickets — "Hosted MCP runs unauthenticated + queueForAgent service-role write with spoofable caller ids" (CRITICAL) and "Hosted (--http) mode serves /call,/connect,/batch,/events unauthenticated". This issue asked for the zoom facade to be gated until those are fixed, not for those to be fixed. The one file already sitting in the unrouted bucket with its full body on disk is pre-existing and still there.
