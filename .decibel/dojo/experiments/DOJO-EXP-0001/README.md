# DOJO-EXP-0001: Voice Input for Decibel Commands

## Status: Production-Ready (Ungraduated)

The voice input system is fully implemented and integrated with the MCP server, but remains an ungraduated Dojo feature until real-world usage validates the approach.

## Proposal
DOJO-PROP-0001

## Problem
No hands-free way to interact with Decibel - adding wishes, logging issues, searching artifacts all require typing. Friction slows capture of ideas in the moment.

## Hypothesis
Using on-device speech-to-text (SFSpeechRecognizer pattern from ios-studio) + AI intent parsing, we can route voice input to the right Decibel action without complex command grammars

## What Was Built

### 1. Voice MCP Tools (`src/tools/voice.ts`)

Four new MCP tools for voice interaction:

| Tool | Description |
|------|-------------|
| `voice_inbox_add` | Add transcript to inbox, auto-parse intent |
| `voice_inbox_list` | List queued/completed inbox items |
| `voice_inbox_process` | Process a queued item by routing to correct tool |
| `voice_command` | Direct processing without inbox storage |

### 2. Intent Parsing

Pattern-based intent detection that routes to existing tools:

| Intent | Triggered By | Routes To |
|--------|--------------|-----------|
| `add_wish` | "wish:", "I wish we had..." | `dojo_add_wish` |
| `log_issue` | "issue:", "bug with..." | `sentinel_createIssue` |
| `search` | "find...", "where is...", questions | (queued for AI) |
| `ask_oracle` | "roadmap status", "progress" | (queued for AI) |
| `log_crit` | "crit:", "I noticed..." | `logCrit` |
| `log_friction` | "friction:", "frustrating that..." | `friction_log` |
| `record_learning` | "learned:", "TIL..." | `learnings_append` |

### 3. Voice CLI (`bin/decibel-voice`)

Bash CLI for voice capture on macOS:

```bash
# Process text directly
decibel-voice --text "wish: better error messages"

# List inbox
decibel-voice --inbox

# Process queued item
decibel-voice --process voice-20251230-...
```

### 4. Voice Inbox Storage

Persistent YAML files in `.decibel/voice/inbox/`:

```yaml
id: voice-20251230-0405-a1b2
transcript: "I wish we had dark mode"
source: voice_cli
status: completed
intent: add_wish
intent_confidence: 0.9
result:
  tool_called: add_wish
  tool_result: { wish_id: "WISH-0010", ... }
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Voice Input Architecture                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐  │
│  │ Voice CLI    │───▶│ Voice Inbox  │───▶│ Intent Parser    │  │
│  │ (whisper)    │    │ (.decibel/)  │    │ (pattern match)  │  │
│  └──────────────┘    └──────────────┘    └────────┬─────────┘  │
│                                                    │            │
│                                                    ▼            │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    Existing MCP Tools                    │   │
│  │  dojo_add_wish │ sentinel_createIssue │ logCrit │ ...   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Running the Experiment

```bash
cd /Volumes/Ashitaka/Documents/GitHub/decibel-tools-mcp
npx ts-node .decibel/dojo/experiments/DOJO-EXP-0001/run.ts
```

## Results
Results will be written to `.decibel/dojo/results/DOJO-EXP-0001/`

## What's Next

1. **iOS App (WISH-0009)**: Mobile voice capture with SFSpeechRecognizer
2. **AI-Powered Intent**: Replace pattern matching with LLM for better accuracy
3. **Search Integration**: Implement semantic search for `search` and `ask_oracle` intents
4. **Whisper Integration**: Add local Whisper for better transcription

## Graduation Criteria

- [ ] 30+ days of real-world usage
- [ ] Search/oracle intents implemented
- [ ] iOS app validates mobile capture pattern
- [ ] Intent accuracy > 90% on diverse inputs
