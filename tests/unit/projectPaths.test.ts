import { describe, it, expect } from 'vitest';
import { resolveProjectRoot, listProjectIds } from '../../src/projectPaths.js';

describe('projectPaths', () => {
  describe('resolveProjectRoot', () => {
    it('should return config for known project "senken"', async () => {
      const config = await resolveProjectRoot('senken');

      expect(config.projectId).toBe('senken');
      expect(config.projectName).toBe('Senken Trading Agent');
      expect(config.root).toBe('/Users/ben/decibel/senken-trading-agent');
    });

    it('should throw error for unknown projectId', async () => {
      await expect(resolveProjectRoot('unknown-project')).rejects.toThrow(
        'Unknown projectId: "unknown-project"'
      );
    });

    it('should include known projects in error message', async () => {
      await expect(resolveProjectRoot('nonexistent')).rejects.toThrow('senken');
    });
  });

  describe('listProjectIds', () => {
    it('should return array of known project IDs', () => {
      const ids = listProjectIds();

      expect(ids).toContain('senken');
      expect(Array.isArray(ids)).toBe(true);
    });
  });
});
