---
uid: 01a0babe-c876-78ea-ab18-176f4811c138
id: ISS-0178
projectId: decibel-tools-mcp
severity: med
status: open
priority: high
tags:
  - killswitch
  - safety
  - unattended-work
  - daemon
  - feature
created_at: 2026-09-19T17:37:40.470Z
linked_commits:
  - sha: 3668d3383c41c09d8c7c856c418b31ba5964decf
    shortSha: 3668d33
    message: "sentinel: ISS-0178 — kill switch, one durable STOP for unattended work"
    relationship: related
    linked_at: 2026-09-19T17:37:47.130Z
    linked_by: ai:claude
updated_at: 2026-09-19T18:17:16.817Z
---
# Kill switch — one durable STOP that halts unattended work, reachable from a physical button

**Severity:** med
**Status:** open

## Details

WANTED. Ben, 2026-09-19: a RUN/STOP control, eventually a physical button on the desk —
press it and unattended work stops. The machine-tool metaphor is the right one: a big red
stop halts the automation, it does not power down the panel you need in order to diagnose
and restart.

WHY NOW, and the timing is not a joke. Today alone: a hook writing 47 MB and 110k lines
across 1,022 directories on a 94%-full volume, 168 runs opened and none ever closed, agents
messaging other agents unprompted, and a queue that replays remote writes into local files.
All of it unattended, none of it with an off switch that is not "find the process and kill
it".

DESIGN, and the first constraint is the one that makes this real rather than theatre: a
kill switch that sets a flag nothing reads is a surface that looks live and is not — the
exact failure shape this repo has been finding all week. So it ships with real consumers or
it does not ship.

  STATE: a single machine-global file, ~/.decibel/killswitch.json, plain JSON. Machine-wide
  because a button on a desk is machine-wide. A file because it must survive a restart, be
  readable by a process that is not this one, and be parseable by whatever cheap thing ends
  up behind the physical button.

  SCOPE OF THE STOP: unattended work only — the agentic queue replay and the dojo
  experiment runner to begin with. Interactive tool calls keep working, deliberately: you
  need sentinel, oracle and the kill switch itself to find out what went wrong and to
  release it.

  THE SAFETY INVARIANT: you can never stop yourself out of resuming. killswitch.status and
  killswitch.resume are never gated, by construction rather than by an exception list.

  ACCOUNTABILITY: a stop records who, when and why, and emits provenance. A stop with no
  reason is allowed — a button has no keyboard — but it is recorded as unattributed.

  IDEMPOTENT: pressing stop twice is a no-op that reports the original stop, not a new one.
  A button will be pressed twice.

PHYSICAL DEVICE, later and out of scope here, but the design has to leave room for it: the
device will POST to the daemon. The daemon binds 127.0.0.1 by design (ADR-0006), so a
device on the network cannot reach it without a deliberate exposure decision — that is a
separate call with real security weight, and this issue must not quietly pre-empt it. A
device attached to the same machine has no such problem.

ACCEPTANCE:
  - stop / resume / status work over stdio AND HTTP, since the button speaks HTTP
  - a stopped state blocks agentic queue replay and dojo experiment runs with a legible
    refusal naming the stop's reason and time, not a generic error
  - status and resume work while stopped, asserted
  - the state survives a daemon restart
  - a second stop does not overwrite the first
  - pressing stop with no daemon running still records (file-based, not daemon-based)

[2026-09-19] INTEGRATION TARGET NAMED. Ben, 2026-09-19: the physical control will be tactus — custom
hardware, driven through its touch dial. Device build comes first; nothing here is blocked
on it, and nothing here should be built for it yet.

ONE ASSUMPTION IN THE SHIPPED DESIGN IS NOW WRONG, in a good way. I wrote the actor field
around a dumb button — "a physical button cannot type", hence the unattributed default.
Tactus is not dumb: per its README it is a virtual keyboard system with a mapping engine,
layers, and macros (multi-step actions), with dial concepts already drawn
(dial-agentic-v1.png, dial-agentic-v3-thermal.png). So the device CAN supply attribution,
and a press should arrive as actor='tactus' (or the specific dial binding) with
source='device' rather than falling back to unattributed. The unattributed path stays as
the floor for anything cruder; it just stops being the expected case.

WHAT A DIAL AFFORDS THAT A BUTTON DOES NOT, recorded so the three-action surface is a
deliberate choice rather than an accident when someone revisits it. A dial is continuous and
has position; a button is binary and stateless. That invites scope selection — stop the
agentic queue, or experiments, or everything — and it invites hold-to-confirm. The facade
deliberately ships stop/resume/status and no more, because the value of a red button is that
there is nothing to learn before pressing it. If scope selection is wanted later, the state
file is the place it belongs (a `scope` field beside `reason` and `source`), NOT a fourth
action: the device writes intent into state, and the gates read it. That keeps one contract
for both a dial and a person.

WHAT TACTUS WILL NEED FROM US, when its turn comes — none of it built here:
  - a reachable endpoint. The daemon binds 127.0.0.1 (ADR-0006). Same-machine tactus is
    fine as-is; a networked dial needs a deliberate exposure decision with real security
    weight, and that decision is not this issue's to make.
  - the request shape, which already works and is verified:
      POST /batch {"calls":[{"facade":"killswitch","action":"stop",
                   "params":{"reason":"...","actor":"tactus","source":"device"}}]}
  - read-back for the dial's own indicator: killswitch.status returns stopped plus who/when/
    why, so the hardware can show state rather than assume it. A dial that shows STOP while
    the system is running is worse than no indicator.

[2026-09-19] TWO CONTROLS, NOT ONE — and this corrects my previous note. Ben, 2026-09-19: there will be
the tactus touch dial AND a purpose-built RUN/STOP button. I had written that attribution
from tactus makes the unattributed path "stop being the expected case". Wrong: a dedicated
button is exactly that case, and it is the more important of the two.

THEY HAVE DIFFERENT FAILURE REQUIREMENTS, which is the whole design point:

  DIAL (tactus)          rich, attributed, scope-capable. Speaks HTTP to the daemon.
                         If the daemon is down the dial does not work — acceptable,
                         because it is the considered path, not the emergency one.

  RUN/STOP BUTTON        must work when the daemon is the wedged thing. The scenario a
                         physical stop exists for INCLUDES the software being unresponsive,
                         so the button must not depend on what it is stopping. Its only
                         requirement is the ability to write one JSON file.

THIS RETRO-JUSTIFIES THE FILE. ~/.decibel/killswitch.json being plain JSON on disk was
written up as convenience — readable by a microcontroller, survives restarts. With a
dedicated button in the picture it is load-bearing: the file IS the interface for the
control that has to work when nothing else does.

PROVEN, not assumed. A hand-written state file, no daemon and no MCP involved, engages the
brake and produces the full refusal:

    Kill switch engaged at 2026-09-19T18:20:00Z by runstop-button
      — physical RUN/STOP pressed. Refusing: dojo experiment run.

REFACTOR HAZARD, now pinned by tests. The gates re-read the file on EVERY check. That looks
like an obvious thing to optimise — cache it at module load, memoise the read — and the
symptom of doing so would be a dead physical button, showing up nowhere near the cache and
long after the change. Two tests now assert out-of-band engagement and release, including a
"hot" reader that has already observed the running state before the file changes underneath
it. Anyone who adds caching will fail those instead of shipping a brake that does not brake.

STILL OUT OF SCOPE HERE: both devices. Reachability for a networked control remains a
deliberate security decision (ADR-0006, 127.0.0.1 bind), and a same-machine button writing
the file directly sidesteps it entirely — which may be the better answer for the RUN/STOP
precisely because it removes the network from the emergency path.

[2026-09-19] TACTUS ANSWERED, from their repo rather than from intent. Three outcomes.

SAME MACHINE, settled. The module is USB-attached through the Tactus connector system — HID
vendor page, driverless, no network in the path. Interface B (write the file directly) is
correct and they explicitly do NOT want the daemon exposed past 127.0.0.1 for this. ADR-0006
stays unspent. A networked variant, if it ever comes, arrives as its own proposal with its
own security argument rather than as a quiet requirement from a device.

READ-BACK CONFIRMED, and the drift case is the SHIPPING configuration. The dial has a real
display (apps/tactus-config/DialDisplay.tsx), their spec already says stopped renders as
"dial goes cold blue", and their plan has BOTH a standalone kill switch module AND an
integrated guarded toggle. So two controls changing state independently is the normal case,
not an edge case, which is exactly why status returns who/when/why rather than a bare
boolean.

Their flicker worry is measured and closed: status cannot lag a completed write. engageStop
does write-then-rename, readKillSwitch does a fresh uncached read, so a read starting after
a write always sees the new state. 200 write-then-immediately-read cycles, zero stale reads,
worst round trip 1.39 ms. Their 250 ms is polling interval, not staleness. If a flicker is
ever observed it means something started caching a read that must not be cached — which the
out-of-band tests now prevent.

TWO GAPS RECORDED RATHER THAN SOLVED.

1. FAIL-SAFE HAS A SEAM, and tactus raised it themselves rather than letting their copy
   carry it. Their hardware promises normally-closed wiring: a cut cable or unplugged module
   should read as STOP ASSERTED. But a cut cable cannot write a file, and this reader treats
   unreadable as RUNNING by design. So NC wiring only delivers fail-safe with a host-side
   watchdog that writes stopped:true when an enrolled module goes silent. That watchdog is
   theirs and they have logged it. Nothing for us to build or change — it writes the same
   file the button writes, because interface B is not a special case, it IS the contract.
   The fail-open read stays as is.

2. ONLY ONE OF THEIR THREE GESTURES MAPS TO ANYTHING THAT EXISTS. Their spec is tap=HALT,
   hold=KILL, guard+strike=HARD STOP. HALT is what this facade does. KILL (terminate running
   processes) and HARD STOP (latch, revoke credentials, force the autonomy ceiling to zero)
   have nothing to call — and this is not a small addition: Decibel has no process registry
   to terminate against, no credential revocation path, and no autonomy-ceiling concept at
   all. Three separate capabilities, not three parameters. Recorded so the facade's three
   actions are never read as covering their three gestures.

LATCH — resolved cleanly and worth keeping as precedent. Their HARD STOP latches, and their
spec says no software path may un-stop it. That is the exact inverse of this issue's central
invariant, where resume is never blocked by construction. Their resolution, which I would
have argued for: the latch is separate hardware-held state gating re-arm, NOT a mode of this
flag. Both properties stay true at once, and neither side has to know the other's mechanism.
An invariant kept by drawing the boundary in the right place rather than by compromising it.

Tracked on their side as tactus ISS-0005 against EPIC-0005.
