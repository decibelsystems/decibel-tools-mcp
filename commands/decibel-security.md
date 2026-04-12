---
description: Security review with auto-tracking to decibel
argument-hint: [project-id]
---

Perform a security-focused review of the code in the current context.

## Security Checklist

- Input validation and sanitization
- Authentication and authorization
- SQL injection vulnerabilities
- XSS (Cross-Site Scripting) vulnerabilities
- CSRF (Cross-Site Request Forgery) vulnerabilities
- Sensitive data exposure
- Dependency vulnerabilities
- Secrets/credentials in code
- Error handling that leaks information
- Insecure direct object references

## Output Format

Structure findings by severity:

## Critical
- List exploitable vulnerabilities requiring immediate attention

## High
- List significant security risks

## Medium
- List defense-in-depth issues

## Low
- List minor security improvements

## Learnings
- Note any security patterns or best practices discovered

---

## Workflow

After completing your review, follow this flow:

### Step 1: Offer to Fix

Ask the user:
> "I found [N] security issues. Would you like me to fix them now?"

If yes, make the fixes. If no, proceed to Step 2.

### Step 2: Re-assess After Fixes

If fixes were made, briefly note which vulnerabilities were resolved vs which remain.

### Step 3: Ingest to Decibel

Ask the user:
> "Would you like me to track the remaining findings and learnings in decibel?"

If yes, call the `codereview_ingest` MCP tool with:
- **Only unfixed vulnerabilities** (skip anything you just fixed)
- **All learnings** (security patterns are valuable regardless of fixes)

```json
{
  "review_type": "security-review",
  "raw_output": "<your review with ONLY unfixed issues and learnings>",
  "projectId": "$ARGUMENTS"
}
```

This creates issues for vulnerabilities that need future attention and captures security learnings.
