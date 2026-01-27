# Tutor - Best Practices Extraction and Sharing

> DOJO-PROP-0006: Extract and share coding best practices from Claude Code transcripts.

## Overview

Tutor automatically identifies high-quality Claude Code sessions, extracts transferable patterns, and shares them with your team or the community. It helps teams scale knowledge from their best engineers without requiring manual documentation.

## Problem

- Teams want their best engineers to train others, but there's no time
- Valuable patterns from successful Claude Code sessions are lost
- No way to discover what "good" prompting looks like
- No mechanism to share anonymized best practices across the community

## Solution

```
~/.claude/sessions/
       │
       ▼
┌─────────────────┐
│ Transcript      │  Read local Claude Code session logs
│ Reader          │
└─────────────────┘
       │
       ▼
┌─────────────────┐
│ Scorer          │  Evaluate quality (completion, iterations, feedback)
└─────────────────┘
       │
       ▼
┌─────────────────┐
│ Pattern         │  Extract approach without leaking code
│ Extractor       │  (LLM summarization)
└─────────────────┘
       │
       ├──► Team storage (.decibel/tutor/patterns/)
       │
       └──► Community (opt-in level 3, anonymized)
```

## Scoring Approach

Multi-signal scoring on a 0-1 scale:

| Signal | Weight | Measurement |
|--------|--------|-------------|
| Task Completion | 25% | Session ended with commit or user "done" |
| Iteration Efficiency | 25% | Fewer back-and-forth = higher (1-shot = 1.0, 5+ = 0.2) |
| Explicit Feedback | 30% | From feedback tool (+1 = 1.0, -1 = 0.0) |
| No Immediate Revert | 20% | Code still exists after 24h |

**Example scores:**
- Great session: Completed + 1 iteration + positive feedback + no revert = **0.95**
- Okay session: Completed + 3 iterations + no feedback + no revert = **0.65**
- Poor session: Abandoned + 5 iterations + negative feedback = **0.15**

## Extraction Approach

### Phase 1: Structural Analysis (Automated)

Parse transcript JSON to extract:

```yaml
taskType: "feature"
category: "backend"

structuralPatterns:
  clarifyingQuestions: 2      # Claude asked questions before coding
  upfrontContext: true        # User provided context in first message
  planningPhase: true         # TodoWrite used before Edit
  incrementalCommits: 3       # Multiple small commits vs one big
  testWritten: true           # Test files created

toolUsage:
  Read: 12
  Edit: 8
  Bash: 5
  TodoWrite: 1

sessionShape: "plan-execute-verify"  # vs "trial-error-fix"
```

### Phase 2: LLM Summarization (High-scoring only)

For transcripts scoring > 0.8, use Claude to extract patterns:

```
DO NOT include:
- Specific code snippets
- File paths, function names, variable names
- Business logic or domain details

DO include:
- Type of problem being solved
- Approach/methodology used
- Key decisions and why they worked
- Prompting techniques that were effective
```

## Pattern Format

```yaml
pattern:
  id: PAT-0042
  title: "Type-First API Development"

  approach: |
    1. Started by defining TypeScript interfaces for request/response
    2. Asked clarifying questions about edge cases before implementing
    3. Implemented routes incrementally, testing each before moving on
    4. Added error handling as a separate pass at the end

  prompting_signals:
    - "User provided API requirements upfront with examples"
    - "Requested type definitions before implementation"
    - "Asked for incremental commits after each endpoint"

  anti_patterns_avoided:
    - "Didn't try to implement everything at once"
    - "Didn't skip error handling"

  tags: [api, typescript, backend, incremental]

  metrics:
    score: 0.92
    iterations: 2
    session_shape: "plan-execute-verify"
```

## Privacy Levels

| Level | Description | What's Shared |
|-------|-------------|---------------|
| 0 | Nothing (default) | Nothing |
| 1 | Local only | Team can see your patterns |
| 2 | Anonymized metrics | Aggregate stats to Decibel |
| 3 | Community patterns | Anonymized patterns shared publicly |

## Privacy Guardrails

Before sharing (even at team level):

- Strip file paths: `src/api/users.ts` → `[api file]`
- Strip identifiers: `getUserById` → `[function]`
- Strip business terms: `PaymentProcessor` → `[domain object]`
- No code snippets: Only approach descriptions
- Hash session ID: Cannot trace back to original

## Tools

| Tool | Description |
|------|-------------|
| `tutor_scan` | Scan Claude Code sessions and score them |
| `tutor_extract` | Extract pattern from high-scoring session |
| `tutor_list` | List extracted patterns (team or community) |
| `tutor_recommend` | Get recommendations based on current task |
| `tutor_settings` | Configure privacy level and opt-in |

## Storage

```
.decibel/tutor/
├── settings.yml           # Privacy level, opt-in status
├── scores/                # Session scores cache
│   └── {session-hash}.yml
├── patterns/              # Extracted patterns
│   └── PAT-{id}.yml
└── community/             # Downloaded community patterns
    └── PAT-{id}.yml
```

## Usage Examples

```bash
# Scan recent sessions and show scores
tutor_scan

# Extract pattern from a high-scoring session
tutor_extract sessionId: "abc123"

# Get recommendations for current task
tutor_recommend context: "implementing OAuth"

# Change privacy level
tutor_settings level: 2
```

## Integration Points

- **Feedback Tool**: Positive feedback boosts session score
- **Velocity Tool**: Links patterns to productivity metrics
- **Forecasting**: Patterns help estimate similar future tasks
