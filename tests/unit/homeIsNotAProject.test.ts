// ISS-0177 — the walk-up mistook the global config directory for a project.
//
// ~/.decibel holds projects.json, device.json, daemon.meta and config.yaml. It
// is named exactly like a project's .decibel/, so a walk-up from any directory
// under $HOME that is not itself a project used to stop at HOME and return a
// "project" with id = basename(HOME). The failure was not an error, it was a
// confident wrong answer, and every write then landed in the one directory
// every project shares.
//
// The Windows CI leg surfaced it first, but only because %TEMP% lives inside
// %USERPROFILE%. These tests fake HOME instead, so they reproduce the bug on
// every platform — the macOS `~/Documents -> ~` repro recorded on the issue.
//
// Faking HOME under the real one also, by accident, tests the case that made
// the first fix insufficient: skipping ~/.decibel left the walk free to climb
// past it and find the real home above. Reaching the global config directory
// now ends the walk.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { resolveProjectRoot } from '../../src/projectPaths.js';

describe('the global config directory is not a project (ISS-0177)', () => {
  let fakeHome: string;
  let originalCwd: string;
  const savedEnv: Record<string, string | undefined> = {};

  const setEnv = (key: string, value: string | undefined): void => {
    if (!(key in savedEnv)) savedEnv[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };

  beforeEach(async () => {
    originalCwd = process.cwd();
    fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), 'decibel-fake-home-'));

    // os.homedir() reads $HOME on POSIX and %USERPROFILE% on Windows; set both
    // so the fake home takes on every platform the suite runs on.
    setEnv('HOME', fakeHome);
    setEnv('USERPROFILE', fakeHome);
    // Keep the registry inside the fake home too, so nothing touches the real one.
    setEnv('DECIBEL_REGISTRY_PATH', path.join(fakeHome, '.decibel', 'projects.json'));
    setEnv('DECIBEL_PROJECT_ROOT', undefined);

    // The global config directory, as a fresh install leaves it.
    await fs.mkdir(path.join(fakeHome, '.decibel'), { recursive: true });
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    for (const key of Object.keys(savedEnv)) delete savedEnv[key];
    await fs.rm(fakeHome, { recursive: true, force: true });
  });

  it('refuses to resolve HOME as a project from a directory under it', async () => {
    const documents = path.join(fakeHome, 'Documents');
    await fs.mkdir(documents, { recursive: true });
    process.chdir(documents);

    // Before the fix this resolved to { projectId: basename(fakeHome) }.
    await expect(resolveProjectRoot('unknown-project')).rejects.toThrow(
      'PROJECT_NOT_FOUND: "unknown-project"'
    );
  });

  it('refuses to resolve HOME as a project from HOME itself', async () => {
    process.chdir(fakeHome);

    await expect(resolveProjectRoot('unknown-project')).rejects.toThrow(
      'PROJECT_NOT_FOUND: "unknown-project"'
    );
  });

  it('does not climb past HOME to a .decibel in an ancestor of it', async () => {
    // `/Users/.decibel` or `C:\\Users\\.decibel` would otherwise be handed to
    // every user on the machine as their project. Windows CI hit exactly this
    // against the real home sitting above the fake one.
    const ancestor = path.join(fakeHome, 'above');
    const home = path.join(ancestor, 'home');
    await fs.mkdir(path.join(ancestor, '.decibel'), { recursive: true });
    await fs.mkdir(path.join(home, '.decibel'), { recursive: true });
    const workdir = path.join(home, 'Documents');
    await fs.mkdir(workdir, { recursive: true });

    setEnv('HOME', home);
    setEnv('USERPROFILE', home);
    setEnv('DECIBEL_REGISTRY_PATH', path.join(home, '.decibel', 'projects.json'));
    process.chdir(workdir);

    await expect(resolveProjectRoot('unknown-project')).rejects.toThrow(
      'PROJECT_NOT_FOUND: "unknown-project"'
    );
  });

  it('still discovers a real project that lives under HOME', async () => {
    // The regression this fix must not cause: nearly every real checkout is
    // somewhere under $HOME, and walking up to one must keep working.
    const projectDir = path.join(fakeHome, 'Documents', 'GitHub', 'a-real-project');
    await fs.mkdir(path.join(projectDir, '.decibel'), { recursive: true });
    const nested = path.join(projectDir, 'src', 'tools');
    await fs.mkdir(nested, { recursive: true });
    process.chdir(nested);

    const config = await resolveProjectRoot('a-real-project');

    expect(config.projectId).toBe('a-real-project');
    expect(await fs.realpath(config.root)).toBe(await fs.realpath(projectDir));
  });

  it('still resolves HOME when it is asked for explicitly by path', async () => {
    // Skipping the global config dir is a rule about *discovery*, not a ban.
    // An absolute path with a .decibel/ still resolves, so a deliberate setup
    // is never blocked by the walk-up guard.
    const config = await resolveProjectRoot(fakeHome);

    expect(config.root).toBe(fakeHome);
  });
});
