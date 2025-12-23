# Learning: Parameter Naming Inconsistency

**Date**: 2025-12-22  
**Category**: Architecture  
**Tags**: api-design, schema, mcp, convention

---

## Problem

MCP tool parameters used inconsistent naming:
- Some tools: `project_id` (snake_case)
- Other tools: `projectId` (camelCase)

Claude instances use both forms unpredictably → silent failures → debugging churn.

## Root Cause

No enforced schema convention. Each tool author picked their own style.

## Band-aid Fix

Added parameter normalizer to accept both forms.

## Proper Fix Needed

1. **Pick ONE convention** — recommend `camelCase` for JS/TS ecosystem
2. **Enforce via TypeScript** — strict typing at tool registration
3. **Schema validation layer** — reject or normalize before tool execution
4. **Document convention** — add to CONTRIBUTING.md or CLAUDE.md

## Pattern to Avoid

Letting parameter naming drift across tools creates a constant cycle:
```
drift → bug → fix → new tool drifts → bug → fix → ...
```

This is exactly the kind of "implicit contract" problem we identified with MarketState.features. The solution is the same: explicit contracts, enforced at boundaries.

## Proposed Schema Enforcement

```typescript
// In tool registration, enforce parameter interface
interface ToolParams {
  projectId: string;  // Always camelCase
  // ...
}

// Normalizer as fallback (not primary defense)
function normalizeParams<T>(raw: Record<string, unknown>): T {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    // Convert snake_case to camelCase
    const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    normalized[camelKey] = value;
  }
  return normalized as T;
}
```

## Action Items

- [ ] Audit all tool parameter names
- [ ] Pick convention (camelCase)
- [ ] Add normalizer at entry point
- [ ] Update tool definitions for consistency
- [ ] Document in CLAUDE.md
