# ADR-0006: ChatGPT MCP Root Path Routing

**Status:** Accepted
**Date:** 2025-12-25
**Authors:** Human + Claude Code

## Context

After a power outage, ChatGPT stopped connecting to our MCP server with this error:

```
expected header to contain text/event-stream got application/json
```

Investigation revealed:
1. ChatGPT sends MCP protocol requests to `POST /` (root path), not `POST /mcp`
2. ChatGPT expects Server-Sent Events (SSE) streaming responses
3. Our server was only routing MCP traffic to `/mcp`, returning JSON at root

## Decision

Route MCP protocol requests at **both** `/mcp` AND root path (`POST /`, `DELETE /`) to the `StreamableHTTPServerTransport` handler.

```typescript
// Handle at both /mcp and root / (for ChatGPT compatibility)
if (path === '/mcp' || (path === '/' && (req.method === 'POST' || req.method === 'DELETE'))) {
  await transport.handleRequest(req, res);
  return;
}
```

### ChatGPT MCP Compatibility Checklist

| Requirement | Implementation |
|-------------|----------------|
| `POST /` routes to MCP | ✅ StreamableHTTPServerTransport |
| `DELETE /` routes to MCP | ✅ For session cleanup |
| `GET /` returns JSON | ✅ Health check (backwards compat) |
| SSE content type | ✅ Handled by transport |
| CORS headers | ✅ All required headers set |
| OAuth routes return 404 | ✅ Not 400, keeps wizard happy |
| Stateless mode | ✅ `sessionIdGenerator: undefined` |

### Required CORS Headers

```typescript
res.setHeader('Access-Control-Allow-Origin', '*');
res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id, Accept');
res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
```

### ngrok Setup

ChatGPT requires HTTPS. Use ngrok with reserved domain:

```bash
ngrok http 8787 --domain=your-domain.ngrok-free.dev
```

## Consequences

### Positive
- ChatGPT connects successfully via MCP at root path
- SSE streaming works correctly
- Backwards compatible with `/mcp` endpoint
- Same server works for Claude (stdio) and ChatGPT (HTTP)

### Negative
- Must protect root path routing in future changes
- `POST /` no longer available for other purposes
- Easy to accidentally regress this behavior

## Testing

Verify ChatGPT connection:
1. Start server: `node dist/server.js --http --port 8787`
2. Start tunnel: `ngrok http 8787 --domain=...`
3. ChatGPT should be able to call tools without SSE error

Manual test:
```bash
# Health check (JSON) - should work
curl https://your-domain.ngrok-free.dev/

# MCP at root - should return SSE headers
curl -X POST https://your-domain.ngrok-free.dev/ \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream"
```
