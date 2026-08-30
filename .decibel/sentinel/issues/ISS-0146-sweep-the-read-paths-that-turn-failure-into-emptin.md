---
uid: 01a050a9-99a8-725c-9b0c-367c2618d169
id: ISS-0146
projectId: decibel-tools-mcp
severity: med
status: open
epic_id: EPIC-0038
created_at: 2026-08-30T03:14:47.335Z
---
# Sweep the read paths that turn failure into emptiness

**Severity:** med
**Status:** open
**Epic:** EPIC-0038

## Details

A read path that catches broadly and returns an empty collection tells its caller a lie the caller cannot detect: "nothing there" and "could not read" arrive as the same bytes, through a success envelope.

MEASURED, NOT THEORETICAL. The decibel-hq peer measured ten of thirty-four projects returning empty provenance that demonstrably had events — non-deterministic, load-dependent, at concurrency 6, errored=0 (2026-08-30). That is fd-table exhaustion, and no part of the response said so. HQ initially filed it as a rate-limiter bug (their ISS-0007); the limiter was exonerated — it short-circuits before dispatch with a real 429 at src/httpServer.ts:778-785 — and the actual cause was ours.

FIXED IN eeeba99 (two instances):
- src/tools/provenance.ts listProvenance — one bare `catch {}` wrapped both the readdir AND the per-file loop, commented "Directory doesn't exist yet". Now only ENOENT may look like emptiness; per-record losses are counted in a new `unreadable_count`. A mid-loop failure previously returned the partial accumulation as though it were the complete set, which is worse than empty because it is plausible.
- src/tools/vector.ts listRuns — ensureDir() before readdir on a tool annotated readOnlyHint:true, so a mistyped project_id got a directory created for it and an empty list back.

STILL TO SWEEP. Same shape, unverified individually:
- listAgenticJobs (already noted in an earlier review as swallowing all errors into [])
- every other `catch {}` or `catch { return [] }` around a directory read in src/tools/ — the pattern is grep-able: readdir inside a try whose catch returns a collection.
- the same question for the .md/.yml issue store, though Phase 3's IssueRepository already narrowed most of it.

THE TEST TO APPLY, not a rule to apply blindly: does this catch let a failure be reported as a successful empty answer? ENOENT genuinely means "nothing there" and may be reported as emptiness. Everything else must reach the caller, or be counted where partial results are worth keeping.

Related: this is the same family as the kernel error-isolation work — a fault that is invisible to its caller is the failure mode, not the fault itself.
