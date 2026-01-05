# Voice Input Setup Guide

Voice input lets you capture ideas, issues, and commands from anywhere (iOS, watch, etc.) and have them sync to your local Decibel projects for processing.

## How It Works

```
┌─────────────┐     ┌───────────┐     ┌──────────────────┐
│  iOS App    │────▶│ Supabase  │────▶│ Local Project    │
│  (voice)    │     │ (queue)   │     │ (.decibel/voice) │
└─────────────┘     └───────────┘     └──────────────────┘
                          │
                    voice_inbox_sync
```

1. **Capture**: Record voice on iOS → transcribed and sent to Supabase `voice_inbox` table
2. **Queue**: Messages wait in Supabase with `project_id` set
3. **Sync**: AI session calls `voice_inbox_sync` to pull messages to local `.decibel/voice/inbox/`
4. **Process**: Messages get routed to appropriate tools (wishes, issues, learnings, etc.)

## Setup for Existing Repos

### 1. Ensure Project is Registered

Your project must be in the Decibel registry:

```bash
# Check if registered
npx decibel registry list

# If not registered, initialize
npx decibel project init --path /path/to/your/repo
```

Or via MCP:
```
project_init with path: "/path/to/your/repo"
```

### 2. Create Voice Directory

The voice inbox needs a local directory:

```bash
mkdir -p /path/to/your/repo/.decibel/voice/inbox
```

Or Claude will create it automatically on first sync.

### 3. Add to CLAUDE.md

Add the sync instruction to your project's `CLAUDE.md`:

```markdown
## Voice Inbox Protocol

At session start, sync voice messages:
```
voice_inbox_sync with project_id: "your-project-id"
```

This pulls pending messages from Supabase → local `.decibel/voice/inbox/`.
```

### 4. Configure iOS App

In the Decibel Tools iOS app:
1. Go to Settings
2. Set your default project ID
3. Voice messages will be tagged with this project

## Syncing Messages

### At Session Start

Claude should automatically sync when starting a session:

```
voice_inbox_sync with project_id: "your-project-id"
```

### Manual Sync

You can also ask Claude to sync anytime:
> "Check for voice messages"
> "Sync my voice inbox"

### Sync Output

```yaml
synced: 3           # New messages pulled
skipped: 0          # Already existed locally
errors: 0           # Failed to sync
items:
  - id: voice-20260104-1234-abc
    transcript: "Add a wish for better error messages"
    intent: add_wish
    status: synced
```

## Voice Intents

The system parses your voice into these intents:

| Say This... | Intent | Routes To |
|-------------|--------|-----------|
| "Add a wish for..." | `add_wish` | `dojo_add_wish` |
| "Log an issue about..." | `log_issue` | `sentinel_createIssue` |
| "I learned that..." | `record_learning` | `learnings_append` |
| "Friction: it's annoying that..." | `log_friction` | `friction_log` |
| "Crit: I noticed..." | `log_crit` | `designer_crit` |

Or use the iOS app's intent buttons for explicit routing.

## Troubleshooting

### Messages Not Syncing

1. **Check project ID matches**: iOS app and sync call must use same ID
2. **Check Supabase connection**: MCP server needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
3. **Check messages exist**: Query Supabase directly to verify

### Processing Fails

1. **Check intent parsing**: Low confidence intents may need manual override
2. **Check target tool exists**: Some intents route to specific tools

### View Pending Messages

```
voice_inbox_list with project_id: "your-project-id", status: "queued"
```

## Projects Ready for Voice

All registered projects now have voice directories:

| Project | ID | Voice Status |
|---------|-----|--------------|
| Senken Trading Agent | `senken-trading-agent` | Ready |
| Decibel Tools MCP | `decibel-tools-mcp` | Ready |
| Decibel Studio | `decibel-studio` | Ready |
| Deck (MTG) | `deck` | Ready |
| Fuligin Guardian | `fuligin` | Ready |
| Decibel Tools Mobile | `decibel-tools-mobile` | Ready |
| Studio iOS | `studio-ios` | Ready |
| Pokedeck | `pokedeck` | Ready |
| Decibel Tools | `decibel-tools` | Ready |

## Quick Start Checklist

- [ ] Project registered in Decibel registry
- [ ] `.decibel/voice/inbox/` directory exists
- [ ] CLAUDE.md has voice sync protocol
- [ ] iOS app configured with project ID
- [ ] Test: send voice message, sync, verify
