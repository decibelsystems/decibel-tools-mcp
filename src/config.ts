import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface Config {
  env: string;
  org: string;
  rootDir: string;
}

export function getConfig(): Config {
  const projectRoot = path.resolve(__dirname, '..');

  return {
    env: process.env.DECIBEL_ENV || 'dev',
    org: process.env.DECIBEL_ORG || 'mediareason',
    rootDir: process.env.DECIBEL_MCP_ROOT || path.join(projectRoot, 'data'),
  };
}

export function log(message: string, ...args: unknown[]): void {
  const config = getConfig();
  if (config.env === 'dev') {
    console.error(`[decibel-mcp] ${message}`, ...args);
  }
}
