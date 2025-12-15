# DOJO-EXP-0001: MCP Tool Registration Validator

## Proposal

DOJO-PROP-0001

## Type

check

## Problem

server.ts has 2000+ lines with tool definitions in ListToolsRequestSchema and handlers in CallToolRequestSchema. When adding tools, it's easy to add a definition but forget the handler (or vice versa), causing runtime errors.

## Hypothesis

Static analysis can detect mismatches between tool definitions and handlers, catching errors before runtime.

## Running

```bash
# Sandbox mode (default) - writes only to dojo/results/
decibel dojo run DOJO-EXP-0001

# Enabled mode - requires explicit enablement
decibel dojo enable DOJO-EXP-0001
decibel dojo run DOJO-EXP-0001 --enabled
```

## Results

Results are written to `dojo/results/DOJO-EXP-0001/<timestamp>/`
