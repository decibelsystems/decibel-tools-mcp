import * as vscode from 'vscode';
import { DecibelMcpClient } from '../mcpClient';

type TreeItem = GroupNode | VoiceItemNode | MessageNode;

interface VoiceInboxItem {
  id: string;
  transcript: string;
  source: string;
  created_at: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  intent?: string;
  intent_confidence?: number;
  error?: string;
  tags?: string[];
}

interface VoiceInboxListResponse {
  items: VoiceInboxItem[];
  total: number;
  by_status: Record<string, number>;
}

class MessageNode extends vscode.TreeItem {
  constructor(message: string, icon?: string) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'message';
    if (icon) this.iconPath = new vscode.ThemeIcon(icon);
  }
}

class GroupNode extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly children: VoiceItemNode[],
  ) {
    super(label, children.length > 0
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.None);
    this.description = `${children.length}`;
    this.contextValue = 'group';
  }
}

class VoiceItemNode extends vscode.TreeItem {
  constructor(public readonly item: VoiceInboxItem) {
    const preview = item.transcript.length > 60
      ? item.transcript.slice(0, 57) + '...'
      : item.transcript;
    super(preview, vscode.TreeItemCollapsibleState.None);
    this.id = `voice-${item.id}`;
    this.description = item.intent || item.source;
    this.tooltip = [
      `ID: ${item.id}`,
      `Status: ${item.status}`,
      `Source: ${item.source}`,
      `Intent: ${item.intent || 'unknown'}`,
      item.created_at ? `Time: ${new Date(item.created_at).toLocaleString()}` : '',
      '',
      item.transcript,
      item.error ? `\nError: ${item.error}` : '',
    ].filter(Boolean).join('\n');
    this.contextValue = 'voiceItem';
    this.iconPath = voiceItemIcon(item.status);
  }
}

function voiceItemIcon(status: string): vscode.ThemeIcon {
  switch (status) {
    case 'queued': return new vscode.ThemeIcon('inbox', new vscode.ThemeColor('charts.blue'));
    case 'processing': return new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.yellow'));
    case 'completed': return new vscode.ThemeIcon('pass', new vscode.ThemeColor('charts.green'));
    case 'failed': return new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
    default: return new vscode.ThemeIcon('mail');
  }
}

const STATUS_ORDER = ['queued', 'processing', 'failed', 'completed'] as const;
const STATUS_LABELS: Record<string, string> = {
  queued: 'Queued',
  processing: 'Processing',
  completed: 'Completed',
  failed: 'Failed',
};

export class VoiceTreeProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private items: VoiceInboxItem[] = [];
  private loadError: string | null = null;

  constructor(private readonly client: DecibelMcpClient) {}

  refresh(): void {
    this.items = [];
    this.loadError = null;
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TreeItem): Promise<TreeItem[]> {
    if (!this.client.isConnected) {
      return [new MessageNode('MCP server not connected', 'warning')];
    }

    if (!element) {
      await this.loadData();

      if (this.loadError) {
        return [new MessageNode(this.loadError, 'warning')];
      }

      if (this.items.length === 0) {
        return [new MessageNode('No voice messages', 'info')];
      }

      // Group by status
      const byStatus = new Map<string, VoiceInboxItem[]>();
      for (const item of this.items) {
        const list = byStatus.get(item.status) || [];
        list.push(item);
        byStatus.set(item.status, list);
      }

      const groups: GroupNode[] = [];
      for (const status of STATUS_ORDER) {
        const statusItems = byStatus.get(status);
        if (!statusItems || statusItems.length === 0) continue;
        const label = STATUS_LABELS[status] || status;
        const nodes = statusItems.map(i => new VoiceItemNode(i));
        const group = new GroupNode(label, nodes);
        group.collapsibleState = status === 'queued' || status === 'failed'
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed;
        groups.push(group);
      }
      return groups;
    }

    if (element instanceof GroupNode) {
      return element.children;
    }

    return [];
  }

  private async loadData(): Promise<void> {
    try {
      const res = await this.client.callFacade<VoiceInboxListResponse>('voice', 'inbox_list');
      this.items = res.items || [];
      this.loadError = null;
    } catch (err) {
      this.loadError = err instanceof Error ? err.message : 'Failed to load voice inbox';
      this.items = [];
    }
  }
}
