---
uid: 019b47a6-d340-78d4-a069-e9dbf60e825c
id: ISS-0022
projectId: decibel-tools-mcp
status: open
priority: high
epic_id: EPIC-0020
tags:
  - agentic
  - dialect
  - interface
created_at: 2025-12-22T20:01:14.048Z
updated_at: 2025-12-22T20:01:14.048Z
---
# Implement BaseDialect interface and abstract class

**Status:** open
**Epic:** EPIC-0020

## Details

Create src/agentic/dialects/base.ts with Dialect interface and BaseDialect abstract class. Interface includes: id, role, version, render(), lintRules, lint(). BaseDialect provides common helpers: formatEvidence(), formatMissingData(), formatMetaSignature(). Also create RenderOptions type and LintRule/LintResult types. See AGENTIC_PACK_V1_DIRECTIVE.md section 1.4.
