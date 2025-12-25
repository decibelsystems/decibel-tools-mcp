---
projectId: decibel-tools-mcp
change: User selection as supervised learning signal for OCR improvement
timestamp: 2025-12-24T17:27:36.379Z
location: project
---

# ADR: User selection as supervised learning signal for OCR improvement

## Change

User selection as supervised learning signal for OCR improvement

## Rationale

OCR errors on vintage Magic cards follow predictable patterns (drop shadow confusions). Rather than hand-coding all confusions, capture user selections as ground truth training pairs. Build confusion matrix from real data, segmented by frame type. Static seed (hand-coded) bootstraps the system, learned data improves it.

## Impact

Enables self-improving recognition accuracy over time. Every user interaction trains the system. Privacy-preserving (local-first, no images stored). Generalizable pattern for any human-in-the-loop ML system.
