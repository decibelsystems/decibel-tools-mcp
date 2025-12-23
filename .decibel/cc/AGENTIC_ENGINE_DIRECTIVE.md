# CC Directive: Agentic Pack Engine Implementation

**Project**: decibel-tools-mcp  
**Location**: `src/agentic/`  
**Reference**: ADR-0020, SPEC at `senken/.decibel/architect/agentic/SPEC.md`

---

## Objective

Implement the Agentic Pack engine as a Decibel Architect module. This provides 4 tools for agent voice/rendering governance:

1. **Pack Compiler** — merge configs → single versioned artifact
2. **Renderer** — payload → text (pure function)
3. **Linter** — validate rendered output against dialect rules
4. **Golden Eval** — regression testing for semiotic clarity

---

## Core Invariant

> **Canonical payload is the truth. Renderers are only views.**

Renderers NEVER change meaning. They change compression, typography, and stance.

---

## File Structure to Create

```
src/agentic/
├── types.ts          # CanonicalPayload, RenderOutput, LintResult interfaces
├── compiler.ts       # Pack compilation + hashing
├── renderer.ts       # Payload → text transformation
├── linter.ts         # Output validation rules
├── golden.ts         # Golden eval harness
└── index.ts          # MCP tool registration
```

---

## Implementation Notes

### types.ts

Define the CanonicalPayload schema from SPEC.md. Key fields:
- `role`: Sensor | Analyst | Overmind | Specialist
- `status`: OK | DEGRADED | BLOCKED | ALERT
- `load`: GREEN | YELLOW | RED
- `evidence[]`, `missing_data[]`
- `decision`, `guardrails[]`, `dissent_summary[]` (Overmind)
- `metadata.pack_id`, `metadata.pack_hash`, `metadata.renderer_id`

### compiler.ts

```typescript
interface CompileResult {
  pack_id: string;
  pack_hash: string;  // SHA-256
  compiled_at: string;
  content: CompiledPack;
}

function compilePack(projectRoot: string): CompileResult
```

Reads from `.decibel/architect/agentic/`:
- taxonomy.yaml
- renderers.yaml
- consensus.yaml
- ansi_styles.yaml
- avatars/*.yaml
- packs/{pack_name}.yaml

Outputs `compiled_agentic_pack.json` + hash.

### renderer.ts

```typescript
function render(
  payload: CanonicalPayload,
  rendererId: string,
  pack: CompiledPack,
  target: 'plain' | 'markdown' | 'ansi' = 'plain'
): RenderOutput
```

Key logic:
1. Select renderer by `rendererId` from pack
2. If `payload.metadata.specialist_id` exists, use specialist renderer
3. Apply template substitution
4. Apply ANSI styles if target === 'ansi'
5. Return rendered text + metadata

### linter.ts

```typescript
function lint(
  rendered: string,
  rendererId: string,
  pack: CompiledPack,
  payload?: CanonicalPayload
): LintResult
```

Check rules from renderer constraints:
- Emoji position (header-only for roles, none for specialists)
- Max emoji count
- Required sections present
- Compression limits (line count, section length)
- Banned punctuation (!, hype words)

### golden.ts

```typescript
function runGolden(
  projectRoot: string,
  caseName?: string,
  strict?: boolean
): GoldenResult
```

For each golden case:
1. Load `{case}.payload.json`
2. Render with each expected renderer
3. Lint each output
4. Compare against stored `{case}.{role}.{ext}` files
5. Report pass/fail + diffs

---

## MCP Tools to Register

```typescript
// In server.ts or index.ts
tools: [
  {
    name: 'agentic_compile_pack',
    description: 'Compile agentic configs into versioned pack',
    inputSchema: { projectId: string }
  },
  {
    name: 'agentic_render',
    description: 'Render canonical payload through dialect',
    inputSchema: { payload: object, renderer_id: string, target?: string }
  },
  {
    name: 'agentic_lint',
    description: 'Validate rendered output against dialect rules',
    inputSchema: { rendered: string, renderer_id: string, payload?: object }
  },
  {
    name: 'agentic_run_golden',
    description: 'Run golden-set regression tests',
    inputSchema: { case_name?: string, strict?: boolean }
  }
]
```

---

## Testing

Create test cases using the golden example from SPEC:
- `weekend_trap.payload.json` → render → compare with `weekend_trap.overmind.md`
- Test lint catches: too many emoji, missing required section, hype words

---

## Dependencies

- `yaml` (already in package.json)
- `crypto` (Node built-in, for SHA-256)
- No external template engine needed; use simple string replacement

---

## Do NOT

- Modify trading logic or signal processing
- Change any existing tool behavior
- Add external dependencies without approval
- Use `@decibel/cli` (it doesn't exist — see ISS-0026)

---

## Success Criteria

1. `decibel agentic compile` produces valid `compiled_agentic_pack.json`
2. `decibel agentic render` transforms weekend_trap payload correctly
3. `decibel agentic lint` catches dialect violations
4. `decibel agentic golden run` passes for weekend_trap case
5. All tools registered and callable via MCP
