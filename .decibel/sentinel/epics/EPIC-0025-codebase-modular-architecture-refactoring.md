---
id: EPIC-0025
projectId: decibel-tools-mcp-wip
title: Codebase Modular Architecture Refactoring
summary: Refactor the 3 largest monolithic files into modular, testable, maintainable architectures
status: planned
priority: high
tags: [refactoring, architecture, maintainability, testing]
owner: 
squad: 
created_at: 2026-01-23T09:09:40.178Z
---

# Codebase Modular Architecture Refactoring

## Summary

Refactor the 3 largest monolithic files into modular, testable, maintainable architectures

## Motivation

- server.py is 9,186 lines - impossible to test or maintain
- EditorCanvas.jsx is 5,972 lines with 15+ responsibilities
- CADStudioNode.jsx is 4,654 lines with mixed concerns
- Merge conflicts on every PR touching these files
- New developer onboarding takes 2-3 days to understand structure
- Zero unit test coverage due to tight coupling

## Outcomes

- Each module under 500 lines average
- Unit test coverage possible for all components
- Parallel development without merge conflicts
- 10x faster code navigation and understanding
- Clear separation of concerns

## Acceptance Criteria

- [ ] api/server.py split into routes/, services/, tasks/, utils/ directories
- [ ] EditorCanvas.jsx split into 11 focused modules
- [ ] CADStudioNode.jsx split into 12 focused files
- [ ] All existing functionality preserved
- [ ] npm run build passes
- [ ] No runtime errors
