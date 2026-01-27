# Integration: Auditor + Workflow + Existing Tools

## Current State

We just built **Workflow** and **Git** domains. There's a proposed **Auditor** domain from the code health framework work.

## The Integration Pattern

```
                    ┌──────────────────────────────────────┐
                    │         USER / AI ASSISTANT          │
                    │  "Is this ready to commit?"          │
                    │  "What code smells do we have?"      │
                    └─────────────────┬────────────────────┘
                                      │
                    ┌─────────────────▼────────────────────┐
                    │        WORKFLOW TOOLS                │
                    │  (High-level orchestration)          │
                    │                                      │
                    │  workflow_status ──┬─► oracle        │
                    │  workflow_preflight├─► sentinel_scan │
                    │  workflow_ship     ├─► auditor ◄────┐│
                    │  workflow_investigate                ││
                    └─────────────────┬────────────────────┘│
                                      │                     │
        ┌─────────────────────────────┼─────────────────────┤
        │                             │                     │
        ▼                             ▼                     │
┌───────────────┐            ┌───────────────┐             │
│   SENTINEL    │            │   AUDITOR     │◄────────────┘
│  (Work data)  │            │  (Code quality)│
│               │            │                │
│ • scan        │            │ • triage       │─── Detects smells
│ • issues      │            │ • naming_audit │─── Checks conventions
│ • epics       │            │ • refactor_score│── Prioritizes fixes
│ • policies    │            │ • health_dash  │─── Aggregates metrics
└───────┬───────┘            └───────┬────────┘
        │                            │
        │                            │
        ▼                            ▼
┌───────────────┐            ┌───────────────┐
│   FRICTION    │◄───────────│  Auto-logged  │
│  (Pain points)│            │   findings    │
└───────────────┘            └───────────────┘
```

## What Changes in Workflow

### workflow_preflight should call Auditor

Currently, `workflow_preflight` does its own god file check:

```typescript
// CURRENT (in workflow.ts)
const godFiles = await checkGodFiles(resolved.root);
```

Should become:

```typescript
// PROPOSED
const auditResult = await auditorTriage({ projectId: input.projectId });
// Use auditResult.god_files, auditResult.rule_sprawl, etc.
```

### workflow_status should include code health

Currently shows: git, issues, roadmap health, friction, recommendations

Should add: code quality summary from Auditor

```typescript
// PROPOSED addition to WorkflowStatusOutput
codeQuality: {
  godFiles: number;
  namingViolations: number;
  dipViolations: number;
  overallScore: number;
}
```

## What Auditor Tools Should Look Like

### auditor_triage (the core smell detector)

```typescript
interface AuditorTriageInput {
  projectId?: string;
  path?: string;           // Specific file or directory
  checks?: string[];       // Which checks to run (default: all)
}

interface AuditorTriageOutput {
  scanned: number;         // Files scanned
  issues: Array<{
    file: string;
    line?: number;
    smell: 'god_file' | 'rule_sprawl' | 'dip_violation' | 'duplicate_code' | 
           'hidden_rules' | 'buried_legacy' | 'naming_drift' | 'missing_tests' |
           'hidden_side_effects' | 'hardcoded_values';
    severity: 'high' | 'medium' | 'low';
    message: string;
    suggestion?: string;
  }>;
  summary: {
    high: number;
    medium: number;
    low: number;
  };
}
```

### auditor_naming_audit

```typescript
interface AuditorNamingInput {
  projectId?: string;
  conventions?: string;    // Path to naming-conventions.yml (auto-detect if not provided)
}

interface AuditorNamingOutput {
  violations: Array<{
    file: string;
    line: number;
    found: string;         // What we found
    expected: string;      // What convention expects
    category: 'variable' | 'function' | 'class' | 'file' | 'constant';
  }>;
  stats: {
    checked: number;
    passed: number;
    violations: number;
  };
}
```

### auditor_refactor_score

```typescript
interface RefactorCandidate {
  file: string;
  score: number;           // 0-100, higher = more urgent
  factors: {
    lines: number;
    complexity: number;    // Cyclomatic complexity
    smellCount: number;
    testCoverage?: number;
    lastModified: string;
    changeFrequency: number;  // Commits in last 30 days
  };
  recommendation: 'split' | 'extract' | 'simplify' | 'delete' | 'refactor';
}
```

### auditor_health_dashboard

```typescript
interface CodeHealthDashboard {
  timestamp: string;
  project: string;
  metrics: {
    totalFiles: number;
    totalLines: number;
    godFiles: number;
    avgFileSize: number;
    maxFileSize: number;
    namingViolations: number;
    smellCount: {
      high: number;
      medium: number;
      low: number;
    };
  };
  trends?: {
    godFiles: 'improving' | 'stable' | 'degrading';
    smells: 'improving' | 'stable' | 'degrading';
  };
  topOffenders: Array<{
    file: string;
    issues: number;
  }>;
}
```

## Integration with Friction

When Auditor detects issues, it can optionally auto-log to Friction:

```typescript
// In auditor_triage
if (input.autoLogFriction && highSeverityFindings.length > 0) {
  await frictionLog({
    projectId: input.projectId,
    context: 'code-quality',
    description: `Detected ${highSeverityFindings.length} high-severity code smells`,
    impact: 'technical-debt',
    auto_detected: true,
  });
}
```

## Integration with Oracle

Oracle's `next_actions` could incorporate Auditor findings as a signal:

```typescript
// In oracle.ts getNextActions()
const auditFindings = await auditorTriage({ projectId });
if (auditFindings.summary.high > 0) {
  actions.push({
    description: `Address ${auditFindings.summary.high} high-severity code issues`,
    source: 'auditor',
    priority: 'high',
    domain: 'code-quality',
  });
}
```

## File Structure

```
src/tools/
├── auditor.ts              # Core auditor functions
├── auditor/
│   └── index.ts            # Tool definitions
└── workflow.ts             # Updated to call auditor
```

## Implementation Priority

1. **auditor_triage** - Core detection, used by workflow_preflight
2. **Update workflow_preflight** - Use auditor instead of inline checks
3. **auditor_health_dashboard** - Aggregate view
4. **auditor_naming_audit** - Requires naming-conventions.yml
5. **auditor_refactor_score** - Combines auditor + git data
6. **auditor_init** - Scaffolds naming conventions

## No Duplication Zones

| Feature | Owner | Not Duplicated In |
|---------|-------|-------------------|
| Code smell detection | Auditor | Workflow (calls Auditor) |
| God file check | Auditor | workflow_preflight |
| Data validation | Sentinel | Auditor |
| Work prioritization | Oracle | Auditor (Auditor feeds Oracle) |
| Pain point tracking | Friction | Auditor (Auditor feeds Friction) |
| File history | Git tools | Auditor (Auditor uses Git) |
