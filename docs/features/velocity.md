# Velocity Tracking - Team Productivity Metrics

> DOJO-PROP-0006: Track contributor and team velocity over time with automated snapshots and trend analysis.

## Overview

Velocity Tracking captures contributor metrics across time periods (daily, weekly, quarterly). It aggregates data from git commits (with line counts) and Sentinel issues to provide visibility into team productivity trends.

## Problem

- Engineering managers lack visibility into team productivity
- No historical record of contribution patterns
- Can't answer "are we speeding up or slowing down?"
- Manual tracking is tedious and inconsistent

## Solution

```
Git History + Sentinel Issues
           │
           ▼
┌─────────────────┐
│ Snapshot        │  Capture metrics at a point in time
│ Capture         │  (daily, weekly, quarterly)
└─────────────────┘
           │
           ▼
┌─────────────────┐
│ Aggregation     │  Group by contributor
└─────────────────┘
           │
           ├──► velocity/snapshots/*.yml
           │
           ▼
┌─────────────────┐
│ Trend Analysis  │  Compare periods, detect changes
└─────────────────┘
```

## Metrics Captured

| Metric | Source | Description |
|--------|--------|-------------|
| Commits | git log | Number of commits in period |
| Lines Added | git numstat | Total lines added |
| Lines Deleted | git numstat | Total lines deleted |
| Issues Opened | Sentinel | Issues created in period |
| Issues Closed | Sentinel | Issues marked done in period |

## Time Periods

| Period | Date Range | Use Case |
|--------|-----------|----------|
| `daily` | Single day (00:00-23:59) | Daily standups, sprint tracking |
| `weekly` | Monday-Sunday | Sprint reviews, capacity planning |
| `quarterly` | Q1-Q4 calendar quarters | OKR reviews, performance tracking |

## Tools

| Tool | Description |
|------|-------------|
| `velocity_snapshot` | Capture a velocity snapshot for a period |
| `velocity_list` | List existing snapshots |
| `velocity_trends` | Calculate trends between periods |
| `velocity_contributor` | Individual contributor report |
| `velocity_install_hook` | Install git hook for auto-capture |
| `velocity_uninstall_hook` | Remove auto-capture hook |

## Storage

```
.decibel/velocity/
└── snapshots/
    ├── 2026-01-20-daily.yml
    ├── 2026-01-20-weekly.yml
    ├── 2026-01-01-quarterly.yml
    └── ...
```

## Snapshot Format

```yaml
period: daily
date: "2026-01-25"
range:
  start: "2026-01-25T00:00:00.000Z"
  end: "2026-01-25T23:59:59.999Z"

contributors:
  - id: "human:Alice <alice@example.com>"
    commits: 5
    linesAdded: 342
    linesDeleted: 89
    issuesClosed: 2
    issuesOpened: 1

  - id: "human:Bob <bob@example.com>"
    commits: 3
    linesAdded: 156
    linesDeleted: 23
    issuesClosed: 1
    issuesOpened: 0

projectTotals:
  commits: 8
  linesAdded: 498
  linesDeleted: 112
  issuesClosed: 3
  issuesOpened: 1

capturedAt: "2026-01-25T18:30:00.000Z"
```

## Usage Examples

### Capture a Snapshot

```typescript
// Daily snapshot (for today)
await velocity_snapshot({ period: "daily" });

// Weekly snapshot
await velocity_snapshot({ period: "weekly" });

// Historical snapshot (specific date)
await velocity_snapshot({
  period: "daily",
  referenceDate: "2026-01-20"
});
```

### View Trends

```typescript
// Compare last two weekly snapshots
const trends = await velocity_trends({ period: "weekly" });

// Returns:
// {
//   period: "weekly",
//   trends: [
//     { metric: "commits", direction: "up", changePercent: 15.3, current: 45, previous: 39 },
//     { metric: "linesAdded", direction: "stable", changePercent: 2.1, current: 1250, previous: 1224 },
//     { metric: "issuesClosed", direction: "down", changePercent: -25, current: 6, previous: 8 }
//   ],
//   comparedSnapshots: { current: "2026-01-20-weekly", previous: "2026-01-13-weekly" }
// }
```

### Contributor Report

```typescript
// Get individual contributor metrics
const report = await velocity_contributor({
  contributorId: "alice@example.com",
  period: "weekly",
  limit: 4
});

// Returns last 4 weekly snapshots for this contributor
// with totals aggregated across all snapshots
```

### List Snapshots

```typescript
// List all snapshots
const all = await velocity_list({});

// Filter by period
const weekly = await velocity_list({ period: "weekly", limit: 10 });
```

## Auto-Capture with Git Hooks

For enterprise dashboards, install the auto-capture hook to automatically capture daily snapshots after each commit:

### Install Hook

```typescript
await velocity_install_hook({
  hookType: "post-commit",    // or "post-push"
  periods: ["daily"]          // What to auto-capture
});
```

This creates/updates `.git/hooks/post-commit` to:
1. Check if today's daily snapshot exists
2. If not, capture a new snapshot
3. Never block commits (failures are silent)

### Uninstall Hook

```typescript
await velocity_uninstall_hook({ hookType: "post-commit" });
```

Safely removes the velocity hook while preserving any other hooks in the file.

## Trend Direction

Trends are calculated with a 5% threshold for stability:

| Change | Direction |
|--------|-----------|
| > +5% | `up` |
| < -5% | `down` |
| -5% to +5% | `stable` |

## Integration Points

- **Forecasting**: Use velocity data to calibrate capacity plans
- **Workflow Status**: Show velocity in project health checks
- **Roadmap**: Track delivery velocity against milestone timelines

## Enterprise Dashboard Use Case

For teams wanting a central dashboard:

1. **Install hooks** on all team member machines:
   ```bash
   velocity_install_hook periods: ["daily"]
   ```

2. **Aggregate data** by reading `.decibel/velocity/snapshots/*.yml` from all repos

3. **Dashboard** polls/syncs snapshot files and displays:
   - Team velocity trends over time
   - Individual contributor metrics
   - Comparison across repos/teams

The decentralized storage model means no central server is required - dashboards can read directly from git-synced `.decibel/` directories.
