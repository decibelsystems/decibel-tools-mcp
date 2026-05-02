# RFC: `policy_codify` tool

**Status:** Draft
**Origin:** Field report from a downstream consumer (apocalyptic-frontend-clean), 2026-05-01

---

## Source motivation

This RFC is a **use-case report from the field** rather than an internal
roadmap proposal. It originated in a single-session experience on the
apocalyptic frontend-clean codebase where the same codification flow ran
four times in a row, surfacing friction the consumer felt acutely.

Filed here because the implementation lives here. Decibel maintainers
should treat the priority/scope as advisory; the value claim is that
*the workflow described is real and recurring*, even if the precise tool
shape changes during design review.

Source PRs (apocalyptic-frontend-clean repo, `otherides/frontend_v0.2`):
- `#41` — M-1+M-2 sweep: original Supabase-auth defensive pattern + verifier
- `#45` — M-3 follow-up: caught a regex blind spot the M-2 sweep missed
- `#47` — M-4 follow-up: post-merge review of #43 found 3 HIGH issues
- `#50` — original RFC (this document, snapshot from origin)

---

## Problem

When a code review surfaces a new bug class, the *fix* is the easy part.
The expensive part is the **codification work** that turns a one-off bug
into a permanent prevention stack:

1. Update the policy YAML with a violation example
2. Extend the static verifier with a detection regex
3. Add patched files to the verifier's `SITES` array
4. Wire the verifier into pre-commit (fail-closed)
5. Wire the verifier into CI
6. File any deferred follow-up issues

In the source session, we performed this exact 6-step codification
**four times in a row** for related-but-distinct bug classes (M-1, M-2,
M-3, M-4 of POL-0002 — defensive Supabase auth headers).

Each pass was mechanical, identical in shape, and prone to forgetting
one of the steps. We *did* forget the `&&` shape in M-2's regex — only
caught after M-3 review re-derived it from new patches. A tool would
have caught that drift earlier (regression-testing the regex against
pre-fix file content).

Forgetting step 3 (`SITES`) silently degrades the canonical-pattern
check. Forgetting step 4 (pre-commit) makes the policy CI-only, missing
the developer-feedback loop. Forgetting step 6 (follow-up issues) loses
deferred items in chat history.

The mechanical-yet-consequential shape of this work makes it a
**high-value automation target**. Once codified, every future policy
across every consumer project gets these scaffolds for free.

---

## Proposal

A new MCP tool: `decibel-tools__policy_codify`.

### Tool signature

```typescript
decibel-tools__policy_codify({
  project_id: string;          // e.g. "frontend-clean"
  policy_id: string;            // e.g. "POL-0002" (existing) or auto-allocate next
  finding: {
    title: string;              // human-readable: "&&-form silent fallback"
    bug_class_id: string;       // e.g. "M-3" (sequential within policy)

    // Detection — the new check the verifier should add
    detection: {
      kind: "regex" | "ast" | "semantic";
      pattern: string;          // raw regex or AST query
      file_filter?: string;     // glob, default: src/**/*.{js,jsx,ts,tsx}
      severity: "fail" | "warn";
    };

    // Documentation — pasted into the policy YAML's examples.violation
    violation_example: string;  // multi-line code snippet
    why_it_fails: string;       // 1-2 sentence explanation of the failure mode

    // Coverage — files that should now satisfy the canonical pattern
    sites_added?: Array<{
      file: string;             // path relative to project root
      context: string;          // log context, e.g. "[KlingVideoNode]"
      fns: string[];            // function names like "getAuthHeaders"
    }>;

    // Follow-ups — items deferred from this codification
    deferred_issues?: Array<{
      title: string;
      priority: "critical" | "high" | "medium" | "low";
      description: string;
    }>;
  };

  // Mode flags
  dry_run?: boolean;            // default false; if true, returns diff without writing
  verify_against?: "current" | "pre_fix";  // default "current"; "pre_fix" runs the
                                            // new regex against the file contents
                                            // BEFORE the fix to confirm it would
                                            // have caught the bug (regression test)
})
```

### Side effects (when `dry_run: false`)

1. **Policy YAML** (`.decibel/architect/policies/{policy_id}-*.yaml`):
   - Append `violation_example` to `examples.violation`
   - If new bug class, add a brief note to `rationale`

2. **Verifier script** (`scripts/verify-{policy-slug}.mjs`):
   - Append the detection regex to the appropriate check function
   - Append `sites_added` entries to the `SITES` array
   - Bump the verifier version comment

3. **Pre-commit hook** (`scripts/git-hooks/pre-commit`):
   - Idempotent — only adds the verifier wiring block if missing
   - Uses fail-closed `[ -f ]` test (not `[ -x ]`)

4. **CI workflow** (`.github/workflows/verify-{policy-slug}.yml`):
   - Idempotent — only creates if missing
   - Runs verifier on PRs touching paths in `file_filter`

5. **Sentinel issues** (`.decibel/sentinel/issues/ISS-XXXX-*.yml`):
   - One issue file per `deferred_issues` entry
   - Auto-numbered

6. **Verification** (always runs):
   - Run the new regex against `verify_against` target
   - Run the full verifier project-wide
   - Report pass/fail

### Returns

```typescript
{
  diff: string;               // unified diff of all file changes
  verifier_status: {
    pass: boolean;
    new_check_fires_on_pre_fix: boolean;  // true if regex would have caught the bug
    new_check_fires_on_current: boolean;  // false expected (post-fix)
    sites_compliant: number;
    sites_warning: number;
  };
  files_changed: string[];
  issues_filed: string[];     // ISS-XXXX IDs for deferred issues
}
```

The caller commits the diff (or rejects it). The tool does not commit.

---

## Why this shape

### Take the regex as input, don't synthesize it

Translating "this code shape is bad" into a regex is judgment-heavy. The
tool can't reliably auto-derive a regex from a violation example without
false positives or negatives. Asking the caller for the regex makes the
tool a *codification helper*, not a *bug-class detector*.

The tool *can* validate the regex by running it against pre-fix content
(`verify_against: "pre_fix"`). If the new regex doesn't fire on the bug
it's supposed to catch, that's a strong signal the regex is wrong before
it ships.

### One tool, multiple file outputs

Codification spans 5+ files. Asking the caller to invoke 5 tools with
correctly synchronized inputs is friction. One tool that handles all 5
atomically is less error-prone — if any step fails, the whole codify
operation rolls back.

### Idempotent integration files

Pre-commit hook + CI workflow are likely to exist already from prior
codifications. Adding a new policy shouldn't duplicate the wiring; it
should detect the existing wiring and no-op if present.

### Don't auto-commit

The diff is the artifact. The caller reviews it (likely via Claude Code
or equivalent), edits if needed, and commits with their own message.
Auto-commit removes the human review step, which is exactly the wrong
direction for a tool that codifies *governance*.

---

## Implementation sketch

### Phase 1 (MVP) — single policy schema

Target: POL-0002 shape. Tool understands:
- YAML schema with `rationale`, `rules`, `examples.compliant`, `examples.violation`
- Verifier with `SITES` array + check functions
- Pre-commit hook with the canonical wiring block

Out of scope: arbitrary policy schemas, AST-based detection, multi-language verifiers.

Estimate: ~2 weeks for one engineer comfortable with TypeScript MCP servers.

### Phase 2 — generalize policy schema

Add a `policy_schema_version` field so the tool can dispatch on schema.
POL-0001 (frontend security requirements) has a different rule shape;
support both.

### Phase 3 — cross-language verifiers

Most projects have both a frontend (JS verifier) and backend (Python
equivalent). The tool should generate or extend both when a policy spans
languages. POL-0002 currently has only the JS half; the Python half is
TODO.

### Phase 4 — AST detection

Regex detection has known blind spots (multi-line patterns, whitespace
variations, comment-aware matching). For maturing policies, AST-based
detection (via Babel/TypeScript parser, ast-grep, or semgrep) catches
shapes regex can't.

This is its own product — a static analyzer. Worth building, but only
after Phase 1-3 prove the codification workflow.

---

## Open questions

### Q1: Policy lifecycle

Today, policies are filed once and grow violation examples over time.
Do they ever sunset? If a project drops Supabase, POL-0002 becomes dead
weight. Tool should support a `policy_archive` companion that moves a
policy to `.decibel/archive/policies/` while preserving the verifier in
commit history.

### Q2: Cross-project policies

Some policies (defensive auth pattern, rate limiting, error sanitization)
apply to many projects. Should `policy_codify` support a "policy
template" that's instantiated per-project, or is each project's POL-XXXX
distinct? Current design assumes the latter.

Practical compromise: a "policy library" of templates, and
`policy_codify` instantiates a template into a project's policy
namespace with project-specific paths/SITES.

### Q3: Verifier ownership

If a project's verifier is auto-extended by `policy_codify`, who owns
it? The verifier is a hand-written script today; the tool would
mechanically modify it. Hybrid approach: tool only modifies clearly
delimited regions (between `// === BEGIN AUTOGEN ===` and `// === END
AUTOGEN ===` markers), leaves hand-written logic alone.

### Q4: Regex regression-test corpus

The `verify_against: "pre_fix"` mode requires fetching the pre-fix file
content. Two options:
- (a) Caller provides commit SHA of the pre-fix state; tool diffs.
- (b) Caller provides the pre-fix code snippet inline.

Option (a) ties to git history; option (b) is self-contained but relies
on the caller pasting representative code. (a) is cleaner; (b) is more
portable.

---

## Examples from the source session

The session that motivated this RFC ran the codification flow 4 times
in a row, all on POL-0002 (defensive Supabase auth):

| Iteration | Bug class | Detection regex | SITES added |
|-----------|-----------|-----------------|-------------|
| M-1 | `Bearer ${session?.access_token}` (literal "Bearer undefined") | `/Bearer \$\{[^}]*\?\.access_token\}/` | 9 services |
| M-2 | Bare fallback `return { 'Content-Type': ... }` + ternary form | 2 regexes | 17 sites |
| M-3 | `&&` short-circuit form (missed by M-2 ternary regex) | 1 regex | 5 canvas-video sites |
| M-4 | Reset-race silent overwrite (NanoBananaNode) | n/a — runtime, not regex | n/a |

M-1 through M-3 are textbook `policy_codify` calls. M-4 is *not* —
it's a runtime race condition not catchable by static analysis. That
distinction is important: the tool is for *static-analyzable* bug
classes only. Runtime bugs need different infrastructure (test
recipes, integration tests, runtime instrumentation).

---

## Adoption path

1. **Decibel team review of this RFC** — confirm the shape, especially
   the "policy YAML schema" and "verifier ownership" questions
2. **Build Phase 1 MVP** in `decibel-tools-mcp` (~2 weeks)
3. **Pilot on POL-0002 in apocalyptic** — replay M-3 codification via
   the new tool, compare diff to the manual diff that shipped in #45
4. **Pilot on a fresh policy** — file a brand-new policy via the tool
   from scratch, validate the YAML/verifier/hook/CI scaffolding
5. **Open beta to other decibel projects**

---

## Alternatives considered

### A. Don't build it; document the manual workflow

Already done implicitly via the verifier file + POL-0002 + git history
in apocalyptic. The session that motivated this RFC ran 4 manual
codifications using those references and still made errors (e.g., the
M-2 ternary regex that missed the `&&` form — only caught after M-3
review). Manual ceremony is error-prone even with good docs.

### B. Build a generic "lint extension" framework

Instead of policy-specific codification, build a meta-system where
adding a lint rule writes the regex + tests + CI hookup. This is what
ESLint plugins and ast-grep registries already do.

The reason `policy_codify` is different: it integrates with decibel's
*policy system* — the YAML, the architect ADRs, the sentinel issues,
the audit trail. Generic lint frameworks don't know about those.
A decibel-aware tool can write the policy YAML, link the verifier,
file the deferred issues, and update the policy registry — all in
one operation.

### C. Skip codification automation; invest in test coverage

If runtime tests caught the auth-failure bugs, we wouldn't need the
verifier. True for some bug classes; not true for "Bearer undefined"
or silent fallbacks where the bug only manifests under specific
session-lifecycle conditions that are hard to reproduce in tests.

Static verifiers and runtime tests are complements, not substitutes.

---

## Decision request

Decibel maintainers: please confirm or push back on:

1. **Tool shape** — single composite tool vs. multiple narrow tools
2. **Scope** — codification only (this RFC) vs. broader "policy
   lifecycle management" (Q1)
3. **Phasing** — start with POL-0002-shape MVP, or aim for general
   schema from the start
4. **Ownership** — who maintains the tool's policy-schema templates as
   policies evolve

If you agree the shape is right, the implementation work can be scoped
internally. If you disagree on shape or scope, the RFC discussion
captures the field-data so future tooling decisions are anchored in a
real consumer experience.

---

## Appendix A: relationship to existing decibel tools

This tool would extend the existing decibel architecture:

- `architect_createPolicy` — creates a new policy YAML
- **`policy_codify` (new)** — extends an existing policy with a new
  finding + scaffolds the verifier/hook/CI/issues
- `architect_listPolicies` — used to confirm policy_id valid
- `sentinel_create_issue` — used internally to file deferred issues
- `learnings_append` — could optionally be called by the tool to
  record the codification as a learning entry

The tool is a *coordinator* over existing primitives, not a parallel
stack. That's an important invariant: it should not duplicate what
existing tools do, only orchestrate them in a way that's hard to do
manually.

---

## Appendix B: example invocation

For the M-3 codification that shipped in apocalyptic-frontend-clean#45:

```typescript
decibel-tools__policy_codify({
  project_id: "frontend-clean",
  policy_id: "POL-0002",
  finding: {
    title: "&&-form silent fallback",
    bug_class_id: "M-3",
    detection: {
      kind: "regex",
      pattern: "\\.\\.\\.\\s*\\(\\s*session\\?\\.access_token\\s*&&\\s*\\{\\s*['\"]Authorization['\"]",
      severity: "fail",
    },
    violation_example: `
      const headers = {
        'Content-Type': 'application/json',
        ...(session?.access_token && { 'Authorization': \`Bearer \${session.access_token}\` })
      };
    `,
    why_it_fails: "When session is null, the spread evaluates to nothing → request fires without Authorization → backend 401s with no client-side surface.",
    sites_added: [
      { file: "src/services/betaInviteService.js", context: "BetaInviteService", fns: ["getAuthHeaders"] },
      { file: "src/services/cameraPathService.js", context: "CameraPathService", fns: ["getAuthHeaders"] },
      { file: "src/components/Canvas/nodes/KlingVideoNode.jsx", context: "KlingVideoNode", fns: ["getAuthHeaders"] },
      { file: "src/components/Canvas/nodes/SoraVideoNode.jsx", context: "SoraVideoNode", fns: ["getAuthHeaders"] },
      { file: "src/components/Canvas/nodes/SeedanceVideoNode.jsx", context: "SeedanceVideoNode", fns: ["getAuthHeaders"] },
    ],
    deferred_issues: [],
  },
  verify_against: "pre_fix",
});
```

Expected output: a unified diff equivalent to the human-authored
PR #45, plus a `verifier_status` confirming the new regex fires on
pre-fix content of the 5 added sites.

---

**End of RFC**
