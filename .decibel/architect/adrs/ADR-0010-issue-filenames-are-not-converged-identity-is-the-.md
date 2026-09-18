---
id: ADR-0010
projectId: decibel-tools-mcp
status: accepted
created_at: 2026-08-31T00:05:15.416Z
updated_at: 2026-08-31T00:05:15.416Z
related_epics: [EPIC-0038]
---

# Issue filenames are not converged; identity is the id field, not the filename

## Context

EPIC-0038 Phase 5 converges the issue store. The behaviour half is done: one writer (#62), and all 58 bare-YAML records in this project converted to canonical markdown (#64). The remaining item was cosmetic — 79 records still carry timestamp-slug filenames like 2026-02-13T07-29-13Z-phase-1a-1b-eliminate-legacy-switch.md rather than ISS-NNNN-slug.md.

They split in two. 52 already carry a correct `id: ISS-NNNN` in frontmatter, so renaming would be a pure filename catch-up with no identity change and no collisions. The other 27 carry no id at all and currently report their filename as their id, so renaming would MINT identity they never had.

The blocking fact is what points at those filenames. 49 of 194 provenance events reference them, plus 2 ADRs — 52 references. Provenance events are not ordinary links:

    artifact_refs:
      - sentinel:issue:2026-02-13T07-29-13Z-phase-1a-1b-eliminate-legacy-switch-unify-tool-loa.md
    fingerprint_after: sha256:67e501c6a3bdc9ee

That is an immutable audit record with a content hash, written to record what happened at a point in time. Renaming leaves it dangling; rewriting it to match makes the audit log assert something that was never true. Neither is acceptable, and there is no third option that preserves both the rename and the record.

## Decision

Do not rename. Timestamp-slug filenames stay as they are, indefinitely, and Phase 5 is complete without this item.

Identity is the `id:` field, not the filename. That field is already correct on the 52 and the store already addresses records by it — findIssueCandidates matches on frontmatter id and on filename, so both populations resolve today. The filename is a human-facing convenience, and convergence buys tidiness in a directory listing and nothing else.

That is not a trade worth 52 broken references, 49 of them in an audit log whose entire purpose is to be trustworthy about the past. The epic already ranks this correctly — it calls cosmetic format convergence near-zero architectural value and sequences it last precisely so it can be dropped when it stops paying.

The 27 idless records are explicitly NOT given ids. Minting identity for a record that never had one is a larger change than it looks: they are addressed by filename today, so they would break twice — once when the name changes and once when the id they report changes.

## Consequences

POSITIVE: every provenance reference and both ADR references keep resolving; the audit trail stays true. No record changes identity. Phase 5 closes on the two things that mattered — one writer, one format — rather than being held open by cosmetics.

NEUTRAL: the issues directory holds two filename shapes indefinitely. This is visible in `ls` and nowhere else. Both resolve, both list, both close.

NEGATIVE / ACCEPTED: `ls` does not sort by issue number for those 79, and a human reading filenames cannot infer the id. Accepted deliberately.

IF THIS IS EVER REVISITED, the prerequisite is an aliasing layer in the resolver that accepts both the old filename and ISS-NNNN, so references survive the rename. Building that first turns this from a lossy change into a safe one. Do not reopen the rename without it.

DOES NOT APPLY TO the .yml -> .md conversion already done in #64. That changed bytes, not filenames stems, so no reference broke — which is exactly why it was safe and this is not.
