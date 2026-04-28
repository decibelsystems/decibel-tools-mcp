---
description: Code review with auto-tracking to decibel
argument-hint: [project-id]
---

Review the code changes in the current context for bugs, issues, and improvements.

## Review Scope

- Check for bugs, logic errors, and edge cases
- Identify performance issues
- Review error handling
- Check for code style and maintainability issues
- Note any security concerns

## Output Format

Structure your review with clear sections:

## Critical Issues
- List critical issues that must be fixed

## High Priority
- List high priority issues that should be fixed soon

## Suggestions
- List nice-to-have improvements

## Learnings
- Note any patterns or insights worth documenting

---

## Workflow

After completing your review, follow this flow:

### Step 1: Offer to Fix

Ask the user:
> "I found [N] issues. Would you like me to fix them now?"

If yes, make the fixes. If no, proceed to Step 2.

### Step 2: Re-assess After Fixes

If fixes were made, briefly note which issues were resolved vs which remain unfixed.

### Step 3: Ingest to Decibel

Ask the user:
> "Would you like me to track the remaining findings and learnings in decibel?"

If yes, call the `codereview_ingest` MCP tool with:
- **Only unfixed issues** (skip anything you just fixed)
- **All learnings** (patterns are valuable regardless of fixes)

```json
{
  "review_type": "code-review",
  "raw_output": "<your review with ONLY unfixed issues and learnings>",
  "projectId": "$ARGUMENTS"
}
```

This creates issues for things that need future attention and captures learnings for the team.
