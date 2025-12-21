# Decibel Agent Context

> **For AI Assistants**: Read this before creating files or folders related to project tracking.

This project uses **Decibel Tools**—an MCP-based project intelligence system. All work tracking, decisions, and experiments are managed through structured tools, not manual files.

## Core Principle

**Never create manual folders or markdown files for tracked concepts.** Always use the appropriate MCP tool.

## Module Quick Reference

| When Asked To... | Use This Tool | NOT This |
|------------------|---------------|----------|
| Create an epic | `sentinel_log_epic` | ❌ `mkdir epic` |
| Track an issue | `sentinel_createIssue` | ❌ `issue.md` |
| Record a decision | `architect_createAdr` | ❌ `docs/adr-001.md` |
| Propose a capability | `dojo_create_proposal` | ❌ `proposals/` folder |
| Log a wish/idea | `dojo_add_wish` | ❌ `wishlist.md` |
| Set up an experiment | `dojo_scaffold_experiment` | ❌ `experiments/` folder |
| Record design choice | `designer_record_design_decision` | ❌ `design-notes.md` |
| Track pain point | `friction_log` | ❌ `friction.md` |

## Understanding the Modules

### Sentinel (Work Tracking)
- **Epics**: Large features with child issues
- **Issues**: Specific tasks, bugs, or work items
- Tools: `sentinel_log_epic`, `sentinel_createIssue`, `sentinel_list_epics`, `sentinel_listIssues`

### Architect (Decisions)
- **ADRs**: Architecture Decision Records with context, decision, and consequences
- Tools: `architect_createAdr`

### Dojo (Capability Incubation)
- **Wishes**: Lightweight ideas for future capabilities
- **Proposals**: Formalized capability proposals with problem/hypothesis
- **Experiments**: Runnable tests of proposed capabilities
- Tools: `dojo_add_wish`, `dojo_create_proposal`, `dojo_scaffold_experiment`, `dojo_run_experiment`

### Oracle (Strategy)
- **Next Actions**: AI-synthesized recommendations based on project state
- **Health Scores**: Epic health and risk assessment
- **Roadmap**: Strategic context linking epics to objectives
- Tools: `oracle_next_actions`, `roadmap_get`, `roadmap_getHealth`

### Designer (Design Decisions)
- **Design Decisions**: Visual, UX, and implementation design choices
- **Crits**: Early-stage design feedback and observations
- Tools: `designer_record_design_decision`, `designer_crit`

### Friction (Pain Points)
- **Friction Logs**: Recurring problems that erode productivity
- Signal count increases when the same friction is encountered repeatedly
- Tools: `friction_log`, `friction_bump`, `friction_list`

## Decision Tree

```
Creating tracked work?
├── Large feature spanning multiple tasks → sentinel_log_epic
├── Specific bug or task → sentinel_createIssue
└── Just exploring an idea → dojo_add_wish

Recording a decision?
├── Technical/architecture → architect_createAdr
└── Design/visual/UX → designer_record_design_decision

Exploring new capability?
├── Initial idea → dojo_add_wish
├── Ready to formalize → dojo_create_proposal
└── Ready to test → dojo_scaffold_experiment

Encountered recurring problem?
└── friction_log (or friction_bump if already logged)
```

## Anti-Patterns to Avoid

- ❌ Creating folders named `epic/`, `adrs/`, `proposals/`, `experiments/`
- ❌ Writing markdown files for tracked concepts
- ❌ Bypassing tools with "I'll just create a quick file"
- ❌ Assuming Decibel terms mean filesystem structures

## Project-Specific Notes

<!-- Add project-specific context below -->
