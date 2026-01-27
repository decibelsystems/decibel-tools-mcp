# ADR: Workflow Domain for Decibel Tools

## Status
Proposed

## Context

Users interact with decibel-tools-mcp via AI assistants (Claude, Cursor, VSCode, terminals). The current toolset has 76 tools across 12 domains, which creates cognitive overhead:

1. **Remembering which tool to use** - Users must recall specific tool names
2. **Manual git operations** - Git history is valuable for forensics but disconnected from Decibel
3. **No unified workflows** - Common patterns require multiple tool invocations

The goal: Make AI assistants the primary interface, with high-level workflows that chain tools automatically.

## Decision

Add a new **Workflow** domain with tools that:

1. Expose high-level intents (status, ship, investigate, etc.)
2. Integrate git operations natively (no external CLI dependencies)
3. Link Decibel artifacts to git history
4. Provide pre-commit/pre-merge quality gates as tools (not hooks)

### New Tools

| Tool | Description |
|------|-------------|
| `workflow_status` | Project health: open issues, roadmap health, friction, recommendations |
| `workflow_preflight` | Pre-commit checks: scan, policy audit, god file detection |
| `workflow_ship` | Pre-release: full audit, health check, build verification |
| `workflow_investigate` | Debug context: recent changes, related issues, friction, learnings |
| `workflow_start_feature` | Begin work: create epic, check friction, get recommendations |
| `git_log_recent` | Recent commits with optional filtering |
| `git_changed_files` | Files changed in a commit range or since tag |
| `git_find_removal` | Find when a string/function was removed (git log -S) |
| `git_blame_context` | Get context around a line with blame info |
| `git_tags` | List tags for release forensics |
| `sentinel_link_commit` | Link an issue/epic to a commit SHA |

### Workflow Tool Behavior

Each workflow tool chains existing tools and returns a unified result:

```typescript
workflow_status:
  1. sentinel_list_repo_issues (status: open)
  2. roadmap_getHealth
  3. friction_list (top 3 by signal)
  4. oracle_next_actions
  → Returns combined summary

workflow_preflight:
  1. sentinel_scan
  2. sentinel_auditPolicies
  3. Check for files > 400 lines
  4. Check for TODO/FIXME count
  → Returns pass/fail with details

workflow_investigate:
  1. git_log_recent (last 20)
  2. sentinel_list_repo_issues (open, by recent update)
  3. friction_list
  4. learnings_list (recent)
  → Returns investigation context
```

### Git Tools Implementation

Git tools use native `child_process.spawn` with git commands (git is universally available, unlike external CLIs). This follows the existing pattern in `bench.ts` for platform info.

```typescript
// Example: git_log_recent
export async function gitLogRecent(input: GitLogInput): Promise<GitLogOutput> {
  const resolved = resolveProjectPaths(input.projectId);
  const args = ['log', '--oneline', `-${input.count || 20}`];
  
  if (input.since) args.push(`--since=${input.since}`);
  if (input.path) args.push('--', input.path);
  
  const result = await execGit(args, resolved.root);
  return { commits: parseGitLog(result.stdout) };
}
```

### Linking Issues to Commits

When closing an issue, optionally link to the commit:

```yaml
# .decibel/sentinel/issues/ISS-0042.yml
id: ISS-0042
title: Fix auth token refresh
status: done
resolution: Fixed in main
linked_commits:
  - sha: abc1234
    message: "fix(auth): handle token expiry"
    date: 2025-01-22
```

This enables:
- `git_find_issue` - Find which commit resolved an issue
- `sentinel_get_epic_commits` - All commits linked to an epic's issues

## Consequences

### Positive
- AI assistants can use high-level intents instead of remembering 76 tools
- Git history becomes part of the project intelligence
- Quality gates are invokable (not hidden in hooks)
- Forensics: "when did this break?" becomes a tool call

### Negative
- Adds ~12 new tools (but simplifies usage patterns)
- Git dependency (acceptable - git is universal in dev environments)

### Neutral
- Existing tools remain available for fine-grained control
- Workflows are optional - power users can still use individual tools

## Implementation Notes

1. Add `src/tools/workflow.ts` for high-level workflow tools
2. Add `src/tools/git.ts` for git operations
3. Extend Sentinel to support `linked_commits` field
4. Add slash commands in `commands/` for common workflows
5. Update CLAUDE.md with workflow recommendations

## Slash Commands (for Claude Code plugin)

```
/decibel-tools:status     → workflow_status
/decibel-tools:preflight  → workflow_preflight  
/decibel-tools:ship       → workflow_ship
/decibel-tools:investigate → workflow_investigate
/decibel-tools:start "Feature name" → workflow_start_feature
```
