---
context: onboarding / license setup
frequency: occasional
impact: high
status: open
source: human
signal_count: 1
created_at: 2026-07-11T15:28:31.565Z
last_reported: 2026-07-11T15:28:31.565Z
tags: []
---

# Onboarding a new pro user is clunky and manual. Installing @decibelsystems/tools creates no config — no postinstall hook, and loadConfig() returns defaults without writing a file. The user must hand-create ~/.decibel/config.yaml and paste the license key. On top of that, provisioning the key itself is manual (insert a row into the Core Supabase licenses table), and the license validation ref was stale/hardcoded. We need a one-click / single-command setup (e.g. `decibel setup <key>` or an interactive init) that provisions the key and writes the config in one step.

Onboarding a new pro user is clunky and manual. Installing @decibelsystems/tools creates no config — no postinstall hook, and loadConfig() returns defaults without writing a file. The user must hand-create ~/.decibel/config.yaml and paste the license key. On top of that, provisioning the key itself is manual (insert a row into the Core Supabase licenses table), and the license validation ref was stale/hardcoded. We need a one-click / single-command setup (e.g. `decibel setup <key>` or an interactive init) that provisions the key and writes the config in one step.

## Context

**Where:** onboarding / license setup
**Frequency:** occasional
**Impact:** high
**Reported by:** human

## Current Workaround

Manually mkdir -p ~/.decibel and write config.yaml with the license key by hand; provision the key via a manual SQL insert into the Core licenses table.

## Signal Log

- 2026-07-11T15:28:31.565Z [human] Initial report
