# Research — Structured Research Request & Artifact

Run or delegate a research task (market scan, competitor analysis, feasibility study, entity mapping, fact verification) and produce a **parseable research artifact** — never loose notes.

This skill encodes the Decibel research peer's methodology so results are consistent whether the research peer runs it or you run it yourself. Spec seed: `researcher-peer/CLAUDE.md` + `researcher-peer/skills/SCHEMA.md` (envelope v0.2.0).

## Step 1 — Scope Before Searching

Answer these before any lookup. If the requester's ask is too broad, propose a scoped starting point instead of shallow coverage of everything.

- **Question**: the specific thing to find out
- **Decision supported**: what the requester will do differently based on the answer
- **Domain**: `market | competitor | feasibility | technical | entity-map | custom`
- **Done means**: what evidence closes the question
- **Depth/time bound**: quick scan vs. deep dive; when to stop digging and report gaps

## Step 2 — Delegate or Run

**Delegate if a research peer is online** (preferred — they have the specialized skill pack):

1. `mcp__claude-peers__list_peers` (scope: machine) — look for a peer advertising `"role":"researcher"`
2. Send the request via `send_message` using this shape:

```
RESEARCH REQUEST
QUESTION: <specific question>
DECISION SUPPORTED: <what this feeds>
DOMAIN: market|competitor|feasibility|technical|entity-map|custom
DONE MEANS: <evidence that closes it>
DEPTH: quick-scan | standard | deep-dive
VERTICAL CONTEXT: <free-form: platform constraints, communities, monetization, regulatory frame>
DELIVER AS: research artifact JSON (schema 0.2.0) + short prose summary
```

3. Continue other work; the reply arrives as a peer message. Do not re-ask while waiting.

**Run it yourself if no research peer is available**, following the methodology:

1. **Map entities first** — companies, products, people, technologies, markets, standards — before relationships.
2. **Discover relationships** — funding, acquisitions, licensing, technical lineage, partnerships, shared staff, influence chains.
3. **Verify facts** — cross-reference claims; mark uncertain connections as such. Never present speculation as fact. Distinguish "documented" from "my inference" — label each.
4. **Cite sources** — where each fact came from. "Common knowledge" is not a source.
5. **Time-bound** — if digging stops yielding new findings, report what you have and list the gaps. Don't spiral.

## Step 3 — Source Tiering (per claim)

- **primary**: official filings, original docs, source repos, direct quotes
- **secondary**: reputable press, industry analysis citing primaries
- **tertiary**: aggregators, forums, AI-search snippets

Rules:
- Treat AI-search snippets as **tertiary**; always chase the primary link before citing.
- A claim's confidence is capped by its best source: `high` needs multiple independent sources or a primary; `medium` = single source / widely reported but unverified; `low` = inferred or anecdotal.
- Note `paywalled: true` on sources the requester can't independently check.

## Step 4 — Emit the Artifact

Output BOTH: a one-paragraph prose summary for the human, and this JSON envelope (compatible with `researcher-peer/skills/SCHEMA.md` v0.2.0):

```json
{
  "type": "research",
  "schema_version": "0.2.0",
  "domain": "market|competitor|feasibility|technical|entity-map|custom",
  "scope": "what was researched and what decision it supports",
  "emitted_at": "ISO8601",
  "entities": [
    {"type": "company|product|person|technology|standard|market|community", "name": "...", "id_suggestion": "...", "key_facts": ["..."], "confidence": "high|medium|low"}
  ],
  "relationships": [
    {"source": "entity-a", "target": "entity-b", "type": "acquired|invested-in|licenses|competes-with|built-on|partnered-with|hired-from|influenced|forked", "details": "...", "confidence": "high|medium|low"}
  ],
  "timeline": {"start": "YYYY-MM", "end": "YYYY-MM", "key_moments": ["..."]},
  "findings": ["material facts the requester needs to act"],
  "risks": ["what could invalidate this"],
  "gaps": ["things that could not be verified or found"],
  "sources": [{"url": "...", "type": "primary|secondary|tertiary", "paywalled": false, "retrieved": "YYYY-MM-DD"}],
  "confidence": "high|medium|low",
  "summary": "one-paragraph synthesis tied to the original decision"
}
```

`gaps` is mandatory honesty: an empty gaps array on a non-trivial question is a smell.

## Step 5 — Land the Findings in Decibel

Never let research die in a chat transcript:

- **Always**: `learnings` — record the key finding(s) so future sessions can retrieve them
- **If it motivates work**: `sentinel create_issue` or `dojo add_wish` / `dojo create_proposal`
- **If it settles an architecture question**: `architect create_adr` citing the artifact
- **If it informs design**: `designer record_design_decision`

Include the artifact's `summary` and the strongest primary source in whatever you land.

## When to Use

- Before committing to a build direction (feasibility, competitor landscape)
- Pitch/deck prep needing verified market facts
- "Is X true?" fact-verification with citation requirements
- Mapping an unfamiliar domain's players and relationships

## Related

- Research peer skill pack: `researcher-peer/skills/` (app-store-intel, social-listening, competitor-teardown, market-sizing, opportunity-brief)
- Wishes this skill serves: WISH-0016 (this skill), WISH-0018 (citation verification — do manually per Step 3 until tooled), WISH-0019 (brief registry — Step 5 is the interim)
