import * as vscode from 'vscode';
import { DecibelMcpClient } from './mcpClient';
import { ProGate } from './proGate';
import { SentinelTreeProvider } from './views/sentinelTree';
import { DojoTreeProvider } from './views/dojoTree';

export function registerCommands(
  context: vscode.ExtensionContext,
  client: DecibelMcpClient,
  outputChannel: vscode.OutputChannel,
  sentinelTree: SentinelTreeProvider,
  dojoTree: DojoTreeProvider,
  proGate: ProGate,
): void {
  context.subscriptions.push(
    // Core commands
    vscode.commands.registerCommand('decibel.projectStatus', () =>
      projectStatus(client, outputChannel)),

    vscode.commands.registerCommand('decibel.preflight', () =>
      preflight(client, outputChannel)),

    vscode.commands.registerCommand('decibel.createIssue', () =>
      createIssue(client, sentinelTree)),

    vscode.commands.registerCommand('decibel.createEpic', () =>
      createEpic(client, sentinelTree)),

    vscode.commands.registerCommand('decibel.addWish', () =>
      addWish(client, dojoTree)),

    vscode.commands.registerCommand('decibel.refresh', () => {
      sentinelTree.refresh();
      dojoTree.refresh();
      vscode.window.showInformationMessage('Decibel: Refreshed');
    }),

    vscode.commands.registerCommand('decibel.showQuickPick', () =>
      showQuickPick(proGate)),

    // Pro activation
    vscode.commands.registerCommand('decibel.activate', () =>
      activatePro(proGate)),

    vscode.commands.registerCommand('decibel.deactivate', () =>
      deactivatePro(proGate)),

    // Pro commands
    vscode.commands.registerCommand('decibel.voiceSync', () =>
      requirePro(proGate, () => voiceSync(client, outputChannel))),

    vscode.commands.registerCommand('decibel.voiceCommand', () =>
      requirePro(proGate, () => voiceCommand(client, outputChannel))),
  );
}

function requirePro(proGate: ProGate, fn: () => Promise<void>): Promise<void> {
  if (!proGate.isPro) {
    vscode.window.showWarningMessage(
      'This feature requires Decibel Pro. Run "Decibel: Activate Pro" to enter your license key.',
    );
    return Promise.resolve();
  }
  return fn();
}

async function activatePro(proGate: ProGate): Promise<void> {
  const key = await vscode.window.showInputBox({
    prompt: 'Enter your Decibel Pro license key',
    placeHolder: 'DCBL-XXXX-XXXX-XXXX',
    password: false,
    validateInput: (value) => {
      if (!value) return null; // allow empty to cancel
      const upper = value.toUpperCase();
      if (!/^DCBL-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(upper)) {
        return 'Format: DCBL-XXXX-XXXX-XXXX';
      }
      return null;
    },
  });
  if (!key) return;

  const valid = await proGate.activate(key.toUpperCase());
  if (valid) {
    vscode.window.showInformationMessage('Decibel Pro activated!');
  } else {
    vscode.window.showErrorMessage('Invalid license key.');
  }
}

async function deactivatePro(proGate: ProGate): Promise<void> {
  const confirm = await vscode.window.showWarningMessage(
    'Deactivate Decibel Pro? Pro features will be hidden.',
    { modal: true },
    'Deactivate',
  );
  if (confirm !== 'Deactivate') return;

  await proGate.deactivate();
  vscode.window.showInformationMessage('Decibel Pro deactivated.');
}

// --- Core commands ---

async function projectStatus(client: DecibelMcpClient, output: vscode.OutputChannel): Promise<void> {
  try {
    const result = await client.callFacade<Record<string, unknown>>('workflow', 'status');
    output.clear();
    output.appendLine('=== Project Status ===');
    output.appendLine(JSON.stringify(result, null, 2));
    output.show(true);
  } catch (err) {
    vscode.window.showErrorMessage(`Project status failed: ${(err as Error).message}`);
  }
}

async function preflight(client: DecibelMcpClient, output: vscode.OutputChannel): Promise<void> {
  try {
    const result = await client.callFacade<Record<string, unknown>>('workflow', 'preflight');
    output.clear();
    output.appendLine('=== Preflight Check ===');
    output.appendLine(JSON.stringify(result, null, 2));
    output.show(true);
  } catch (err) {
    vscode.window.showErrorMessage(`Preflight failed: ${(err as Error).message}`);
  }
}

async function createIssue(client: DecibelMcpClient, tree: SentinelTreeProvider): Promise<void> {
  const title = await vscode.window.showInputBox({
    prompt: 'Issue title',
    placeHolder: 'Describe the issue...',
  });
  if (!title) return;

  const severity = await vscode.window.showQuickPick(
    ['low', 'med', 'high', 'critical'],
    { placeHolder: 'Select severity' },
  );
  if (!severity) return;

  try {
    const result = await client.callFacade<{ id: string }>('sentinel', 'create_issue', {
      title,
      severity,
    });
    vscode.window.showInformationMessage(`Issue created: ${result.id}`);
    tree.refresh();
  } catch (err) {
    vscode.window.showErrorMessage(`Create issue failed: ${(err as Error).message}`);
  }
}

async function createEpic(client: DecibelMcpClient, tree: SentinelTreeProvider): Promise<void> {
  const title = await vscode.window.showInputBox({
    prompt: 'Epic title',
    placeHolder: 'Name of the epic...',
  });
  if (!title) return;

  const summary = await vscode.window.showInputBox({
    prompt: 'Epic summary',
    placeHolder: 'Brief description of what this epic covers...',
  });
  if (!summary) return;

  try {
    const result = await client.callFacade<{ epic_id: string }>('sentinel', 'log_epic', {
      title,
      summary,
    });
    vscode.window.showInformationMessage(`Epic created: ${result.epic_id}`);
    tree.refresh();
  } catch (err) {
    vscode.window.showErrorMessage(`Create epic failed: ${(err as Error).message}`);
  }
}

async function addWish(client: DecibelMcpClient, tree: DojoTreeProvider): Promise<void> {
  const capability = await vscode.window.showInputBox({
    prompt: 'What capability do you wish for?',
    placeHolder: 'e.g., Bulk archive support...',
  });
  if (!capability) return;

  const reason = await vscode.window.showInputBox({
    prompt: 'Why do you want this?',
    placeHolder: 'e.g., Frequently need to clean up old items...',
  });
  if (!reason) return;

  try {
    const result = await client.callFacade<{ id: string }>('dojo', 'add_wish', {
      capability,
      reason,
    });
    vscode.window.showInformationMessage(`Wish added: ${result.id}`);
    tree.refresh();
  } catch (err) {
    vscode.window.showErrorMessage(`Add wish failed: ${(err as Error).message}`);
  }
}

// --- Pro commands ---

async function voiceSync(client: DecibelMcpClient, output: vscode.OutputChannel): Promise<void> {
  try {
    const result = await client.callFacade<Record<string, unknown>>('voice', 'inbox_sync');
    output.clear();
    output.appendLine('=== Voice Inbox Sync ===');
    output.appendLine(JSON.stringify(result, null, 2));
    output.show(true);
  } catch (err) {
    vscode.window.showErrorMessage(`Voice sync failed: ${(err as Error).message}`);
  }
}

async function voiceCommand(client: DecibelMcpClient, output: vscode.OutputChannel): Promise<void> {
  const command = await vscode.window.showInputBox({
    prompt: 'Voice command text',
    placeHolder: 'e.g., Create an issue for the login bug...',
  });
  if (!command) return;

  try {
    const result = await client.callFacade<Record<string, unknown>>('voice', 'command', {
      text: command,
    });
    output.clear();
    output.appendLine('=== Voice Command Result ===');
    output.appendLine(JSON.stringify(result, null, 2));
    output.show(true);
  } catch (err) {
    vscode.window.showErrorMessage(`Voice command failed: ${(err as Error).message}`);
  }
}

// --- Quick pick ---

async function showQuickPick(proGate: ProGate): Promise<void> {
  const items: vscode.QuickPickItem[] = [
    { label: '$(pulse) Project Status', description: 'Show project health', detail: 'decibel.projectStatus' },
    { label: '$(checklist) Preflight Check', description: 'Run pre-commit checks', detail: 'decibel.preflight' },
    { label: '$(issues) Create Issue', description: 'Log a new issue', detail: 'decibel.createIssue' },
    { label: '$(milestone) Create Epic', description: 'Start a new epic', detail: 'decibel.createEpic' },
    { label: '$(lightbulb) Add Wish', description: 'Add a capability wish', detail: 'decibel.addWish' },
    { label: '$(refresh) Refresh', description: 'Refresh all views', detail: 'decibel.refresh' },
  ];

  if (proGate.isPro) {
    items.push(
      { label: '', kind: vscode.QuickPickItemKind.Separator },
      { label: '$(mic) Sync Voice Inbox', description: 'Pro', detail: 'decibel.voiceSync' },
      { label: '$(comment) Voice Command', description: 'Pro', detail: 'decibel.voiceCommand' },
    );
  } else {
    items.push(
      { label: '', kind: vscode.QuickPickItemKind.Separator },
      { label: '$(key) Activate Pro', description: 'Enter license key', detail: 'decibel.activate' },
    );
  }

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Decibel Tools',
  });

  if (picked?.detail) {
    vscode.commands.executeCommand(picked.detail);
  }
}
