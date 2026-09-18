// Shared by every e2e test that spawns a real server process.
// Lived in stdio.test.ts until thinStdio.test.ts needed it too — importing a
// test file to reach a helper re-registers that file's suites, so they ran
// twice.

// Allowlist of parent-environment variables to forward to the spawned server.
// Anything outside this list (e.g. OPENAI_API_KEY in the developer's shell) is
// dropped, plus all DECIBEL_* keys are forwarded by name-prefix.
const SAFE_ENV_KEYS = [
  'PATH',
  'HOME',
  'USER',
  'SHELL',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'NODE_PATH',
  'NODE_OPTIONS',
  'TMPDIR',
  'TMP',
  'TEMP',
];

// Bound on the stderr buffer that `startServer()` accumulates. A hung server
// could otherwise fill memory before the spawn timeout fires.
export const STDERR_BUF_LIMIT = 16 * 1024;


export function buildServerEnv(rootDir: string): Record<string, string> {
  const env: Record<string, string> = {};

  for (const key of SAFE_ENV_KEYS) {
    const v = process.env[key];
    if (v !== undefined) env[key] = v;
  }

  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith('DECIBEL_') && v !== undefined) env[k] = v;
  }

  // Explicit overrides — these win over any DECIBEL_* values inherited above.
  env.DECIBEL_MCP_ROOT = rootDir;
  env.DECIBEL_PROJECT_ROOT = rootDir;
  // 'dev' so config.log() emits the "running on stdio" line we wait on as a
  // ready signal. With env='test', logging is suppressed (config.ts:25).
  env.DECIBEL_ENV = 'dev';

  return env;
}
