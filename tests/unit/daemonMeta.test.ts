// ISS-0179. daemon.meta is machine-global discovery: the session-init hook, the
// issue-close hook, the HQ client and ensureRuntime all follow it. Any `--http`
// run used to advertise itself there, and nothing ever detected a stale entry —
// so a throwaway server on another port silently redirected every hook on the
// machine, and kept them pointed at a dead port after it exited. The symptom was
// hooks quietly doing nothing.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn, type ChildProcess } from 'child_process';
import {
  advertisedPort,
  resolveDaemonPort,
  heldByAnotherProcess,
  isPidAlive,
  DEFAULT_DAEMON_PORT,
} from '../../src/runtime/daemonMeta.js';

describe('daemon.meta discovery (ISS-0179)', () => {
  let fakeHome: string;
  const savedEnv: Record<string, string | undefined> = {};

  // A real, live process that is not us. `pid 1` would be the obvious choice
  // and it is wrong on Windows — there is no init there, and the low pids are
  // Idle (0) and System (4). The Windows CI leg caught that, which is the
  // second time today an unexamined POSIX assumption only showed up there.
  let other: ChildProcess;
  let otherPid: number;

  const setEnv = (key: string, value: string | undefined): void => {
    if (!(key in savedEnv)) savedEnv[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };

  const writeMeta = (meta: Record<string, unknown>): void => {
    fs.mkdirSync(path.join(fakeHome, '.decibel'), { recursive: true });
    fs.writeFileSync(path.join(fakeHome, '.decibel', 'daemon.meta'), JSON.stringify(meta));
  };

  beforeEach(() => {
    other = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
    otherPid = other.pid as number;
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'decibel-meta-'));
    setEnv('HOME', fakeHome);
    setEnv('USERPROFILE', fakeHome);
    setEnv('DECIBEL_DAEMON_PORT', undefined);
  });

  afterEach(() => {
    other.kill();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    for (const key of Object.keys(savedEnv)) delete savedEnv[key];
    fs.rmSync(fakeHome, { recursive: true, force: true });
  });

  describe('a stale advertisement is not followed', () => {
    it('ignores a port whose pid is no longer running', () => {
      // A pid that cannot exist: the kernel would have to have wrapped around
      // past it, and 0x7FFFFFFF is above every platform's pid_max.
      writeMeta({ started_at: 'x', crash_count: 0, port: 4899, pid: 0x7fffffff });

      expect(advertisedPort()).toBeUndefined();
      expect(resolveDaemonPort()).toBe(DEFAULT_DAEMON_PORT);
    });

    it('follows a port whose pid is alive', () => {
      writeMeta({ started_at: 'x', crash_count: 0, port: 4899, pid: process.pid });

      expect(advertisedPort()).toBe(4899);
      expect(resolveDaemonPort()).toBe(4899);
    });

    it('treats a missing, empty or unparseable file as no advertisement', () => {
      expect(advertisedPort()).toBeUndefined();

      fs.mkdirSync(path.join(fakeHome, '.decibel'), { recursive: true });
      fs.writeFileSync(path.join(fakeHome, '.decibel', 'daemon.meta'), 'not json{');
      expect(advertisedPort()).toBeUndefined();

      writeMeta({ started_at: 'x', crash_count: 0 });
      expect(advertisedPort()).toBeUndefined();
    });

    it('still honours an entry that records no pid at all', () => {
      // Written by an older build. Unverifiable rather than known-dead, so it
      // is followed — this fix must not orphan a daemon mid-upgrade.
      writeMeta({ started_at: 'x', crash_count: 0, port: 4890 });

      expect(advertisedPort()).toBe(4890);
    });
  });

  describe('discovery order', () => {
    it('prefers an explicit port over everything', () => {
      writeMeta({ started_at: 'x', crash_count: 0, port: 4899, pid: process.pid });
      expect(resolveDaemonPort(4001)).toBe(4001);
    });

    it('prefers the environment over the advertisement', () => {
      writeMeta({ started_at: 'x', crash_count: 0, port: 4899, pid: process.pid });
      setEnv('DECIBEL_DAEMON_PORT', '4002');
      expect(resolveDaemonPort()).toBe(4002);
    });

    it('ignores a nonsense environment value rather than dialling it', () => {
      setEnv('DECIBEL_DAEMON_PORT', 'banana');
      expect(resolveDaemonPort()).toBe(DEFAULT_DAEMON_PORT);
    });
  });

  describe('who currently holds discovery', () => {
    it('reports a live foreign pid, so a second daemon can refuse to take over', () => {
      writeMeta({ started_at: 'x', crash_count: 0, port: 4888, pid: otherPid });
      expect(heldByAnotherProcess()?.port).toBe(4888);
    });

    it('does not report ourselves as a foreign holder', () => {
      writeMeta({ started_at: 'x', crash_count: 0, port: 4888, pid: process.pid });
      expect(heldByAnotherProcess()).toBeNull();
    });

    it('does not report a dead holder — an abandoned entry is free to take', () => {
      writeMeta({ started_at: 'x', crash_count: 0, port: 4899, pid: 0x7fffffff });
      expect(heldByAnotherProcess()).toBeNull();
    });
  });

  describe('isPidAlive', () => {
    it('is true for this process and for another live one', () => {
      expect(isPidAlive(process.pid)).toBe(true);
      expect(isPidAlive(otherPid)).toBe(true);
    });

    it('is false for a pid that cannot exist, and for nonsense', () => {
      expect(isPidAlive(0x7fffffff)).toBe(false);
      expect(isPidAlive(0)).toBe(false);
      expect(isPidAlive(-1)).toBe(false);
      expect(isPidAlive(undefined)).toBe(false);
    });
  });
});
