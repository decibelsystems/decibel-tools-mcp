import fs from 'fs/promises';
import path from 'path';
import os from 'os';

export interface TestContext {
  rootDir: string;
  cleanup: () => Promise<void>;
}

/**
 * Creates an isolated test context with a temporary data directory.
 * Each test gets its own directory to prevent state leakage.
 */
export async function createTestContext(): Promise<TestContext> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'decibel-mcp-test-'));

  // Create .decibel folder so project resolution works
  await fs.mkdir(path.join(rootDir, '.decibel'), { recursive: true });

  // Set environment variables for tools to use
  process.env.DECIBEL_MCP_ROOT = rootDir;
  process.env.DECIBEL_PROJECT_ROOT = rootDir;
  process.env.DECIBEL_ENV = 'test';

  // Store the original cwd and change to test directory
  // so project discovery from cwd works
  const originalCwd = process.cwd();
  process.chdir(rootDir);

  return {
    rootDir,
    cleanup: async () => {
      // Restore cwd before cleanup
      process.chdir(originalCwd);
      await fs.rm(rootDir, { recursive: true, force: true });
    },
  };
}

/**
 * Cleans up the test context after tests complete.
 */
export async function cleanupTestContext(ctx: TestContext): Promise<void> {
  await ctx.cleanup();
  // Reset environment
  delete process.env.DECIBEL_MCP_ROOT;
  delete process.env.DECIBEL_PROJECT_ROOT;
  delete process.env.DECIBEL_ENV;
}

/**
 * Helper to read a file and parse its frontmatter.
 */
export async function readFileWithFrontmatter(
  filePath: string
): Promise<{ frontmatter: Record<string, string>; body: string }> {
  const content = await fs.readFile(filePath, 'utf-8');
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (!match) {
    throw new Error(`Invalid frontmatter format in ${filePath}`);
  }

  const frontmatterLines = match[1].split('\n');
  const frontmatter: Record<string, string> = {};

  for (const line of frontmatterLines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim();
      const value = line.slice(colonIndex + 1).trim();
      frontmatter[key] = value;
    }
  }

  return { frontmatter, body: match[2] };
}

/**
 * Helper to list files in a directory recursively.
 */
export async function listFilesRecursive(dir: string): Promise<string[]> {
  const files: string[] = [];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const subFiles = await listFilesRecursive(fullPath);
        files.push(...subFiles);
      } else {
        files.push(fullPath);
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return files;
}

/**
 * Helper to wait for a condition with timeout.
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 5000,
  intervalMs = 100
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}
