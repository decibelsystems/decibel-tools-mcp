# Technical Learnings: decibel-tools-mcp

> A living document of lessons learned, gotchas, and insights.

---

### [2025-12-24 17:22:28] Vintage Magic OCR: Drop shadow causes predictable character confusions
**Category:** integration | **Tags:** `ocr`, `magic`, `vintage`, `drop-shadow`, `fuzzy-matching`

Vintage Magic cards (pre-8th Edition, ~1993-2003) have white title text with black drop shadow that creates consistent OCR errors. The shadow causes predictable character confusions:

- `G` → `s`, `g` (shadow reads as separate stroke)
- `e` → `u`, `z` (shadow bleeds into letter shape)
- `a` → `r`, `u` (open counters fill with shadow)
- `t` → `r` (cross-stroke confusion)

Solution approach:
1. Detect vintage frame style (sample title bar for high contrast white+black in same region)
2. Apply shadow confusion matrix to weight Levenshtein substitutions
3. Constrain search to vintage card names (~7,500 vs 30,000+)
4. Generate multiple OCR candidates from shadow corrections

This pattern applies to any OCR task with drop shadow typography.

---
### [2025-12-24 17:39:21] Self-improving OCR: User selection as supervised learning signal
**Category:** architecture | **Tags:** `learning-system`, `ocr`, `deck`, `architecture`, `human-in-the-loop`

Implemented a self-improving OCR learning system with design provenance chain:

**The Learning Loop:**
1. User scans card → OCR produces noisy text
2. System shows candidates with scores
3. User selects correct card (GROUND TRUTH)
4. Signal recorded: OCR text → correct name + frame metadata
5. Confusion matrix updated (char + n-gram level)
6. Next scan uses learned corrections

**Key Design Decisions (from G's refinements):**

1. **N-gram layer** - Shadow errors smear across 2-3 chars (`ea→zr`), not just single chars
2. **Granular frame buckets** - Use Scryfall's `frame` field ("1993", etc) not just vintage/modern
3. **Undo window** - 5 seconds before commit to prevent bad labels from mis-taps
4. **Edit budget** - Max 4 mutations per candidate, scoring gate prevents degradation
5. **Min observation threshold** - 20 observations before learned rule activates
6. **Append-only JSONL** - Simple, versionable, async-friendly

**Files:**
- LearningSignal.swift - Full capture model with diagnostics
- LearningStore.swift - JSONL persistence with undo
- ConfusionMatrix.swift - Needleman-Wunsch alignment, char + ngram
- LearnedCandidateGenerator.swift - Edit-budgeted candidate gen
- OCRLearningIntegration.swift - UI entry point

This pattern generalizes to any human-in-the-loop ML system where user selection = supervision signal.

---
### [2025-12-30 05:22:55] Mobile Companion App Architecture: Pocket Console Pattern
**Category:** architecture | **Tags:** `mobile`, `architecture`, `patterns`, `icloud`, `offline-first`

For mobile companion apps in an AI/agentic ecosystem, the "Pocket Console" pattern works well:

1. **Capture** - Mobile excels at voice input and share extensions. Use offline-first queue (SwiftData) with eventual sync.

2. **Observe** - Don't replicate desktop dashboards. Provide glanceable status snapshots with < 10s time-to-value.

3. **Act** - Voice commands that trigger queued actions. Never destructive without confirmation. Default to "enqueue if offline".

4. **Share** - Use native share sheet (UIActivityViewController) instead of building in-app chat. Leverage existing team tools.

Key insight: iCloud Drive provides 80% of cross-device sync value with 20% of the complexity. Write events as JSON files to inbox folders, let desktop agent watch and process. Defer Hub/API until sync latency becomes a problem.

Schema versioning (v1) from day one enables future evolution without breaking changes.

---
### [2026-01-01 07:16:29] Supabase Cloud Spine Integration Complete
**Category:** integration | **Tags:** `supabase`, `cloud-spine`, `studio`, `handoff`, `senken-pro`

## Session Handoff - 2024-12-31

### What Was Added

**Supabase Client (`src/lib/supabase.ts`)**
- Singleton pattern for anon + service role clients
- Type definitions for all Decibel Studio entities: Project, Artifact, ArtifactFile, Device, Event, Job
- Connects to senken.pro Supabase backend
- Env vars: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`

**Cloud Spine Tools (`src/tools/studio/cloud-spine.ts`)**
12 MCP tools for Decibel Studio cloud sync:
- Projects: `studio_list_projects`, `studio_create_project`, `studio_get_project`
- Artifacts: `studio_list_artifacts`, `studio_create_artifact`, `studio_update_artifact`
- Events: `studio_sync_events` (incremental sync by sequence number)
- Devices: `studio_register_device`, `studio_heartbeat`
- Jobs: `studio_list_jobs`, `studio_claim_job`, `studio_update_job`

### Current State
- Build passes ✓
- Tools are exported via `src/tools/studio/index.ts` → `studioCloudSpineTools`
- Files are uncommitted (staged in git status)

### Pending Work
- Test against live senken.pro Supabase with real credentials
- Authentication flow (tools require auth for create/update operations)
- May need RLS policies tuned on Supabase side

### Git Status
Uncommitted files:
- `src/lib/supabase.ts` (new)
- `src/tools/studio/cloud-spine.ts` (new)
- `src/tools/studio/index.ts` (modified - imports cloud-spine)
- `package.json` (likely has @supabase/supabase-js dep)

---
### [2026-01-01 18:04:41] Deploying MCP server alongside Flask on Render (single service)
**Category:** integration | **Tags:** `render`, `deployment`, `flask`, `node`, `submodule`, `single-service`

## Context
decibel-tools-mcp is included as a git submodule in senken-trading-agent. Both need to run on a single Render service to reduce cost and complexity.

## Architecture
```
Render service: "senken-trading" (senken.pro)
├── Flask (Python) on PORT (main, required by Render)
├── Node MCP server on port 8788 (internal)
└── Flask proxies /api/inbox → localhost:8788
```

## Implementation
Modify `scripts/start.sh` to start both processes:

```bash
# After cd backend, before WORKERS line:

# Build and start MCP server
echo "🔧 Building decibel-tools-mcp..."
cd ../decibel-tools-mcp
npm install --production
npm run build
echo "🌐 Starting MCP server on port 8788..."
node dist/server.js --http --port 8788 &
MCP_PID=$!
echo "   MCP PID: $MCP_PID"
cd ../backend
```

## Requirements
- Render Python runtime must have Node.js available (verify first)
- decibel-tools-mcp must support PORT env var (added in commit 856a58d)
- Flask needs proxy routes for MCP endpoints → localhost:8788

## Alternative: Two services
If single-service becomes complex, use render.yaml Blueprint to deploy two services from same repo:
- Service 1: senken-trading (Flask) → senken.pro  
- Service 2: decibel-mcp (Node, rootDir: decibel-tools-mcp) → mcp.senken.pro

---
### [2026-01-01 18:10:23] MCP proxy already exists in senken-trading-agent
**Category:** integration | **Tags:** `senken`, `proxy`, `flask`, `mcp`, `integration`, `dont-forget`

## Don't Reinvent The Wheel

senken-trading-agent ALREADY has MCP proxy infrastructure at:
`backend/routes/mcp_proxy_routes.py`

## What It Does
- Starts decibel-tools-mcp Node server as subprocess (lazy init on first request)
- Runs on port 8787
- Proxies: /sse/, /mcp, /call, /tools, /dojo/*, /context/*, /event/*, /artifact/*, /bench/*

## Adding New Endpoints
Just add a route to mcp_proxy_routes.py:
```python
@mcp_proxy_bp.route('/api/inbox', methods=['POST'])
def api_inbox():
    """Receive voice transcript from iOS app."""
    return _proxy_json_request('/api/inbox')
```

## DO NOT
- Add Node startup to start.sh (proxy handles this)
- Create a second Render service (not needed)
- Run Node on a different port (causes conflicts)

## Key Files
- Proxy: `backend/routes/mcp_proxy_routes.py`
- Registration: `backend/ccxt_backend.py` line ~1045
- Node path: Uses `DECIBEL_MCP_PATH` env var or `/decibel-mcp` submodule

---
### [2026-01-02 07:53:01] iOS Voice Inbox Supabase Fallback Not Working on Render
**Category:** debug | **Tags:** `supabase`, `render`, `voice-inbox`, `debugging`, `env-vars`

## Current Issue
The iOS voice capture flow to senken.pro/api/inbox is still failing with:
```
Project "deck" registered at /Volumes/Ashitaka/Documents/GitHub/deck but .decibel folder not found
```

## Root Cause Analysis
The Supabase fallback in `resolveVoiceRoot()` (voice.ts:90-96) should catch this error and use Supabase instead, but `isSupabaseConfigured()` appears to be returning false on Render.

## Code Already Updated
1. `isSupabaseConfigured()` in supabase.ts now checks for `SUPABASE_SERVICE_KEY` (not ANON_KEY)
2. `voiceInboxAdd` supports remote mode writing to Supabase
3. `voice_inbox_sync` tool added to pull messages locally
4. Health endpoint includes debug info: `supabase_configured`, `has_supabase_url`, `has_supabase_service_key`

## Next Steps to Debug
1. Check if deploy with debug health is live: `curl https://senken.pro/mcp/health`
   - Should now return `node_response` field with supabase config status
2. If `has_supabase_service_key: false`, the env vars aren't being passed to Node subprocess
3. Check Render env vars - user said they set them but names may differ:
   - Expected: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
   - User may have set: `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, etc.

## Flask Proxy Architecture
- Flask on port 10000 (Render's PORT)
- Node MCP server spawned by Flask on port 8787
- subprocess.Popen inherits env from Flask by default
- `/api/inbox` → Flask → `_proxy_json_request('/api/inbox')` → Node httpServer.ts

## Files Modified This Session
- `/Volumes/Ashitaka/Documents/GitHub/decibel-tools-mcp/src/lib/supabase.ts` - Fixed isSupabaseConfigured
- `/Volumes/Ashitaka/Documents/GitHub/decibel-tools-mcp/src/httpServer.ts` - Added debug info to /health
- `/Volumes/Ashitaka/Documents/GitHub/senken-trading-agent/backend/routes/mcp_proxy_routes.py` - Pass through node_response

## Commits Made
1. decibel-tools-mcp: `103364b` - feat: add Supabase config status to /health endpoint
2. senken-trading-agent: `14ba04c9` - feat: pass through Node health response for debugging

---
### [2026-01-06 17:28:30] First public npm release - v1.0.0 through v1.0.4
**Category:** process | **Tags:** `npm`, `release`, `publishing`, `documentation`

Published decibel-tools-mcp to npm for public use.

**Release progression:**
- v1.0.0: Initial public release
- v1.0.1: Added complete docs for all 92 tools
- v1.0.2: Corrected platform claims (Claude Desktop, Cursor only - not Codex/ChatGPT)
- v1.0.3: Added Claude Code to tested platforms
- v1.0.4: Removed Studio (15 tools) and Voice (5 tools) from public docs - still ship internally

**Final public release:** 72 tools across 12 domains

**Platforms tested:** Claude Desktop, Claude Code, Cursor

**Internal-only tools (undocumented but functional):**
- Studio: 15 tools for cloud asset generation
- Voice: 5 tools for voice inbox processing

**npm auth:** Using access token with bypass 2FA, stored in ~/.npmrc

**Package config:** Uses `files` whitelist in package.json to exclude .decibel/ project data from npm package.

---
### [2026-01-10 21:22:06] Issue triage: Python CLI approach obsolete
**Category:** process | **Tags:** `triage`, `architecture`, `tech-debt`

Triaged ISS-0001 through ISS-0016. Key insight: early issues (Dec 2025) assumed a Python CLI + Node.js shim architecture. This was superseded by native TypeScript with direct file operations. Closed 8 issues as wontfix/completed/duplicate. The CLAUDE.md now documents the correct architecture: self-contained MCP server using fs/YAML, never shelling out to CLI.

---
### [2026-01-10 21:47:17] dataRoot.ts cleanup - resolvePath was dead code
**Category:** architecture | **Tags:** `cleanup`, `dead-code`, `projectRegistry`

The entire resolvePath() mechanism in dataRoot.ts with DataDomain types and unknown_project fallback was dead code. All tools had migrated to resolveProjectPaths() from projectRegistry.ts. Removed ~250 lines of dead code, keeping only ensureDir(). Issues ISS-0015 (silent fallback) and ISS-0008 (dojo CLI) were already fixed by the projectRegistry migration but never closed.

---
### [2026-01-10 21:57:37] dataRoot.ts Dead Code Cleanup
**Category:** architecture | **Tags:** `dead-code`, `cleanup`, `projectRegistry`, `dataRoot`

**What happened:** Cleaned up 250+ lines of dead code from src/dataRoot.ts.

**Dead code removed:**
- `resolvePath()` function with DataDomain enum switch
- `DataDomain` type and `ResolvePathOptions` interface
- `hasProjectLocal()` and `getProjectName()` helpers
- `initProjectDecibel()` initialization function
- Internal helpers: `findUpDir()`, `inferProjectName()`, `getRoots()`, `throwProjectResolutionError()`

**Why it was dead:** All project resolution migrated to `projectRegistry.ts` which:
- Uses `resolveProject()` for ID/alias → path mapping
- Uses `resolveProjectPaths()` helper for tools
- Throws explicit PROJECT_NOT_FOUND errors (no silent fallback)

**What remains:** Only `ensureDir()` - used by 13 files with 28+ call sites.

**Verification process:**
1. Grep for imports showed only `ensureDir` imported
2. Grep for each function name found zero callers
3. External second opinion confirmed cleanup was safe

**Lesson:** When migrating to new architecture, add cleanup task for old code paths.

---
### [2026-01-12 06:52:46] External Second Opinion for Risky Refactors
**Category:** process | **Tags:** `refactoring`, `code-review`, `second-opinion`, `process`

**Context:** Proposed removing ~250 lines of "dead code" from dataRoot.ts. User correctly flagged this as risky and requested external validation before proceeding.

**What worked:**
1. User got independent Claude session to review the same codebase
2. External review confirmed: "CC got this one right. The cleanup is safe."
3. Only then proceeded with deletion

**Lesson:** For significant deletions or refactors where the AI claims code is "dead" or "unused":
- Grep searches can miss dynamic imports, reflection, or external consumers
- A second opinion from independent context catches blind spots
- The few minutes of validation prevents potential rollback pain

**Also this session:** Added website links to README (decibel.systems/tools in header, decibel.systems on MIT footer). Published 1.1.2.

---
### [2026-01-13 06:49:43] Carbon Voice Integration - Initial Setup Complete
**Category:** integration | **Tags:** `carbon-voice`, `voice`, `oauth`, `webhooks`, `edge-functions`

Met with Carbon Voice CEO - good meeting. Integration path is clear.

## What Carbon Voice Provides
- OAuth 2.1 flow for user auth
- Webhook events on `ai.prompt.response.generated`
- Already has MCP server (`cv-mcp-server`) and npm types (`cv-contracts`)
- API docs: https://api.carbonvoice.app/docs

## Work Completed
1. Created Edge Functions in `decibel-studio/supabase/functions/`:
   - `carbon-voice-callback/index.ts` - OAuth redirect handler
   - `carbon-voice-webhook/index.ts` - Receives AI events, inserts to voice_inbox
   - `_shared/carbon-voice.ts` - Types and helpers

2. API key created in Carbon dashboard (test key with placeholder URLs)

## Next Steps
- Set Supabase secrets (CARBON_VOICE_CLIENT_ID, CLIENT_SECRET, WEBHOOK_SECRET, REDIRECT_URI)
- Create `carbon_voice_credentials` table migration
- Update Carbon dashboard with real callback/webhook URLs after deploy
- Deploy Edge Functions: `supabase functions deploy`
- Test OAuth flow end-to-end

## Integration Architecture
Carbon Voice → webhook → Supabase Edge Function → voice_inbox table → voice_inbox_sync pulls to local

---
