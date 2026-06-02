# Discussion: Supabase vs. Git as the cross-machine transport

**Date**: 2026-06-02
**Status**: Open — partially overtaken by ADR-0007
**Author**: drafted with Claude during a triage session

The question that prompted this: *"Should we fix ISS-0102 (.mcp.json Supabase env for fresh clones) or is that patching a layer we're about to replace?"* — and underneath it, the broader strategic question of whether Supabase or git should be the foundation for cross-machine / enterprise deployment.

This doc is for thinking out loud, not a decision artifact. It captures the actual architecture, lays out the realistic options, and notes the trade-offs. **Recommendation is the user's call, not mine** — but I've flagged the option I'd lean toward at the end.

> **Update before reading**: this doc was drafted under the assumption that "files are the system of record, Supabase is only transport." That premise is **incomplete** as of ADR-0007 (accepted 2026-05-24, locked by Ben) — there is now a `Store` abstraction (`FsStore` for solo/dev with git-tracked `.decibel/`, `SupabaseStore` for hosted multi-tenant SaaS under org-scoped RLS) selected by `DECIBEL_STORE` config. So for hosted SaaS, **Supabase IS the system of record** (with RLS doing tenant isolation), not just transport. The decision this doc still informs is narrower than its title suggests:
>
> 1. **FsStore (solo/dev) deployments** — Options A/B below remain live. The agentic dispatch queue is already file-based; the agent write-back queue and voice inbox are still Supabase-mediated even when the store itself is local files.
> 2. **SupabaseStore (hosted) deployments** — most of the queue-vs-store question dissolves: writes go directly through the Store API under RLS, the `agent_queue` intermediate isn't needed. Voice still sits on Supabase by necessity (iOS sync).
>
> The "Enterprise lens" section is partly resolved by ADR-0007 — hosted SaaS already has a multi-tenant enterprise story via SupabaseStore + RLS. The remaining live question is whether the FsStore *write-back queue* is worth keeping on Supabase or worth replacing with a git-based mechanism.

---

## What the architecture *actually* is today

I went in assuming "the queue is on Supabase". That's only partly true. There are **three separate queues** with **two different architectures**, and the conflation is what made the ISS-0102 question feel bigger than it is.

| Queue | Direction | Backend today | Already git-native? |
|---|---|---|---|
| **Agentic dispatch** (`agentic_enqueue` → jobs) | HQ → agent | `.decibel/agentic/jobs/*.yml` (local files) | ✓ Yes |
| **Agent write-back** (`agent_queue` table) | Remote agent → local store | Supabase → `agentic queue_sync` → local files | No |
| **Voice inbox** | iOS → local store | Supabase → `voice_inbox_sync` → local files | No |

And the **core knowledge store** (issues, epics, ADRs, roadmap, friction, learnings, dojo, designer) is already entirely in `.decibel/` markdown + YAML. Zero Supabase. Already in git. This is the most important fact — CLAUDE.md's principle "Supabase as queue, local files as source of truth" is literally how the code is structured.

### So the question isn't "are we on Supabase or git?"

The system of record is *already* on git. The question is **how data moves between machines** when (a) HQ on one laptop wants to dispatch work to an agent on another, (b) a remote agent's writes need to reach the local repo, or (c) the iOS voice app's notes need to reach the laptop.

That's a **transport** question, not a **storage** question. Three transports are realistic:

1. **Supabase** (the status quo for write-back + voice).
2. **Git** (commits and pulls as the message bus).
3. **Same filesystem** (shared FS, network mount, iCloud Drive folder) — works for some scenarios, not all.

---

## Option A — Status quo, fix ISS-0102

**Keep Supabase for write-back + voice. Don't touch dispatch (it's already local files). Just fix the `.mcp.json` env issue so fresh clones / worktree agents work.**

### What this looks like
- `.mcp.json` gains a split: committed `.mcp.json` with non-secret env, gitignored `.mcp.local.json` with Supabase URL + key
- ISS-0102's recommended fix, ~30 minutes
- Everything keeps working exactly as it does today
- Dispatch queue cross-machine still requires manual setup (shared FS, or `git pull` cadence)

### Strengths
- **Zero refactor risk**. Everything that works keeps working.
- **Voice on iOS is already solved** — iOS → Supabase is a well-trodden mobile sync pattern. Push notifications, offline queueing, background sync all work out of the box.
- Write-back queue has working idempotency, retry, and observability via Supabase Studio.
- The smallest possible step that unblocks the stop-hook + worker we just shipped.

### Weaknesses
- Adds a third-party dependency to enterprise pitch ("you need a Supabase account / on-prem Supabase deploy").
- Two transports to maintain long-term (file-based dispatch + Supabase write-back + Supabase voice).
- Doesn't move the project toward the "git is the foundation" direction.
- The Supabase env problem (ISS-0102 root cause) is symptomatic of a deeper issue: secrets management across worktrees / fresh clones is a real ops cost.

### When this is the right call
- If a Supabase dependency is acceptable for enterprise (or the enterprise plan offers on-prem Supabase).
- If the iOS voice integration is high-value enough that breaking it isn't acceptable.
- If you want to keep moving on features (Mother facade, distribution, etc.) rather than refactor transport.

---

## Option B — Replace the agent write-back queue with git; keep voice on Supabase

**Replace `agent_queue` table with `.decibel/agentic/writes/*.yml` files committed by remote agents to a branch; mirror the agentic dispatch queue's file-based pattern. Voice inbox stays on Supabase because mobile is special.**

### What this looks like
- Remote agent commits a YAML file to a branch (`agent-writes/<agent-id>/<timestamp>-create-issue.yml`)
- Local `git pull` picks it up
- `agentic queue_sync` becomes a function that scans the local branch (or stash) for new write-files and applies them
- The Supabase `agent_queue` table is deprecated (with a migration window)
- Voice stays on Supabase — iOS doing git is not realistic without significant native-app investment

### Strengths
- **Removes Supabase from the most common cross-machine path** (HQ ↔ headless agents). Half the cross-machine traffic is now git.
- **Native audit trail** — every remote write is a git commit. Enterprise compliance love this. Who, when, why, exactly what changed.
- **Offline-first** — a remote agent without network can still commit; the writes sync when network returns.
- **Permissions are already git-native** — branch protection, code review, signed commits, deploy keys all just work.
- Reduces the "ISS-0102-shape" surface area (one less Supabase-credentialed surface).

### Weaknesses
- **iOS still needs Supabase** for voice — you don't actually delete the Supabase dep.
- Real engineering work — designing the file format, the write-apply path, conflict resolution, garbage collection. Probably 2–4 weeks for a solid first version.
- Git as a queue has well-known gotchas: ordering across concurrent agents needs design (per-agent branches? lockfiles? sequence numbers?), garbage collection (you don't want infinite `agent-writes/` accumulation), and replay semantics.
- Existing `agent_queue` consumers (HQ?, remote agents in production?) need a migration path.
- More moving parts in the "agent submits a write" flow than a simple `INSERT INTO agent_queue VALUES (…)`.

### When this is the right call
- If enterprise sales conversations are running into the Supabase dependency as a real objection.
- If the audit-trail story is differentiated value for the buyer persona.
- If you have 2–4 weeks of engineering capacity to invest before re-prioritizing features.
- If you want to stay on the "Supabase as queue" → "git as queue" evolution arc deliberately rather than drift into it.

---

## Option C — All-git, including voice (long-tail)

**Replace everything with git, including voice. iOS commits voice notes to a per-device branch via libgit2 (or a small server-side helper).**

This is the "no Supabase anywhere" option. It removes the third-party dependency entirely but is **significantly more work** — iOS as a git client is non-trivial, push notification triggers need to be rebuilt against a git transport (probably a thin webhook server), and the offline/sync UX in the iOS app needs a rewrite.

**My honest take**: this isn't the right next step. Voice is the only path where Supabase is genuinely earning its keep — mobile sync is its sweet spot. The cost of moving it isn't justified by purity alone. Reserve this for a future enterprise tier where customers explicitly demand "no third-party SaaS dependencies" and are willing to pay for it.

I'm including it for completeness, not as a serious option for now.

---

## Trade-off matrix

| Factor | A (Status quo + fix) | B (Git for write-back) | C (All-git) |
|---|---|---|---|
| Time to unblock current work | 30 min | 2–4 weeks | 6+ weeks |
| Risk of breaking existing flows | Very low | Medium | High |
| Removes Supabase from enterprise pitch | No | Partial | Yes |
| Native audit trail for agent writes | No | Yes | Yes |
| Works for iOS voice | Yes (today) | Yes (unchanged) | Requires major iOS work |
| Offline-first remote agents | Limited | Yes | Yes |
| Long-term ops burden | Two transports | One + voice | One |
| Aligns with "Supabase as queue, files as truth" principle | Mixed | Yes | Yes |

---

## The enterprise lens

The user-stated motivation is that git is "a foundation for enterprise". A few honest observations about that framing:

- **Enterprise buyers care about audit, compliance, on-prem deploy, and SSO** — not specifically about "git". Git happens to deliver audit and on-prem easily, which is why it's a good *means*. The "end" is the buyer needing to point compliance at something they can reason about.
- **Supabase has an enterprise/on-prem story** (Supabase Enterprise, self-hosted via Docker). It's not a blocker — but it is a procurement conversation, vendor security review, and a separate uptime contract. Git is something every enterprise already has.
- **The split system of record (already git) + transport (Supabase) is hard to explain on a sales call**. Unifying on git makes the architecture story tighter: "Your data is in your git repo. Your agents commit to it. You audit it like any other code."
- **One legitimate counter**: enterprises that already deploy Supabase (most data-team-heavy companies do) may *prefer* a Supabase-backed transport because it integrates with their existing data warehouse / BI / monitoring stack. The "git everything" pitch can actually be a negative to that buyer.

So "git as enterprise foundation" is a real story, but it isn't a slam dunk. The strongest version of the argument is: *make the system of record visibly, demonstrably git-native, then let customers choose Supabase or git for the transport.* Option B is closer to that than Option A.

---

## What I'd lean toward (acknowledging it's your call)

**Option A now, Option B as a deliberate Q3 epic** — not because Option B is wrong, but because of the sequencing:

1. **Land ISS-0102** (~30 min). The auto-pickup hook we just made robust is partially broken for fresh clones / worktrees today. Fixing that is uncomplicated and immediate.
2. **Spike Option B in a dojo proposal** within the next 2 weeks. Real architecture sketch: file format for queued writes, branch strategy, conflict resolution, replay semantics, observability story. Cost the implementation honestly.
3. **Decide for Option B at end of spike** — knowing the actual shape, not the imagined one. If the spike reveals it's cleaner than feared → schedule the build. If it's messier than hoped → at least we have the artifact for the next time the question comes up.
4. **Voice stays on Supabase** indefinitely. The cost-benefit for moving voice is genuinely bad.

This avoids the trap of *either* "fix ISS-0102 then never seriously consider git" (Option A indefinitely by default) *or* "start the git refactor without scoping it" (Option B sized by hope).

---

## Open questions for you

These are the things only you can answer that materially change the recommendation:

1. **How often is the Supabase dependency coming up in enterprise conversations?** Once? Often? If often → bump Option B's priority.
2. **Is HQ currently writing to the dispatch queue cross-machine?** (i.e., HQ on machine A enqueuing a job for an agent on machine B). If yes — what transport does it use today (manual git, shared FS, something else)? This affects how urgent cross-machine dispatch sync is.
3. **Is anyone using the `agent_queue` write-back path in production right now?** Volume? If high → migration is non-trivial. If low → spike is much easier.
4. **What's the time horizon for the enterprise pitch?** Quarter? Year? Drives whether a 2–4 week refactor is timely or premature.
5. **Are you the only iOS user, or is there a real fleet?** If just you — voice on Supabase is a personal-productivity tool, lower stakes. If real users — voice stability is sacred.

---

## Concrete first step under each option

| If you pick | Do this first |
|---|---|
| Option A | Implement ISS-0102 (`.mcp.json` split + `.mcp.local.example.json`) — ~30 min, single PR. |
| Option B | File a dojo proposal: "Git-native agent write-back queue (replaces `agent_queue` table)" with the architecture sketch. Spike the file format + branch strategy. ~3–5 days for the proposal. |
| Both (recommended) | Do ISS-0102 in the next hour. Schedule the dojo proposal for next week. |
| Option C | Don't, yet. Revisit when an enterprise customer explicitly demands no-SaaS. |

---

## What's NOT in scope here

- **Replacing Postgres for senken/mother** — those are app-tier domain databases (trading data, advice snapshots). Different problem, different decision.
- **License validation** — `src/license.ts` uses Supabase for license-key lookup. That's a separate decision; could move to git-signed license files or could stay.
- **Studio cloud-spine** — `src/tools/studio/cloud-spine.ts` is the Studio cross-device sync. Same shape as voice (mobile-ish, sync-heavy). Same recommendation: keep on Supabase unless we commit to all-git.
