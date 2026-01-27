# Ship - Pre-Release Readiness Check

Comprehensive pre-release validation. Checks everything needed before shipping.

Use the `workflow_ship` tool.

This is equivalent to asking: "Is this ready to release?"

## What It Checks

- All preflight checks (data, code quality)
- Roadmap health review
- Blocked issues must be resolved
- Uncommitted changes
- Unpushed commits

## Output

- **Ready/Not Ready** status
- **Blockers** - Must fix before shipping
- **Warnings** - Should address but not blocking
- **Checklist** - Status of each item
- **Next Steps** - What to do next

## When to Use

- Before tagging a release
- Before merging to main/master
- Before deploying to production
- Release planning review
