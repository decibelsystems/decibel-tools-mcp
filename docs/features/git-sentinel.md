# Git-Sentinel Linking - Connect Commits to Work Items

> Bidirectional linking between git commits and Sentinel artifacts (issues, epics).

## Overview

Git-Sentinel tools create bidirectional references between git commits and Sentinel work items. This enables traceability: "what commits fixed this issue?" and "what issues does this commit relate to?"

## Problem

- Commits and issues live in separate systems
- Hard to trace "which commit fixed this bug?"
- No reverse lookup "what work items does this commit touch?"
- Manual linking is tedious and often forgotten

## Solution

```
Git Commit                     Sentinel Artifact
    │                               │
    │   sentinel_link_commit        │
    └──────────────────────────────►│
                                    │ (stores in YAML)
    │   sentinel_get_linked_commits │
    │◄──────────────────────────────┘
    │
    │   git_find_linked_issues
    └──────────────────────────────►│
                                    │ (scans all artifacts)
```

## Relationship Types

| Relationship | Use When | Example |
|--------------|----------|---------|
| `fixes` | Commit fixes a bug | `git commit -m "fixes ISS-0042"` |
| `closes` | Commit completes work | `closes EPIC-0001` |
| `implements` | Commit adds feature | `implements ISS-0015` |
| `related` | General reference | Standalone `ISS-0042` mention |
| `reverts` | Commit reverts previous | `reverts ISS-0033` |
| `breaks` | Commit introduces regression | `breaks ISS-0028` |

## Tools

| Tool | Description |
|------|-------------|
| `sentinel_link_commit` | Manually link a commit to an artifact |
| `sentinel_get_linked_commits` | Get all commits linked to an artifact |
| `git_find_linked_issues` | Reverse lookup: find artifacts for a commit |
| `sentinel_auto_link` | Auto-parse commit message and create links |

## Storage

Links are stored directly in the Sentinel artifact YAML:

```yaml
# .decibel/sentinel/issues/ISS-0042.yml
id: ISS-0042
title: Fix login timeout
status: done

linkedCommits:
  - sha: "abc1234def5678"
    message: "fixes ISS-0042: increase timeout to 30s"
    relationship: fixes
    linkedAt: "2026-01-25T14:30:00Z"

  - sha: "987fed654cba"
    message: "related cleanup for ISS-0042"
    relationship: related
    linkedAt: "2026-01-25T15:00:00Z"
```

## Usage Examples

### Manual Linking

```typescript
// Link a commit to an issue
await sentinel_link_commit({
  artifactId: "ISS-0042",
  commitSha: "abc1234",
  relationship: "fixes"
});

// Link to an epic
await sentinel_link_commit({
  artifactId: "EPIC-0001",
  commitSha: "def5678",
  relationship: "implements"
});
```

### Auto-Link from Commit Message

```typescript
// Parse commit message and create links automatically
await sentinel_auto_link({
  commitSha: "HEAD"  // or specific SHA
});

// Parses patterns like:
// - "fixes ISS-0042" → relationship: fixes
// - "closes EPIC-0001" → relationship: closes
// - "implements ISS-0015" → relationship: implements
// - standalone "ISS-0042" → relationship: related
```

### Query Linked Commits

```typescript
// Get all commits for an issue
const commits = await sentinel_get_linked_commits({
  artifactId: "ISS-0042"
});

// Returns:
// {
//   artifactId: "ISS-0042",
//   commits: [
//     { sha: "abc1234", message: "fixes ISS-0042...", relationship: "fixes", linkedAt: "..." },
//     { sha: "987fed6", message: "related cleanup...", relationship: "related", linkedAt: "..." }
//   ]
// }
```

### Reverse Lookup

```typescript
// Find all artifacts that reference a commit
const issues = await git_find_linked_issues({
  commitSha: "abc1234"
});

// Returns:
// {
//   commitSha: "abc1234def5678...",
//   artifacts: [
//     { id: "ISS-0042", type: "issue", relationship: "fixes" },
//     { id: "EPIC-0001", type: "epic", relationship: "implements" }
//   ]
// }
```

## Commit Message Patterns

The `sentinel_auto_link` tool recognizes these patterns (case-insensitive):

| Pattern | Detected Relationship |
|---------|----------------------|
| `fixes ISS-0042` | fixes |
| `fix: ISS-0042` | fixes |
| `fixing EPIC-0001` | fixes |
| `closes ISS-0042` | closes |
| `close EPIC-0001` | closes |
| `implements ISS-0015` | implements |
| `reverts ISS-0033` | reverts |
| `breaks ISS-0028` | breaks |
| `ISS-0042` (standalone) | related |
| `EPIC-0001` (standalone) | related |

## Integration Workflows

### Post-Commit Hook

Automatically link commits by adding to your workflow:

```bash
# After each commit, auto-link referenced issues
git commit -m "fixes ISS-0042: resolve login timeout"
# Then run:
sentinel_auto_link commitSha: "HEAD"
```

### PR Review

Before merging, check what issues will be affected:

```typescript
// Get all commits in PR
const commits = ["abc123", "def456", "ghi789"];

// Check what each touches
for (const sha of commits) {
  const linked = await git_find_linked_issues({ commitSha: sha });
  console.log(`${sha} affects: ${linked.artifacts.map(a => a.id).join(", ")}`);
}
```

### Issue Investigation

When investigating an issue, see what commits have been applied:

```typescript
const commits = await sentinel_get_linked_commits({
  artifactId: "ISS-0042"
});

// Check if there's a fix commit
const hasFix = commits.commits.some(c => c.relationship === "fixes");
```

## Best Practices

1. **Reference issues in commit messages** - Makes auto-link work
2. **Use specific verbs** - "fixes" vs "closes" vs "implements"
3. **Link reverts explicitly** - Helps track regressions
4. **Run auto-link after commits** - Or use post-commit hook
5. **Query before closing issues** - Verify fixes are committed

## Integration Points

- **Workflow Investigate**: Shows linked commits when debugging
- **Velocity Tracking**: Attribute commits to work items
- **Roadmap Progress**: Track epic completion via linked commits
