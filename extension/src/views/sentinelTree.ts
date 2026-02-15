import * as vscode from 'vscode';
import { DecibelMcpClient } from '../mcpClient';
import type { EpicSummary, IssueSummary, ListEpicsResponse, ListIssuesResponse } from '../types';

type TreeItem = GroupNode | EpicNode | IssueNode | MessageNode;

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
    public readonly children: (EpicNode | IssueNode)[],
  ) {
    super(label, children.length > 0
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.None);
    this.description = `${children.length}`;
    this.contextValue = 'group';
  }
}

class EpicNode extends vscode.TreeItem {
  constructor(public readonly epic: EpicSummary) {
    super(epic.title, vscode.TreeItemCollapsibleState.None);
    this.id = `epic-${epic.id}`;
    this.description = `[${epic.priority}]`;
    this.tooltip = `${epic.id}: ${epic.title}\nStatus: ${epic.status}\nPriority: ${epic.priority}`;
    this.contextValue = 'epic';
    this.iconPath = epicIcon(epic.status);
  }
}

class IssueNode extends vscode.TreeItem {
  constructor(public readonly issue: IssueSummary) {
    super(issue.title, vscode.TreeItemCollapsibleState.None);
    this.id = `issue-${issue.id}`;
    this.description = `[${issue.severity}]`;
    this.tooltip = `${issue.title}\nSeverity: ${issue.severity}\nStatus: ${issue.status}`;
    this.contextValue = 'issue';
    this.iconPath = issueIcon(issue.status);
  }
}

function epicIcon(status: string): vscode.ThemeIcon {
  switch (status) {
    case 'in_progress': return new vscode.ThemeIcon('play-circle', new vscode.ThemeColor('charts.green'));
    case 'planned': return new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('charts.blue'));
    case 'shipped': return new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('charts.green'));
    case 'on_hold': return new vscode.ThemeIcon('debug-pause', new vscode.ThemeColor('charts.yellow'));
    case 'cancelled': return new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('charts.red'));
    default: return new vscode.ThemeIcon('circle-outline');
  }
}

function issueIcon(status: string): vscode.ThemeIcon {
  switch (status) {
    case 'open': return new vscode.ThemeIcon('issues', new vscode.ThemeColor('charts.orange'));
    case 'closed': return new vscode.ThemeIcon('pass', new vscode.ThemeColor('charts.green'));
    case 'wontfix': return new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('disabledForeground'));
    default: return new vscode.ThemeIcon('issues');
  }
}

const EPIC_STATUS_ORDER = ['in_progress', 'planned', 'on_hold', 'shipped', 'cancelled'] as const;
const EPIC_STATUS_LABELS: Record<string, string> = {
  in_progress: 'In Progress',
  planned: 'Planned',
  shipped: 'Shipped',
  on_hold: 'On Hold',
  cancelled: 'Cancelled',
};

export class SentinelTreeProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private epics: EpicSummary[] = [];
  private issues: IssueSummary[] = [];
  private loadError: string | null = null;

  constructor(private readonly client: DecibelMcpClient) {}

  refresh(): void {
    this.epics = [];
    this.issues = [];
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

    // Root level: Epics + Issues groups
    if (!element) {
      await this.loadData();

      if (this.loadError) {
        return [new MessageNode(this.loadError, 'warning')];
      }

      if (this.epics.length === 0 && this.issues.length === 0) {
        return [new MessageNode('No epics or issues yet', 'info')];
      }

      const epicGroups = this.buildEpicGroups();
      const issueGroups = this.buildIssueGroups();

      const epicsRoot = new GroupNode('Epics', []);
      epicsRoot.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
      epicsRoot.description = `${this.epics.length}`;
      (epicsRoot as any)._children = epicGroups;

      const issuesRoot = new GroupNode('Issues', []);
      issuesRoot.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
      issuesRoot.description = `${this.issues.length}`;
      (issuesRoot as any)._children = issueGroups;

      return [epicsRoot, issuesRoot];
    }

    // Sub-groups under Epics/Issues
    if (element instanceof GroupNode) {
      const subChildren = (element as any)._children;
      if (subChildren) return subChildren;
      return element.children;
    }

    return [];
  }

  private async loadData(): Promise<void> {
    try {
      const [epicRes, issueRes] = await Promise.all([
        this.client.callFacade<ListEpicsResponse>('sentinel', 'list_epics'),
        this.client.callFacade<ListIssuesResponse>('sentinel', 'list_issues'),
      ]);
      this.epics = epicRes.epics || [];
      this.issues = issueRes.issues || [];
      this.loadError = null;
    } catch (err) {
      this.loadError = err instanceof Error ? err.message : 'Failed to load work items';
    }
  }

  private buildEpicGroups(): GroupNode[] {
    const byStatus = new Map<string, EpicSummary[]>();
    for (const epic of this.epics) {
      const list = byStatus.get(epic.status) || [];
      list.push(epic);
      byStatus.set(epic.status, list);
    }

    const groups: GroupNode[] = [];
    for (const status of EPIC_STATUS_ORDER) {
      const items = byStatus.get(status);
      if (!items || items.length === 0) continue;
      const label = `${EPIC_STATUS_LABELS[status] || status}`;
      const nodes = items.map(e => new EpicNode(e));
      const group = new GroupNode(label, nodes);
      group.collapsibleState = status === 'in_progress'
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed;
      groups.push(group);
    }
    return groups;
  }

  private buildIssueGroups(): GroupNode[] {
    const open = this.issues.filter(i => i.status === 'open');
    const closed = this.issues.filter(i => i.status !== 'open');

    const groups: GroupNode[] = [];
    if (open.length > 0) {
      const g = new GroupNode('Open', open.map(i => new IssueNode(i)));
      g.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
      groups.push(g);
    }
    if (closed.length > 0) {
      const g = new GroupNode('Closed', closed.map(i => new IssueNode(i)));
      g.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
      groups.push(g);
    }
    return groups;
  }
}
