# Plan: Feedback Tool for Decibel Tools

## Problem Statement

Decibel Tools needs a built-in feedback mechanism to:
1. Collect user/AI feedback on tools, features, and workflows
2. Track sentiment and satisfaction over time
3. Identify which tools are most/least useful
4. Surface recurring issues that could become friction or issues

## Design Options

### Option A: Tool-Specific Feedback
Feedback tied to specific tool invocations.

```yaml
target: workflow_preflight
rating: 4
sentiment: positive
context: "Caught a blocked issue I forgot about"
```

**Pros:** Directly links feedback to tool usage
**Cons:** Requires knowing tool name, may miss general feedback

### Option B: General Feedback with Categories
Freeform feedback with categorization.

```yaml
category: tool | workflow | documentation | ux | performance | other
subject: "workflow_preflight check"
rating: 4
feedback: "Caught a blocked issue I forgot about"
```

**Pros:** More flexible, captures broader feedback
**Cons:** May be harder to aggregate tool-specific insights

### Option C: Hybrid (Recommended)
Optional tool reference with general category fallback.

```yaml
category: tool  # Required: tool | workflow | docs | ux | perf | other
tool_ref: workflow_preflight  # Optional: specific tool
rating: 5  # 1-5 scale
sentiment: positive  # positive | neutral | negative | mixed
feedback: "Caught issues I would have missed"
tags: [helpful, time-saver]
```

## Proposed Data Model

### Feedback Entry (YAML in Markdown frontmatter)

```yaml
---
id: FB-20260123-001
category: tool
tool_ref: workflow_preflight
rating: 5
sentiment: positive
source: human  # human | agent
status: open   # open | acknowledged | actioned | archived
created_at: 2026-01-23T22:00:00.000Z
updated_at: 2026-01-23T22:00:00.000Z
rating_count: 1
tags: [helpful, workflow]
---

# Feedback: workflow_preflight catches hidden issues

The preflight check caught a blocked issue I had forgotten about.
Would have caused problems in production.

## Response Log
(empty - maintainer responses appear here)
```

### Storage Location
`.decibel/feedback/{timestamp}-{slug}.md`

Example: `2026-01-23T22-00-00Z-workflow-preflight-catches-hidden-issues.md`

## Proposed Tools

### 1. `feedback_submit`
Create new feedback entry.

**Required:**
- `category`: tool | workflow | docs | ux | perf | other
- `feedback`: Text description

**Optional:**
- `tool_ref`: Specific tool name (if category=tool)
- `rating`: 1-5 scale
- `sentiment`: positive | neutral | negative | mixed
- `source`: human | agent (default: human)
- `tags`: Array of strings
- `projectId`: Project context

**Returns:**
```json
{
  "id": "FB-20260123-001",
  "path": ".decibel/feedback/...",
  "created": true
}
```

### 2. `feedback_list`
Query feedback with filters.

**Optional Filters:**
- `category`: Filter by category
- `tool_ref`: Filter by tool
- `sentiment`: Filter by sentiment
- `rating_min`: Minimum rating
- `status`: open | acknowledged | actioned | archived
- `limit`: Max results (default: 20)
- `since`: Date filter

**Returns:**
```json
{
  "entries": [...],
  "summary": {
    "total": 42,
    "by_category": { "tool": 30, "workflow": 10, "docs": 2 },
    "avg_rating": 4.2,
    "sentiment_breakdown": { "positive": 35, "neutral": 5, "negative": 2 }
  }
}
```

### 3. `feedback_rate`
Add a rating to existing feedback (bump pattern).

**Required:**
- `feedback_id`: ID or slug match

**Optional:**
- `rating`: 1-5 (adds to rating_history, updates average)
- `note`: Additional context
- `source`: human | agent

**Returns:**
```json
{
  "id": "FB-20260123-001",
  "rating_count": 5,
  "avg_rating": 4.2,
  "rating_history": [5, 4, 4, 5, 3]
}
```

### 4. `feedback_respond`
Maintainer response/acknowledgment.

**Required:**
- `feedback_id`: ID or slug match
- `response`: Response text

**Optional:**
- `status`: acknowledged | actioned | archived
- `linked_issue`: Link to created sentinel issue
- `linked_friction`: Link to created friction

**Returns:**
```json
{
  "id": "FB-20260123-001",
  "status": "acknowledged",
  "response_count": 1
}
```

### 5. `feedback_trends` (Optional - Phase 2)
Aggregate feedback analytics.

**Returns:**
```json
{
  "period": "last_30_days",
  "total_feedback": 42,
  "trending_up": ["workflow_preflight", "git_log_recent"],
  "trending_down": ["sentinel_scan"],
  "top_issues": [
    { "theme": "performance", "count": 8 },
    { "theme": "documentation", "count": 5 }
  ],
  "satisfaction_trend": [4.1, 4.3, 4.2, 4.5]
}
```

## Integration Points

### 1. Workflow Tools
Could prompt for feedback after significant operations:

```typescript
// In workflow_ship, after successful completion:
// "Ready to ship! Would you like to provide feedback on this workflow? (feedback_submit)"
```

### 2. Provenance
Emit provenance events for feedback:
- `create` when feedback submitted
- `review` when acknowledged
- `link` when connected to issue/friction

### 3. Oracle/Next Actions
Include feedback themes in recommendations:
- "5 users reported issues with X - consider reviewing"

## Implementation Steps

1. **Create types** (`src/tools/feedback.ts`)
   - FeedbackCategory enum
   - FeedbackSentiment enum
   - Input/Output interfaces

2. **Implement core functions**
   - `submitFeedback()`
   - `listFeedback()`
   - `rateFeedback()`
   - `respondToFeedback()`

3. **Create tool definitions** (`src/tools/feedback/index.ts`)
   - MCP tool specs with input schemas
   - Handler wrappers

4. **Register tools** (`src/tools/index.ts`)
   - Add `...feedbackTools` to exports

5. **Add provenance integration**
   - Emit events on create/update

6. **Documentation**
   - Update CLAUDE.md with feedback tools
   - Add to command reference

## Questions for User

1. **Rating Scale**: 1-5 or thumbs up/down?
2. **Anonymous vs Attributed**: Track who gave feedback?
3. **Scope**: Project-local or global feedback store?
4. **Auto-prompt**: Should workflows ask for feedback?
5. **Priority**: Build all 5 tools or start with submit+list?

## Recommended Phase 1

Start with:
- `feedback_submit` - Essential
- `feedback_list` - Essential
- `feedback_respond` - For closing the loop

Defer to Phase 2:
- `feedback_rate` (bump pattern)
- `feedback_trends` (analytics)
