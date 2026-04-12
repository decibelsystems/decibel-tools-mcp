---
description: PR review with auto-tracking to decibel
argument-hint: [project-id]
---

Review this PR for merge readiness.

## PR Review Checklist

- Does the code do what the PR description says?
- Are there adequate tests?
- Is the code readable and maintainable?
- Are there any breaking changes?
- Is documentation updated if needed?
- Are there any security concerns?
- Is error handling appropriate?

## Output Format

## Verdict

State one of: **Approve** | **Request Changes** | **Comment**

## Critical Issues
- List blocking issues that must be addressed before merge

## High Priority
- List important issues that should be fixed

## Suggestions
- List optional improvements

## Questions
- List any clarifications needed from the author

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
  "review_type": "pr-review",
  "raw_output": "<your review with ONLY unfixed issues and learnings>",
  "projectId": "$ARGUMENTS"
}
```

This creates issues for things that need future attention and captures learnings for the team.
