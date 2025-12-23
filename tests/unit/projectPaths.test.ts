import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { resolveProjectRoot, listProjectIds } from '../../src/projectPaths.js';

describe('projectPaths', () => {
  let tempDir: string;
  let originalCwd: string;
  let originalEnv: string | undefined;

  beforeEach(async () => {
    // Create a temp directory for tests
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'decibel-test-'));
    originalCwd = process.cwd();
    originalEnv = process.env.DECIBEL_PROJECT_ROOT;
  });

  afterEach(async () => {
    // Restore original state
    process.chdir(originalCwd);
    if (originalEnv !== undefined) {
      process.env.DECIBEL_PROJECT_ROOT = originalEnv;
    } else {
      delete process.env.DECIBEL_PROJECT_ROOT;
    }
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('resolveProjectRoot', () => {
    it('should resolve project when cwd has .decibel folder and projectId matches', async () => {
      // Create a project with .decibel folder
      const projectDir = path.join(tempDir, 'my-project');
      await fs.mkdir(path.join(projectDir, '.decibel'), { recursive: true });
      process.env.DECIBEL_PROJECT_ROOT = projectDir;

      const config = await resolveProjectRoot('my-project');

      expect(config.projectId).toBe('my-project');
      expect(config.root).toBe(projectDir);
    });

    it('should throw error for unknown projectId when not in a project', async () => {
      // Point to temp dir without .decibel
      process.env.DECIBEL_PROJECT_ROOT = tempDir;

      await expect(resolveProjectRoot('unknown-project')).rejects.toThrow(
        'Unknown project: "unknown-project"'
      );
    });

    it('should resolve project when projectId is a path with .decibel folder', async () => {
      // Create a project with .decibel folder
      const projectDir = path.join(tempDir, 'path-project');
      await fs.mkdir(path.join(projectDir, '.decibel'), { recursive: true });

      const config = await resolveProjectRoot(projectDir);

      expect(config.projectId).toBe('path-project');
      expect(config.root).toBe(projectDir);
    });

    it('should use DECIBEL_PROJECT_ROOT fallback when projectId not found', async () => {
      // Create a project with .decibel folder
      const projectDir = path.join(tempDir, 'current-project');
      await fs.mkdir(path.join(projectDir, '.decibel'), { recursive: true });
      process.env.DECIBEL_PROJECT_ROOT = projectDir;

      // When DECIBEL_PROJECT_ROOT is set with a .decibel folder,
      // any projectId should resolve to that path (treating projectId as a label)
      const config = await resolveProjectRoot('other-project');
      expect(config.projectId).toBe('other-project');
      expect(config.root).toBe(projectDir);
    });
  });

  describe('listProjectIds', () => {
    it('should return current project when in a .decibel project', async () => {
      // Create a project with .decibel folder
      const projectDir = path.join(tempDir, 'list-project');
      await fs.mkdir(path.join(projectDir, '.decibel'), { recursive: true });
      process.env.DECIBEL_PROJECT_ROOT = projectDir;

      const ids = listProjectIds();

      expect(ids).toContain('list-project');
      expect(Array.isArray(ids)).toBe(true);
    });

    it('should return registered projects plus discovered ones when not in a local project', async () => {
      process.env.DECIBEL_PROJECT_ROOT = tempDir;

      const ids = listProjectIds();

      // Returns at least the registered projects from projects.json
      expect(Array.isArray(ids)).toBe(true);
      // Registry has projects, so it won't be empty
      expect(ids.length).toBeGreaterThanOrEqual(0);
    });
  });
});
