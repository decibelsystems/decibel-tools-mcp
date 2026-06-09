# Invariants — decibel-tools-mcp (security review scope)

The adversary should attack these properties. This is an MCP daemon (TypeScript)
that exposes project-intelligence tools over stdio + HTTP, plus a Plan D
multi-tenant layer: an org-scoped Supabase store, an agent-presence writer, and a
HQ→agent command dispatcher. Context: the HTTP server binds 127.0.0.1 in daemon
mode but 0.0.0.0 in `--http` (hosted) mode, and the hosted MCP (senken.pro) is
currently unauthenticated.

## Multi-tenant store — cross-org isolation (src/store/supabaseStore.ts)

- A request MUST NOT read or write rows belonging to an org the caller is not a
  member of, regardless of the `X-Org-Key` (orgId) or `projectKey` values supplied.
  Tenant scoping is enforced by Supabase RLS keyed on the caller's JWT; the daemon
  MUST forward the caller's JWT (`X-User-Key` → `userJwt`) as the Authorization
  bearer, and MUST NOT fall back to a service-role key for tenant content writes.
- `created_by` on a written row MUST reflect the authenticated caller (JWT `sub`),
  never a value the caller can spoof through the request body.
- A missing/empty `userJwt` or `orgId` MUST cause the write to fail closed, not to
  proceed with elevated (anon/service) privileges.
- `resolveProjectId(orgId, projectKey)` MUST only resolve projects within the
  passed org; a project key that exists in another org MUST NOT resolve.

## Agent-command control plane — the highest-risk surface (src/agentCommands.ts)

- The dispatcher MUST only act on commands scoped to the org_id it is authorized
  to serve. org_id MUST be the PRIMARY filter; `target_host` + `target_session_key`
  are defense-in-depth, NOT the security boundary. An org-A admin writing a command
  row that names an org-B peer's (guessable) session_key MUST NOT cause delivery to
  org B — because that row carries org_id=A and B's daemon only serves org B.
- The dispatcher MUST NOT dispatch a command whose `target_host` is not this host.
- Only the allowlisted command kinds (`message`, `request_status`) may execute; any
  other `kind` MUST fail without side effects. There is NO shell/exec kind.
- An expired command (`expires_at` in the past) MUST NOT be dispatched.
- A delivered `message` MUST be transported to the target as untrusted-channel
  DATA (a peer message), NEVER framed as a privileged/system instruction. The
  broker `from_id` MUST be a non-privileged label (e.g. `decibel-daemon`), never
  `system`.
- The status/result write-back MUST be scoped to the authorized org_id (a settle
  MUST NOT update a row outside it).

## HTTP kernel / transport — auth, CORS, tier (src/httpServer.ts, src/kernel.ts)

- When an auth token is configured, every protected route MUST reject a request
  with a missing or wrong `Authorization` header before any tool dispatch, using a
  timing-safe comparison.
- Tier gating: a `core`-tier caller MUST NOT be able to invoke a `pro`/`apps`
  facade, including indirectly via a delegated/parent call.
- CORS: in daemon mode, REST endpoints MUST restrict `Access-Control-Allow-Origin`
  to localhost; only the `/mcp` MCP route may use `*`. A non-localhost origin MUST
  NOT receive a permissive ACAO on REST endpoints in daemon mode.
- Request-supplied identity headers (`X-User-Key`, `X-Org-Key`, `X-Agent-Id`,
  `X-License-Key`) MUST be treated as untrusted input — never logged as secrets,
  never used to bypass tier/auth checks.

## Project resolution (src/projectRegistry.ts)

- Path resolution MUST NOT allow traversal outside a registered project root via a
  crafted projectId/alias/path (e.g. `../`, absolute paths to unrelated dirs).
- The cwd/ENV fallbacks (strategies 6/7) MUST NOT let a caller resolve an arbitrary
  project they didn't specify in a way that crosses a tenant boundary in hosted mode.

## License validation (src/license.ts)

- License validation MUST fail closed: when offline beyond the grace window and no
  valid cache exists, the server MUST NOT grant pro/apps tier.
- A forged or tampered license payload MUST NOT validate.

## General

- No code path may interpolate untrusted request input into a shell command,
  SQL string (all Supabase access is via parameterized PostgREST calls), or file
  path without validation.
- Secrets (JWTs, service keys, license keys, auth tokens) MUST NOT be written to
  logs or error messages.
