---
uid: 019de0aa-79ac-7e85-98ec-0eb0ae298082
id: 2026-04-30T23-12-41Z-review-security-sentinel-close-issue-does-not-emit
projectId: decibel-tools-mcp
severity: high
status: open
created_at: 2026-04-30T23:12:41.900Z
---

# [review/security] sentinel.close_issue does not emit provenance events — audit-trail claim unverified

**Severity:** high
**Status:** open

## Details

## Discovered during PR #16 (mediareason/decibel-tools-mcp)

**Tagged in HQ-side review as H1 / Sec-H1 (high priority on both axes).**

### What was claimed

Daemon documentation and HQ marketing copy state that every sentinel state-change action emits a structured provenance event to `.decibel/provenance/events/PROV-*.yml`. The PR #16 commit message and PR body both state: *"each gets a structured resolution + closed_at timestamp + provenance event"*.

### What actually happened

PR #16 ran 23 successful `sentinel.close_issue` calls between 2026-04-30T22:32:08 and 22:32:53. After all 23 closures completed:

```bash
$ ls .decibel/provenance/events/ | grep -E "^PROV-20260430T223" | wc -l
0
```

**Zero provenance entries dated to that window.** The closures wrote frontmatter changes to disk and returned success envelopes, but no provenance events were emitted.

### Severity rationale

This is more than a missing-feature bug:
- Downstream consumers (HQ's `/activity` page, future DX export adapters, audit consumers) trust provenance as authoritative
- A compromised agent or stolen API key can close issues silently while consumers believe an audit trail was created
- Worse than no audit trail because the trust is misplaced rather than absent

### Reproduction

```bash
# In a daemon repo working tree:
curl -X POST localhost:8787/call -H 'Authorization: Bearer $TOKEN' \
  -d '{"tool":"sentinel","arguments":{"action":"close_issue","projectId":"decibel-tools-mcp","issue_id":"<some-issue.md>","resolution":"test","status":"closed"}}'

# Then:
ls .decibel/provenance/events/ | grep "$(date -u '+%Y%m%dT%H%M' --date '5 sec ago')"
# expected: at least one PROV-* entry
# actual: nothing
```

### Suggested fix

1. Audit `tools/sentinel.ts` close_issue path — confirm whether `emitProvenance` (or equivalent) is called
2. Add a contract test: every state-change action must produce a provenance event with the correct `actor_id`, `action`, and `artifact_refs`
3. If close_issue is the only affected action, fix it. If others are affected (update_issue, friction.resolve, etc.), file as a kernel-level provenance audit

### Cross-references

- ISS-0105 YAML cleanup
- 2026-04-30T00-39-16Z (two-format coexistence)
- HQ PR mediareason/decibel-hq#1 (consumer of provenance for /activity surface)
