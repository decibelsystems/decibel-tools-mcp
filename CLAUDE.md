# Claude Code Context - READ FIRST

This file contains critical information for any Claude instance working on this codebase.

## Environment

- **OS**: macOS
- **Python**: Use `python3` (not `python`)

## Debugging Protocol

When investigating issues, bugs, or unexpected behavior:

### Required Structure

1. **Symptom Statement**: Describe the observed behavior precisely (not interpretations)

2. **Evidence Inventory**: List what we actually know with citations
   - File + function + line number for code claims
   - Exact log output for runtime claims
   - "Unverified" tag for anything inferred

3. **Hypothesis Set** (minimum 3):
   For each plausible explanation:
   - **H1/H2/H3**: [Description]
   - **Confirms if**: [Specific evidence that would prove this]
   - **Falsifies if**: [Specific evidence that would rule this out]

4. **Evidence Gaps**: What we don't know but need to
   - Exact instrumentation to add (log line, breakpoint, assertion)
   - Exact query/command to run

5. **Current Assessment**:
   > Most likely: [Hypothesis] (confidence: X%)
   > Because: [Specific evidence supporting this]
   > I could be wrong if: [What would change my mind]

### Anti-Patterns to Avoid
- ❌ "The problem is X" without citing evidence
- ❌ Jumping to solutions before completing hypothesis set
- ❌ Treating absence of evidence as evidence of absence
- ❌ Confidence > 80% without call chain or log confirmation