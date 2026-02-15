---
projectId: decibel-tools-mcp
severity: low
status: open
created_at: 2026-02-15T08:45:59.607Z
---

# Wire up Stripe webhook for automatic license key generation

**Severity:** low
**Status:** open

## Details

Currently keys are manually inserted into Supabase licenses table. Set up a Stripe webhook that fires on subscription, generates a DCBL-XXXX key, inserts it, and emails it to the customer. Can be a Supabase Edge Function.
