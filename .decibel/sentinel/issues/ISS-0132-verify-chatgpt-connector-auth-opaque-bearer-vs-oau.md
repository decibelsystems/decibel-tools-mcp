---
uid: 01a01da2-b885-7463-bb84-396129457a4a
id: ISS-0132
projectId: decibel-tools-mcp
severity: high
status: in_progress
epic_id: EPIC-0037
created_at: 2026-08-20T05:26:38.469Z
updated_at: 2026-08-20T05:29:08.892Z
---

# Verify ChatGPT connector auth (opaque bearer vs OAuth) before building the EPIC-0037 post office

**Severity:** high
**Status:** in_progress
**Epic:** EPIC-0037

## Details

BLOCKING UNKNOWN, raised by the decibel-hq session during design review of EPIC-0037. Nobody has verified it and it is load-bearing for the whole epic.

Question: does ChatGPT's connector / remote-MCP UI accept an OPAQUE BEARER TOKEN, or does it require OAuth on the remote MCP server?

Why it decides the design:
- If opaque bearer is accepted, the org-scoped agent-token class already designed in decibel-hq ADR-0009 (sibling to hq.daemon_tokens, sha256 at rest, immutable except revoked_at/last_used_at) is sufficient. That is a small amount of work on an existing pattern.
- If OAuth is required, the edge function needs an OAuth authorization-server wrapper — discovery, client registration, token exchange, refresh — in front of the agent token. That is a materially larger build and changes the sequencing conversation.

This must be answered BEFORE the seven-verb facade or the edge endpoint is built, not discovered during integration. It is the difference between "reuse the token class" and "stand up an authorization server".

Verification should be first-hand: check current OpenAI documentation for remote MCP servers / connectors and the ChatGPT connector setup flow, and confirm what credential the UI actually asks for. Do not infer it from the Responses API path — an OpenAI agent you run yourself can pass arbitrary headers, but the ChatGPT connector UI is a different surface with its own requirements, and the epic depends on the latter.

Related: decibel-hq ADR-0009 (runtime-agnostic agent contract, path B edge function), decibel-tools-mcp ADR-0006 (daemon binds 127.0.0.1:4888 — deliberately not tunnelled).

[2026-08-20] VERIFIED against OpenAI's current docs (2026-08-20). The answer splits by surface, which is exactly why this had to be checked rather than inferred from the SDK path.

CHATGPT CONNECTOR / PLUGIN PATH — OAuth 2.1, no documented static-token option.
- OpenAI's plugin auth docs enumerate two security schemes: `noauth` (read-only anonymous) and `oauth2`. Static API keys and bearer tokens are not mentioned as an option anywhere on that page.
- OAuth 2.1 authorization-code flow with PKCE is required for protected resources. "Anything that exposes customer-specific data or write actions should authenticate users."
- The server must expose protected-resource metadata at /.well-known/oauth-protected-resource, or point to it via a WWW-Authenticate challenge.
- Client registration: OpenAI recommends OAuth with Client ID Metadata Documents. ChatGPT supports CIMD with public-client token exchange (`none`) or signed client assertion (`private_key_jwt`). Dynamic client registration "remains supported when configured".
- ChatGPT then attaches the issued access token as `Authorization: Bearer <token>` on MCP requests.
- Connecting a custom remote MCP server requires Developer Mode (Settings -> Connectors -> Advanced -> Developer mode).

RESPONSES API / SELF-RUN OPENAI AGENTS — opaque bearer is fine.
- The MCP tool takes an `authorization` field carrying a bearer token. OpenAI does not store it and it is not visible in the Response object, so it must be resent on every request.

CALIBRATION: the docs do not explicitly PROHIBIT a static bearer in the connector UI; they simply document no path for one. Treat "OAuth required for an authenticated connector" as strongly evidenced rather than formally stated. `noauth` is documented and would technically work, but is unacceptable here — an unauthenticated post office lets anyone write into an org's threads.

CONSEQUENCE FOR EPIC-0037: Ben is using the ChatGPT app, so this is the connector path, so the OAuth wrapper is REQUIRED. The optimistic branch ("reuse decibel-hq's agent-token class as-is") is closed. The edge function needs an OAuth 2.1 authorization server in front of the agent tokens: PKCE authorization-code flow, protected-resource metadata discovery, and CIMD or dynamic client registration.

The agent-token class is still the right credential at rest — it becomes what the OAuth layer ISSUES AGAINST rather than what ChatGPT presents directly. Org-binding-by-credential and endpoint-stamped `from` are unaffected.

This materially enlarges decibel-hq's edge-function build and should be reflected in the ADR-0009 phase 4 sequencing decision.

Sources:
https://developers.openai.com/plugins/build/auth
https://developers.openai.com/api/docs/mcp
https://developers.openai.com/api/docs/guides/tools-connectors-mcp
