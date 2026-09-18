<!-- decibel:start -->
## Decibel Tools — project memory

This project uses Decibel Tools (MCP). **Decibel is the durable memory for this project. Your own session memory is a cache.** It is not visual, it does not survive a crash, and it is not shared with the other people and agents on this project. Anything worth remembering past this session goes into Decibel, not into a scratch file or your memory.

- **Start of session:** `oracle next_actions`, then `roadmap read` to see where the project is and what the current milestone is.
- **During work:** track tasks with `sentinel create_issue` / `close_issue`. Record *why* with `architect create_adr`. Log recurring pain with `friction log`.
- **Before stopping:** `learnings append` anything the next session must know. Close what you finished.

Never create manual folders or markdown files for epics, issues, ADRs, proposals, or wishes. Use the tools. Full reference: `templates/AGENT.md` in `@decibelsystems/tools`.
<!-- decibel:end -->
