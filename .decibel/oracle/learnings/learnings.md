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
