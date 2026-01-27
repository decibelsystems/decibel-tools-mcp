# Code Health Auditor - Automated Quality Assessment

> Part of the Code Health domain: Detect code smells, track health trends, and prioritize refactoring.

## Overview

The Auditor provides automated code health assessment tools. It detects common code smells, generates health dashboards, scores files by refactoring urgency, and tracks trends over time.

## Problem

- Code quality degrades gradually without visibility
- "God files" accumulate complexity unnoticed
- No objective way to prioritize refactoring
- Naming conventions drift without enforcement
- Hard to know if health is improving or degrading

## Solution

```
Codebase
    │
    ▼
┌─────────────────┐
│ Triage          │  Quick smell detection
└─────────────────┘
    │
    ▼
┌─────────────────┐
│ Health Dashboard│  Aggregate metrics
└─────────────────┘
    │
    ├──► Refactor scores (priority ranking)
    │
    ├──► Naming audit (convention checks)
    │
    └──► Health history (trend tracking)
```

## Code Smells Detected

| Smell | Description | Detection |
|-------|-------------|-----------|
| `god_file` | Files > 500 lines | Line count threshold |
| `rule_sprawl` | Business logic scattered | Pattern matching |
| `dip_violation` | Dependency inversion issues | Import analysis |
| `duplicate_code` | Copy-paste patterns | Similarity hashing |
| `hidden_rules` | Inline magic numbers/strings | Regex patterns |
| `buried_legacy` | Old code in new files | Comment/date analysis |
| `naming_drift` | Inconsistent naming | Convention comparison |
| `missing_tests` | Untested modules | Test coverage mapping |
| `hidden_side_effects` | Sneaky mutations | AST analysis |
| `hardcoded_values` | Magic numbers, URLs | Literal detection |

## Tools

| Tool | Description |
|------|-------------|
| `auditor_triage` | Quick smell scan on file or directory |
| `auditor_health_dashboard` | Generate comprehensive health report |
| `auditor_refactor_score` | Rank files by refactoring urgency |
| `auditor_naming_audit` | Check naming conventions |
| `auditor_init` | Create naming conventions scaffold |
| `auditor_log_health` | Record snapshot for trend tracking |
| `auditor_health_history` | View health trends over time |

## Storage

```
.decibel/auditor/
├── naming-conventions.yml   # Custom naming rules
└── health-log.yaml          # Historical snapshots
```

## Usage Examples

### Quick Triage

```typescript
// Scan src/ for common smells
const result = await auditor_triage({});

// Scan specific directory
const result = await auditor_triage({
  path: "src/services/",
  checks: ["god_file", "hardcoded_values"]
});

// Returns:
// {
//   findings: [
//     { file: "src/services/auth.ts", smell: "god_file", lines: 847, severity: "high" },
//     { file: "src/services/api.ts", smell: "hardcoded_values", count: 12, severity: "medium" }
//   ],
//   summary: { total: 2, high: 1, medium: 1, low: 0 }
// }
```

### Health Dashboard

```typescript
const dashboard = await auditor_health_dashboard({});

// Returns:
// {
//   metrics: {
//     totalFiles: 145,
//     totalLines: 28432,
//     avgFileSize: 196,
//     godFileCount: 8,
//     smellCounts: { god_file: 8, hardcoded_values: 34, hidden_rules: 12 }
//   },
//   topOffenders: [
//     { file: "src/server.ts", lines: 1247, smells: 5 },
//     { file: "src/models/user.ts", lines: 892, smells: 3 }
//   ]
// }
```

### Refactor Prioritization

```typescript
const scores = await auditor_refactor_score({ limit: 5 });

// Returns files ranked by urgency with recommendations:
// {
//   candidates: [
//     {
//       file: "src/server.ts",
//       score: 0.92,
//       recommendation: "split",
//       reasons: ["1247 lines", "5 code smells", "high coupling"]
//     },
//     {
//       file: "src/utils/helpers.ts",
//       score: 0.78,
//       recommendation: "extract",
//       reasons: ["generic name", "mixed concerns"]
//     }
//   ]
// }
```

### Naming Convention Audit

```typescript
// First, initialize conventions
await auditor_init({});  // Creates naming-conventions.yml scaffold

// Then audit against conventions
const naming = await auditor_naming_audit({});

// Returns:
// {
//   violations: [
//     { file: "src/utils.ts", issue: "Generic filename 'utils'", suggestion: "Split by domain" },
//     { file: "src/helpers/misc.ts", issue: "Anti-pattern 'misc'", suggestion: "Name by purpose" }
//   ]
// }
```

### Track Health Over Time

```typescript
// Record a snapshot after a commit
await auditor_log_health({
  commit: "abc1234"  // Optional: associate with commit
});

// View trend history
const history = await auditor_health_history({ limit: 10 });

// Returns:
// {
//   snapshots: [
//     { date: "2026-01-25", godFiles: 8, smells: 54, commit: "abc1234" },
//     { date: "2026-01-18", godFiles: 10, smells: 62, commit: "def5678" }
//   ],
//   trends: {
//     godFiles: { direction: "improving", change: -2 },
//     smells: { direction: "improving", change: -8 }
//   }
// }
```

## Naming Conventions File

```yaml
# .decibel/auditor/naming-conventions.yml
version: 1

antiPatterns:
  files:
    - "utils"
    - "helpers"
    - "misc"
    - "common"
    - "shared"

  identifiers:
    - "temp"
    - "data"
    - "info"
    - "item"

conventions:
  files:
    services: "*Service.ts"
    models: "*Model.ts"
    controllers: "*Controller.ts"

  functions:
    handlers: "handle*"
    validators: "validate*"
    formatters: "format*"
```

## Refactoring Recommendations

The `auditor_refactor_score` tool provides actionable recommendations:

| Recommendation | When Applied | Action |
|---------------|--------------|--------|
| `split` | God file (>800 lines) | Break into domain modules |
| `extract` | Mixed concerns | Pull out distinct responsibilities |
| `simplify` | High complexity | Reduce nesting, clarify logic |
| `delete` | Unused/dead code | Remove safely |
| `rename` | Naming violations | Rename to match conventions |

## Scoring Formula

Refactor urgency score (0-1) combines:

```
score = (0.4 × size_factor) + (0.3 × smell_count) + (0.3 × coupling_factor)
```

Where:
- `size_factor`: Normalized file size (0 at 100 lines, 1 at 1000+ lines)
- `smell_count`: Number of detected smells normalized
- `coupling_factor`: Import/export complexity

## Integration Points

- **Workflow Preflight**: Include auditor checks before commits
- **CI/CD**: Run `auditor_triage` as a quality gate
- **Velocity**: Correlate health trends with productivity

## Best Practices

1. **Run triage before PRs** - Catch issues early
2. **Log health after major refactors** - Track improvement
3. **Set up naming conventions early** - Prevent drift
4. **Focus on top offenders** - Don't fix everything at once
5. **Review trends weekly** - Catch degradation patterns
