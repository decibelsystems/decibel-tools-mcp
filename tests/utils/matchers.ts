import { expect } from 'vitest';
import fs from 'fs/promises';

/**
 * Custom matchers for Decibel MCP tests.
 */

expect.extend({
  /**
   * Check if a string is a valid ISO 8601 timestamp.
   */
  toBeValidTimestamp(received: string) {
    const date = new Date(received);
    const isValid = !isNaN(date.getTime()) && received.includes('T');

    return {
      pass: isValid,
      message: () =>
        isValid
          ? `Expected ${received} not to be a valid ISO timestamp`
          : `Expected ${received} to be a valid ISO timestamp`,
    };
  },

  /**
   * Check if a file path exists and is a markdown file.
   */
  async toBeMarkdownFile(received: string) {
    try {
      const stat = await fs.stat(received);
      const isMarkdown = received.endsWith('.md') && stat.isFile();

      return {
        pass: isMarkdown,
        message: () =>
          isMarkdown
            ? `Expected ${received} not to be a markdown file`
            : `Expected ${received} to be a markdown file`,
      };
    } catch {
      return {
        pass: false,
        message: () => `Expected ${received} to exist as a markdown file`,
      };
    }
  },

  /**
   * Check if frontmatter contains expected keys and values.
   */
  toMatchFrontmatter(
    received: Record<string, string>,
    expected: Record<string, string>
  ) {
    const mismatches: string[] = [];

    for (const [key, value] of Object.entries(expected)) {
      if (received[key] !== value) {
        mismatches.push(`${key}: expected "${value}", got "${received[key]}"`);
      }
    }

    return {
      pass: mismatches.length === 0,
      message: () =>
        mismatches.length === 0
          ? `Expected frontmatter not to match ${JSON.stringify(expected)}`
          : `Frontmatter mismatches:\n${mismatches.join('\n')}`,
    };
  },

  /**
   * Check if a slug contains only safe filesystem characters.
   */
  toBeSafeSlug(received: string) {
    const safePattern = /^[a-z0-9-]+$/;
    const isSafe = safePattern.test(received);

    return {
      pass: isSafe,
      message: () =>
        isSafe
          ? `Expected ${received} not to be a safe slug`
          : `Expected ${received} to contain only lowercase letters, numbers, and hyphens`,
    };
  },

  /**
   * Check if priority is valid.
   */
  toBeValidPriority(received: string) {
    const validPriorities = ['low', 'med', 'high'];
    const isValid = validPriorities.includes(received);

    return {
      pass: isValid,
      message: () =>
        isValid
          ? `Expected ${received} not to be a valid priority`
          : `Expected ${received} to be one of: ${validPriorities.join(', ')}`,
    };
  },

  /**
   * Check if severity is valid.
   */
  toBeValidSeverity(received: string) {
    const validSeverities = ['low', 'med', 'high', 'critical'];
    const isValid = validSeverities.includes(received);

    return {
      pass: isValid,
      message: () =>
        isValid
          ? `Expected ${received} not to be a valid severity`
          : `Expected ${received} to be one of: ${validSeverities.join(', ')}`,
    };
  },
});

// Type declarations for custom matchers
declare module 'vitest' {
  interface Assertion<T> {
    toBeValidTimestamp(): T;
    toBeMarkdownFile(): Promise<T>;
    toMatchFrontmatter(expected: Record<string, string>): T;
    toBeSafeSlug(): T;
    toBeValidPriority(): T;
    toBeValidSeverity(): T;
  }
  interface AsymmetricMatchersContaining {
    toBeValidTimestamp(): unknown;
    toBeMarkdownFile(): unknown;
    toMatchFrontmatter(expected: Record<string, string>): unknown;
    toBeSafeSlug(): unknown;
    toBeValidPriority(): unknown;
    toBeValidSeverity(): unknown;
  }
}
