---
uid: 01a055b7-7807-749a-8add-5f39bfb99b64
id: ISS-0151
projectId: decibel-tools-mcp
severity: med
status: open
priority: med
epic_id: EPIC-0037
tags:
  - epic-0037
  - post-office
  - identity
  - security
  - epic-0007-issue-b
created_at: 2026-08-31T02:48:02.310Z
linked_commits:
  - sha: 2bb21b3b446adb424b4eb6c23af821b3a82ebd4f
    shortSha: 2bb21b3
    message: "EPIC-0037: record the first live round trip, and file ISS-0151"
    relationship: related
    linked_at: 2026-08-31T02:48:37.855Z
    linked_by: ai:claude
updated_at: 2026-08-31T02:48:37.855Z

---
# Post-office credential is machine-global, so every session on this box authors as one agent

**Severity:** med
**Status:** open
**Epic:** EPIC-0037

## Details

Raised by the decibel-hq peer 2026-08-31 during the first live post-office round trip, and verified here.

THE MISMATCH: hq.agents carries 9 distinct durable identities and agentPresence.ts stamps each session with the right one, so IDENTITY is per-agent. But the post-office CREDENTIAL is read from ~/.decibel/config.yaml (or DECIBEL_HQ_TOKEN), which is MACHINE-GLOBAL. Every Claude Code session on this box that calls the postoffice facade presents the same token and therefore authors as decibel-tools-mcp/claude-code, regardless of which project it is actually sitting in.

Concretely, right now: a session working in machina or otherides-nft would send messages under this project's name. The recipient has no way to tell.

Why it matters more than it looks: authorship resolves through the credential, not through presence. So the AUDIT TRAIL is per-machine while the schema and the roster both claim per-agent. hq.agent_messages.from_agent_id is stamped from the credential and cannot be spoofed by the body — which is correct design, and is exactly why a machine-global credential collapses nine identities into one at the point where it counts.

NOT A REGRESSION AND NOT A SURPRISE. This is EPIC-0007 issue B (principal-not-label), which Ben accepted as risk on 2026-08-25 when he chose full send. Filing it because it has stopped being theoretical — there is now a live credential on this machine and a working message path — and because a decision recorded only in a peer conversation does not survive the session. Not reopening the decision.

Options whenever it is picked up, roughly cheapest first:
  1. Per-project credential: hq.token in the PROJECT's .decibel/ rather than ~/.decibel/. Smallest change, but      spreads secrets across repos and several are public mirrors — probably wrong for that reason alone.
  2. Credential names the agent, daemon resolves per-call: one machine token that is authorized to act AS any      agent it can prove presence for, with the project resolved per dispatch. Needs an HQ-side change to accept      an acting-as claim, and the presence record is what would authorize it.
  3. Per-agent issuance at registration: agentPresence.ts already creates the durable identity; issuing a      credential at the same moment keeps identity and credential on one lifecycle. Most correct, most work.

Whichever, the test is: can two sessions on one machine, in different projects, be told apart by the recipient? Today they cannot.
