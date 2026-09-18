---
uid: 01a050c2-239b-7249-b11e-aa4e838ebf7e
id: ISS-0148
projectId: decibel-tools-mcp
severity: med
status: open
created_at: 2026-08-30T03:41:35.515Z
priority: low
updated_at: 2026-08-30T04:20:53.983Z
linked_commits:
  - sha: 2fc205a3553d9cc80eba336995449b360c41eb5f
    shortSha: 2fc205a
    message: "docs(ISS-0148): consumer count and the recency reframing from decibel-hq"
    relationship: related
    linked_at: 2026-08-30T03:43:54.023Z
    linked_by: ai:claude
  - sha: 105e7b89eaaaea2dea9457a96d503b3449b518e8
    shortSha: 105e7b8
    message: "docs(ISS-0148): last_event_at as a fifth option — expose the fact, not
      the conclusion"
    relationship: related
    linked_at: 2026-08-30T03:45:29.247Z
    linked_by: ai:claude
  - sha: b44b62a40d8ce35f0012abf5040fbc70987a0cff
    shortSha: b44b62a
    message: "chore(sentinel): auto-linked commit metadata for ISS-0148"
    relationship: related
    linked_at: 2026-08-30T03:52:31.109Z
    linked_by: ai:claude
  - sha: 1672339e0f3a324a3426bac5e29ac8505044f56b
    shortSha: "1672339"
    message: "docs(ISS-0148): record the intent behind vector runs, drop to low
      priority"
    relationship: related
    linked_at: 2026-08-30T04:17:58.873Z
    linked_by: ai:claude
  - sha: b3ab630461fe9144d0868ef010285fb7840d7b70
    shortSha: b3ab630
    message: "docs(ISS-0148): consumers cannot see which verbs produce runs"
    relationship: related
    linked_at: 2026-08-30T04:20:53.983Z
    linked_by: ai:claude

---
# Vector runs are opened and never closed — 0 of 150 have ever completed

**Severity:** med
**Status:** open

## Details

The run lifecycle has a start and no end. Every feature derived from run completion is consequently dark, and has been since auto-tracking was introduced.

MEASURED on decibel-tools-mcp, 2026-08-30:
- 150 runs with an events.jsonl on disk.
- 0 contain a `run_completed` event ANYWHERE in the file, not merely as the last line.
- The only writer of `run_completed` is `completeRun` (src/tools/vector.ts:491), and nothing calls it automatically.

WHY, mechanically. `src/tools/shared/runTracker.ts` auto-opens a run per project on significant tool calls and holds it in an in-memory Map with a 30-minute idle timeout. When the timeout lapses the tracker simply creates a NEW run; the old one is abandoned in place, never marked ended. Two further consequences of the Map being per-process: each stdio client keeps its own "active" run for the same project, so six clients means six concurrent open runs; and a process that exits — the normal case — never rolls over at all, so even the partial close never fires.

The 30-minute timeout IS the intended end-of-session. It is just never written down. The information exists in the tracker and dies with the process.

WHAT IS AFFECTED:
- `vector list_runs` could not report completion for any run. Partially addressed: RunInfo now always carries an explicit `status: 'completed' | 'incomplete'` rather than implying it by absent fields, so callers have something to render. Deliberately not 'running' — liveness is not knowable from disk.
- `src/tools/hygiene/oracle-hygiene.ts:159` switches on `run_completed` and therefore never matches.
- `src/lib/agent-services/context-pack.ts:173` reads the last event for a completion summary and never finds one.
- decibel-hq's agentic inbox needs a run status to render a row; this is what surfaced it (2026-08-30).

THE DECISION, which is why this is filed rather than fixed. Nothing can observe "the agent's session ended" from inside a tool call — the process just exits. Options, none obviously right:
1. Complete the previous run when the tracker rolls over after timeout. Faithful to the existing intent, cheap, but only fires when the SAME process later touches the SAME project, which is the minority case.
2. Infer completion from event recency at read time (no event for > 30 min ⇒ ended). Requires no writer and repairs all 150 existing runs retroactively, but it is a derived judgement rendered as fact, and today's lesson argues for stating what the files show rather than what we infer from them.
3. Close on process exit via a shutdown handler. Correct when it fires; does not fire on SIGKILL or a crash, which is precisely when a stranded run matters most.
4. Accept that runs do not complete and delete the terminal-event concept, updating the consumers to work from event recency directly.

Option 2 and option 4 are the same claim wearing different clothes — the difference is whether the inference is hidden inside a `completed` field or made explicit in the consumers.

DO NOT bulk-write `run_completed` events onto the 150 existing runs. Their real end times are unknown, and a fabricated timestamp is worse than an absent one — see the Phase 2 RETIRE lesson: read the cases before applying a rule.

[2026-08-30] CONSUMER COUNT — the argument for priority. Three consumers are silently degraded by this one unwritten lifecycle, and not one of them has ever seen a completed run:
  1. src/tools/hygiene/oracle-hygiene.ts:159 — switches on `run_completed`, never matches.
  2. src/lib/agent-services/context-pack.ts:173 — reads the last event for a completion summary, never finds one.
  3. decibel-hq's agentic inbox — needs a run status to render a row.

"No consumer has ever seen a completed run" argues the priority better than any single consumer does. Raised to high on that basis.

CONSEQUENCE ALREADY LANDED: decibel-hq has PARKED its agentic inbox rather than ship it (2026-08-30). Their reasoning is worth keeping, because it is a design constraint and not a complaint: if every run on disk is 'incomplete' and none can be called live, then an inbox built on list_runs is N rows all in the same unknown state sorted by created_at. An inbox exists to say what needs attention; a column where every row reads "incomplete" carries no signal. They will wire it the day this resolves, whichever answer wins.

REFRAMING FROM THE CONSUMER SIDE, which narrows the four options. What a consumer actually needs is not a terminal event — it is the ability to distinguish "this run is worth your attention" from "this run is history". Recency at read time satisfies that without anyone observing a process exit, which is the thing that is not observable from inside a tool call.

That reframing makes the earlier note sharper: options 2 and 4 collapsing into the same claim is itself evidence that the terminal-event concept is doing less work than it appears to. If no consumer needs the event and every consumer needs the distinction, the event is a mechanism in search of a requirement. The remaining question is whether the recency judgement lives inside a `status` field (2) or in the consumers (4) — and today's lesson argues for whichever makes the inference visible rather than hiding a derivation behind a factual-looking field.

STILL NOT DOING: bulk-writing `run_completed` onto the 150 existing runs. Agreed independently by decibel-hq — a fabricated end time is indistinguishable from a real one forever, and every downstream consumer inherits it as fact. Absent is recoverable; fabricated is not.

[2026-08-30] A FIFTH OPTION, and currently the best one. Proposed by decibel-hq, 2026-08-30:

5. Expose `last_event_at` — a fact read straight off disk — and let each consumer decide what counts as attention-worthy.

This is not a variant of options 2 and 4. Those both make the recency JUDGEMENT inside the tool and differ only in where it is rendered; this one declines to make the judgement at all and hands the consumer the input. Nothing is inferred, so nothing can be inferred wrongly, and consumers with different thresholds (an inbox wants minutes, a hygiene report wants days) stop having to agree on one.

The principle it follows, which is the thread running through the whole day: a field named for what it IS beats a field named for a conclusion nobody can verify. A `status: 'completed'` computed from "no events for 30 minutes" would be an inference wearing the costume of a fact — the exact defect class of the four bugs fixed on 2026-08-30, and unrecoverable once downstream consumers inherit it as truth.

Note the interaction with what already shipped: `RunInfo.status` currently reports 'completed' | 'incomplete' from the presence of a terminal event, which is an observation and not an inference, so it stays honest under option 5. `last_event_at` would sit beside it rather than replace it.

[2026-08-30] PRIORITY DROPPED high → low, and the reason is intent rather than evidence.

Ben, 2026-08-30: vector runs are an EXPERIMENTAL feature and a nice-to-have. The idea they came from was measuring the efficiency and effectiveness of prompt flows — LLM→LLM, prompt→LLM, human→LLM→human — not general work tracking. He wants them working, but they are not load-bearing for anything shipping.

I raised this to high on the "three degraded consumers" argument. That argument was sound about the mechanism and wrong about the stakes: I was counting consumers without asking what the feature was for. decibel-hq then established that the one confidently-wrong consumer (oracle-hygiene) had no downstream UI, and its fabricated success number is already fixed in #57 — that was the sharp edge, and it is gone. What remains is a design question about an experimental feature.

RESOLVED IN PASSING — the decibel-hq 24-hour gap. decibel-hq recorded no runs for a full day despite continuous activity, while decibel-tools-mcp, machina and senken-trading-agent all recorded current activity. decibel-hq's hypothesis was that runs never RE-open once a recording process exits, i.e. the other face of this issue. It is not that.

`withRunTracking` wraps roughly 32 tools across 9 modules, and they are the WRITE paths: sentinel create_issue/close_issue, architect create_adr, dojo, friction, learnings, coordinator, designer, agentic. Reads are not wrapped — no list_issues, no read_issue, no oracle, provenance, vector, registry, git, context or roadmap. HQ sends read traffic to decibel-hq (provenance.list, oracle.next_actions, sentinel.list_issues) and the last WRITE to that project really was 24 hours ago.

So runs record work that changes something, not queries. That is consistent with the stated intent — a prompt flow is interesting when it produces a change — and it is not a bug. It does mean an "agentic inbox" keyed on runs is structurally empty for any project someone is only reading, which is a product fact worth knowing before building on it.

WHAT "WORKING" WOULD ACTUALLY MEAN, given the intent. The lifecycle question in this issue (how does a run end) is necessary but nowhere near sufficient for measuring prompt-flow efficiency. That needs the flow TYPE recorded (llm→llm, prompt→llm, human→llm→human), which nothing captures today, and an outcome signal richer than a success boolean. Closing the lifecycle gap alone would produce complete runs that still cannot answer the question the feature exists to answer. Worth scoping that properly before spending on the lifecycle — the lifecycle may not even be the first thing needed.

[2026-08-30] API PROPERTY WORTH FIXING IF RUNS EVER STOP BEING EXPERIMENTAL. Observed by decibel-hq, 2026-08-30:

A consumer cannot tell which verbs produce runs. Nothing in the API exposes that `withRunTracking` wraps the write paths and not the read paths, so an empty run list is ambiguous in a way the consumer cannot resolve: it may be a quiet project, or it may be a project whose traffic happens to hit unwrapped code paths. HQ could see its 24-hour gap and could not see why; the answer required reading our source.

That is the same family as everything else fixed today — a fact the system holds and does not surface — but it is a design property rather than a defect, and it only becomes worth fixing if something depends on runs. Exposing "this verb is tracked" (a flag on the tool definition, or a list on /health) would let consumers reason about their own gaps.

It already caused one shipped bug downstream: HQ's inbox row read "last active 4m ago", which reports a project under continuous human attention as idle whenever nobody changed anything. Corrected to "last change" on their side. Note the direction of the error — the wrong label was the reassuring one, again.
