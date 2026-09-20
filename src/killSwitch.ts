/**
 * The kill switch — one durable STOP for unattended work (ISS-0178).
 *
 * WHAT IT STOPS, AND WHAT IT DELIBERATELY DOES NOT. The metaphor is a machine
 * tool's big red button: it halts the automation, it does not power down the
 * panel. Unattended work — the agentic queue replaying remote writes, the dojo
 * experiment runner spawning a script — refuses while stopped. Interactive
 * calls keep working on purpose, because the first thing anyone does after
 * hitting stop is ask what went wrong, and that takes sentinel, oracle and this
 * module itself.
 *
 * THE SAFETY INVARIANT. You can never stop yourself out of resuming. That holds
 * BY CONSTRUCTION rather than by an exception list: nothing in this file gates
 * itself, and enforcement lives at the call sites of the work being stopped.
 * There is no path where `resume` consults the flag it is trying to clear.
 *
 * WHY A FILE, AND WHY THIS FILE. State lives at ~/.decibel/killswitch.json:
 *
 *   - machine-global, because a button on a desk is machine-global. Stopping
 *     "the project you happen to be in" is not what a red button means.
 *   - a file, so it survives a daemon restart, a crash, and a reboot. A stop
 *     that forgets itself is worse than no stop, because it teaches people the
 *     switch is unreliable.
 *   - plain JSON with no schema tricks, so a process that is not this one — a
 *     shell script, a microcontroller, a future physical button — can read and
 *     write it without linking anything.
 *
 * WHAT IT IS NOT. It is not a security control. Anything that can write to
 * ~/.decibel can clear it. It is an operational brake for work you started, in
 * the same spirit as the daemon's own PID file.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

/** Machine-global, deliberately — see the header. */
export const KILL_SWITCH_PATH = path.join(os.homedir(), '.decibel', 'killswitch.json');

export interface KillSwitchState {
  /** The only field a reader strictly needs. */
  stopped: boolean;
  /** Why, when stated. A button has no keyboard, so this is optional by design. */
  reason?: string;
  /** Who pressed it: an agent id, a person, or 'button' for the physical one. */
  actor?: string;
  /** ISO timestamp of the stop that is currently in force. */
  stopped_at?: string;
  /** Free-form origin, e.g. 'mcp', 'http', 'device'. Useful when a stop surprises someone. */
  source?: string;
}

const RUNNING: KillSwitchState = { stopped: false };

/**
 * Read the current state, treating every failure as RUNNING.
 *
 * FAIL-OPEN IS THE RIGHT CHOICE HERE and it is worth saying why, because the
 * opposite is defensible and wrong for this case. A corrupt or unreadable
 * killswitch file would, under fail-closed, halt all unattended work on the
 * machine with no way to diagnose it except editing the very file that is
 * broken — a brake that jams on is worse than one that does not engage. The
 * stop is an operational convenience, not a safety interlock, and it says so in
 * the header.
 *
 * Note this is the one place the module is deliberately quiet: a missing file
 * is the overwhelmingly common case (nobody has ever pressed stop) and must not
 * be noise.
 */
export function readKillSwitch(): KillSwitchState {
  try {
    const raw = fs.readFileSync(KILL_SWITCH_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as KillSwitchState;
    // Anything other than an explicit `true` is running. A file containing
    // `{"stopped":"yes"}` from a well-meaning script must not read as stopped,
    // because a truthy-string check would make the brake depend on spelling.
    return parsed.stopped === true ? parsed : RUNNING;
  } catch {
    return RUNNING;
  }
}

/** True when unattended work should refuse. */
export function isStopped(): boolean {
  return readKillSwitch().stopped;
}

/**
 * Engage the stop. Idempotent: a second press reports the FIRST stop rather
 * than overwriting it, because a button will be pressed twice and the original
 * reason and time are the ones worth keeping.
 *
 * @returns the state now in force, and whether this call is what engaged it
 */
export function engageStop(opts: { reason?: string; actor?: string; source?: string } = {}): {
  state: KillSwitchState;
  already: boolean;
} {
  const current = readKillSwitch();
  if (current.stopped) {
    return { state: current, already: true };
  }

  const state: KillSwitchState = {
    stopped: true,
    stopped_at: new Date().toISOString(),
    ...(opts.reason ? { reason: opts.reason } : {}),
    // An unattributed stop is allowed — a physical button cannot type — but it
    // is recorded as unattributed rather than silently attributed to whoever
    // happened to be running.
    actor: opts.actor || 'unattributed',
    ...(opts.source ? { source: opts.source } : {}),
  };
  writeState(state);
  return { state, already: false };
}

/**
 * Release the stop. Idempotent, and never gated — see the safety invariant.
 *
 * @returns the state that was cleared, when there was one
 */
export function releaseStop(): { released: KillSwitchState | null } {
  const current = readKillSwitch();
  if (!current.stopped) return { released: null };
  writeState(RUNNING);
  return { released: current };
}

function writeState(state: KillSwitchState): void {
  const dir = path.dirname(KILL_SWITCH_PATH);
  fs.mkdirSync(dir, { recursive: true });
  // Write-then-rename: a physical button may be pressed while something else is
  // reading, and a half-written file must never be observable as either state.
  const tmp = `${KILL_SWITCH_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, KILL_SWITCH_PATH);
}

/**
 * Thrown at the gate. Carries the stop's own reason and time so the refusal can
 * say WHY work stopped rather than merely that it did — the difference between
 * a legible brake and a mystery.
 */
export class KillSwitchEngagedError extends Error {
  readonly code = 'KILL_SWITCH_ENGAGED';
  readonly state: KillSwitchState;

  constructor(operation: string, state: KillSwitchState) {
    const when = state.stopped_at ? ` at ${state.stopped_at}` : '';
    const who = state.actor && state.actor !== 'unattributed' ? ` by ${state.actor}` : '';
    const why = state.reason ? ` — ${state.reason}` : '';
    super(
      `Kill switch engaged${when}${who}${why}. Refusing: ${operation}. ` +
        `Release it with killswitch.resume (never blocked), or delete ${KILL_SWITCH_PATH}.`
    );
    this.name = 'KillSwitchEngagedError';
    this.state = state;
  }
}

/**
 * The gate. Call at the top of anything that runs without someone watching.
 *
 * Takes the operation name so the refusal names what it refused — "agentic
 * queue replay" is actionable, "operation failed" is not.
 */
export function assertRunnable(operation: string): void {
  const state = readKillSwitch();
  if (state.stopped) throw new KillSwitchEngagedError(operation, state);
}

/**
 * Non-throwing form of {@link assertRunnable}, for call sites whose contract is
 * to RETURN an error rather than throw one.
 *
 * Both forms exist deliberately. `assertRunnable` suits functions that already
 * throw (agentQueueSync throws for unconfigured Supabase, so a throw is in
 * keeping); this suits functions that declare `Promise<Output | SomeError>`,
 * where throwing would be a lie about the signature and would behave
 * differently when called directly than when called through a handler that
 * catches. That divergence between the direct and dispatched path is a bug
 * shape this repo has been bitten by more than once.
 */
export function checkRunnable(operation: string): KillSwitchEngagedError | null {
  const state = readKillSwitch();
  return state.stopped ? new KillSwitchEngagedError(operation, state) : null;
}
