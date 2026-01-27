# Forecasting Engine - Capacity Planning Tools

> DOJO-PROP-0005: Break down PRDs into tasks, estimate complexity, and create capacity plans using velocity data.

## Overview

The Forecasting Engine helps teams estimate work, plan capacity, and improve accuracy over time through calibration. It uses industry-standard Fibonacci story points combined with project-specific learning to generate realistic timelines.

## Problem

- Story point estimates are often wildly inaccurate
- No data-driven feedback loop to improve estimates
- Capacity planning is guesswork
- Teams don't know their actual velocity

## Solution

```
PRD/Feature Description
        │
        ▼
┌─────────────────┐
│ Task Decomposer │  Claude breaks PRD into discrete tasks
└─────────────────┘
        │
        ▼
┌─────────────────┐
│ Point Estimator │  Fibonacci scale + category multipliers
└─────────────────┘
        │
        ▼
┌─────────────────┐
│ Capacity Planner│  Team size × hours/week → timeline
└─────────────────┘
        │
        ▼
┌─────────────────┐
│ Calibration     │  Record actuals → improve future estimates
└─────────────────┘
```

## Story Point Scale

Fibonacci scale with baseline hour estimates:

| Points | Complexity | Baseline Hours | Confidence |
|--------|-----------|----------------|------------|
| 1 | Trivial | 1-4 | High |
| 2 | Simple | 3-8 | High |
| 3 | Moderate | 6-16 | Medium |
| 5 | Complex | 12-32 | Medium |
| 8 | Very Complex | 24-48 | Low |
| 13 | Large | 40-80 | Low |
| 21 | Epic-sized | 64-120 | Low |

**Rule**: Tasks estimated at 13+ points should probably be split.

## Category Multipliers

Different work types have different estimation accuracy:

| Category | Multiplier | Notes |
|----------|------------|-------|
| frontend | 1.2× | Often underestimated |
| backend | 1.0× | Baseline |
| api | 1.0× | Baseline |
| database | 1.1× | Schema changes have ripples |
| devops | 1.4× | High variance |
| testing | 0.9× | Usually faster than expected |
| documentation | 0.8× | Usually faster |
| design | 1.1× | Iteration cycles |
| other | 1.2× | Buffer for unknowns |

## Calibration System

As you record completed tasks, the system learns:

```yaml
calibration:
  lastUpdated: "2026-01-26T00:00:00Z"
  dataPoints: 25
  hoursPerStoryPoint: 3.8
  categoryMultipliers:
    frontend: 1.35
    backend: 0.95
    devops: 1.6
  confidenceLevel: medium  # low (<10), medium (10-19), high (20+)
```

**Confidence Levels**:
- `low`: < 10 completed tasks recorded
- `medium`: 10-19 completed tasks
- `high`: 20+ completed tasks

## Tools

| Tool | Description |
|------|-------------|
| `forecast_decompose` | Generate prompt for Claude to break down a feature |
| `forecast_parse` | Parse Claude's YAML response into task estimates |
| `forecast_plan` | Create capacity plan with timeline |
| `forecast_record` | Record a completed task for calibration |
| `forecast_calibration` | View calibration status and recommendations |

## Storage

```
.decibel/oracle/
├── calibration.yml        # Learned hours-per-point and multipliers
├── completed_tasks.yml    # Historical data for calibration
└── plans/                 # Saved capacity plans
    └── PLAN-2026-01-26-K786.yml
```

## Usage Flow

### 1. Decompose a Feature

```typescript
// Step 1: Get decomposition prompt
const result = await forecast_decompose({
  title: "User Authentication System",
  description: "Implement login, register, password reset with OAuth support",
  context: "Using Express + Prisma, need JWT tokens"
});

// Step 2: Send prompt to Claude, get YAML response
// (Claude returns task breakdown as YAML)

// Step 3: Parse the response
const tasks = await forecast_parse({
  projectId: "my-project",
  title: "User Authentication System",
  yamlResponse: claudeResponse
});
```

### 2. Create Capacity Plan

```typescript
const plan = await forecast_plan({
  projectId: "my-project",
  title: "Auth Sprint",
  tasks: tasks.tasks,
  teamSize: 2,
  hoursPerWeek: 32,  // Productive hours (not meeting time)
  startDate: "2026-02-01"
});

// Returns:
// {
//   plan: {
//     id: "PLAN-2026-01-26-K786",
//     totals: { storyPoints: 21, estimatedHours: { min: 42, max: 105 } },
//     timeline: {
//       estimatedWeeks: { min: 1, max: 2 },
//       estimatedEndDate: { min: "2026-02-08", max: "2026-02-15" }
//     }
//   }
// }
```

### 3. Record Actuals (Calibration)

```typescript
// After completing a task, record the actual time spent
await forecast_record({
  projectId: "my-project",
  taskId: "TASK-ABC123",
  category: "backend",
  estimatedPoints: 3,
  actualHours: 10,
  tags: ["auth", "api"]
});

// System recalculates calibration with new data point
```

### 4. Check Calibration Status

```typescript
const status = await forecast_calibration({
  projectId: "my-project"
});

// Returns:
// {
//   hasCalibration: true,
//   calibration: { dataPoints: 15, hoursPerStoryPoint: 3.8, confidence: "medium" },
//   recommendations: [
//     "Need 20+ data points for high confidence (currently 15)",
//     "Record tasks in more categories to improve category-specific estimates"
//   ]
// }
```

## Example Plan Output

```yaml
id: PLAN-2026-01-26-K786
title: Auth System Implementation
createdAt: 2026-01-26T02:40:36.336Z

tasks:
  - id: TASK-MKUK8M3Z
    title: Setup authentication routes
    description: Create Express routes for login, register, logout
    category: backend
    storyPoints: 3
    estimatedHours:
      min: 7
      max: 18
    confidence: medium
    dependencies: []
    tags: [auth, api]

  - id: TASK-NXYZ9P4A
    title: Create user database schema
    description: Design and implement user model with Prisma
    category: database
    storyPoints: 2
    estimatedHours:
      min: 3
      max: 9
    confidence: high
    dependencies: []
    tags: [database, prisma]

  - id: TASK-QWER7T8U
    title: Build login form component
    description: React component with validation
    category: frontend
    storyPoints: 3
    estimatedHours:
      min: 7
      max: 19
    confidence: medium
    dependencies: [Setup authentication routes]
    tags: [ui, forms]

totals:
  storyPoints: 8
  estimatedHours:
    min: 17
    max: 46
  taskCount: 3

teamVelocity:
  pointsPerWeek: 15
  hoursPerPoint: 4.2
  confidence: low

timeline:
  estimatedWeeks:
    min: 1
    max: 1
  estimatedEndDate:
    min: 2026-02-02
    max: 2026-02-02
```

## Integration Points

- **Velocity Tools**: Use velocity snapshots to calibrate team capacity
- **Sentinel**: Link tasks to epics/issues for tracking
- **Tutor**: Learn from completed tasks to identify estimation patterns

## Design Decisions

### Why Statistical, Not ML?

- Works without training data (uses industry baselines)
- Transparent calculations (users understand why)
- Improves with calibration data (but doesn't require it)
- No model training or hosting costs
- Explainable to stakeholders

### Why Fibonacci?

- Industry standard, familiar to most teams
- Non-linear scale prevents false precision
- Encourages splitting large items (13+ points)

### Why Category Multipliers?

- Different work types have different estimation characteristics
- Frontend is systematically underestimated
- DevOps has high variance
- Calibration adjusts these per-team
