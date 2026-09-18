---
uid: 01a03a84-19bc-78c0-a222-ca74c1d0289d
id: ISS-0135
projectId: decibel-tools-mcp
severity: high
status: closed
epic_id: EPIC-0037
created_at: 2026-08-25T20:02:11.004Z
updated_at: 2026-08-30T23:15:54.291Z
closed_at: 2026-08-30T23:15:53.936Z
resolution: |-
  Closed 2026-08-30. HQ-side dependency, landed by the decibel-hq peer and verified here over the wire rather than taken on report.

    POST https://home.theagenthq.app/agents/mcp (unauthenticated) -> HTTP 401 with
    www-authenticate: Bearer realm="decibel-hq", error="invalid_token",
      error_description="a valid bearer credential is required",
      resource_metadata="https://home.theagenthq.app/.well-known/oauth-protected-resource/agents/mcp"

  That is a well-formed RFC 9728 protected-resource challenge, which is what the ChatGPT connector needs.

  Applied on Core: 20260825000001 (agent_tokens, the four oauth_* tables, hq.resolve_bearer, hq.issue_agent_token). Edge functions agent-oauth and agent-post-office deployed with verify_jwt=false.

  NOTE ON THE ORIGIN: discovery is https://home.theagenthq.app, NOT hq.decibelsystems.com. That domain has no DNS at all — confirmed unresolvable from here. Anything in this repo or its docs that points at hq.decibelsystems.com is wrong and will fail closed.
---

# HQ must stand up an OAuth 2.1 authorization server in front of agent tokens (ADR-0009 phase 4 scope increase)

**Severity:** high
**Status:** closed
**Epic:** EPIC-0037

## Details

Ben's call, 2026-08-25: "we also need to support oauth 2.1 for hq". This confirms the branch ISS-0132 landed on and closes the sequencing question — the optimistic path (reuse the ADR-0009 agent-token class as the credential ChatGPT presents directly) is dead.

WHY THIS IS REQUIRED, not optional (verified in ISS-0132 against OpenAI docs, 2026-08-20):
- The ChatGPT connector UI is the surface Ben actually uses, and OpenAI's plugin auth docs enumerate exactly two schemes: `noauth` and `oauth2`. No static/opaque bearer path is documented for that surface.
- `noauth` is not acceptable here: an unauthenticated post office lets anyone write into an org's threads.
- The Responses API path DOES accept an opaque bearer, but that is the self-run-agent surface, not the connector. Designing for it would solve the wrong problem.

WHAT HQ HAS TO BUILD (edge function, `supabase/functions/agent-mcp/`):
1. OAuth 2.1 authorization-code flow with PKCE.
2. Protected-resource metadata at /.well-known/oauth-protected-resource, or a WWW-Authenticate challenge pointing at it.
3. Client registration: Client ID Metadata Documents (CIMD) — ChatGPT supports public-client token exchange (`none`) or signed client assertion (`private_key_jwt`). Dynamic client registration remains supported if configured.
4. Token issuance/refresh, with ChatGPT then sending `Authorization: Bearer <issued token>` on MCP requests.
5. Connecting the server requires Developer Mode (Settings -> Connectors -> Advanced).

WHAT DOES NOT CHANGE:
The ADR-0009 agent-token class is still the right credential AT REST — it becomes what the OAuth layer ISSUES AGAINST rather than what the client presents. Org-binding-by-credential and endpoint-stamped `from` (EPIC-0037 acceptance criterion 4) are unaffected. sha256-at-rest, immutable-except-revoked_at/last_used_at all still hold.

OWNERSHIP: this is decibel-hq's build, not decibel-tools-mcp's — the local daemon stays bound to 127.0.0.1:4888 and is deliberately NOT tunnelled (ADR-0006). Filed here because EPIC-0037 is tracked in this repo and this is a hard dependency for the seven-verb facade: no auth story, no post office.

CALIBRATION: OpenAI's docs do not formally PROHIBIT a static bearer in the connector UI; they document no path for one. Treat "OAuth required" as strongly evidenced rather than formally stated. If a static-bearer path is later confirmed, this collapses back to the token class alone — but do not plan on it.

Related: ISS-0132 (the verification), ISS-0134 (durable agent identity seam), decibel-hq ADR-0009 phase 4, EPIC-0037 acceptance criteria 4 and 5.

## Resolution

Closed 2026-08-30. HQ-side dependency, landed by the decibel-hq peer and verified here over the wire rather than taken on report.

  POST https://home.theagenthq.app/agents/mcp (unauthenticated) -> HTTP 401 with
  www-authenticate: Bearer realm="decibel-hq", error="invalid_token",
    error_description="a valid bearer credential is required",
    resource_metadata="https://home.theagenthq.app/.well-known/oauth-protected-resource/agents/mcp"

That is a well-formed RFC 9728 protected-resource challenge, which is what the ChatGPT connector needs.

Applied on Core: 20260825000001 (agent_tokens, the four oauth_* tables, hq.resolve_bearer, hq.issue_agent_token). Edge functions agent-oauth and agent-post-office deployed with verify_jwt=false.

NOTE ON THE ORIGIN: discovery is https://home.theagenthq.app, NOT hq.decibelsystems.com. That domain has no DNS at all — confirmed unresolvable from here. Anything in this repo or its docs that points at hq.decibelsystems.com is wrong and will fail closed.
