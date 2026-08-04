---
id: ISS-0118
projectId: decibel-tools-mcp
severity: med
status: open
created_at: 2026-08-04T01:29:13.003Z
---

# dojo calls with caller_role 'ai' crash: resolveRole reads allowed_tools.length on inheriting role without guard

**Severity:** med
**Status:** open

## Details

Any dojo action called with caller_role: 'ai' fails with "Cannot read properties of undefined (reading 'length')". Root cause: src/tools/dojoPolicy.ts:187 in resolveRole() does `role.allowed_tools.length > 0` while handling inheritance, but the project's .decibel/dojo_policy.yaml defines the ai role as only `inherits: mother` with no allowed_tools key, so role.allowed_tools is undefined. Repro: dojo add_wish with caller_role: 'ai' in decibel-tools-mcp (observed 2026-08-03 while logging research-peer wishes; workaround was omitting caller_role). Fix: guard with optional chaining — `role.allowed_tools?.length ? role.allowed_tools : parent.allowed_tools`. Note the same pattern is safe for denied_tools/sandbox which already use || and spread fallbacks.
