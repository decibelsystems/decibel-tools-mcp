# Zoom fixtures — HAND-BUILT, NOT CAPTURED

These are written from the observed shape of rendered output plus the field
names the Python reads. No API response was captured to produce them.

Verified against real data (safe to test as fact):
- The list envelope keys the script reads: `summaries`, `next_page_token`,
  `total_records`, and per-entry `meeting_uuid`, `meeting_id`, `meeting_topic`,
  `meeting_start_time`, `summary_start_time`.
- The detail shape is modern `summary_content` markdown.
- Section ordering inside `summary_content`: Quick recap, then Next steps with
  per-person `###` groups, then Summary with `###` topic groups.
- Task permalinks appended inline to Next-steps bullets, carrying the meeting
  UUID url-encoded (`==` as `%3D%3D`).
- `meeting_uuid` value `lgoqel38SxWZZ6kiYgSYlw==` is real, taken from disk.

NOT verified, deliberately absent:
- The deprecated split shape (`summary_overview`, `summary_details[]`,
  `next_steps[]`). Never observed on this account. Build that path from Zoom's
  docs and mark it unverified rather than fixturing it here.
- A uuid starting with `/` or containing `//`, which is what triggers the
  double-encode branch. None of the 26 files on disk have one.

Meeting content is synthetic. Host ids and emails are placeholders.

## Files

- `list-page1.json` — first page, `next_page_token` populated, exercises the loop
- `list-page2.json` — final page, empty token, terminates the loop
- `detail-summary-content.json` — one meeting detail, modern shape

The two list pages carry four meetings between them: two whose topic matches a
`plasiv` needle, one that matches nothing (routes to unrouted), and one with no
summary body available, which the script counts as `empty` and never writes.
