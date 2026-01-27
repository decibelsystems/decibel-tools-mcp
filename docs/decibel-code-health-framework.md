# Decibel Code Health Framework

A structured approach to identifying and addressing technical debt in AI-accelerated development.

---

## Part 1: Code Smell Audit

### Quick Triage Checklist

Run through this for any file or module before shipping or during review:

| Smell | Check | Severity |
|-------|-------|----------|
| **God File** | Is this file > 300 lines? Does it handle multiple responsibilities? | 🔴 High |
| **Rule Sprawl** | Are there > 3 nested if/elif chains? Growing conditional logic? | 🔴 High |
| **DIP Violation** | Does business logic directly reference API field names, SDK methods, vendor specifics? | 🔴 High |
| **Duplicated Code** | Is similar logic copy-pasted in 2+ places? | 🟡 Medium |
| **Hidden Rules** | Are prompts, thresholds, or templates hardcoded inline? | 🟡 Medium |
| **Buried Legacy** | Is there commented code, unused imports, dead functions? | 🟡 Medium |
| **Naming Drift** | Do names follow the project truth table? | 🟡 Medium |
| **Missing Tests** | Is there test coverage for the happy path + 1 edge case? | 🟡 Medium |
| **Hidden Side Effects** | Do functions mutate state, write files, or call external services unexpectedly? | 🔴 High |
| **Hardcoded Values** | Are paths, IDs, URLs, or env-specific values embedded? | 🟡 Medium |

---

## Part 2: Naming Truth Table Template

Establish this per-project and keep it in the repo root or docs folder.

### Example Structure

```yaml
# naming-conventions.yml

entities:
  user:
    variable: user, current_user
    function_prefix: get_user, create_user, update_user
    class: User, UserProfile, UserService
    table: users
    api_field: user_id, user_email
    
  order:
    variable: order, current_order
    function_prefix: get_order, create_order, process_order
    class: Order, OrderService, OrderProcessor
    table: orders
    api_field: order_id, order_status

patterns:
  collections: plural (users, orders, items)
  single_item: singular (user, order, item)
  booleans: is_, has_, can_, should_ prefix
  async_functions: _async suffix or async_ prefix (pick one)
  private: _ prefix for internal methods
  constants: UPPER_SNAKE_CASE
  
anti_patterns:
  - data, info, manager, handler, utils (too vague)
  - temp, tmp, foo, bar (obviously)
  - abbreviations unless universal (ok: id, url, api | bad: usr, ord, cfg)
```

### Prompt for Generating Project-Specific Truth Table

```
Analyze this codebase and generate a naming truth table.

For each core entity/concept you identify:
1. How is it currently named as a variable?
2. How is it named in function names?
3. How is it named as a class?
4. How is it named in the database/API?

Flag any inconsistencies where the same concept uses different names.
Flag any names that are too generic (data, info, manager, handler, utils).

Output as YAML in the naming-conventions.yml format.
```

---

## Part 3: AI-Assisted Audit Prompts

### Prompt A: God File Detection & Decomposition Plan

```
Analyze this file for "god file" anti-patterns.

A god file violates the Single Responsibility Principle by:
- Handling multiple unrelated responsibilities
- Being the place where "everything happens"
- Having functions that don't conceptually belong together
- Being > 300 lines with mixed concerns

For this file:

1. **Responsibility Inventory**: List each distinct responsibility this file handles
2. **Dependency Map**: What does this file import? What imports it?
3. **Coupling Score**: How many other files would break if this file's interface changed?
4. **Decomposition Plan**: If splitting, what would the new files be?
   - Proposed file names
   - Which functions/classes move where
   - What shared utilities need extraction

5. **Migration Risk**: Rate low/medium/high - how risky is refactoring this?

Be specific. Reference actual function names and line numbers.
```

### Prompt B: Dependency Inversion Audit

```
Audit this code for Dependency Inversion Principle (DIP) violations.

DIP violations occur when high-level business logic depends directly on low-level implementation details:
- Hardcoded API field names in business logic
- Direct SDK/client method calls mixed with domain logic
- Vendor-specific error codes handled inline
- Data transformation tightly coupled to external service shapes

For each violation found:

1. **Location**: File, function, line
2. **Violation Type**: What external detail is leaking in?
3. **Blast Radius**: If the external service changes this detail, how many places break?
4. **Abstraction Proposal**: What adapter/interface would isolate this?

Example of violation:
```python
# BAD: Business logic knows about Stripe's field names
def process_payment(payment_data):
    if payment_data['stripe_charge_id']:  # Stripe-specific
        amount = payment_data['amount_cents'] / 100  # Stripe-specific format
```

Example of fix:
```python
# GOOD: Business logic uses domain concepts
def process_payment(payment: Payment):
    if payment.external_id:
        amount = payment.amount  # Already in dollars
        
# Adapter handles translation
class StripePaymentAdapter:
    def to_domain(self, stripe_data: dict) -> Payment:
        return Payment(
            external_id=stripe_data['stripe_charge_id'],
            amount=stripe_data['amount_cents'] / 100
        )
```

Audit the provided code and list all violations with proposed fixes.
```

### Prompt C: Hidden Rules & Configuration Extraction

```
Find all "hidden rules" in this codebase - logic that should be configurable but is hardcoded.

Hidden rules include:
- Magic numbers (thresholds, limits, timeouts)
- Hardcoded prompts or templates
- Environment-specific values (URLs, paths, IDs)
- Business rules embedded in code (pricing, limits, feature flags)
- Retry counts, batch sizes, rate limits

For each hidden rule found:

1. **Location**: File and line
2. **Current Value**: What's hardcoded
3. **Rule Type**: threshold | template | env_config | business_rule | operational
4. **Volatility**: How often might this need to change?
5. **Extraction Target**: Where should this live?
   - Environment variable
   - Config file (which one)
   - Database/feature flag system
   - Constants file with documentation

Output as a migration checklist with priority order.
```

### Prompt D: Duplicated Logic Finder

```
Identify duplicated or near-duplicated code in this codebase.

Look for:
- Copy-pasted functions with minor variations
- Similar patterns repeated across files
- Logic that should be a shared utility
- Error handling patterns repeated everywhere
- Data transformation logic duplicated

For each duplication found:

1. **Locations**: All files/functions containing the duplicate
2. **Similarity**: exact | near-exact | structural (same pattern, different details)
3. **Variation Points**: What differs between copies?
4. **Consolidation Proposal**: 
   - Proposed shared function/class name
   - Where it should live
   - How to parameterize the variations
5. **Risk**: What breaks if we consolidate wrong?

Prioritize by: frequency of duplication × likelihood of divergent changes
```

### Prompt E: Buried Legacy Logic Detector

```
Find buried legacy logic in this codebase - code that no longer serves its original purpose or encodes outdated assumptions.

Signs of buried legacy:
- Commented-out code blocks
- Functions that are defined but never called
- Conditional branches that can never execute
- TODO/FIXME/HACK comments older than 6 months
- Imports that aren't used
- Feature flags that are always on/off
- Workarounds for bugs that were fixed
- Code paths for deprecated integrations

For each legacy item found:

1. **Location**: File and line
2. **Type**: dead_code | obsolete_workaround | deprecated_feature | zombie_import
3. **Age Estimate**: Based on git blame or code style, how old is this?
4. **Confidence**: How sure are we this is actually dead?
   - definitely_dead: No references anywhere
   - probably_dead: Only referenced by other dead code
   - maybe_dead: Referenced but possibly obsolete
5. **Removal Risk**: What's the worst case if we're wrong?
6. **Recommendation**: delete | archive | investigate_first

Output as a cleanup checklist, safest deletions first.
```

---

## Part 4: Refactoring Decision Matrix

Use this to prioritize which smells to fix first.

### Scoring Factors

| Factor | Weight | 1 (Low) | 3 (Medium) | 5 (High) |
|--------|--------|---------|------------|----------|
| **Change Frequency** | 3x | Rarely touched | Monthly changes | Weekly changes |
| **Bug History** | 2x | No bugs | Occasional bugs | Frequent bugs |
| **Onboarding Pain** | 2x | Easy to understand | Needs explanation | Only original author knows |
| **Blast Radius** | 3x | Isolated | Few dependents | Core dependency |
| **Fix Effort** | -1x | > 1 week | 1-3 days | < 1 day |

### Priority Score Formula

```
Priority = (Change Frequency × 3) + (Bug History × 2) + (Onboarding Pain × 2) + (Blast Radius × 3) - (Fix Effort × 1)
```

### Triage Buckets

- **Score > 30**: Fix before next feature work
- **Score 20-30**: Schedule for next refactor sprint
- **Score 10-20**: Fix opportunistically when touching nearby code
- **Score < 10**: Document but don't prioritize

---

## Part 5: Pre-Merge Hygiene Checklist

Quick sanity check before any PR merges.

```markdown
## Pre-Merge Checklist

### Naming & Structure
- [ ] New names follow naming-conventions.yml
- [ ] No new god files created (or existing ones not made worse)
- [ ] New code lives in appropriate module (not just dumped in utils/)

### Dependencies & Coupling
- [ ] No new direct vendor/API dependencies in business logic
- [ ] External service interactions go through adapters
- [ ] No new hardcoded environment-specific values

### Rules & Configuration
- [ ] Magic numbers extracted to constants with documentation
- [ ] Prompts/templates in dedicated files, not inline strings
- [ ] Thresholds and limits are configurable

### Quality
- [ ] No copy-pasted logic (extract to shared utility if repeated)
- [ ] Happy path test exists
- [ ] At least one edge case test exists
- [ ] No new commented-out code

### Documentation
- [ ] Complex logic has inline comments explaining WHY
- [ ] Public functions have docstrings
- [ ] Breaking changes noted in PR description
```

---

## Part 6: Project Health Dashboard Prompt

Run this periodically (weekly/bi-weekly) to track trends.

```
Generate a code health report for this project.

## Metrics to Calculate

### Size & Complexity
- Total lines of code
- Number of files > 300 lines (god file candidates)
- Deepest nesting level found
- Longest function (by lines)

### Coupling
- Files with > 10 imports
- Files imported by > 10 other files
- Circular dependency chains

### Hygiene
- TODO/FIXME count
- Commented-out code blocks
- Unused imports count
- Functions with no callers

### Test Coverage
- Files with 0 test coverage
- Test-to-code ratio

### Trend (if previous report available)
- Which metrics improved?
- Which metrics degraded?
- New problem areas?

Output as a structured report with specific file callouts for the worst offenders in each category.
```

---

## Part 7: Continuous Integration Hooks

### Recommended CI Checks (from article)

| Check | Tool | What It Catches |
|-------|------|-----------------|
| Linting | `ruff` | Style, unused imports, common bugs |
| Type checking | `mypy` or `pyright` | Interface mismatches, None bugs |
| Tests | `pytest` | Behavior regressions |
| Secrets | `gitleaks` | Accidental credential commits |
| Dependencies | `pip-audit` / `safety` | Vulnerable packages |
| Complexity | `radon` | Functions too complex to maintain |
| Dead code | `vulture` | Unused functions and variables |

### Minimal Pre-commit Config

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.4.4
    hooks:
      - id: ruff
        args: [--fix]
      - id: ruff-format
  
  - repo: https://github.com/gitleaks/gitleaks
    rev: v8.18.2
    hooks:
      - id: gitleaks

  - repo: local
    hooks:
      - id: no-god-files
        name: Check for god files
        entry: bash -c 'find . -name "*.py" -exec wc -l {} + | awk "$1 > 300 {print \"GOD FILE: \" $2; exit 1}"'
        language: system
        types: [python]
```

---

## Appendix: Quick Reference Card

### The Big 6 Questions Before Shipping

1. **Could someone else understand this in 6 months?**
2. **If the external API changes, how many files break?**
3. **Where do I change X if requirements shift?** (Should be ONE place)
4. **What happens if this fails?** (Error handling, not just happy path)
5. **How would I know if this broke in production?**
6. **Is there a test that would catch a regression?**

### Red Flags in Code Review

- File length > 300 lines
- Function length > 50 lines
- Nesting depth > 4 levels
- Import list > 15 items
- Hardcoded strings that look like URLs, IDs, or prompts
- `# TODO`, `# HACK`, `# FIXME` without tickets
- Generic names: `data`, `result`, `temp`, `manager`, `handler`, `utils`
- Copy-pasted blocks with small variations
