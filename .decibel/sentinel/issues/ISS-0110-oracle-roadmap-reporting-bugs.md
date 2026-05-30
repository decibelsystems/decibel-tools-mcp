---
id: ISS-0110
projectId: decibel-tools-mcp
severity: high
status: open
created_at: 2026-05-22T00:00:00.000Z
tags: [oracle, roadmap, sentinel, reporting, bug-cluster]
---

# Oracle/Roadmap reporting bugs — wired epics report wrong state

**Severity:** high
**Status:** open

## Summary

Four related bugs in the strategy-layer reporting path that, taken together, make `oracle_roadmap` and milestone progress report wrong values even when the underlying Sentinel store has correct data. Surfaced while validating the roadmap wiring landed in PR #24.

Bug 1 alone makes the wiring look broken: `oracle_roadmap` reports `0%, behind` for milestones whose epics are all marked `shipped` in Sentinel.

## Bugs

### 1. Status mapping drops `shipped` and `cancelled` → `not_started` (high)

**Location**: `src/tools/oracle.ts:719-726`

```ts
let status: EpicStatus['status'] = 'not_started';
if (statusStr === 'completed' || statusStr === 'done') {
  status = 'completed';
} else if (statusStr === 'blocked') {
  status = 'blocked';
} else if (statusStr === 'in_progress' || statusStr === 'active') {
  status = 'in_progress';
}
```

Sentinel's `EpicStatus` vocabulary is `planned | in_progress | shipped | on_hold | cancelled` (`src/tools/sentinel.ts:42`). `shipped` doesn't match any branch — it falls through to `not_started`. Same for `cancelled` and `on_hold`.

**Fix**: extend the match to include `shipped` in the `completed` branch and `on_hold` in the `blocked` branch. Treat `cancelled` as not counted in totals.

### 2. `calculateMilestoneStatus` ignores `milestone.status` field (med)

**Location**: `src/tools/oracle.ts:646-651`

```ts
function calculateMilestoneStatus(
  milestone: { target_date: string },
  epicsCompleted: number, epicsTotal: number, epicsBlocked: number
): 'on_track' | 'at_risk' | 'behind' | 'completed' {
```

The parameter type only carries `target_date` — even if `roadmap.yaml` adds a `status: shipped` field to a milestone, the function never sees it. Classification falls back to "behind" once the target date is past, regardless of declared completion.

**Fix**:
- Extend `Milestone` interface in `src/tools/roadmap.ts:38-43` with optional `status`.
- Extend the local Roadmap type in `src/tools/oracle.ts:551-555` to include `status` on milestones.
- In `calculateMilestoneStatus`, short-circuit to `'completed'` when `milestone.status` is `'shipped'` or `'completed'`.

### 3. Hand-crafted YAML frontmatter doesn't auto-quote `#` (high)

**Location**: `src/tools/sentinel.ts:823-834` (and similar template-literal frontmatter assembly elsewhere)

```ts
const frontmatter = [
  '---',
  `id: ${epicId}`,
  `title: ${input.title}`,     // ← no quoting
  ...
].join('\n');
```

A title or summary value containing `#` (e.g. "Fix bug from PR #42") silently truncates on round-trip because YAML treats `#` as a comment indicator. Confirmed locally:

```
input.title = "Fix bug from PR #42"
written:    title: Fix bug from PR #42
parsed back: { title: "Fix bug from PR" }   ← truncation
```

`stringifyYaml()` (yaml v2.8.2) already auto-quotes correctly — the bug is only in hand-crafted template literals.

**Fix**: introduce a `yamlScalar(value)` helper that returns the value double-quoted when it contains any of `# : { } [ ] , & * ! | > ' " % @ \``  or starts with whitespace; use it wherever frontmatter is assembled (sentinel.ts, possibly architect/designer epics writers). Add regression tests for round-trip.

### 4. No warning when shadow `.decibel/roadmap.yml` exists alongside canonical `architect/roadmap/roadmap.yaml` (low)

**Location**: `src/tools/oracle.ts:572-581`, `src/tools/roadmap.ts:loadRoadmap`

```ts
async function loadRoadmap(resolved: ResolvedProjectPaths): Promise<Roadmap | null> {
  const roadmapPath = resolved.subPath('architect', 'roadmap', 'roadmap.yaml');
  // ... silently reads only canonical path
}
```

Operators occasionally create a `.decibel/roadmap.yml` at the project root by mistake. Oracle silently uses the canonical file and ignores the shadow — leading to confusion when edits to the shadow file appear to have no effect.

**Fix**: check for `.decibel/roadmap.yml` and `.decibel/roadmap.yaml` at load time; if present alongside the canonical file, emit a warning in the response and (optionally) suggest deletion or migration.

## Why this matters

PR #24 wired 12 epics to the roadmap with correct `shipped`/`in_progress`/`planned` statuses, but `oracle_roadmap` will still report M-0001 as `0%, behind` because of Bug 1. The data is right; the reporting layer is stale.

## Proposed PR

Single fix PR touching:
- `src/tools/oracle.ts` (bugs 1, 2, 4)
- `src/tools/roadmap.ts` (bug 2 type extension)
- `src/tools/sentinel.ts` (bug 3 helper + apply at frontmatter sites)
- Tests for status mapping, milestone status, frontmatter round-trip, shadow file warning

**Effort**: ~3 hours
**Risk**: low — additive matches, no behavior change for valid existing data
