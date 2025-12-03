import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getConfig, log } from '../../src/config.js';

describe('Config', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear relevant env vars
    delete process.env.DECIBEL_ENV;
    delete process.env.DECIBEL_ORG;
    delete process.env.DECIBEL_MCP_ROOT;
  });

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
  });

  describe('getConfig', () => {
    it('should return default values when env vars are not set', () => {
      const config = getConfig();

      expect(config.env).toBe('dev');
      expect(config.org).toBe('mediareason');
      expect(config.rootDir).toContain('data');
    });

    it('should use DECIBEL_ENV when set', () => {
      process.env.DECIBEL_ENV = 'production';

      const config = getConfig();

      expect(config.env).toBe('production');
    });

    it('should use DECIBEL_ORG when set', () => {
      process.env.DECIBEL_ORG = 'custom-org';

      const config = getConfig();

      expect(config.org).toBe('custom-org');
    });

    it('should use DECIBEL_MCP_ROOT when set', () => {
      process.env.DECIBEL_MCP_ROOT = '/custom/path/to/data';

      const config = getConfig();

      expect(config.rootDir).toBe('/custom/path/to/data');
    });

    it('should handle all env vars together', () => {
      process.env.DECIBEL_ENV = 'staging';
      process.env.DECIBEL_ORG = 'test-org';
      process.env.DECIBEL_MCP_ROOT = '/tmp/test-data';

      const config = getConfig();

      expect(config.env).toBe('staging');
      expect(config.org).toBe('test-org');
      expect(config.rootDir).toBe('/tmp/test-data');
    });
  });

  describe('log', () => {
    it('should log in dev environment', () => {
      process.env.DECIBEL_ENV = 'dev';

      // log function writes to console.error, which is captured
      // We're just verifying it doesn't throw
      expect(() => log('Test message')).not.toThrow();
    });

    it('should not throw in non-dev environment', () => {
      process.env.DECIBEL_ENV = 'production';

      expect(() => log('Test message')).not.toThrow();
    });

    it('should handle multiple arguments', () => {
      process.env.DECIBEL_ENV = 'dev';

      expect(() => log('Message', { key: 'value' }, 123)).not.toThrow();
    });
  });
});
