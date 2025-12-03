/**
 * Filesystem fixtures and helpers for testing.
 * Create and cleanup test directories, seed data, and verify file structures.
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { recordDesignDecision } from '../../src/tools/designer.js';
import { recordArchDecision } from '../../src/tools/architect.js';
import { createIssue } from '../../src/tools/sentinel.js';
import { projectScenario, designerPayloads, architectPayloads, sentinelPayloads } from './payloads.js';

export interface TestRoot {
  path: string;
  cleanup: () => Promise<void>;
}

/**
 * Create a unique temporary directory for test isolation.
 * Returns the path and a cleanup function.
 */
export async function createTempRoot(prefix = 'decibel-mcp-test-'): Promise<TestRoot> {
  const tempPath = await fs.mkdtemp(path.join(os.tmpdir(), prefix));

  return {
    path: tempPath,
    cleanup: async () => {
      await fs.rm(tempPath, { recursive: true, force: true });
    },
  };
}

/**
 * Set the DECIBEL_MCP_ROOT environment variable for testing.
 */
export function setTestRoot(rootPath: string): void {
  process.env.DECIBEL_MCP_ROOT = rootPath;
  process.env.DECIBEL_ENV = 'test';
}

/**
 * Clear test environment variables.
 */
export function clearTestRoot(): void {
  delete process.env.DECIBEL_MCP_ROOT;
  delete process.env.DECIBEL_ENV;
}

/**
 * Seed a test root with sample data from all tools.
 * Useful for Oracle tests that need existing files.
 */
export async function seedTestData(
  projectId: string,
  options: {
    designer?: number;
    architect?: number;
    sentinel?: number;
  } = {}
): Promise<{
  designerFiles: string[];
  architectFiles: string[];
  sentinelFiles: string[];
}> {
  const { designer = 1, architect = 1, sentinel = 1 } = options;

  const designerFiles: string[] = [];
  const architectFiles: string[] = [];
  const sentinelFiles: string[] = [];

  // Create designer files
  for (let i = 0; i < designer; i++) {
    const result = await recordDesignDecision({
      project_id: projectId,
      area: `Area ${i}`,
      summary: `Design decision ${i}`,
      details: `Details for decision ${i}`,
    });
    designerFiles.push(result.path);
  }

  // Create architect files
  for (let i = 0; i < architect; i++) {
    const result = await recordArchDecision({
      system_id: projectId,
      change: `Architecture change ${i}`,
      rationale: `Rationale for change ${i}`,
      impact: `Impact of change ${i}`,
    });
    architectFiles.push(result.path);
  }

  // Create sentinel files
  const severities = ['low', 'med', 'high', 'critical'] as const;
  for (let i = 0; i < sentinel; i++) {
    const result = await createIssue({
      repo: projectId,
      severity: severities[i % severities.length],
      title: `Issue ${i}`,
      details: `Details for issue ${i}`,
    });
    sentinelFiles.push(result.path);
  }

  return { designerFiles, architectFiles, sentinelFiles };
}

/**
 * Seed a complete project scenario with realistic data.
 */
export async function seedProjectScenario(): Promise<{
  projectId: string;
  files: string[];
}> {
  const files: string[] = [];

  for (const decision of projectScenario.designDecisions) {
    const result = await recordDesignDecision(decision);
    files.push(result.path);
  }

  for (const decision of projectScenario.archDecisions) {
    const result = await recordArchDecision(decision);
    files.push(result.path);
  }

  for (const issue of projectScenario.issues) {
    const result = await createIssue(issue);
    files.push(result.path);
  }

  return {
    projectId: projectScenario.projectId,
    files,
  };
}

/**
 * Verify the expected directory structure exists.
 */
export async function verifyDirectoryStructure(
  rootPath: string,
  projectId: string
): Promise<{
  hasDesigner: boolean;
  hasArchitect: boolean;
  hasSentinel: boolean;
}> {
  const check = async (subPath: string): Promise<boolean> => {
    try {
      await fs.access(path.join(rootPath, subPath));
      return true;
    } catch {
      return false;
    }
  };

  return {
    hasDesigner: await check(`designer/${projectId}`),
    hasArchitect: await check(`architect/${projectId}`),
    hasSentinel: await check(`sentinel/${projectId}/issues`),
  };
}

/**
 * Count files in a directory (non-recursive).
 */
export async function countFiles(dirPath: string): Promise<number> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).length;
  } catch {
    return 0;
  }
}

/**
 * List all markdown files in a directory tree.
 */
export async function listMarkdownFiles(dirPath: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(dir: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          files.push(fullPath);
        }
      }
    } catch {
      // Directory doesn't exist
    }
  }

  await walk(dirPath);
  return files.sort();
}

/**
 * Read and parse a markdown file's frontmatter.
 */
export async function readFrontmatter(
  filePath: string
): Promise<Record<string, string>> {
  const content = await fs.readFile(filePath, 'utf-8');
  const match = content.match(/^---\n([\s\S]*?)\n---/);

  if (!match) {
    return {};
  }

  const frontmatter: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim();
      const value = line.slice(colonIndex + 1).trim();
      frontmatter[key] = value;
    }
  }

  return frontmatter;
}

/**
 * Sample expected file structures for assertions.
 */
export const expectedStructures = {
  designer: {
    frontmatterKeys: ['project_id', 'area', 'summary', 'timestamp'],
    filePattern: /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z-[\w-]+\.md$/,
  },
  architect: {
    frontmatterKeys: ['system_id', 'change', 'timestamp'],
    filePattern: /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z-[\w-]+\.md$/,
    sections: ['## Change', '## Rationale', '## Impact'],
  },
  sentinel: {
    frontmatterKeys: ['repo', 'severity', 'status', 'created_at'],
    filePattern: /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z-[\w-]+\.md$/,
    validSeverities: ['low', 'med', 'high', 'critical'],
    validStatuses: ['open', 'closed', 'in_progress'],
  },
};
