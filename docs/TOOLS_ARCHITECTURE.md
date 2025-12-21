# Decibel Tools Architecture Directive

> **For AI Assistants**: Read this before implementing or modifying any tool in decibel-tools-mcp.

## Core Principle: Self-Contained MCP Server

**decibel-tools-mcp is a self-contained MCP server.** It must NOT depend on external CLIs.

```
CORRECT Architecture:
┌─────────────────────────────────────────────────────────────┐
│  Claude Desktop / Claude Code / Cursor                      │
└─────────────────────┬───────────────────────────────────────┘
                      │ MCP (stdio)
                      ▼
┌─────────────────────────────────────────────────────────────┐
│  decibel-tools-mcp                                          │
│  ════════════════════════════════════════════════════════   │
│  Native file operations (fs, YAML parsing)                  │
│  NO external CLI dependencies                               │
└─────────────────────┬───────────────────────────────────────┘
                      │ reads/writes
                      ▼
┌─────────────────────────────────────────────────────────────┐
│  .decibel/ folder (project-local)                           │
│  └── sentinel/, architect/, dojo/, friction/, etc.          │
└─────────────────────────────────────────────────────────────┘


WRONG Architecture (current dojo.ts bug):
┌─────────────────────────────────────────────────────────────┐
│  decibel-tools-mcp                                          │
│  spawn('decibel', [...])  ← WRONG: shells out to CLI        │
└─────────────────────┬───────────────────────────────────────┘
                      │ subprocess
                      ▼
┌─────────────────────────────────────────────────────────────┐
│  External CLI (doesn't exist / project-specific)            │
│  e.g., senken's "mother" CLI                                │
└─────────────────────────────────────────────────────────────┘
```

## Implementation Pattern

Follow the pattern established in `friction.ts` and `sentinel.ts`:

### ✅ CORRECT: Native File Operations

```typescript
import fs from 'fs/promises';
import path from 'path';
import YAML from 'yaml';
import { resolveProjectPaths } from '../projectRegistry.js';

export async function addWish(input: AddWishInput): Promise<AddWishOutput> {
  // 1. Resolve project paths
  const resolved = resolveProjectPaths(input.projectId);
  
  // 2. Build file path
  const wishDir = path.join(resolved.root, '.decibel', 'dojo', 'wishes');
  await fs.mkdir(wishDir, { recursive: true });
  
  // 3. Generate ID and write YAML
  const wishId = await getNextWishId(wishDir);
  const wishPath = path.join(wishDir, `${wishId}.yaml`);
  
  const wishData = {
    id: wishId,
    capability: input.capability,
    reason: input.reason,
    // ...
  };
  
  await fs.writeFile(wishPath, YAML.stringify(wishData), 'utf-8');
  
  return { wish_id: wishId, ... };
}
```

### ❌ WRONG: Shelling Out to CLI

```typescript
import { spawn } from 'child_process';

// DON'T DO THIS - creates external dependency
const DECIBEL_COMMAND = 'decibel';

async function execDecibel(args: string[]): Promise<...> {
  return new Promise((resolve) => {
    const proc = spawn(DECIBEL_COMMAND, args, { ... });
    // ...
  });
}

export async function addWish(input: AddWishInput): Promise<...> {
  // WRONG: depends on external CLI that may not exist
  const { stdout, stderr, exitCode } = await execDecibel([
    'dojo', 'wish', input.capability, '--reason', input.reason
  ]);
  // ...
}
```

## Project-Specific Extensions

Project-specific tools (like senken's "mother" CLI) can build ON TOP of decibel-tools-mcp:

```
┌─────────────────────────────────────────────────────────────┐
│  senken's mother CLI                                        │
│  - Can import from decibel-tools-mcp                        │
│  - Can add senken-specific commands                         │
│  - Can extend Dojo with trading-specific experiments        │
└─────────────────────┬───────────────────────────────────────┘
                      │ imports / extends
                      ▼
┌─────────────────────────────────────────────────────────────┐
│  decibel-tools-mcp (self-contained)                         │
└─────────────────────────────────────────────────────────────┘
```

The MCP server is the **foundation layer**. It must work standalone.

## File Locations

All data lives in project-local `.decibel/` folders:

```
{project_root}/
└── .decibel/
    ├── sentinel/
    │   ├── epics/
    │   │   └── EPIC-0001.yaml
    │   └── issues/
    │       └── ISS-0001.yaml
    ├── architect/
    │   └── adrs/
    │       └── ADR-0001.yaml
    ├── dojo/
    │   ├── wishes/
    │   │   └── WISH-0001.yaml
    │   ├── proposals/
    │   │   └── DOJO-PROP-0001.yaml
    │   ├── experiments/
    │   │   └── DOJO-EXP-0001/
    │   │       ├── manifest.yaml
    │   │       └── run.py
    │   └── results/
    │       └── DOJO-EXP-0001/
    │           └── 20251221-150000/
    │               └── result.yaml
    ├── friction/
    │   └── {timestamp}-{slug}.md
    ├── designer/
    │   └── decisions/
    │       └── {timestamp}-{slug}.md
    └── learnings/
        └── {project_id}.md
```

## Key Helper Functions

Use these established patterns:

| Function | Purpose | Source |
|----------|---------|--------|
| `resolveProjectPaths(projectId?)` | Get project root and .decibel paths | `projectRegistry.ts` |
| `validateWritePath(path, resolved)` | Ensure path is within project | `projectRegistry.ts` |
| `ensureDir(path)` | Create directory if needed | `dataRoot.ts` |
| `getNextId(dir, prefix)` | Generate next sequential ID | implement per-tool |

## Conversion Checklist

When converting a tool from CLI-based to native:

- [ ] Remove `spawn`/`exec` imports
- [ ] Remove CLI command constants (`DECIBEL_COMMAND`)
- [ ] Add `fs`, `path`, `YAML` imports
- [ ] Use `resolveProjectPaths()` for project resolution
- [ ] Write YAML directly to `.decibel/` subdirectories
- [ ] Generate sequential IDs (WISH-0001, DOJO-PROP-0001, etc.)
- [ ] Add proper error handling for file operations
- [ ] Emit provenance events where appropriate

## Current Status

| Tool File | Status | Notes |
|-----------|--------|-------|
| `friction.ts` | ✅ Native | Reference implementation |
| `sentinel.ts` | ✅ Native | Epics and issues |
| `architect.ts` | ✅ Native | ADRs |
| `designer.ts` | ✅ Native | Design decisions |
| `learnings.ts` | ✅ Native | Project learnings |
| `oracle.ts` | ✅ Native | Next actions |
| `dojo.ts` | ❌ CLI-based | **Needs conversion** |
| `context.ts` | ⚠️ Check | May have CLI deps |

## Priority: Convert dojo.ts

The `dojo.ts` file currently shells out to a non-existent `decibel` CLI. Convert these functions to native file operations:

1. `addWish` - write to `.decibel/dojo/wishes/WISH-NNNN.yaml`
2. `listWishes` - scan wishes directory
3. `createProposal` - write to `.decibel/dojo/proposals/DOJO-PROP-NNNN.yaml`
4. `scaffoldExperiment` - create experiment directory structure
5. `listDojo` - scan proposals and experiments
6. `runExperiment` - subprocess execution (keep spawn, but for the experiment script, not a CLI)
7. `getExperimentResults` - read from results directory
8. `readArtifact` - read artifact files
9. `canGraduate` - check experiment status from manifest

Follow the `friction.ts` pattern for each.
