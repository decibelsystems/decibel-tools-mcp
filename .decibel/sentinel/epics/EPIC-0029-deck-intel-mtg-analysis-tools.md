---
id: EPIC-0029
projectId: decibel-tools-mcp
title: Deck Intel — MTG Analysis Tools
summary: Enhanced the deck module from 4 basic tools to 10 analysis tools. Added format-aware deal finding, tribal/archetype type search, multi-filter price bracket queries, set EV analysis (via deck_set_stats RPC), price volatility scoring (broad scan via deck_volatility_scores RPC + single-card CV analysis), and cross-printing reprint arbitrage detection. Also switched from requiring DECK_SUPABASE_KEY to bundling the anon key (tables have public SELECT RLS).
status: planned
priority: medium
tags: [deck, mtg, supabase, analysis]
owner: 
squad: 
created_at: 2026-03-26T20:36:15.299Z
---

# Deck Intel — MTG Analysis Tools

## Summary

Enhanced the deck module from 4 basic tools to 10 analysis tools. Added format-aware deal finding, tribal/archetype type search, multi-filter price bracket queries, set EV analysis (via deck_set_stats RPC), price volatility scoring (broad scan via deck_volatility_scores RPC + single-card CV analysis), and cross-printing reprint arbitrage detection. Also switched from requiring DECK_SUPABASE_KEY to bundling the anon key (tables have public SELECT RLS).

## Motivation

- Cards table has rich columns (legalities JSONB, type_line, mana_cost, rarity) that were barely queried
- No way to find budget cards legal in a specific format
- No tribal/archetype search capability
- No set-level EV analysis for pack cracking decisions
- No price volatility or stability scoring
- No cross-printing arbitrage detection

## Outcomes

- 6 new tools: format_deals, type_search, price_bracket, set_analysis, volatility, reprints
- 2 Supabase RPC functions created: deck_set_stats, deck_volatility_scores
- Shared validation helpers: validateFormat, validateRarity, gradeStability
- Anon key bundled — no env var required for read-only deck access
- All 10 tools exposed via deck facade in definitions.ts

## Acceptance Criteria

- [ ] All 10 deck tools compile and appear in MCP tool list
- [ ] Format validation prevents PostgREST injection via legalities path
- [ ] Set analysis uses server-side RPC for efficient aggregation
- [ ] Volatility broad scan uses real CV-based scoring via RPC
- [ ] Reprints fallback suggests partial matches when no exact match found
