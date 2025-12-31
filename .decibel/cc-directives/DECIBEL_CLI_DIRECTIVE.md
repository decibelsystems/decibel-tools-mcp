# Directive: Decibel CLI + MCP Fallback

**Epic:** EPIC-0011 - Decibel CLI + MCP Tool Alignment  
**Issues:** ISS-0011 (CLI), ISS-0012 (MCP fallback)  
**Owner:** Decibel Tools Thread  
**Priority:** High  

---

## Context

The MCP context pack tools (`decibel_context_list`, `decibel_context_pin`, etc.) currently shell out to a `decibel` CLI that doesn't exist. This causes all context tools to fail with `spawn decibel ENOENT`.

We want:
1. A real `decibel` CLI that humans can use from terminal
2. MCP tools that work with OR without the CLI (YAML fallback)

---

## Phase 1: Create Decibel CLI (ISS-0011)

### Goal
Create a Node.js CLI installable via `npm install -g` that provides context pack commands.

### Commands to Implement

```bash
# List pinned facts
decibel context list [--json]

# Pin a new fact
decibel context pin --title "Title" [--body "Body"] [--trust high|medium|low] [--refs ref1,ref2]

# Remove a pinned fact
decibel context unpin <fact-id>

# Compile full context pack (pinned facts + recent events + state)
decibel context refresh [--json]
```

### Implementation Steps

1. **Add bin to package.json:**
```json
{
  "bin": {
    "decibel": "./dist/cli.js"
  }
}
```

2. **Create src/cli.ts:**
```typescript
#!/usr/bin/env node
import { Command } from 'commander';
import { contextList, contextPin, contextUnpin, contextRefresh } from './cli/context.js';

const program = new Command();

program
  .name('decibel')
  .description('Decibel Tools CLI')
  .version('0.3.0');

const context = program.command('context').description('Context pack commands');

context
  .command('list')
  .description('List pinned facts')
  .option('--json', 'Output as JSON')
  .action(contextList);

context
  .command('pin')
  .description('Pin a fact to memory')
  .requiredOption('--title <title>', 'Fact title')
  .option('--body <body>', 'Fact body/details')
  .option('--trust <level>', 'Trust level: high, medium, low', 'medium')
  .option('--refs <refs>', 'Comma-separated references')
  .option('--json', 'Output as JSON')
  .action(contextPin);

context
  .command('unpin <id>')
  .description('Remove a pinned fact')
  .option('--json', 'Output as JSON')
  .action(contextUnpin);

context
  .command('refresh')
  .description('Compile full context pack')
  .option('--json', 'Output as JSON')
  .option('--sections <sections>', 'Comma-separated sections to include')
  .action(contextRefresh);

program.parse();
```

3. **Create src/cli/context.ts** with the actual logic:
   - Read/write `.decibel/context/pinned.yaml`
   - Use `js-yaml` for parsing
   - Resolve project from cwd (walk up looking for `.decibel/`)
   - Human-friendly output by default, JSON with `--json`

4. **Install commander:**
```bash
npm install commander
```

5. **Build and link:**
```bash
npm run build
npm link
```

### File Structure
```
src/
├── cli.ts                 # Main CLI entrypoint
├── cli/
│   ├── context.ts         # context subcommands
│   ├── resolveProject.ts  # Find .decibel from cwd
│   └── output.ts          # Human vs JSON formatting
```

### Output Examples

**Human output (default):**
```
📌 Pinned Facts (1)

  fact-20251216195240-5e55ed
  ──────────────────────────
  Title: Render Production: Senken Backend
  Trust: high
  Refs:  render.com, mediareason/senken-trading-agent
  
  Service: senken-trading-agent
  URL: https://senken.pro
  ...
```

**JSON output (--json):**
```json
{
  "facts": [
    {
      "id": "fact-20251216195240-5e55ed",
      "title": "Render Production: Senken Backend",
      "body": "Service: senken-trading-agent\n...",
      "trust": "high",
      "refs": ["render.com", "mediareason/senken-trading-agent"]
    }
  ]
}
```

---

## Phase 2: MCP YAML Fallback (ISS-0012)

### Goal
Update MCP context tools to work even when CLI is not installed.

### Strategy
```
Try CLI → If ENOENT → Fall back to direct YAML read/write
```

### Implementation

Update `src/tools/context.ts`:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

// Direct YAML implementations
async function contextListViaYaml(projectRoot: string): Promise<ContextListOutput> {
  const pinnedPath = path.join(projectRoot, '.decibel/context/pinned.yaml');
  
  if (!fs.existsSync(pinnedPath)) {
    return { status: 'executed', facts: [] };
  }
  
  const content = fs.readFileSync(pinnedPath, 'utf-8');
  const data = yaml.load(content) as { facts?: PinnedFact[] };
  
  return {
    status: 'executed',
    facts: data.facts || [],
  };
}

async function contextPinViaYaml(
  projectRoot: string,
  input: ContextPinInput
): Promise<ContextPinOutput> {
  const pinnedPath = path.join(projectRoot, '.decibel/context/pinned.yaml');
  const contextDir = path.dirname(pinnedPath);
  
  // Ensure directory exists
  if (!fs.existsSync(contextDir)) {
    fs.mkdirSync(contextDir, { recursive: true });
  }
  
  // Load existing or create new
  let data: { facts: PinnedFact[] } = { facts: [] };
  if (fs.existsSync(pinnedPath)) {
    const content = fs.readFileSync(pinnedPath, 'utf-8');
    data = yaml.load(content) as { facts: PinnedFact[] };
  }
  
  // Generate ID
  const now = new Date();
  const ts = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const hash = Math.random().toString(16).slice(2, 8);
  const id = `fact-${ts}-${hash}`;
  
  // Add fact
  data.facts.push({
    id,
    title: input.title,
    body: input.body,
    ts: now.toISOString(),
    trust: input.trust || 'medium',
    refs: input.refs,
  });
  
  // Write back
  fs.writeFileSync(pinnedPath, yaml.dump(data));
  
  return { status: 'pinned', id };
}

// Updated main function with fallback
export async function contextList(
  input: ContextListInput
): Promise<ContextListOutput | ContextError> {
  const callerRole = input.caller_role || 'human';
  
  try {
    const { projectRoot } = await buildContext(
      input.project_id,
      callerRole,
      'decibel_context_list',
      input.agent_id
    );
    
    // Try CLI first
    try {
      const args = ['context', 'list', '--json'];
      const { stdout, stderr, exitCode } = await execDecibel(args, projectRoot);
      
      if (exitCode === 0) {
        const result = JSON.parse(stripAnsi(stdout));
        return { status: 'executed', facts: result.facts || [] };
      }
    } catch (e: any) {
      if (e.code === 'ENOENT' || e.message?.includes('ENOENT')) {
        log('context: CLI not found, using YAML fallback');
        return await contextListViaYaml(projectRoot);
      }
      throw e;
    }
    
    // CLI failed, try YAML
    log('context: CLI failed, using YAML fallback');
    return await contextListViaYaml(projectRoot);
    
  } finally {
    recordRequestEnd(callerRole);
  }
}
```

### Testing the Fallback

1. **With CLI installed:**
   - `decibel context list` works
   - MCP `decibel_context_list` calls CLI

2. **Without CLI:**
   - MCP `decibel_context_list` reads YAML directly
   - Logs: "CLI not found, using YAML fallback"

---

## Acceptance Criteria

### Phase 1 (CLI)
- [ ] `npm run build` produces `dist/cli.js`
- [ ] `npm link` makes `decibel` available in PATH
- [ ] `decibel context list` shows pinned facts
- [ ] `decibel context list --json` outputs valid JSON
- [ ] `decibel context pin --title "Test"` creates a fact
- [ ] `decibel context unpin <id>` removes a fact
- [ ] Commands work when run from project subdirectory (finds `.decibel/` by walking up)

### Phase 2 (MCP Fallback)
- [ ] MCP tools work when CLI is installed (uses CLI)
- [ ] MCP tools work when CLI is NOT installed (uses YAML)
- [ ] Log message indicates which method was used
- [ ] No behavior change for end users

---

## Notes

- Use `commander` for CLI parsing (already popular, good TypeScript support)
- Keep CLI and MCP using the same YAML schema
- Project resolution: walk up from cwd looking for `.decibel/` folder
- The HTTP server mode already works, this is just for stdio MCP and terminal usage

---

## Files to Create/Modify

**New:**
- `src/cli.ts` - CLI entrypoint
- `src/cli/context.ts` - Context subcommand handlers
- `src/cli/resolveProject.ts` - Project finder
- `src/cli/output.ts` - Human/JSON formatting

**Modify:**
- `package.json` - Add bin field, add commander dependency
- `src/tools/context.ts` - Add YAML fallback functions

---

## Questions for Ben

None - proceed with implementation.
