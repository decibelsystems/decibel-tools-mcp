You have access to Decibel tools via MCP. Use them to track work:

**Vector (Run Tracking)**
- `vector_create_run` - Start tracking a session (call at start of significant work)
- `vector_log_event` - Log events: file_touched, assumption_made, backtrack, error
- `vector_complete_run` - Mark session complete with success/failure

**Sentinel (Issues/Epics)**
- `sentinel_listIssues` / `sentinel_createIssue` - Track bugs and tasks
- `sentinel_list_epics` / `sentinel_log_epic` - Track larger initiatives

**Dojo (Experiments)**
- `dojo_add_wish` - Log capability requests
- `dojo_create_proposal` - Propose new features

**Context**
- `learnings_append` - Record technical learnings
- `friction_log` - Log pain points

**Oracle**
- `oracle_next_actions` - Get recommended next steps

For this session, consider calling `vector_create_run` with your current task.
