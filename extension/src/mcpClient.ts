import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const MAX_RESTARTS = 3;
const RESTART_DELAY_MS = 2000;
const DAEMON_PROBE_TIMEOUT_MS = 3000;

export class DecibelMcpClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private restartCount = 0;
  private disposed = false;
  private _mode: 'stdio' | 'bridge' = 'stdio';

  constructor(
    private readonly workspaceRoot: string,
    private readonly outputChannel: vscode.OutputChannel,
  ) {}

  get mode(): 'stdio' | 'bridge' {
    return this._mode;
  }

  async start(): Promise<void> {
    const serverPath = this.resolveServerPath();
    if (!serverPath) {
      throw new Error(
        'Could not find Decibel MCP server. Set decibel.serverPath in settings, ' +
        'or ensure dist/server.js exists in the parent directory.'
      );
    }

    const config = vscode.workspace.getConfiguration('decibel');
    const useDaemon = config.get<boolean>('useDaemon', false);
    const daemonUrl = config.get<string>('daemonUrl', 'http://localhost:4888');

    // Determine launch mode
    const args = [serverPath];
    if (useDaemon) {
      const alive = await this.probeDaemon(daemonUrl);
      if (alive) {
        args.push('--bridge', daemonUrl);
        this._mode = 'bridge';
        this.log(`Daemon alive at ${daemonUrl} — launching in bridge mode`);
      } else {
        this._mode = 'stdio';
        this.log(`Daemon not available at ${daemonUrl} — falling back to stdio (bridge will re-probe)`);
        // Still launch bridge — it has its own health probe and will auto-switch
        args.push('--bridge', daemonUrl);
        this._mode = 'bridge';
      }
    } else {
      this._mode = 'stdio';
      this.log(`Starting in stdio mode: ${serverPath}`);
    }

    this.log(`Workspace root: ${this.workspaceRoot}`);

    this.transport = new StdioClientTransport({
      command: 'node',
      args,
      cwd: this.workspaceRoot,
      env: {
        ...process.env,
        DECIBEL_PROJECT_ROOT: this.workspaceRoot,
      },
    });

    this.client = new Client({
      name: 'decibel-vscode',
      version: '0.1.0',
    });

    this.transport.onclose = () => {
      if (!this.disposed) {
        this.log('MCP server process exited unexpectedly');
        this.handleUnexpectedExit();
      }
    };

    this.transport.onerror = (err) => {
      this.log(`MCP transport error: ${err.message}`);
    };

    await this.client.connect(this.transport);
    this.restartCount = 0;
    this.log(`MCP client connected (mode=${this._mode})`);
  }

  async stop(): Promise<void> {
    this.disposed = true;
    if (this.transport) {
      await this.transport.close();
      this.transport = null;
    }
    this.client = null;
    this.log('MCP client stopped');
  }

  get isConnected(): boolean {
    return this.client !== null && this.transport !== null;
  }

  async callFacade<T>(facade: string, action: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.client) {
      throw new Error('MCP client is not connected');
    }

    this.log(`Calling ${facade}.${action}`);

    const result = await this.client.callTool({
      name: facade,
      arguments: { action, ...params },
    });

    if (result.isError) {
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '{}';
      const error = JSON.parse(text);
      throw new Error(error.message || error.error || `${facade}.${action} failed`);
    }

    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
    if (!text) {
      throw new Error(`Empty response from ${facade}.${action}`);
    }

    return JSON.parse(text) as T;
  }

  private resolveServerPath(): string | null {
    // 1. Explicit setting
    const config = vscode.workspace.getConfiguration('decibel');
    const explicit = config.get<string>('serverPath');
    if (explicit && fs.existsSync(explicit)) {
      return explicit;
    }

    // 2. Monorepo dev mode: ../dist/server.js relative to extension
    const monorepoPath = path.resolve(__dirname, '..', '..', 'dist', 'server.js');
    if (fs.existsSync(monorepoPath)) {
      return monorepoPath;
    }

    // 3. Installed package in workspace node_modules
    const nmPath = path.join(this.workspaceRoot, 'node_modules', '@decibel', 'tools', 'dist', 'server.js');
    if (fs.existsSync(nmPath)) {
      return nmPath;
    }

    return null;
  }

  /**
   * Probe the daemon health endpoint to see if it's running.
   */
  private async probeDaemon(url: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DAEMON_PROBE_TIMEOUT_MS);
      const res = await fetch(`${url}/health`, { signal: controller.signal });
      clearTimeout(timeout);
      return res.ok;
    } catch {
      return false;
    }
  }

  private async handleUnexpectedExit(): Promise<void> {
    if (this.disposed) return;

    this.restartCount++;
    if (this.restartCount > MAX_RESTARTS) {
      this.log(`Exceeded max restarts (${MAX_RESTARTS}). Giving up.`);
      vscode.window.showErrorMessage(
        'Decibel MCP server crashed repeatedly. Check the Decibel Tools output channel for details.'
      );
      return;
    }

    this.log(`Restarting in ${RESTART_DELAY_MS}ms (attempt ${this.restartCount}/${MAX_RESTARTS})...`);
    await new Promise(resolve => setTimeout(resolve, RESTART_DELAY_MS));

    if (this.disposed) return;

    try {
      await this.start();
      this.log('MCP server restarted successfully');
    } catch (err) {
      this.log(`Restart failed: ${(err as Error).message}`);
      this.handleUnexpectedExit();
    }
  }

  private log(message: string): void {
    const ts = new Date().toISOString().slice(11, 19);
    this.outputChannel.appendLine(`[${ts}] ${message}`);
  }
}
