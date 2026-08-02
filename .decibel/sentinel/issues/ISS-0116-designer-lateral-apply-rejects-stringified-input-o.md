---
id: ISS-0116
projectId: decibel-tools-mcp
severity: med
status: open
created_at: 2026-07-17T17:16:24.607Z
---

# designer lateral_apply rejects stringified input object (ISS-0112 family)

**Severity:** med
**Status:** open

## Details

designer(action=lateral_apply, technique=challenge) fails with INVALID_INPUT "challenge requires assumption field" whenever the input param arrives as a JSON string instead of an object. Affects ALL techniques, not just challenge — the handler reads input.input as an object (src/tools/lateral.ts:417,450-454) and does no string coercion. Root cause: the facade MCP inputSchema exposes only {action} with additionalProperties:true (src/facades/index.ts:97-108), so calling LLMs get no type info that input must be an object and often serialize it as a JSON string; the kernel passes flat params through with no coercion (src/kernel.ts:~310). Reproduced 2026-07-17 on current main against live daemon v2.1.2: identical call succeeds with input as object, fails with input as string. Also note: top-level assumption is ignored by design (handler only reads input.input). Originally reported from plasiv session on the old /Volumes/Kiki build. Suggested fix: kernel-level coercion — when the internal tool schema declares a param as object/array but it arrives as string, attempt JSON.parse (fixes the whole ISS-0112 family), or per-handler parse in lateral.ts.
