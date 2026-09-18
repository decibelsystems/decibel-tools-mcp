---
id: EPIC-0036
projectId: decibel-tools-mcp
title: Zoom meeting-summary ingestion with multi-client routing
summary: Port the plasiv Zoom AI Companion puller (bin/pull-zoom-summaries.py,
  Python, stdlib-only) into decibel-tools-mcp as a pro-tier `zoom` facade, and
  extend it from single-repo to multi-client routing so one account-wide pull
  fans out to the right client project. Zero new npm deps (Node >=18 global
  fetch + fs). Local/stdio only until hosted-MCP auth is fixed.
status: in_progress
priority: medium
tags:
  - zoom
  - ingestion
  - pro-tier
  - client-work
  - meetings
owner: ""
squad: ""
created_at: 2026-08-14T19:24:18.031Z
updated_at: 2026-09-04T20:16:19.972Z
linked_commits:
  - sha: b0448659b3c2fa792977ca32b825c4fd37adf5e9
    shortSha: b044865
    message: "zoom facade: port the plasiv puller into the general kit (EPIC-0036)"
    relationship: related
    linked_at: 2026-09-04T20:13:43.903Z
    linked_by: ai:claude
  - sha: 8325d3a82dbed2802d07ef581e9bf49db8e14bbb
    shortSha: 8325d3a
    message: "sentinel: close ISS-0123 and ISS-0152, EPIC-0036 in progress"
    relationship: related
    linked_at: 2026-09-04T20:14:24.397Z
    linked_by: ai:claude
  - sha: 59b88e15944f858061cacfd93d368e6ba25e183c
    shortSha: 59b88e1
    message: "sentinel: EPIC-0036 note on routing-gated fixtures"
    relationship: related
    linked_at: 2026-09-04T20:15:45.774Z
    linked_by: ai:claude
  - sha: 5df82f1e3945a996b3767cc27bd5bdcfc9db5d07
    shortSha: 5df82f1
    message: "sentinel: close ISS-0123 and ISS-0152, EPIC-0036 in progress"
    relationship: related
    linked_at: 2026-09-04T20:16:19.972Z
    linked_by: ai:claude

---

# Zoom meeting-summary ingestion with multi-client routing

## Summary

Port the plasiv Zoom AI Companion puller (bin/pull-zoom-summaries.py, Python, stdlib-only) into decibel-tools-mcp as a pro-tier `zoom` facade, and extend it from single-repo to multi-client routing so one account-wide pull fans out to the right client project. Zero new npm deps (Node >=18 global fetch + fs). Local/stdio only until hosted-MCP auth is fixed.

## Motivation

- Decibel runs one client engagement (plasiv) today and expects more; the puller currently has to be copied and re-pointed per repo
- Nothing in src/ touches meetings today — no overlap with corpus or the voice inbox
- Zoom returns next_steps as a structured array, which maps onto sentinel issues

## Outcomes

- One zoom facade across all Decibel projects instead of a per-repo script copy
- A weekly sync_all that routes each meeting to the right client project
- No silently dropped meetings
- Foundation for meeting-summary to sentinel-issue extraction

## Acceptance Criteria

- [ ] zoom facade registered in tools/index.ts under loadProTools and visible in both transports
- [ ] Dedup keyed on meeting_uuid, not filename
- [ ] Credentials read from ~/.decibel/config.yaml
- [ ] Per-project match rules on ProjectEntry
- [ ] Unmatched meetings land in an unrouted bucket, never dropped
- [ ] dry-run prints the routing table before writing

## Note (2026-09-04T19:41:59.665Z)

Port intel from the plasiv peer, 2026-09-04. Source is unchanged since 2026-08-14 (commit b6ace88); nothing else in plasiv pulls Zoom.

DO NOT TRUST THE SOURCE AS PROVEN. A crontab entry outside the repo (`0 18 * * * /usr/bin/python3 <plasiv>/bin/pull-zoom-summaries.py --route --days 7`) has never once succeeded — 18 log lines, all "Operation not permitted", from cron lacking macOS TCC Full Disk Access to /Volumes/Ashitaka plus /usr/bin/python3 resolving through the Xcode shim. Every summary on disk was pulled by hand, so the --route path in particular has almost no real mileage. Port it with fresh eyes, don't copy its behaviour on faith.

Do not move or delete the plasiv script when porting — that crontab still points at its path and Ben has not decided its fate.

CARRY OVER EXACTLY (dedup depends on it):
- Frontmatter keys: source: zoom-ai-companion / topic (quotes downgraded) / start / meeting_uuid / status
- Filename: "{topic}{ YYYY-MM-DD HH_MM}Z.md", topic sanitised of [/\:*?"<>|]
- Dedup by scanning meeting_uuid out of the first 600 chars of every *.md in the target dirs — filenames are unreliable and hand-named files predate the script
- extract_list()'s loud fallback: expect the list under `summaries`, fall back to any list-of-dicts and print which key it came from, warn when total_records > 0 but no list was found

API FACTS:
- S2S OAuth: POST zoom.us/oauth/token?grant_type=account_credentials&account_id=..., Authorization: Basic base64(client_id:client_secret)
- GET /meetings/meeting_summaries?from&to&page_size=300, loop next_page_token; then GET /meetings/{uuid}/meeting_summary
- Meeting UUIDs are single URL-encoded normally but DOUBLE-encoded when they start with "/" or contain "//"
- Zoom ignores from/to on the summaries list endpoint — filter client-side or the window is a lie
- Two detail shapes: modern `summary_content` markdown, deprecated split of summary_overview + summary_details[] {label, summary} + next_steps[] (flat string array, coerce defensively). Prefer summary_content.
- Meetings with no AI Companion summary return an empty body: count and skip, never write. A missing file is expected, not a failure.

FIX IN THE PORT RATHER THAN PORTING AS-IS:
- Token is fetched once with no refresh; S2S tokens last 1h, so a long backfill outlives its token
- No retry, backoff, 429 handling or concurrency cap — serial one-detail-call-per-meeting. Clean log is meaningless at hand-driven volume.
- Dedup should key on uuid + start, not uuid alone: if Zoom reuses a UUID across occurrences of a recurring meeting the second is silently skipped. Unobserved but undefended.
- Routing matches a lowercased topic substring, first rule wins, no specificity ordering — a client name in an unrelated title misroutes. Registry aliases are deliberately excluded from matching (two-letter addresses like "dt"/"dv" match nearly any title). Find a better key than topic substring.
- --route is opt-in today with single-dir default; for a facade routed behaviour is probably the only mode worth having.

SPLIT: effectively all of it is general. There is no participant-to-client mapping. The only client-specific artifact is the registry entry `"zoom": {"match": ["plasiv"], "out": "meetings/raw"}`; the two "plasiv" strings in the script are docstring and error-hint examples.

## Note (2026-09-04T19:44:10.020Z)

Payload-shape intel and one correction from the plasiv peer, 2026-09-04 (second pass).

CORRECTION to the previous note: --route is not entirely unexercised. The unrouted bucket holds one file, which means a routed run has happened at least once by hand. "Least-exercised path" is accurate; "never run" was too strong. The cron record is unchanged — zero successful automated runs, everything hand-driven.

NO RAW PAYLOADS EXIST. The script renders straight to markdown and never persists a response, so there is nothing captured to test against. Shape below is inferred from rendered output, and the inference is sound: render() emits the deprecated split branch as overview -> detail sections -> next_steps LAST, but all 26 files on disk order it

  ## Quick recap / ## Next steps / ### <person> / ### Collaboration / ## Summary / ### <topic>

with Next steps SECOND. The split branch cannot produce that ordering. Therefore this account returns the modern single-markdown `summary_content`, and Zoom's own markdown already carries the per-person Next steps grouping.

Two consequences:
- The deprecated split branch (summary_overview / summary_details[] / next_steps[]) has NEVER been exercised against real data. It was described from the code, not observed. If carried across, carry it as a documented guess, not as tested behaviour.
- The next_steps-array question is moot for this account: there is no separate array. Next steps arrive as markdown bullets inside summary_content, each with a Zoom task permalink appended inline as `- <task text>[https://tasks.zoom.us?meetingId=<encoded uuid>&stepId=<uuid>](same url)`.

ENCODING: a real meeting_uuid from disk for tests — `lgoqel38SxWZZ6kiYgSYlw==` (no slashes, single-encode). The task permalink embeds the same uuid url-encoded with %3D%3D for the trailing ==, a second site where the encoding rule shows up. None of the 26 files carry a uuid starting with / or containing //, so the DOUBLE-ENCODE branch is likewise unverified against real data — the rule comes from Zoom's docs, not from a case seen here.

FIXTURES: the peer can hand-write a list-envelope + summary_content detail pair matching the observed shapes. It cannot honestly fabricate the deprecated split shape or a slash-bearing uuid, since neither has ever appeared. Genuine captured fixtures would need one live call at account-wide admin scope against real client meetings — Ben's decision, not the agents'.

See also the new dedup-collision issue filed against this epic: unrouted entries are globally "seen", so a later routing rule can never reclaim them.

## Note (2026-09-04T20:14:18.427Z)

Port landed 2026-09-04 on branch epic-0036-zoom-facade (commit b044865). 782 tests pass, clean build, verified against the built dist/server.js rather than only the source.

Acceptance criteria status:
- [x] zoom facade registered under loadProTools and visible in both transports — with the deliberate exception that it is HIDDEN from the HTTP listing, because ISS-0123 requires it not be served there. "Visible in both transports" as originally written conflicts with the security requirement; the security requirement wins.
- [x] Dedup keyed on meeting_uuid, not filename — strengthened to uuid + start (recurring-meeting uuid reuse).
- [x] Credentials read from ~/.decibel/config.yaml — new `zoom` block in DaemonConfig, with env override and the existing ~/.decibel/zoom-credentials.json still supported so plasiv's working setup is not migrated out from under it.
- [x] Per-project match rules on ProjectEntry — registry `zoom: {match, out}`, longest needle first.
- [x] Unmatched meetings land in an unrouted bucket, never dropped — and now genuinely reclaimable (ISS-0152).
- [x] dry-run prints the routing table before writing.

Closed by this work: ISS-0123 (gating), ISS-0152 (dedup poisoning).

STILL OPEN, and the honest limits of what shipped:
- Routing is still meeting-topic substring matching. Longest-needle ordering makes it deterministic; it does not make it correct. A client name in an unrelated meeting title still misroutes. Participant email domain is the obvious better key but nothing in the list payload carries it — a per-meeting participants lookup would be a second API call per meeting and has not been scoped.
- The deprecated split summary shape and the double-encoded uuid branch are implemented from Zoom's docs and have never been exercised against real data. Both are marked unverified in the code and the tests. Neither has a fixture, on purpose.
- Thin-stdio clients proxy through local HTTP to the daemon, so they hit the localOnly gate and cannot reach zoom. Only a direct stdio server can. That is the conservative reading of "local/stdio only" and it is a real functional limit, not an oversight — revisit when hosted auth is fixed.
- Nothing has been run against the live Zoom API. Every test is against hand-built fixtures.
- The plasiv Python is untouched and still has the ISS-0152 dedup bug. Its crontab entry still points at it and still fails on TCC.

## Note (2026-09-04T20:15:32.658Z)

Testing lesson worth generalising beyond this epic (2026-09-04): A FIXTURE CAN BE UNREACHABLE BY CONSTRUCTION.

The fixture set was built with four meetings, one of them ("Quick sync") intended as the no-summary-body case. In a routed run that meeting matches no routing rule, so it is stubbed and its detail is NEVER fetched — the empty-body path it was built to exercise cannot be reached through it at all. Three tests failed on the first run and the fix was in the expectations, not the code.

The general shape: when a pipeline gates one stage on the outcome of an earlier one, a fixture chosen to exercise the later stage has to be checked against the earlier gate first. Here, routing decides whether a detail fetch happens, so any fixture testing detail-fetch behaviour must route somewhere. The empty-body test now points a route at that meeting deliberately.

Why it matters more than a wrong assertion: had those three tests been written to pass rather than to fail loudly, the suite would have reported coverage of the empty-body path while never executing it. A fixture that silently tests nothing is worse than a missing one, because the gap is invisible. Both agents built the same wrong assumption independently, which is a reasonable sign it is an easy one to make again.

Related: plasiv filed ISS-0019 (high) on its side for the ISS-0152 dedup black hole, carrying this epic's acceptance test verbatim and naming commit b044865 as the fixed reference. Framed as decide-before-fixing — wontfix if the script retires in favour of the facade, patch only if it stays as a fallback path. Awaiting Ben, along with the disposition of the one personal summary already in the unrouted bucket.
