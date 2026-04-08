# Idea — Capture a Project Idea

Quickly capture a project-level idea — bigger than a wish, not yet concrete enough for a proposal or epic.

## Instructions

Parse the user's input to extract the idea. If `$ARGUMENTS` is empty, ask: "What's the idea?"

1. **Extract from input:**
   - **title** — short name for the idea (infer from input, 3-8 words)
   - **description** — the idea itself, in the user's words
   - **spark** — what prompted it? (conversation, problem, observation, random). Infer from context, default to "random"
   - **scope** — how big does this feel? (weekend, sprint, project, moonshot). Infer from context, default to "project"

2. **Save using Dojo:**
   - Use `dojo add_wish` with:
     - `capability`: the title, prefixed with `[IDEA]` so it's distinguishable from regular wishes
     - `reason`: the description
     - `context`: `"spark: {spark}, scope: {scope}"`
     - `mvp`: if the user hinted at a first step, capture it here
     - `success_metric`: if the user mentioned what success looks like, capture it

3. **Respond with:**
   - Confirm: "Idea captured: **{title}**"
   - Show the scope tag
   - If scope is "weekend" or "sprint", suggest: "This feels small enough to proposal — want me to `/idea promote` it?"

## Subcommands

### `/idea list`
List all ideas by running `dojo list_wishes` and filtering for items whose capability starts with `[IDEA]`. Display as a table with title, scope, and date.

### `/idea promote <title>`
Find the matching idea wish, then:
1. If scope is weekend/sprint → offer to create a `dojo create_proposal`
2. If scope is project/moonshot → offer to create a `sentinel log_epic`
Include the original idea description as context in the proposal/epic.

## Examples

**Input:** `/idea build a CLI dashboard that shows all project health in one terminal view`
**Action:** Save wish with capability `[IDEA] CLI project health dashboard`, reason from input, scope: "project", spark: "random"

**Input:** `/idea list`
**Action:** List filtered wishes

**Input:** `/idea promote CLI project health dashboard`
**Action:** Find the wish, offer to create a proposal or epic based on scope

## User Input

$ARGUMENTS
