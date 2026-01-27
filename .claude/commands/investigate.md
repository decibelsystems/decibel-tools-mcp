# Investigate - Debug When Something Broke

Gather context for debugging regressions or unexpected behavior.

Use the `workflow_investigate` tool.

This is equivalent to asking: "Something broke - what changed?"

## What It Returns

- **Recent Commits** - Last 15 commits (filtered by context if provided)
- **Recent Issues** - Issues sorted by last update
- **Related Friction** - Pain points that might be relevant
- **Recent Learnings** - Knowledge that might help
- **Suggestions** - Next steps for investigation

## Parameters

- `context`: Optional hint about what broke. Used to filter commits and friction.

## When to Use

- Bug reports
- Regressions after deployment
- Unexpected behavior
- Post-incident analysis

## Example

```
workflow_investigate with context: "auth"
```

## Follow-Up Tools

After investigating, you might use:

- `git_find_removal` - Find when specific code was removed
- `git_blame_context` - See who changed specific lines
- `git_changed_files` - Compare before/after a specific commit
- `sentinel_list_repo_issues` - Deep dive on related issues
