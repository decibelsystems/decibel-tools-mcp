# Claude Code Directive: Convert dojo.ts to Native File Operations

**Issue**: #3 - https://github.com/mediareason/decibel-tools-mcp/issues/3
**Priority**: High - blocking all Dojo tools from working

## Problem

`src/tools/dojo.ts` shells out to a `decibel` CLI that doesn't exist:

```typescript
const DECIBEL_COMMAND = 'decibel';
const proc = spawn(DECIBEL_COMMAND, args, {...});  // FAILS: spawn decibel ENOENT
```

## Solution

Convert all functions to use **native file operations** following `friction.ts` pattern.

## Reference Implementation

Study `src/tools/friction.ts` - it's the cleanest example:
- Uses `resolveProjectPaths()` for project resolution
- Writes directly to `.decibel/` subdirectories with `fs.writeFile()`
- Generates sequential IDs by scanning directory
- Uses YAML for structured data

## Functions to Convert

Priority order (start with addWish, it's most commonly used):

### 1. addWish (HIGH PRIORITY)
```
Input: capability, reason, inputs, outputs, projectId
Output: { wish_id: "WISH-0001", timestamp, path }
Write to: .decibel/dojo/wishes/WISH-NNNN.yaml
```

### 2. listWishes
```
Scan: .decibel/dojo/wishes/*.yaml
Return: array of wish summaries
```

### 3. createProposal
```
Write to: .decibel/dojo/proposals/DOJO-PROP-NNNN.yaml
```

### 4. listDojo
```
Scan: proposals/, experiments/, wishes/ directories
Return: combined summary
```

### 5. scaffoldExperiment
```
Create: .decibel/dojo/experiments/DOJO-EXP-NNNN/
  - manifest.yaml
  - run.py (or run.ts)
  - README.md
```

### 6. runExperiment
```
Keep spawn() but for the experiment script, not CLI:
spawn('python3', ['run.py'], { cwd: experimentDir })
Write results to: .decibel/dojo/results/DOJO-EXP-NNNN/{run_id}/
```

### 7. getExperimentResults, readArtifact, canGraduate
```
Read from results directory, no CLI needed
```

## File Structure

```
.decibel/dojo/
├── wishes/
│   └── WISH-0001.yaml
├── proposals/
│   └── DOJO-PROP-0001.yaml
├── experiments/
│   └── DOJO-EXP-0001/
│       ├── manifest.yaml
│       └── run.py
└── results/
    └── DOJO-EXP-0001/
        └── 20251221-152000/
            └── result.yaml
```

## Key Helpers to Use

```typescript
import fs from 'fs/promises';
import path from 'path';
import YAML from 'yaml';
import { resolveProjectPaths, validateWritePath } from '../projectRegistry.js';
import { ensureDir } from '../dataRoot.js';
```

## ID Generation Pattern

```typescript
async function getNextWishId(wishDir: string): Promise<string> {
  try {
    const files = await fs.readdir(wishDir);
    const ids = files
      .filter(f => f.startsWith('WISH-') && f.endsWith('.yaml'))
      .map(f => parseInt(f.replace('WISH-', '').replace('.yaml', ''), 10))
      .filter(n => !isNaN(n));
    const maxId = ids.length > 0 ? Math.max(...ids) : 0;
    return `WISH-${String(maxId + 1).padStart(4, '0')}`;
  } catch {
    return 'WISH-0001';
  }
}
```

## What to Remove

- `const DECIBEL_COMMAND = 'decibel';`
- `async function execDecibel()` 
- All `await execDecibel([...])` calls
- Text parsing functions (`parseWishOutput`, `parseProposalOutput`, etc.)

## What to Keep

- All type definitions (AddWishInput, etc.)
- `buildDojoContext()` - but simplify it
- `resolveDojoRoot()` - still needed for path resolution
- Rate limiting and policy checks

## Testing

After each function conversion:
```bash
npm run build
npm test
```

Manual test:
```bash
# Start server
node dist/server.js --http --port 8787

# Test addWish
curl -X POST http://localhost:8787/tools/call \
  -H "Content-Type: application/json" \
  -d '{
    "name": "dojo_add_wish",
    "arguments": {
      "project_id": "decibel-tools-mcp",
      "capability": "Test native wish",
      "reason": "Testing conversion",
      "inputs": ["test"],
      "outputs": {"result": "test"}
    }
  }'
```

## Success Criteria

- [ ] No `spawn decibel ENOENT` errors
- [ ] `dojo_add_wish` creates YAML file in correct location
- [ ] All existing tests pass
- [ ] Can add wish to any registered project

## Start Here

1. Read `src/tools/friction.ts` to understand the pattern
2. Read current `src/tools/dojo.ts` to understand the structure  
3. Start with `addWish` function - smallest, most impactful
4. Build and test after each function
