# Technical Learnings: decibel-tools-mcp

> A living document of lessons learned, gotchas, and insights.

---

### [2025-12-24 17:22:28] Vintage Magic OCR: Drop shadow causes predictable character confusions
**Category:** integration | **Tags:** `ocr`, `magic`, `vintage`, `drop-shadow`, `fuzzy-matching`

Vintage Magic cards (pre-8th Edition, ~1993-2003) have white title text with black drop shadow that creates consistent OCR errors. The shadow causes predictable character confusions:

- `G` → `s`, `g` (shadow reads as separate stroke)
- `e` → `u`, `z` (shadow bleeds into letter shape)
- `a` → `r`, `u` (open counters fill with shadow)
- `t` → `r` (cross-stroke confusion)

Solution approach:
1. Detect vintage frame style (sample title bar for high contrast white+black in same region)
2. Apply shadow confusion matrix to weight Levenshtein substitutions
3. Constrain search to vintage card names (~7,500 vs 30,000+)
4. Generate multiple OCR candidates from shadow corrections

This pattern applies to any OCR task with drop shadow typography.

---
### [2025-12-24 17:39:21] Self-improving OCR: User selection as supervised learning signal
**Category:** architecture | **Tags:** `learning-system`, `ocr`, `deck`, `architecture`, `human-in-the-loop`

Implemented a self-improving OCR learning system with design provenance chain:

**The Learning Loop:**
1. User scans card → OCR produces noisy text
2. System shows candidates with scores
3. User selects correct card (GROUND TRUTH)
4. Signal recorded: OCR text → correct name + frame metadata
5. Confusion matrix updated (char + n-gram level)
6. Next scan uses learned corrections

**Key Design Decisions (from G's refinements):**

1. **N-gram layer** - Shadow errors smear across 2-3 chars (`ea→zr`), not just single chars
2. **Granular frame buckets** - Use Scryfall's `frame` field ("1993", etc) not just vintage/modern
3. **Undo window** - 5 seconds before commit to prevent bad labels from mis-taps
4. **Edit budget** - Max 4 mutations per candidate, scoring gate prevents degradation
5. **Min observation threshold** - 20 observations before learned rule activates
6. **Append-only JSONL** - Simple, versionable, async-friendly

**Files:**
- LearningSignal.swift - Full capture model with diagnostics
- LearningStore.swift - JSONL persistence with undo
- ConfusionMatrix.swift - Needleman-Wunsch alignment, char + ngram
- LearnedCandidateGenerator.swift - Edit-budgeted candidate gen
- OCRLearningIntegration.swift - UI entry point

This pattern generalizes to any human-in-the-loop ML system where user selection = supervision signal.

---
### [2025-12-30 05:22:55] Mobile Companion App Architecture: Pocket Console Pattern
**Category:** architecture | **Tags:** `mobile`, `architecture`, `patterns`, `icloud`, `offline-first`

For mobile companion apps in an AI/agentic ecosystem, the "Pocket Console" pattern works well:

1. **Capture** - Mobile excels at voice input and share extensions. Use offline-first queue (SwiftData) with eventual sync.

2. **Observe** - Don't replicate desktop dashboards. Provide glanceable status snapshots with < 10s time-to-value.

3. **Act** - Voice commands that trigger queued actions. Never destructive without confirmation. Default to "enqueue if offline".

4. **Share** - Use native share sheet (UIActivityViewController) instead of building in-app chat. Leverage existing team tools.

Key insight: iCloud Drive provides 80% of cross-device sync value with 20% of the complexity. Write events as JSON files to inbox folders, let desktop agent watch and process. Defer Hub/API until sync latency becomes a problem.

Schema versioning (v1) from day one enables future evolution without breaking changes.

---
### [2026-01-01 07:16:29] Supabase Cloud Spine Integration Complete
**Category:** integration | **Tags:** `supabase`, `cloud-spine`, `studio`, `handoff`, `senken-pro`

## Session Handoff - 2024-12-31

### What Was Added

**Supabase Client (`src/lib/supabase.ts`)**
- Singleton pattern for anon + service role clients
- Type definitions for all Decibel Studio entities: Project, Artifact, ArtifactFile, Device, Event, Job
- Connects to senken.pro Supabase backend
- Env vars: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`

**Cloud Spine Tools (`src/tools/studio/cloud-spine.ts`)**
12 MCP tools for Decibel Studio cloud sync:
- Projects: `studio_list_projects`, `studio_create_project`, `studio_get_project`
- Artifacts: `studio_list_artifacts`, `studio_create_artifact`, `studio_update_artifact`
- Events: `studio_sync_events` (incremental sync by sequence number)
- Devices: `studio_register_device`, `studio_heartbeat`
- Jobs: `studio_list_jobs`, `studio_claim_job`, `studio_update_job`

### Current State
- Build passes ✓
- Tools are exported via `src/tools/studio/index.ts` → `studioCloudSpineTools`
- Files are uncommitted (staged in git status)

### Pending Work
- Test against live senken.pro Supabase with real credentials
- Authentication flow (tools require auth for create/update operations)
- May need RLS policies tuned on Supabase side

### Git Status
Uncommitted files:
- `src/lib/supabase.ts` (new)
- `src/tools/studio/cloud-spine.ts` (new)
- `src/tools/studio/index.ts` (modified - imports cloud-spine)
- `package.json` (likely has @supabase/supabase-js dep)

---
