// ============================================================================
// Device-specific registry tests
// ============================================================================
// One registry file can serve multiple machines: `path` is the canonical
// location (external drives, primary device), `devicePaths[deviceId]` holds
// per-machine copies. These tests simulate two devices by switching
// DECIBEL_DEVICE_ID and point the registry at a temp file via
// DECIBEL_REGISTRY_PATH.
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  registerProject,
  resolveProject,
  listProjects,
  scanForProjects,
  getDeviceId,
  getEffectivePath,
  ProjectEntry,
} from '../../src/projectRegistry.js';

let tmpDir: string;
let savedRegistryPath: string | undefined;
let savedDeviceId: string | undefined;

function makeProject(name: string): string {
  const projectPath = path.join(tmpDir, name);
  fs.mkdirSync(path.join(projectPath, '.decibel'), { recursive: true });
  return projectPath;
}

function readRawRegistry(): { projects: ProjectEntry[] } {
  return JSON.parse(fs.readFileSync(process.env.DECIBEL_REGISTRY_PATH!, 'utf-8'));
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decibel-registry-device-'));
  savedRegistryPath = process.env.DECIBEL_REGISTRY_PATH;
  savedDeviceId = process.env.DECIBEL_DEVICE_ID;
  process.env.DECIBEL_REGISTRY_PATH = path.join(tmpDir, 'projects.json');
  process.env.DECIBEL_DEVICE_ID = 'laptop';
});

afterEach(() => {
  if (savedRegistryPath === undefined) delete process.env.DECIBEL_REGISTRY_PATH;
  else process.env.DECIBEL_REGISTRY_PATH = savedRegistryPath;
  if (savedDeviceId === undefined) delete process.env.DECIBEL_DEVICE_ID;
  else process.env.DECIBEL_DEVICE_ID = savedDeviceId;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('getDeviceId', () => {
  it('uses DECIBEL_DEVICE_ID when set, sanitized', () => {
    process.env.DECIBEL_DEVICE_ID = 'Bens-MacBook-Pro.local';
    expect(getDeviceId()).toBe('bens-macbook-pro');
  });
});

describe('device-aware registerProject', () => {
  it('registers a new project with a canonical path', () => {
    const p = makeProject('alpha');
    registerProject({ id: 'alpha', path: p });
    const raw = readRawRegistry();
    expect(raw.projects[0].path).toBe(p);
    expect(raw.projects[0].devicePaths).toBeUndefined();
  });

  it('stores a differing path for a known id as this device\'s copy', () => {
    // "Desktop" registers the canonical copy.
    process.env.DECIBEL_DEVICE_ID = 'desktop';
    const desktopCopy = makeProject('desktop/alpha');
    registerProject({ id: 'alpha', path: desktopCopy });

    // "Laptop" registers its own copy of the same project.
    process.env.DECIBEL_DEVICE_ID = 'laptop';
    const laptopCopy = makeProject('laptop/alpha');
    registerProject({ id: 'alpha', path: laptopCopy });

    const raw = readRawRegistry();
    expect(raw.projects).toHaveLength(1);
    expect(raw.projects[0].path).toBe(desktopCopy); // canonical untouched
    expect(raw.projects[0].devicePaths).toEqual({ laptop: laptopCopy });
  });

  it('does not let a second copy steal a valid device link unless repoint=true', () => {
    process.env.DECIBEL_DEVICE_ID = 'desktop';
    const canonical = makeProject('desktop/kappa');
    registerProject({ id: 'kappa', path: canonical });

    process.env.DECIBEL_DEVICE_ID = 'laptop';
    const workingCopy = makeProject('laptop/kappa');
    const backupCopy = makeProject('backup-drive/kappa');
    expect(registerProject({ id: 'kappa', path: workingCopy }).action).toBe('device_linked');

    // A scan finding the backup copy must not repoint the link.
    const kept = registerProject({ id: 'kappa', path: backupCopy });
    expect(kept.action).toBe('kept_existing_device_link');
    expect(kept.path).toBe(workingCopy);
    expect(kept.skippedPath).toBe(backupCopy);
    expect(readRawRegistry().projects[0].devicePaths).toEqual({ laptop: workingCopy });

    // Explicit repoint (registry_add) is allowed.
    const repointed = registerProject({ id: 'kappa', path: backupCopy }, { repoint: true });
    expect(repointed.action).toBe('device_linked');
    expect(readRawRegistry().projects[0].devicePaths).toEqual({ laptop: backupCopy });
  });

  it('rewrites the canonical path when canonical=true and drops a redundant override', () => {
    process.env.DECIBEL_DEVICE_ID = 'desktop';
    const oldCopy = makeProject('old/alpha');
    registerProject({ id: 'alpha', path: oldCopy });

    process.env.DECIBEL_DEVICE_ID = 'laptop';
    const newCopy = makeProject('new/alpha');
    registerProject({ id: 'alpha', path: newCopy }); // device link first
    registerProject({ id: 'alpha', path: newCopy }, { canonical: true });

    const raw = readRawRegistry();
    expect(raw.projects[0].path).toBe(newCopy);
    expect(raw.projects[0].devicePaths).toBeUndefined();
  });
});

describe('device-aware resolution', () => {
  it('resolves via the device override when the canonical path is absent', () => {
    process.env.DECIBEL_DEVICE_ID = 'desktop';
    const desktopCopy = makeProject('desktop/beta');
    registerProject({ id: 'beta', path: desktopCopy });

    process.env.DECIBEL_DEVICE_ID = 'laptop';
    const laptopCopy = makeProject('laptop/beta');
    registerProject({ id: 'beta', path: laptopCopy });

    // Simulate the desktop copy not existing on the laptop (drive unplugged).
    fs.rmSync(desktopCopy, { recursive: true, force: true });

    const entry = resolveProject('beta');
    expect(entry.path).toBe(laptopCopy);
  });

  it('falls back to the canonical path when this device has no override', () => {
    const p = makeProject('gamma');
    registerProject({ id: 'gamma', path: p });
    expect(resolveProject('gamma').path).toBe(p);
  });

  it('prefers this device\'s override even when the canonical path exists', () => {
    process.env.DECIBEL_DEVICE_ID = 'desktop';
    const canonical = makeProject('desktop/delta');
    registerProject({ id: 'delta', path: canonical });

    process.env.DECIBEL_DEVICE_ID = 'laptop';
    const override = makeProject('laptop/delta');
    registerProject({ id: 'delta', path: override });

    expect(resolveProject('delta').path).toBe(override);
    expect(getEffectivePath(readRawRegistry().projects[0]).source).toBe('device');
  });

  it('throws a device-aware error when no candidate exists', () => {
    const p = makeProject('epsilon');
    registerProject({ id: 'epsilon', path: p });
    fs.rmSync(p, { recursive: true, force: true });
    expect(() => resolveProject('epsilon')).toThrow(/not available on this device \(laptop\)/);
  });

  it('listProjects returns effective paths with display metadata', () => {
    process.env.DECIBEL_DEVICE_ID = 'desktop';
    const canonical = makeProject('desktop/zeta');
    registerProject({ id: 'zeta', path: canonical });

    process.env.DECIBEL_DEVICE_ID = 'laptop';
    const override = makeProject('laptop/zeta');
    registerProject({ id: 'zeta', path: override });
    fs.rmSync(canonical, { recursive: true, force: true });

    const [entry] = listProjects();
    expect(entry.path).toBe(override);
    expect(entry.canonicalPath).toBe(canonical);
    expect(entry.available).toBe(true);
    expect(entry.pathSource).toBe('device');
  });
});

describe('device-aware scan', () => {
  it('does not report an already device-linked copy as unregistered', () => {
    process.env.DECIBEL_DEVICE_ID = 'desktop';
    const canonical = makeProject('desktop/eta');
    registerProject({ id: 'eta', path: canonical });

    process.env.DECIBEL_DEVICE_ID = 'laptop';
    const override = makeProject('laptop/eta');
    registerProject({ id: 'eta', path: override });

    const result = scanForProjects([path.join(tmpDir, 'laptop')]);
    expect(result.unregistered).toHaveLength(0);
    expect(result.found.some((f) => f.path === override && f.registered)).toBe(true);
  });

  it('scan+register links a local copy of a known project as a device path', () => {
    process.env.DECIBEL_DEVICE_ID = 'desktop';
    const canonical = makeProject('desktop/theta');
    registerProject({ id: 'theta', path: canonical });

    // On the laptop, a copy with the same basename is discovered and applied.
    process.env.DECIBEL_DEVICE_ID = 'laptop';
    const laptopCopy = makeProject('laptop/theta');
    const result = scanForProjects([path.join(tmpDir, 'laptop')]);
    expect(result.unregistered).toHaveLength(1);
    registerProject({ id: result.unregistered[0].id, path: result.unregistered[0].path });

    const raw = readRawRegistry();
    expect(raw.projects).toHaveLength(1);
    expect(raw.projects[0].path).toBe(canonical);
    expect(raw.projects[0].devicePaths).toEqual({ laptop: laptopCopy });
  });

  it('reports a project on an unmounted volume as volume_unmounted', () => {
    const p = makeProject('iota');
    registerProject({ id: 'iota', path: p });
    // Rewrite the canonical path to a volume that is certainly not mounted.
    const raw = readRawRegistry();
    raw.projects[0].path = '/Volumes/definitely-not-mounted-xyz/iota';
    fs.writeFileSync(process.env.DECIBEL_REGISTRY_PATH!, JSON.stringify(raw, null, 2));

    const result = scanForProjects([tmpDir]);
    const orphan = result.orphans.find((o) => o.id === 'iota');
    expect(orphan?.reason).toBe('volume_unmounted:definitely-not-mounted-xyz');
  });
});
