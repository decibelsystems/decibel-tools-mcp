# ADR-0005: Mother Dojo Access - Role-Based AI Access Control

**Status:** Accepted
**Date:** 2025-12-14
**Authors:** Human + Claude Code

## Context

We want Mother (our orchestrating AI) and other AI agents to access Dojo tools via MCP for the wish → proposal → scaffold → run → results workflow. However, AI callers must never be able to:
- Enable experiments (flip the production switch)
- Disable experiments
- Graduate experiments to real tools

These are human-only decisions that require judgment about production readiness.

Additionally, we need:
- Project isolation: Dojo operations scoped to specific projects via Registry
- Sandbox enforcement: AI can only write to designated result directories
- Rate limiting: Prevent runaway AI loops from overwhelming the system

## Decision

### 1. Role-Based Policy System

Created a YAML-based policy system at `.decibel/dojo_policy.yaml` with three roles:

```yaml
roles:
  human:
    allowed_tools: ["*"]
    # Full access, no restrictions

  mother:
    allowed_tools:
      - dojo_add_wish
      - dojo_list_wishes
      - dojo_create_proposal
      - dojo_list
      - dojo_scaffold_experiment
      - dojo_run_experiment
      - dojo_get_results
      - dojo_can_graduate
    denied_tools:
      - dojo_enable_experiment
      - dojo_disable_experiment
      - dojo_graduate_experiment
    sandbox:
      fs_write: ["{DOJO_ROOT}/results/**", "{DOJO_ROOT}/wishes/**", "{DOJO_ROOT}/proposals/**"]
      exec_allowlist: [python, python3, node, rg, git]
      net: false

  ai:
    inherits: mother  # Generic AI gets same restrictions
```

**Key safety rule:** `never_expose_to_ai` list ensures enable/disable/graduate tools are NEVER available to any AI caller, enforced at runtime regardless of policy file.

### 2. Project-Scoped Operations

All Dojo tools now require a `project_id` parameter:

```typescript
interface DojoBaseInput {
  project_id: string;      // Required - resolves via Registry
  caller_role?: CallerRole; // Optional - defaults to 'human'
}
```

Resolution flow:
1. `project_id` → Registry lookup → `project.root`
2. Dojo artifacts at `{project_root}/.decibel/dojo/`
3. CLI executed with `cwd: projectRoot`

This enables Mother to operate on any registered project without path manipulation.

### 3. Rate Limiting for AI Callers

Created `src/tools/rateLimiter.ts` to prevent runaway scenarios:

| Role   | Max requests/min | Max concurrent |
|--------|-----------------|----------------|
| human  | unlimited       | unlimited      |
| mother | 30              | 3              |
| ai     | 20              | 2              |

Implementation uses sliding window for per-minute limits and counter for concurrent tracking. All limits enforced in `buildDojoContext()` before any tool execution.

### 4. Tool Flow

```
buildDojoContext(projectId, callerRole, toolName)
  ├── checkRateLimit(callerRole) → throw if blocked
  ├── enforceToolAccess(toolName, callerRole) → throw if denied
  ├── recordRequestStart(callerRole) → increment concurrent counter
  └── resolveDojoRoot(projectId) → {projectRoot, dojoRoot}

[tool execution in try block]

finally:
  └── finishDojoRequest(callerRole) → decrement concurrent counter
```

## Implementation

### Files Created
- `.decibel/dojo_policy.yaml` - Role definitions and sandbox config
- `src/tools/dojoPolicy.ts` - Policy loader and enforcement
- `src/tools/rateLimiter.ts` - Rate limiting for AI callers

### Files Modified
- `src/tools/dojo.ts` - All tools updated with:
  - `DojoBaseInput` extension (project_id, caller_role)
  - `buildDojoContext()` for policy/rate enforcement
  - try/finally pattern for concurrent tracking
  - CLI execution via `cwd: projectRoot`
- `src/server.ts` - Tool schemas updated with project_id (required) and caller_role (optional)

## Consequences

### Positive
- Mother can now safely propose and test features without human intervention
- Clear separation: AI proposes, human approves
- Project isolation prevents cross-contamination
- Rate limits prevent accidental infinite loops
- Policy is externalized (YAML) for easy adjustment

### Negative
- All Dojo tool calls now require project_id (breaking change for any existing callers)
- Rate limits may need tuning based on real usage patterns
- CLI doesn't have native `--project-root` flag, so we use cwd workaround

### Risks Mitigated
- **Rogue AI enabling experiments:** Hard-blocked at policy layer
- **Infinite request loops:** Rate limited at 30/min for Mother
- **Resource exhaustion:** Concurrent limit of 3 requests
- **Cross-project contamination:** All operations scoped to resolved project root

## Mother Integration (2025-12-15)

### HTTP API

Mother connects via HTTP server mode:

```bash
node dist/server.js --http --port 8787
```

Endpoint: `POST http://localhost:8787/call`

### Request Format

```json
{
  "tool": "dojo_add_wish",
  "arguments": {
    "project_id": "senken",
    "caller_role": "mother",
    "agent_id": "mother-v1",
    ...tool-specific params
  }
}
```

### Required Parameters

All Dojo tool calls from Mother must include:
- `project_id`: Target project (e.g., "senken")
- `caller_role`: Must be `"mother"` for proper access control
- `agent_id`: Agent identifier for audit trails (e.g., "mother-v1")

### Available Tools

| Tool | Description |
|------|-------------|
| `dojo_add_wish` | Log capability wish with context |
| `dojo_create_proposal` | Create proposal (can link to wish_id) |
| `dojo_scaffold_experiment` | Create experiment from proposal |
| `dojo_run_experiment` | Run in sandbox mode |
| `dojo_get_results` | Get experiment results |
| `dojo_list` | List proposals/experiments/wishes |
| `dojo_list_wishes` | List wishes |
| `dojo_can_graduate` | Check graduation eligibility |

### CLI Enhancements (2025-12-15)

New flags passed through MCP:

1. **`--wish` on propose**: Links proposal to existing wish
   - Auto-fills problem from wish's reason
   - Marks wish as resolved → proposal ID

2. **`--context` on wish**: Structured JSON context
   ```json
   {"recent_losses": 3, "volatility_spike": true}
   ```

3. **Enhanced run output**: Returns metrics, artifacts, results_dir

### Typical Workflow

```
Mother encounters limitation
  └─> dojo_add_wish (with context)

Mother has solution idea
  └─> dojo_create_proposal (link wish_id)

Human approves / auto-approve
  └─> dojo_scaffold_experiment

Mother implements experiment
  └─> (writes to experiment files)

Test in sandbox
  └─> dojo_run_experiment
  └─> dojo_get_results

Check eligibility
  └─> dojo_can_graduate

Human review
  └─> CLI: decibel dojo enable/graduate
```

### Documentation

Full integration guide: `docs/MOTHER-INTEGRATION.md`

## Future Considerations

1. **Authentication:** Add `--auth-token` for production HTTP deployment
2. **Dynamic rate limits:** Adjust based on system load
3. **Per-project policies:** Different projects could have different AI access levels
4. **CLI enhancement:** Add native `--project-root` flag to decibel CLI
5. **WebSocket transport:** For streaming responses

## References

- ISS-0010: sentinel_scanData empty stdout issue (led to project_id requirement)
- Original Mother directive from user (2025-12-14)
- ADR-0004: HTTP Mode for ChatGPT Integration
- `docs/MOTHER-INTEGRATION.md`: Full integration guide
