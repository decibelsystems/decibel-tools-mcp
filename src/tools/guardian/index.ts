// ============================================================================
// Guardian Domain Tools — Security Scanning
// ============================================================================

import { ToolSpec } from '../types.js';
import { toolSuccess, toolError } from '../shared/index.js';
import {
  scanDeps,
  scanSecrets,
  scanHttp,
  scanConfig,
  guardianReport,
} from '../guardian.js';

// ============================================================================
// scan_deps
// ============================================================================

export const guardianScanDepsTool: ToolSpec = {
  definition: {
    name: 'guardian_scan_deps',
    description: 'Run npm audit to find dependency vulnerabilities. Returns severity counts and actionable fix suggestions.',
    annotations: {
      title: 'Scan Dependencies',
      readOnlyHint: true,
      destructiveHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Optional project identifier',
        },
      },
    },
  },
  handler: async (args) => {
    try {
      const result = await scanDeps(args);
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// scan_secrets
// ============================================================================

export const guardianScanSecretsTool: ToolSpec = {
  definition: {
    name: 'guardian_scan_secrets',
    description: 'Scan source files for exposed secrets: API keys, tokens, passwords, private keys. Respects allowlist in .decibel/guardian/allowlist.yaml.',
    annotations: {
      title: 'Scan Secrets',
      readOnlyHint: true,
      destructiveHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Optional project identifier',
        },
        directories: {
          type: 'array',
          items: { type: 'string' },
          description: 'Directories to scan (defaults to src/ and extension/src/)',
        },
      },
    },
  },
  handler: async (args) => {
    try {
      const result = await scanSecrets(args);
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// scan_http
// ============================================================================

export const guardianScanHttpTool: ToolSpec = {
  definition: {
    name: 'guardian_scan_http',
    description: 'Inspect daemon HTTP configuration for security issues: auth token, CORS, rate limiter, host binding, TLS.',
    annotations: {
      title: 'Scan HTTP Surface',
      readOnlyHint: true,
      destructiveHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  handler: async () => {
    try {
      const result = await scanHttp();
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// scan_config
// ============================================================================

export const guardianScanConfigTool: ToolSpec = {
  definition: {
    name: 'guardian_scan_config',
    description: 'Check ~/.decibel/config.yaml and environment variables for insecure defaults (no auth token, permissive host binding, etc.).',
    annotations: {
      title: 'Scan Configuration',
      readOnlyHint: true,
      destructiveHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  handler: async () => {
    try {
      const result = await scanConfig();
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// report
// ============================================================================

export const guardianReportTool: ToolSpec = {
  definition: {
    name: 'guardian_report',
    description: 'Run all security scans and produce an aggregate report with an overall grade (A–F).',
    annotations: {
      title: 'Security Report',
      readOnlyHint: true,
      destructiveHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Optional project identifier',
        },
      },
    },
  },
  handler: async (args) => {
    try {
      const result = await guardianReport(args);
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Export All Tools
// ============================================================================

export const guardianTools: ToolSpec[] = [
  guardianScanDepsTool,
  guardianScanSecretsTool,
  guardianScanHttpTool,
  guardianScanConfigTool,
  guardianReportTool,
];
