---
projectId: decibel-tools-mcp
severity: low
status: open
created_at: 2026-04-28T20:32:37.616Z
---

# registry.scan: add first_seen timestamp to findings

**Severity:** low
**Status:** open

## Details

HQ-side polish ask from decibel-hq peer (2026-04-28). The new Inbox surface displays drift findings as ticket rows; without a recency signal they're sorted arbitrarily. Adding `first_seen` per finding would let HQ sort by drift age.

## Per-finding source

**Unregistered findings** (.decibel/ on disk, not in registry):
- Stat the .decibel/ directory, return `first_seen: stats.birthtime.toISOString()` (macOS/APFS supports birthtime; Linux ext4 mostly does too on modern kernels)
- Fallback to `stats.mtime` if birthtime is the epoch (some filesystems)
- This is the cheap, authoritative signal — it's literally when the .decibel/ folder appeared

**Orphan findings** (registry entry, path missing):
- Harder — the path is gone, can't stat it
- Two options:
  - **Option A**: persist a small drift-state file at ~/.decibel/drift-state.json that records first-time-noticed per orphan id; on scan, look up and write new ones; clean up when orphan disappears (registry.remove'd)
  - **Option B**: add `added_at` to registry entries when projects are registered, then orphan first_seen = registry entry's added_at. Tiny schema bump but cleaner.
- Recommend Option B — meaningful for other features too (project age, sort by registration date)

## Schema

```ts
interface ScanFinding {
  id: string;
  path: string;
  registered: boolean;
  registeredAs?: string;
  first_seen?: string;  // ISO timestamp; absent if unknowable
}

interface OrphanFinding {
  id: string;
  path: string;
  reason: 'path_missing' | 'no_decibel_dir';
  first_seen?: string;  // from registry added_at if available
}
```

## Backwards compat

Field is optional, falls back to undefined for filesystems without birthtime support and for orphans pre-dating Option B implementation. HQ can sort "undefined first_seen" findings to the bottom or top depending on UX preference.

## Effort

~30 min for unregistered side (small fs.stat addition in scanForProjects). Orphan side gated on Option B — that's another small change to registerProject + projects.json schema.
