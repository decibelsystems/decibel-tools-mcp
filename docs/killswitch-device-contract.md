# Kill switch — device contract

**Status:** stable. Firmware may be built against this.
**Implements:** ISS-0178. **Consumers:** tactus ISS-0005 (binding + read-back), ISS-0006 (watchdog).

This document exists because firmware outlives conversations. The interface below is also
described in a pull request and in source comments; **this file is the reference**, and if
the three ever disagree, this one is wrong and should be corrected to match the tests in
`tests/unit/killSwitch.test.ts`, which are the actual authority.

---

## What the switch does

Engaging the stop makes **unattended work** refuse:

- the agentic queue replay (writes authored elsewhere, replayed into local files unwatched)
- the dojo experiment runner (spawns a script and walks away)

**Interactive calls keep working, deliberately.** After a stop, the first thing anyone does
is ask what went wrong, and that takes the read tools. A stop that blinded the operator
would be a worse instrument than no stop.

It is an **operational brake, not a security control.** Anything that can write to
`~/.decibel` can clear it.

---

## Interface A — over HTTP (the considered path)

For controls that can reach the daemon and want to attribute a press richly.

```
POST http://127.0.0.1:<port>/batch
Content-Type: application/json

{"calls":[{"facade":"killswitch","action":"stop",
           "params":{"reason":"...","actor":"tactus","source":"device"}}]}
```

| Action | Blocked while stopped? | Notes |
|---|---|---|
| `stop` | n/a | Idempotent — a second press reports the **first** stop, unchanged |
| `resume` | **never** | See the invariant below |
| `status` | **never** | Returns `stopped` plus who / when / why |

**Do not hardcode the port.** Read it from `~/.decibel/daemon.meta` → `"port"`. It has moved
before (ADR-0006).

If the daemon is down, this interface does not work. That is acceptable for a considered
control and **not** acceptable for an emergency one — which is why Interface B exists.

---

## Interface B — the file (the emergency path)

For any control that must work when the software is the wedged thing. **The scenario a
physical stop exists for includes the daemon being unresponsive**, so an emergency control
must not depend on what it is stopping.

Write one file:

```
~/.decibel/killswitch.json

{
  "stopped": true,
  "stopped_at": "2026-09-19T18:20:00Z",
  "actor": "runstop-button",
  "source": "device",
  "reason": "physical RUN/STOP pressed"
}
```

**Field rules, exactly:**

| Field | Required | Rule |
|---|---|---|
| `stopped` | yes | Only the **literal boolean** `true` engages. `"true"`, `"yes"`, `1` all read as **running** — deliberately, so the brake never depends on spelling |
| `stopped_at` | no | ISO 8601. Shown in the refusal |
| `actor` | no | Defaults to `unattributed`. See the diagnostic note below |
| `source` | no | Free-form origin, e.g. `device` |
| `reason` | no | Shown in the refusal |

**To release:** write `{"stopped": false}` or delete the file. Both work.

**Write atomically** — write to a temp file, then rename. A press may land while something
is reading, and a half-written file must never be observable as either state.

**This path needs no daemon and no MCP.** It is tested that way: a hand-written file with
nothing else in the loop engages the brake and produces the full refusal.

---

## Invariants firmware may rely on

1. **You can never stop yourself out of resuming.** `resume` and `status` are never gated.
   This holds *by construction* — nothing in the gate consults itself — not by an exception
   list that a refactor could drop.

2. **State is re-read on every check.** A press is observed immediately by work already
   running; nothing needs restarting. Tests exist specifically to prevent this being
   "optimised" into a cache, because the symptom would be a dead button appearing months
   after the change and nowhere near it.

3. **`status` never lags a completed write.** Write-then-rename plus an uncached read means
   a read starting after a write always sees it. Measured: 200 write-then-immediately-read
   cycles, zero stale reads, worst round trip 1.39 ms.

4. **A second press preserves the first.** Original `reason`, `actor` and `stopped_at` are
   kept. A control gets pressed twice, and the first press is the true one.

5. **An unreadable or corrupt state file reads as RUNNING.** See the seam below — this one
   is a constraint, not a convenience.

---

## Two seams, stated rather than hidden

### Fail-open is deliberate, and it does not deliver fail-safe on its own

A corrupt state file reads as RUNNING. A brake that jams on would halt every unattended job
on the machine with no way to diagnose it except editing the very file that is broken.

**Consequence for normally-closed wiring:** a cut cable or unplugged module cannot write a
file, so NC wiring alone does **not** produce STOP ASSERTED. Delivering that promise requires
a **host-side watchdog** that writes `stopped: true` when an enrolled module goes silent.

That watchdog is the device side's to build. It needs no API from here — it writes the same
file the button writes, because Interface B is not a special case, it *is* the contract.

Its stop should be attributed honestly:

```json
{"stopped": true, "actor": "tactus-watchdog", "reason": "module went silent"}
```

An unattributed stop sends someone hunting for a press that never happened, which is exactly
how people stop trusting a switch.

### Only HALT exists

A three-gesture control (tap / hold / guard+strike) maps to this facade **only at the first
level**:

| Gesture | Maps to | Status |
|---|---|---|
| HALT — stop unattended work | `killswitch.stop` | **exists** |
| KILL — terminate running processes | — | **nothing to call** |
| HARD STOP — latch, revoke credentials, autonomy ceiling to 0 | — | **nothing to call** |

This is a **scale statement, not a gap to close cheaply**: Decibel has no process registry to
terminate against, no credential revocation path, and no autonomy-ceiling concept anywhere.
Three separate capabilities, not three parameters. Do not read the three actions above as
covering three gestures.

**Latching is out of scope here by design.** A latch that no software path may release is the
exact inverse of invariant 1. It belongs as hardware-held state gating re-arm, *outside* this
flag — which keeps the device's latch authoritative and this invariant intact, with neither
side needing to know the other's mechanism.

---

## Scope, when it comes

Per-agent kill vs global kill is the stop-the-queue vs stop-everything distinction. It will
arrive as a **field beside `reason` and `source`**, never as a fourth action: the device
writes intent, the gates read it, and one contract keeps serving both a dial and a person.

Nothing about a device that writes `{"stopped": true}` changes when it lands.

---

## If the contract appears to be violated

Report it upstream rather than working around it locally. A local workaround for, say, an
observed flicker would bury a caching bug in this repo inside device firmware, where it
becomes a hardware defect months later and gets "fixed" by someone who never reads the test
that was supposed to prevent it.
