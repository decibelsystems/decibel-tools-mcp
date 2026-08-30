---
uid: 01a001bc-5aa7-7056-a7ab-25f62594d211
id: ISS-0125
projectId: decibel-tools-mcp
severity: low
status: open
epic_id: EPIC-0036
created_at: 2026-08-14T19:25:16.327Z
---

# Decide the Zoom auth model before selling meeting ingestion as a pro feature

**Severity:** low
**Status:** open
**Epic:** EPIC-0036

## Details

Strategic, not a code task. Blocks positioning this as a paid feature; does not block internal company use.

The puller uses Server-to-Server OAuth with meeting_summary:read:admin — an account-wide admin scope. One credential set reads every meeting in the Zoom account. For Decibel's own use that is fine (own account, own meetings). Sold to customers it forces a choice:

(a) Each customer stands up their own Server-to-Server OAuth app. Requires Zoom admin rights and a multi-step marketplace setup — high onboarding friction, and a hard stop for any user who is not a Zoom account admin.

(b) Decibel publishes a Zoom Marketplace OAuth app with user-level scopes plus hosted token exchange. That is a product with a review process and a hosted callback, not a tool port.

Decide before the internal implementation hardens around the admin-scope assumption — retrofitting user-level OAuth after the fact is more expensive than designing the credential layer for both now.

Note: multi-client routing (ISS-0122) is the agency-shaped differentiator and is entirely local, so it needs no marketplace review. It is worth building either way, independent of how this decision lands.
