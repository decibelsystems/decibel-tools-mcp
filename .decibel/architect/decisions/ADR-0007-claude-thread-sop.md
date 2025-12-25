---
id: ADR-0007
title: "Standard Operating Procedure for Claude Threads"
status: accepted
date: 2025-12-25
tags:
  - process
  - claude
  - workflow
---

# ADR-0007: Standard Operating Procedure for Claude Threads

## Context

Multiple Claude threads work across various projects (senken, decibel-tools, decibel-studio, deck). Without a consistent SOP, threads may:
- Create ad-hoc markdown instead of using Decibel Tools
- Lose context between sessions
- Miss tracking valuable learnings or friction points

## Decision

All Claude threads should follow this SOP when working on registered Decibel projects.

### Session Start

| Action | Tool | Notes |
|--------|------|-------|
| Check priorities | `oracle_next_actions` | **ASPIRATIONAL** - not reliable yet, skip if unhelpful |
| Review open issues | `sentinel_list_repo_issues` | See what's in flight |
| Check friction log | `friction_list` | Recurring pain points to be aware of |

### During Work

| When | Use | NOT This |
|------|-----|----------|
| Large feature planned | `sentinel_log_epic` | mkdir epic/ |
| Specific task/bug | `sentinel_createIssue` | task.md |
| Architecture decision | `architect_createAdr` | docs/adr-001.md |
| Design decision | `designer_record_design_decision` | design-notes.md |
| Small idea | `dojo_add_wish` | wishlist.md |
| Ready to propose | `dojo_create_proposal` | proposals/ folder |
| Hit recurring problem | `friction_log` / `friction_bump` | complain in chat |

### Session End

| Action | Tool |
|--------|------|
| Log learnings | `learnings_append` |
| Update issue status | `sentinel_close_issue` if done |
| Note any new friction | `friction_log` |

## Aspirational Features (Not Yet Reliable)

These are good ideas we want to work toward but aren't production-ready:

- **oracle_next_actions** - Intended to provide AI-driven prioritization but needs more development
- **oracle_roadmap** - Strategic view, still maturing
- **Cross-project coordination** - Currently each project is siloed

## Consequences

- Consistent tracking across all projects
- Learnings accumulate over time
- Friction patterns become visible
- New Claude threads can get up to speed faster

## Related

- CLAUDE.md (decibel-tools-mcp specific guidance)
- projects.json (registered projects)
