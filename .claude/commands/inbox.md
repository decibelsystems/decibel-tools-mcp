# Check Voice Inbox

Sync and display the voice inbox for this project.

## Instructions

1. First, sync the inbox from Supabase (if configured):
   - Use `voice_inbox_sync` with project_id: "decibel-tools-mcp"
   - If Supabase isn't configured, proceed to step 2

2. List all inbox items:
   - Use `voice_inbox_list` with project_id: "decibel-tools-mcp"

3. Summarize the results:
   - Show count of queued vs completed vs failed items
   - For queued items: show transcript, intent, and ask if I should process them
   - For completed items: brief summary of what was created
   - For failed items: show error and suggest retry

4. If there are queued items, ask: "Would you like me to process these?"
