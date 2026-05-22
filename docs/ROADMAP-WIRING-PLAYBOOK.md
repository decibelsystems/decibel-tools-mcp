# Roadmap Wiring Playbook

A reusable procedure for fixing a Decibel project where epics exist but aren't connected to the roadmap, and the roadmap itself is stale or placeholder.

**Use this when**: `roadmap.yaml` still has scaffold data (`OBJ-0001 "Example Objective"`), `milestones[].epics` is empty, or `oracle roadmap` reports `epics_total: 0` despite epics existing in `.decibel/sentinel/epics/`.

**Symptom**: the roadmap reports `0%, behind` not because work isn't happening, but because the strategy layer can't *see* the work — the `roadmap link_epic` step was never run.

---

## The prompt

Paste this verbatim to Claude in the target repo. It audits first, stops at the two real decision points, and verifies at the end.

> **Wire this project's epics to its roadmap.** Work in these phases and stop where noted.
>
> **Phase 1 — Audit (read-only, report back).**
> Run `sentinel list_epics` and `roadmap read` (or read `.decibel/sentinel/epics/` and `.decibel/architect/roadmap/roadmap.yaml` directly). Tell me: how many epics exist, how many are linked to the roadmap (`epic_context`), whether `roadmap.yaml` has real objectives/milestones or just placeholder scaffold, and what `oracle roadmap` / `get_health` currently reports.
>
> **Phase 2 — Triage epics (stop for my approval before changing anything).**
> Classify each epic as **real** or **fixture**. Fixtures are: created in a tight timestamp cluster (many within seconds of each other), generic names ("Test Epic", "Epic 1", "First"), or exact-duplicate titles. Real epics have spread-out timestamps and descriptive titles + summaries. Show me the fixture list with evidence (timestamps, names). **Do not cancel anything yet — wait for my OK**, then set approved fixtures/duplicates to `status: cancelled` with a `cancelled_reason`.
>
> **Phase 3 — Design the roadmap structure (stop for my approval).**
> For the real epics, propose: themes, objectives (with timeframe + key results), milestones (with target dates), and a full epic→objective/milestone/theme/work_type mapping table. The milestone dates and groupings are my call — **present the table and wait for my approval or edits** before writing.
>
> **Phase 4 — Write the wiring.**
> Write the approved structure into `roadmap.yaml` (objectives, themes, milestones), and for each real epic add an `epic_context` entry linking it to its theme/objective/milestone/work_type. Use `roadmap link_epic` if the MCP tool is available, otherwise edit `roadmap.yaml` directly. Validate: every `epic_context` milestone/objective/theme reference resolves, and every `milestone.epics[]` entry has an `epic_context`.
>
> **Phase 5 — Correct epic statuses from evidence.**
> For each real epic, determine `planned | in_progress | shipped` from **code evidence and linked-issue states** — not guesswork. Linked issues all closed + code present → `shipped`; code present or issues open → `in_progress`; no code, no issues → `planned`. Record a `status_evidence` line on each epic you change.
>
> **Phase 6 — Regenerate health.**
> Run `roadmap get_health` and `oracle roadmap` so the cached `oracle/progress.yaml` reflects the new wiring. Report the before/after milestone progress.

---

## Why it's shaped this way

- **The two hard stops are deliberate.** Phase 2 (cancelling epics) mutates shared data on the agent's own inference — Claude's safety classifier will block a bulk-cancel that wasn't explicitly approved. Phase 3 (objectives/milestones/dates) is a strategic judgment only the project owner holds. Every other phase is safe to run unattended.
- **"Evidence, not guesswork" in Phase 5 is load-bearing.** Without it, Claude marks epics `shipped` by reading the summary's optimistic tone. Forcing it to check linked-issue states and grep for the actual code is what makes the resulting roadmap trustworthy.
- **Phase 1 being read-only-and-report matters** because every account differs — some have no `roadmap.yaml` at all (needs `roadmap init` first), some have real objectives but unlinked epics, some are pure placeholder. The audit tells Claude which subset of phases applies.

---

## Variant shortcuts

| Situation | Adjust the prompt |
|---|---|
| No `roadmap.yaml` at all | Prepend: *"If there's no roadmap.yaml, run `roadmap init` first."* |
| You trust the fixture call | Append to Phase 2: *"If fixtures are an obvious timestamp-clustered batch, cancel them without stopping."* |
| You just want the audit | Paste only Phase 1. Good for triaging which accounts need the full treatment. |

---

## Reference: the data model

Three facades, three layers — see the hierarchy:

```
OBJECTIVE        (Roadmap facade owns)   "why" — quarters/releases
  └─ MILESTONE   (Roadmap facade owns)   time-boxed delivery target
       └─ EPIC   (Sentinel facade owns)  large body of work
            └─ ISSUE  (Sentinel owns)    individual task
```

- **Sentinel** owns the epic + issue *records* (`log_epic` is the only place an epic is born).
- **Roadmap** owns objectives + milestones, and the epic↔objective link (`link_epic`). It never *creates* epics.
- **Oracle** owns nothing — read-only analysis (`oracle roadmap` is a rollup view).

`roadmap.yaml` schema:

```yaml
objectives:   [{ id, title, timeframe, owner?, key_results?: [{metric,target,current}] }]
themes:       [{ id, label, description? }]
milestones:   [{ id, label, target_date, epics?: [epic_id, ...] }]
epic_context:
  EPIC-XXXX:
    epic_id: EPIC-XXXX
    theme: <theme-id>
    objectives: [<objective-id>, ...]
    milestone: <milestone-id>
    work_type: feature | infra | refactor | experiment | policy
    adrs: []
```

`link_epic` writes both sides: it appends the epic to `milestone.epics[]` AND creates the `epic_context[epicId]` entry.

Epic statuses: `planned | in_progress | shipped | on_hold | cancelled`.

---

## Fixture detection heuristics

Test fixtures leak into the live `.decibel/` store when a test suite runs against it instead of a temp dir. Tells:

1. **Timestamp clustering** — many epics/issues created within the same second or two (`created_at` values within ~100ms).
2. **Generic names** — "Test Epic", "First", "Second", "Epic 1", "High Priority", "Epic: Special Characters! @#$%". Each name exercises a different code path.
3. **Batch correlation** — fixture epics and fixture issues usually share the same creation timestamp (one test run produced both).
4. **Contrast with real items** — real epics have timestamps spread over weeks/months, descriptive titles, and full multi-paragraph summaries.
