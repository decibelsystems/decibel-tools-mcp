/**
 * Dojo Graduated Tools Loader
 *
 * Scans dojo/graduated/*.yaml for graduated experiments and registers them
 * as MCP tools. When a graduated tool is called, it executes the experiment's
 * entrypoint and returns the results.
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { parse as parseYaml } from 'yaml';
import { log } from '../config.js';

// ============================================================================
// Types
// ============================================================================

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  output_schema?: Record<string, unknown>;
}

export interface GraduatedTool {
  experiment_id: string;
  tool_name: string;
  tool_definition: ToolDefinition;
  source_dir: string;
  entrypoint: string;
  graduated_at: string;
}

export interface GraduatedToolResult {
  success: boolean;
  output?: Record<string, unknown>;
  error?: string;
  exit_code: number;
  stdout?: string;
  stderr?: string;
}

// ============================================================================
// Constants
// ============================================================================

const GRADUATED_DIR = 'dojo/graduated';

// ============================================================================
// Loader
// ============================================================================

/**
 * Find the dojo root directory (looks for dojo/ folder)
 */
function findDojoRoot(): string | null {
  // Try current directory first
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, 'dojo'))) {
    return cwd;
  }

  // Try DECIBEL_PROJECT_ROOT env var
  const projectRoot = process.env.DECIBEL_PROJECT_ROOT;
  if (projectRoot && fs.existsSync(path.join(projectRoot, 'dojo'))) {
    return projectRoot;
  }

  return null;
}

/**
 * Load all graduated tools from dojo/graduated/*.yaml
 */
export function loadGraduatedTools(): GraduatedTool[] {
  const root = findDojoRoot();
  if (!root) {
    log('dojoGraduated: No dojo root found, no graduated tools to load');
    return [];
  }

  const graduatedDir = path.join(root, GRADUATED_DIR);
  if (!fs.existsSync(graduatedDir)) {
    log('dojoGraduated: No graduated directory found');
    return [];
  }

  const tools: GraduatedTool[] = [];
  const files = fs.readdirSync(graduatedDir).filter((f) => f.endsWith('.yaml'));

  for (const file of files) {
    try {
      const filePath = path.join(graduatedDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const tool = parseYaml(content) as GraduatedTool;

      // Validate required fields
      if (!tool.tool_name || !tool.tool_definition || !tool.source_dir) {
        log(`dojoGraduated: Skipping invalid graduated tool: ${file}`);
        continue;
      }

      // Resolve source_dir relative to root
      tool.source_dir = path.resolve(root, tool.source_dir);

      tools.push(tool);
      log(`dojoGraduated: Loaded graduated tool: ${tool.tool_name}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`dojoGraduated: Failed to load ${file}: ${message}`);
    }
  }

  return tools;
}

/**
 * Convert graduated tools to MCP tool definitions
 */
export function graduatedToolsToMcpDefinitions(
  tools: GraduatedTool[]
): Array<{
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}> {
  return tools.map((tool) => ({
    name: `graduated_${tool.tool_name}`,
    description: `[Graduated] ${tool.tool_definition.description}`,
    inputSchema: tool.tool_definition.input_schema,
  }));
}

/**
 * Execute a graduated tool
 */
export async function executeGraduatedTool(
  tool: GraduatedTool,
  input: Record<string, unknown>
): Promise<GraduatedToolResult> {
  const entrypointPath = path.join(tool.source_dir, tool.entrypoint);

  if (!fs.existsSync(entrypointPath)) {
    return {
      success: false,
      error: `Entrypoint not found: ${entrypointPath}`,
      exit_code: -1,
    };
  }

  // Determine how to run the entrypoint
  const ext = path.extname(tool.entrypoint);
  let command: string;
  let args: string[];

  if (ext === '.py') {
    command = 'python3';
    args = [entrypointPath, '--input', JSON.stringify(input)];
  } else if (ext === '.ts') {
    // Use tsx for TypeScript
    command = 'npx';
    args = ['tsx', entrypointPath, '--input', JSON.stringify(input)];
  } else if (ext === '.js') {
    command = 'node';
    args = [entrypointPath, '--input', JSON.stringify(input)];
  } else {
    return {
      success: false,
      error: `Unsupported entrypoint type: ${ext}`,
      exit_code: -1,
    };
  }

  log(`dojoGraduated: Executing ${command} ${args.join(' ')}`);

  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: tool.source_dir,
      env: {
        ...process.env,
        DOJO_TOOL_INPUT: JSON.stringify(input),
      },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('error', (err) => {
      resolve({
        success: false,
        error: `Process error: ${err.message}`,
        exit_code: -1,
        stderr: err.message,
      });
    });

    proc.on('close', (code) => {
      const exitCode = code ?? -1;

      // Try to parse JSON output
      let output: Record<string, unknown> | undefined;
      try {
        output = JSON.parse(stdout);
      } catch {
        // Output is not JSON, include as string
      }

      resolve({
        success: exitCode === 0,
        output,
        exit_code: exitCode,
        stdout: output ? undefined : stdout,
        stderr: stderr || undefined,
      });
    });
  });
}

/**
 * Find a graduated tool by name
 */
export function findGraduatedTool(
  tools: GraduatedTool[],
  name: string
): GraduatedTool | undefined {
  // Handle both "graduated_toolname" and "toolname" formats
  const toolName = name.startsWith('graduated_') ? name.slice(10) : name;
  return tools.find((t) => t.tool_name === toolName);
}
