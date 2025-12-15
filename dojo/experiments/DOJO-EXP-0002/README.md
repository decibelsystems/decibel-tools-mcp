# DOJO-EXP-0002: JSON Schema Validator

## Proposal

DOJO-PROP-0002

## Type

script

## Problem

Schema changes break integrations silently

## Hypothesis

Automated validation catches drift before deployment

## Running

```bash
# Sandbox mode (default) - writes only to dojo/results/
decibel dojo run DOJO-EXP-0002

# Enabled mode - requires explicit enablement
decibel dojo enable DOJO-EXP-0002
decibel dojo run DOJO-EXP-0002 --enabled
```

## Results

Results are written to `dojo/results/DOJO-EXP-0002/<timestamp>/`
