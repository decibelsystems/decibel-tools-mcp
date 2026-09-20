// ============================================================================
// The kill switch — ISS-0178
// ============================================================================
// Three properties are worth pinning, because each is the kind a later
// simplification removes without noticing:
//
//   1. You can never stop yourself out of resuming. If this breaks, the only
//      way back is editing a JSON file by hand, which is precisely what a
//      button on a desk exists to avoid.
//   2. A second press does not overwrite the first. A button WILL be pressed
//      twice, and the original reason and time are the ones worth keeping.
//   3. An unreadable state file reads as RUNNING. Fail-open is deliberate and
//      contested, so it is asserted rather than left to be re-litigated by
//      whoever next reads the file: a brake that jams on halts every unattended
//      job on the machine with no way to diagnose it except fixing the broken
//      file.
//
// The state is machine-global by design, so these tests point KILL_SWITCH_PATH
// at a temp HOME rather than touching the real one.
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

let tmpHome: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'decibel-killswitch-'));
  vi.spyOn(os, 'homedir').mockReturnValue(tmpHome);
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

/** Imported fresh each time so KILL_SWITCH_PATH picks up the mocked homedir. */
async function load() {
  return import('../../src/killSwitch.js');
}

describe('kill switch', () => {
  it('reads as running when nothing has ever been pressed', async () => {
    const ks = await load();
    expect(ks.isStopped()).toBe(false);
    expect(ks.readKillSwitch()).toEqual({ stopped: false });
  });

  it('engages, and the state survives being read by a separate reader', async () => {
    const ks = await load();
    const { state, already } = ks.engageStop({ reason: 'runaway job', actor: 'ben' });

    expect(state.stopped).toBe(true);
    expect(already).toBe(false);
    expect(ks.isStopped()).toBe(true);

    // Read the file directly, the way a shell script or a microcontroller
    // would — the whole reason state is a plain JSON file.
    const onDisk = JSON.parse(fs.readFileSync(ks.KILL_SWITCH_PATH, 'utf-8'));
    expect(onDisk.stopped).toBe(true);
    expect(onDisk.reason).toBe('runaway job');
    expect(onDisk.actor).toBe('ben');
    expect(onDisk.stopped_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('records an unattributed stop rather than inventing an actor', async () => {
    const ks = await load();
    // A physical button cannot type a name.
    const { state } = ks.engageStop({});
    expect(state.actor).toBe('unattributed');
    expect(state.stopped).toBe(true);
  });

  describe('pressed twice', () => {
    it('keeps the FIRST reason, actor and timestamp', async () => {
      const ks = await load();
      const first = ks.engageStop({ reason: 'the real reason', actor: 'ben' }).state;
      const second = ks.engageStop({ reason: 'panic', actor: 'someone else' });

      expect(second.already).toBe(true);
      expect(second.state.reason).toBe('the real reason');
      expect(second.state.actor).toBe('ben');
      expect(second.state.stopped_at).toBe(first.stopped_at);
    });
  });

  describe('the safety invariant — never stop yourself out of resuming', () => {
    it('reports status while stopped', async () => {
      const ks = await load();
      ks.engageStop({ reason: 'x' });
      // Must not throw, must not refuse.
      expect(ks.readKillSwitch().stopped).toBe(true);
    });

    it('releases while stopped, and says what it released', async () => {
      const ks = await load();
      ks.engageStop({ reason: 'x', actor: 'ben' });

      const { released } = ks.releaseStop();
      expect(released?.reason).toBe('x');
      expect(ks.isStopped()).toBe(false);
    });

    it('is idempotent on release', async () => {
      const ks = await load();
      expect(ks.releaseStop().released).toBeNull();
      expect(ks.isStopped()).toBe(false);
    });
  });

  describe('the gate', () => {
    it('lets work through while running', async () => {
      const ks = await load();
      expect(() => ks.assertRunnable('some job')).not.toThrow();
      expect(ks.checkRunnable('some job')).toBeNull();
    });

    it('refuses with WHY, not merely THAT — reason, time and operation', async () => {
      const ks = await load();
      ks.engageStop({ reason: 'runaway vector telemetry', actor: 'ben' });

      expect(() => ks.assertRunnable('agentic queue replay')).toThrow(/Kill switch engaged/);
      try {
        ks.assertRunnable('agentic queue replay');
      } catch (err) {
        const e = err as InstanceType<typeof ks.KillSwitchEngagedError>;
        expect(e.code).toBe('KILL_SWITCH_ENGAGED');
        expect(e.message).toContain('runaway vector telemetry'); // why
        expect(e.message).toContain('ben'); // who
        expect(e.message).toContain('agentic queue replay'); // what was refused
        expect(e.message).toContain('killswitch.resume'); // the way out
      }
    });

    it('offers a non-throwing form, so a caller returning errors keeps its contract', async () => {
      const ks = await load();
      ks.engageStop({ reason: 'x' });

      const blocked = ks.checkRunnable('dojo experiment run');
      // The distinction exists because a throw behaves differently for a direct
      // caller than for one behind a handler that catches — a divergence that
      // has bitten this repo before.
      expect(blocked).not.toBeNull();
      expect(blocked!.message).toContain('dojo experiment run');
    });
  });

  describe('out-of-band engagement — the purpose-built RUN/STOP button', () => {
    // The dial talks to the daemon. The dedicated button must NOT, because the
    // scenario it exists for includes the daemon being the wedged thing. All it
    // is required to do is write this file; everything else must notice.
    it('honours a stop written directly to the file by something that is not us', async () => {
      const ks = await load();
      fs.mkdirSync(path.dirname(ks.KILL_SWITCH_PATH), { recursive: true });
      fs.writeFileSync(
        ks.KILL_SWITCH_PATH,
        JSON.stringify({
          stopped: true,
          stopped_at: '2026-09-19T18:20:00Z',
          actor: 'runstop-button',
          source: 'device',
          reason: 'physical RUN/STOP pressed',
        }),
        'utf-8'
      );

      expect(ks.isStopped()).toBe(true);
      const blocked = ks.checkRunnable('dojo experiment run');
      expect(blocked).not.toBeNull();
      expect(blocked!.message).toContain('runstop-button');
      expect(blocked!.message).toContain('physical RUN/STOP pressed');
    });

    it('re-reads on every check, so a press mid-run is seen without restarting anything', async () => {
      const ks = await load();
      // Establish a "hot" reader first: if a later optimisation caches state at
      // module load or memoises the read, this is the assertion that catches it
      // — and the symptom would be a dead button rather than a test failure
      // anywhere near the cache.
      expect(ks.isStopped()).toBe(false);

      fs.mkdirSync(path.dirname(ks.KILL_SWITCH_PATH), { recursive: true });
      fs.writeFileSync(ks.KILL_SWITCH_PATH, JSON.stringify({ stopped: true }), 'utf-8');

      expect(ks.isStopped()).toBe(true);

      // And released out-of-band too — someone deleting the file by hand is a
      // documented way out, so it must actually work.
      fs.rmSync(ks.KILL_SWITCH_PATH);
      expect(ks.isStopped()).toBe(false);
    });
  });

  describe('a broken state file fails OPEN', () => {
    it('reads unparseable JSON as running', async () => {
      const ks = await load();
      fs.mkdirSync(path.dirname(ks.KILL_SWITCH_PATH), { recursive: true });
      fs.writeFileSync(ks.KILL_SWITCH_PATH, '{ this is not json', 'utf-8');

      expect(ks.isStopped()).toBe(false);
    });

    it('does not treat a truthy non-true value as stopped', async () => {
      const ks = await load();
      fs.mkdirSync(path.dirname(ks.KILL_SWITCH_PATH), { recursive: true });
      // A well-meaning script writing "yes" must not engage the brake, or the
      // brake depends on spelling.
      fs.writeFileSync(ks.KILL_SWITCH_PATH, JSON.stringify({ stopped: 'yes' }), 'utf-8');

      expect(ks.isStopped()).toBe(false);
    });
  });
});
