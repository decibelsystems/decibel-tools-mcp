---
uid: 01a050aa-bae5-7a6a-b500-eb12eccc505a
id: ISS-0147
projectId: decibel-tools-mcp
severity: med
status: open
epic_id: EPIC-0038
created_at: 2026-08-30T03:16:01.381Z
updated_at: 2026-08-31T00:12:03.180Z
---
# The architect ADR store has every defect Phase 2 repaired in the issue store

**Severity:** med
**Status:** open
**Epic:** EPIC-0038

## Details

Phase 2 repaired the SENTINEL store and declared its invariants (degraded == 0, duplicate_ids == 0, project values normalized) available to CI. The architect ADR store was never looked at and carries the same defects, unrepaired. Found incidentally while filing ADR-0009 on 2026-08-30.

1. DUPLICATE ID. Two distinct ADRs both claim ADR-0004:
   - ADR-0004-oversight-pack-composable-policies-compiled-into-s.yml (created 2025-12-21T16:01:33Z)
   - ADR-0004-agentic-pack-v1-capability-roles-render-dialects-a.yml (created 2025-12-22T19:56:57Z)
   Both status: accepted, both real decisions, a day apart. Same shape as the four sentinel duplicate groups.

2. WRONG PROJECT VALUES. Three ADRs say `project: decibel-tools`, four say `project: decibel-tools-mcp`. Identical to the 18 issue records Phase 2 normalized.

3. TWO FORMATS AND TWO FIELD NAMES. The .yml records carry `project:`; the newer .md records carry `projectId:`. That is not just a format split, it is a different KEY for the same fact, so any query over the store has to know both. Sentinel's equivalent split is what Phase 5 exists to converge.

4. UNEXAMINED: whether createAdr allocates ids by reading the directory and incrementing, i.e. whether it has the race Phase 1 fixed for issues with a cross-process lock. Two ADRs a day apart is not evidence of a race — check the allocator directly rather than inferring from the artifacts.

APPLY THE PHASE 2 LESSON, DO NOT SKIP TO A POLICY. The four sentinel duplicate groups turned out to be four unrelated accidents, and a single renumbering rule would have picked wrong on half of them. Read these two ADRs individually and decide which keeps 0004; both look live, unlike the sentinel losers which were all legacy or fixtures.

ALSO NOTE, unrelated to the store but adjacent: "ADR-0009" is now ambiguous in this repo's prose. This repo's ADR-0009 is the wire envelope; several EPIC-0037 and ISS-0135 references mean decibel-hq's ADR-0009 (the agent-token contract). Most are qualified with "decibel-hq"; ISS-0135's title is not. Cross-repo ADR references should always carry the repo name.

[2026-08-31] 2026-08-30 — evidence refresh, and a scope correction. Some of what this issue asserts no longer holds.

STILL TRUE — duplicate ADR-0004. Two different decisions share the id, both listed by list_adrs:
  ADR-0004  Agentic Pack v1 — Capability Roles, Render Dialects, and Consensus Orchestration
  ADR-0004  Oversight Pack: Composable Policies Compiled into Single Agent Entrypoint
One ADR also predates ADR-NNNN entirely and is still timestamp-named (2025-12-24T17-27-36Z-user-selection-as-supervised-learning-signal...).

NOT TRUE — the reader is fine. The ADR store does have the same two-format split the issue store had (8 bare .yml with title:/context:/decision: fields and `project:`, versus fenced .md with the title as a `# heading`, `##` sections and `projectId:`), but list_adrs resolves titles correctly from BOTH. src/architectAdrs.ts parses real YAML at lines 126 and 132 — it never had the hand-rolled first-colon splitter that broke the epic reader in #60. I checked before assuming the family resemblance held; it does not.

IMPORTANT BEFORE ANY RENUMBER: apply ADR-0010's reasoning to this store too. Grep .decibel/provenance for the filenames first. Renumbering the duplicate ADR-0004 is only safe if nothing immutable references it — the same constraint that stopped the issue-filename renames. Do not renumber and then discover the audit trail.

NEW, from the decibel-hq peer 2026-08-30 — ADR IDS COLLIDE ACROSS REPOS and it is live, not hypothetical:
  decibel-tools-mcp ADR-0010 = issue filenames stay timestamp-slug
  decibel-hq        ADR-0010 = HQ SDK stays private until we ship on decibelsystems
Both repos also hold an ADR-0008 and ADR-0009 meaning different things. Verified by reading both stores on disk. ADR ids are project-scoped, so a bare 'per ADR-0010' is ambiguous the moment it crosses a repo boundary and reads as confidently wrong rather than as missing. Convention agreed with the peer: repo-qualify when crossing boundaries, the way EPIC ids already are. This is a convention, not a defect — do not renumber across repos to make ids globally unique.
