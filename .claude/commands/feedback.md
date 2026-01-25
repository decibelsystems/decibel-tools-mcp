# Decibel Tools Quick Feedback

Submit quick feedback on Decibel tools and workflows.

## Usage

Parse the user's input to extract:

**sentiment** - Look for:
- Positive: `+`, `good`, `great`, `helpful`, `love`, `awesome`, `nice`, `works`, 👍
- Negative: `-`, `bad`, `broken`, `slow`, `frustrating`, `hate`, `confusing`, 👎
- Default to positive if unclear

**tool_ref** - Any tool name mentioned (e.g., `workflow_preflight`, `sentinel_list`, `feedback_submit`)

**category** - Infer from context:
- `tool` - if a specific tool name is mentioned
- `workflow` - for process/workflow feedback
- `docs` - for documentation feedback
- `ux` - for usability/experience feedback
- `perf` - for performance feedback
- `other` - if unclear

Then call `feedback_submit` with the extracted values and `source: "human"`.

## Examples

**Input:** `/feedback + preflight`
**Action:** `feedback_submit category:"tool" feedback:"+ preflight" tool_ref:"workflow_preflight" sentiment:"positive"`

**Input:** `/feedback - ship is slow`
**Action:** `feedback_submit category:"perf" feedback:"- ship is slow" tool_ref:"workflow_ship" sentiment:"negative"`

**Input:** `/feedback good feedback tools`
**Action:** `feedback_submit category:"tool" feedback:"good feedback tools" sentiment:"positive"`

**Input:** `/feedback - docs confusing`
**Action:** `feedback_submit category:"docs" feedback:"- docs confusing" sentiment:"negative"`

## User Input

$ARGUMENTS
