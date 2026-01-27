# Preflight - Pre-Commit Quality Checks

Run quality checks before committing. Validates data integrity, code quality, and blocked issues.

Use the `workflow_preflight` tool.

This is equivalent to asking: "Is this code ready to commit?"

## Checks Performed

1. **Git Status** - Uncommitted changes warning
2. **Data Validation** - Sentinel scan for orphans, stale items, invalid data
3. **Code Quality** - Auditor triage for god files, high-severity issues
4. **Blocked Issues** - Check for unresolved blockers

## Parameters

- `strict`: If true, warnings cause failure (default: false)

## When to Use

- Before `git commit`
- Before creating a PR
- After significant changes
- As part of code review

## Strict Mode

With `strict: true`, any warning becomes a failure. Use this for:
- Pre-merge checks
- CI/CD pipelines
- Release preparation
