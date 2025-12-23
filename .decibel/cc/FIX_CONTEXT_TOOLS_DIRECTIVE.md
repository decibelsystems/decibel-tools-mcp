# CC Directive: Fix Context Tools (ISS-0026)

**Project**: decibel-tools-mcp  
**Issue**: ISS-0026 - Context tools broken - @decibel/cli package missing  
**Priority**: High

---

## Problem

Context tools fail with "require is not defined" because they import from a non-existent package:

```typescript
// src/tools/context.ts - BROKEN
import {
  compileContextPack,
  pinFact,
  unpinFact,
  listPinnedFacts,
  appendEvent,
  searchEvents,
  listArtifacts,
  readArtifact,
} from '@decibel/cli/lib/compiler';  // ❌ Package doesn't exist
```

---

## Fix Strategy

**Option chosen: Inline implementation**

Rather than creating a separate package, implement the functions directly in context.ts. This keeps dependencies minimal and avoids the workspace/publishing complexity.

---

## Functions to Implement

### Data Locations

All data lives in `.decibel/context/` within the project:

```
.decibel/context/
├── pinned.yaml       # Pinned facts
├── events.yaml       # Activity journal
└── artifacts/        # Run artifacts (referenced by run_id)
```

### pinFact(projectRoot, title, body?, trust?, refs?)

```typescript
interface PinnedFact {
  id: string;      // fact-{timestamp}
  title: string;
  body?: string;
  trust: 'high' | 'medium' | 'low';
  refs?: string[];
  ts: string;      // ISO timestamp
}

function pinFact(
  projectRoot: string,
  title: string,
  body?: string,
  trust?: 'high' | 'medium' | 'low',
  refs?: string[]
): PinnedFact {
  // 1. Load .decibel/context/pinned.yaml (create if missing)
  // 2. Generate id: `fact-${Date.now()}`
  // 3. Append new fact
  // 4. Write back
  // 5. Return the fact
}
```

### unpinFact(projectRoot, id)

```typescript
function unpinFact(projectRoot: string, id: string): boolean {
  // 1. Load pinned.yaml
  // 2. Find and remove fact by id
  // 3. Write back
  // 4. Return true if found, false if not
}
```

### listPinnedFacts(projectRoot)

```typescript
function listPinnedFacts(projectRoot: string): PinnedFact[] {
  // Load and return all facts from pinned.yaml
}
```

### appendEvent(projectRoot, title, body?, tags?)

```typescript
interface EventRecord {
  id: string;      // evt-{timestamp}-{random}
  title: string;
  body?: string;
  tags: string[];
  ts: string;
}

function appendEvent(
  projectRoot: string,
  title: string,
  body?: string,
  tags?: string[]
): EventRecord {
  // 1. Load .decibel/context/events.yaml (create if missing)
  // 2. Generate id
  // 3. Append event
  // 4. Write back
  // 5. Return event
}
```

### searchEvents(projectRoot, query, limit?)

```typescript
function searchEvents(
  projectRoot: string,
  query: string,
  limit?: number
): EventRecord[] {
  // 1. Load events.yaml
  // 2. Filter by query (simple substring match on title + body + tags)
  // 3. Return up to limit results (most recent first)
}
```

### compileContextPack(projectRoot, sections?)

```typescript
interface ContextPack {
  pinned_facts: PinnedFact[];
  recent_events: EventRecord[];
  // ... other sections as needed
}

function compileContextPack(
  projectRoot: string,
  sections?: string[]
): ContextPack {
  // 1. Load pinned facts
  // 2. Load recent events (last 50)
  // 3. Return combined pack
}
```

### listArtifacts(projectRoot, runId)

```typescript
interface ArtifactInfo {
  name: string;
  size: number;
  ref: string;
}

function listArtifacts(
  projectRoot: string,
  runId: string
): { run_id: string; artifacts: ArtifactInfo[] } | null {
  // 1. Check .decibel/dojo/results/{runId}/ exists
  // 2. List files in directory
  // 3. Return file info
}
```

### readArtifact(projectRoot, runId, name)

```typescript
function readArtifact(
  projectRoot: string,
  runId: string,
  name: string
): { run_id: string; name: string; content: string; mime_type: string } | null {
  // 1. Read file from .decibel/dojo/results/{runId}/{name}
  // 2. Detect mime type from extension
  // 3. Return content (base64 for binary)
}
```

---

## Implementation Steps

1. Add helper functions at top of `src/tools/context.ts`:
   - `ensureDir(path)` - create directory if missing
   - `loadYaml(path)` - load YAML file, return empty object if missing
   - `saveYaml(path, data)` - save YAML file

2. Implement each function inline (no external package)

3. Remove the broken import line

4. Test each tool via MCP

---

## Testing

```bash
# After fix, these should work:
decibel context pin --project senken --title "Test fact" --body "Test body"
decibel context list --project senken
decibel event append --project senken --title "Test event"
```

---

## Do NOT

- Create a separate @decibel/cli package
- Add new dependencies
- Change the MCP tool signatures
- Break existing tools

---

## Success Criteria

1. `decibel_context_pin` creates fact in `.decibel/context/pinned.yaml`
2. `decibel_context_list` returns pinned facts
3. `decibel_event_append` creates event in `.decibel/context/events.yaml`
4. `decibel_event_search` finds events by query
5. No "require is not defined" errors
