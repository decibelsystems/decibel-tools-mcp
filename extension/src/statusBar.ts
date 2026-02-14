import * as vscode from 'vscode';
import { DecibelMcpClient } from './mcpClient';

export function createStatusBarItem(client: DecibelMcpClient): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  item.command = 'decibel.showQuickPick';
  updateStatusBarItem(item, client);
  item.show();
  return item;
}

export function updateStatusBarItem(item: vscode.StatusBarItem, client: DecibelMcpClient): void {
  if (client.mode === 'bridge') {
    item.text = '$(pulse) Decibel (daemon)';
    item.tooltip = 'Decibel Tools — connected via daemon bridge';
  } else {
    item.text = '$(pulse) Decibel';
    item.tooltip = 'Decibel Tools — local stdio';
  }
}
