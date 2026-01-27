# Decibel Code Audit Prompt

Copy this prompt and paste it along with your code file for a structured audit.

---

## Universal Audit Prompt (Copy This)

```
You are a senior engineer performing a code health audit. Analyze the provided code for technical debt and maintainability issues.

## Audit Categories

### 1. STRUCTURAL SMELLS
- **God File**: Does this file handle multiple unrelated responsibilities? List each responsibility found.
- **God Function**: Any function > 50 lines or handling multiple concerns?
- **Deep Nesting**: Any nesting > 4 levels deep?

### 2. COUPLING SMELLS  
- **DIP Violations**: Does business logic directly reference external API field names, SDK specifics, or vendor details?
- **Leaky Abstractions**: Are implementation details (database columns, API shapes) exposed where they shouldn't be?
- **Hidden Dependencies**: Are there implicit dependencies (global state, singletons, environment assumptions)?

### 3. DUPLICATION SMELLS
- **Copy-Paste Code**: Similar logic in multiple places?
- **Structural Duplication**: Same pattern repeated with different details?

### 4. CONFIGURATION SMELLS
- **Magic Numbers**: Unexplained numeric values?
- **Hardcoded Strings**: URLs, paths, prompts, templates inline?
- **Hidden Rules**: Business logic that should be configurable?

### 5. LEGACY SMELLS
- **Dead Code**: Unused functions, unreachable branches?
- **Zombie Comments**: Commented-out code blocks?
- **Stale TODOs**: TODO/FIXME without resolution?

### 6. NAMING SMELLS
- **Vague Names**: data, info, result, temp, manager, handler, utils?
- **Inconsistent Conventions**: Mixed naming styles?
- **Misleading Names**: Names that don't match behavior?

### 7. MISSING SAFEGUARDS
- **No Error Handling**: Happy path only?
- **Hidden Side Effects**: Functions that mutate state, write files, or call external services unexpectedly?
- **Missing Validation**: Inputs trusted without checks?

## Output Format

For each issue found, provide:

| Field | Description |
|-------|-------------|
| **Location** | Function name and line number |
| **Smell Type** | Category from above |
| **Severity** | 🔴 High / 🟡 Medium / 🟢 Low |
| **Description** | What's wrong |
| **Suggested Fix** | Specific refactoring approach |
| **Effort** | S (< 1hr) / M (1hr-1day) / L (> 1day) |

## Final Summary

End with:
1. **Top 3 Priority Fixes** - What to fix first
2. **Structural Recommendation** - If file needs splitting, how?
3. **Quick Wins** - Easy fixes with high impact
4. **Technical Debt Score** - 1-10 (10 = pristine, 1 = rewrite needed)

---

CODE TO AUDIT:
```

---

## Specialized Prompts

### For Agent/LLM Code Specifically

```
Audit this AI/LLM agent code for common anti-patterns:

### Agent-Specific Smells

1. **God Agent**: Single entrypoint handling routing, retrieval, prompting, actions, and errors together
2. **Prompt Spaghetti**: Prompts constructed via string concatenation across multiple functions
3. **Hidden Prompt Logic**: Business rules embedded in prompt strings rather than code
4. **No Prompt Versioning**: Prompts not tracked or versioned
5. **Leaky Context**: Context window management mixed with business logic
6. **Missing Guardrails**: No input validation, output validation, or fallback handling
7. **Hardcoded Models**: Model names/versions inline rather than configurable
8. **No Evaluation Path**: No way to test prompt changes against expected outputs

For each issue:
- Location
- What's wrong
- Proposed separation of concerns
- Migration difficulty (easy/medium/hard)

CODE TO AUDIT:
```

### For API Integration Code

```
Audit this API integration code for coupling issues:

### Integration Smells

1. **Direct Field Access**: Business logic using external API field names directly
2. **Inline Transformation**: Data reshaping mixed with business logic
3. **Scattered Error Handling**: API-specific errors caught in multiple places
4. **Missing Adapter Layer**: No abstraction between external service and domain
5. **Retry Logic Duplication**: Same retry pattern copied across integrations
6. **Credential Handling**: API keys/tokens handled inconsistently
7. **No Circuit Breaker**: Missing failure isolation for external calls

For each violation:
- Which external service is leaking into business logic?
- What domain concept should replace the external detail?
- Proposed adapter interface

CODE TO AUDIT:
```

### For Refactoring Planning

```
I need to refactor this file. Create a migration plan.

### Analysis Required

1. **Responsibility Map**: List every distinct responsibility in this file
2. **Dependency Graph**: What imports this? What does this import?
3. **Change Frequency**: Which parts change most often? (guess based on complexity)
4. **Risk Assessment**: What could break if we restructure?

### Proposed Architecture

1. **New File Structure**: What files should this become?
2. **Interface Design**: What are the public interfaces between new modules?
3. **Migration Order**: Which pieces can be extracted first with least risk?
4. **Temporary Scaffolding**: What compatibility shims needed during migration?

### Step-by-Step Plan

Provide numbered steps I can execute incrementally, each leaving the code in a working state.

FILE TO REFACTOR:
```

---

## Quick One-Liners

### Find God Files
```
List all functions in this file with their line counts and primary responsibility. Flag any > 50 lines.
```

### Find Hidden Config
```
Extract all hardcoded values (numbers, strings, URLs, paths) that should probably be configuration. Output as a proposed config.yaml.
```

### Find Duplicates
```
Identify any code patterns that appear more than once. For each, propose a shared utility function.
```

### Generate Tests for Untested Code
```
This code has no tests. Generate pytest tests covering:
1. Happy path
2. One edge case
3. One error case

Focus on the public interface, not implementation details.
```

### Naming Cleanup
```
Review all variable, function, and class names in this file. Flag any that are:
- Too vague (data, info, result, temp)
- Inconsistent with each other
- Misleading about what they contain/do

Propose better names for each.
```

---

## Workflow Integration

### Before Starting New Feature
```
I'm about to add [FEATURE] to this codebase. Before I start:

1. Where should this code live given the current structure?
2. What existing code can I reuse?
3. What patterns should I follow for consistency?
4. What might I accidentally break?
```

### Before PR Review
```
Review this diff as a senior engineer. Check for:

1. Any new technical debt introduced?
2. Does this follow existing patterns or create new ones?
3. Are there tests for the new behavior?
4. Any hardcoded values that should be config?
5. Any copy-paste that should be extracted?

Be specific and actionable.
```

### Post-Incident
```
This code caused a production incident: [DESCRIBE INCIDENT]

Analyze:
1. What code smell or missing safeguard allowed this to happen?
2. What test would have caught this?
3. What monitoring would have detected this sooner?
4. What structural change would prevent similar issues?
```
