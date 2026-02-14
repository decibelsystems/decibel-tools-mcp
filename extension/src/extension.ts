import * as vscode from 'vscode';
import { DecibelMcpClient } from './mcpClient';
import { SentinelTreeProvider } from './views/sentinelTree';
import { DojoTreeProvider } from './views/dojoTree';
import { registerCommands } from './commands';
import { createStatusBarItem } from './statusBar';
import { ProGate } from './proGate';

let client: DecibelMcpClient | undefined;
let refreshTimer: ReturnType<typeof setInterval> | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showWarningMessage('Decibel Tools requires an open workspace.');
    return;
  }

  const workspaceRoot = workspaceFolder.uri.fsPath;
  const outputChannel = vscode.window.createOutputChannel('Decibel Tools');
  context.subscriptions.push(outputChannel);

  // Create MCP client
  client = new DecibelMcpClient(workspaceRoot, outputChannel);

  try {
    await client.start();
  } catch (err) {
    outputChannel.appendLine(`Failed to start MCP server: ${(err as Error).message}`);
    vscode.window.showErrorMessage(
      `Decibel: Could not start MCP server. ${(err as Error).message}`
    );
    return;
  }

  // Pro gating
  const proGate = new ProGate();
  await proGate.initialize();

  // Tree providers
  const sentinelTree = new SentinelTreeProvider(client);
  const dojoTree = new DojoTreeProvider(client);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('decibel.sentinel', sentinelTree),
    vscode.window.registerTreeDataProvider('decibel.dojo', dojoTree),
  );

  // Commands
  registerCommands(context, client, outputChannel, sentinelTree, dojoTree, proGate);

  // Status bar
  const statusBarItem = createStatusBarItem(client);
  context.subscriptions.push(statusBarItem);

  // Auto-refresh timer
  const config = vscode.workspace.getConfiguration('decibel');
  if (config.get<boolean>('autoRefresh', true)) {
    const intervalSec = config.get<number>('autoRefreshInterval', 60);
    refreshTimer = setInterval(() => {
      sentinelTree.refresh();
      dojoTree.refresh();
    }, intervalSec * 1000);
  }

  // Watch for config changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('decibel.licenseKey') || e.affectsConfiguration('decibel.devMode')) {
        proGate.onConfigChange();
      }
      if (e.affectsConfiguration('decibel.autoRefresh') || e.affectsConfiguration('decibel.autoRefreshInterval')) {
        if (refreshTimer) {
          clearInterval(refreshTimer);
          refreshTimer = undefined;
        }
        const cfg = vscode.workspace.getConfiguration('decibel');
        if (cfg.get<boolean>('autoRefresh', true)) {
          const sec = cfg.get<number>('autoRefreshInterval', 60);
          refreshTimer = setInterval(() => {
            sentinelTree.refresh();
            dojoTree.refresh();
          }, sec * 1000);
        }
      }
    }),
  );

  outputChannel.appendLine('Decibel Tools extension activated');
}

export async function deactivate(): Promise<void> {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = undefined;
  }
  if (client) {
    await client.stop();
    client = undefined;
  }
}
