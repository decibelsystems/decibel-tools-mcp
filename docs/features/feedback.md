# Feedback Tools - Session Quality Signals

> Capture user feedback on Claude Code sessions to improve tooling quality.

## Overview

Feedback tools allow users to submit thumbs-up/thumbs-down ratings on their Claude Code sessions. This data feeds into the Tutor scoring system and helps identify which patterns lead to successful outcomes.

## Problem

- No way to know if a Claude Code session was helpful
- Can't learn from successful vs unsuccessful sessions
- Tooling improvements are blind without user signals
- Community patterns need quality indicators

## Solution

```
User Session
     │
     ▼
┌─────────────────┐
│ Feedback Submit │  +1 / -1 with optional comment
└─────────────────┘
     │
     ▼
┌─────────────────┐
│ Storage         │  .decibel/feedback/
└─────────────────┘
     │
     ├──► Tutor scoring (weight: 30%)
     │
     └──► Quality analytics
```

## Feedback Format

```yaml
# .decibel/feedback/{timestamp}-{session-hash}.yml
sessionId: "abc123..."  # Hashed session identifier
rating: 1               # +1 (positive) or -1 (negative)
comment: "Solved my issue quickly"  # Optional
submittedAt: "2026-01-25T14:30:00Z"
context:
  taskType: "bug-fix"   # Optional categorization
  duration: 1200        # Session duration in seconds
```

## Tools

| Tool | Description |
|------|-------------|
| `feedback_submit` | Submit feedback for a session |
| `feedback_list` | List recent feedback entries |

## Usage Examples

### Submit Positive Feedback

```typescript
await feedback_submit({
  sessionId: "current",  // or specific session hash
  rating: 1,
  comment: "Fixed the bug in one shot"
});
```

### Submit Negative Feedback

```typescript
await feedback_submit({
  sessionId: "current",
  rating: -1,
  comment: "Had to restart multiple times"
});
```

### List Feedback

```typescript
const recent = await feedback_list({
  limit: 20,
  rating: 1  // Optional: filter to positive only
});

// Returns:
// {
//   feedback: [
//     { sessionId: "abc...", rating: 1, comment: "...", submittedAt: "..." },
//     { sessionId: "def...", rating: 1, comment: "...", submittedAt: "..." }
//   ],
//   summary: { positive: 15, negative: 3, total: 18 }
// }
```

## Storage

```
.decibel/feedback/
├── 2026-01-25T14-30-00Z-abc123.yml
├── 2026-01-25T15-45-00Z-def456.yml
└── ...
```

## Privacy

- Session IDs are hashed (not traceable to original session)
- Comments are optional
- Feedback stays local by default
- Only aggregated stats shared at privacy level 2+

## Integration with Tutor

Feedback is weighted at 30% in the Tutor scoring algorithm:

| Rating | Score Contribution |
|--------|-------------------|
| +1 (positive) | 1.0 |
| -1 (negative) | 0.0 |
| No feedback | 0.5 (neutral) |

Combined with other signals:
- Task completion (25%)
- Iteration efficiency (25%)
- No immediate revert (20%)

## Best Practices

1. **Submit feedback promptly** - While context is fresh
2. **Add comments for negative feedback** - Helps identify issues
3. **Be consistent** - Calibrate your ratings over time
4. **Rate the outcome, not the effort** - Did it work?

## Future Enhancements

- Auto-prompt for feedback after sessions
- Emoji reactions beyond thumbs up/down
- Session tagging for categorization
- Team feedback aggregation
