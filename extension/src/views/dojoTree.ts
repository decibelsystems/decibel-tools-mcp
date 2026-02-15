import * as vscode from 'vscode';
import { DecibelMcpClient } from '../mcpClient';
import type { WishSummary, ProposalSummary, ExperimentSummary, DojoListResponse } from '../types';

type TreeItem = GroupNode | WishNode | ProposalNode | ExperimentNode | MessageNode;

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
    public readonly children: (WishNode | ProposalNode | ExperimentNode)[],
  ) {
    super(label, children.length > 0
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.None);
    this.description = `${children.length}`;
    this.contextValue = 'group';
  }
}

class WishNode extends vscode.TreeItem {
  constructor(public readonly wish: WishSummary) {
    super(wish.capability, vscode.TreeItemCollapsibleState.None);
    this.id = `wish-${wish.id}`;
    this.description = wish.id;
    this.tooltip = `${wish.id}: ${wish.capability}\nReason: ${wish.reason}${wish.resolved_by ? `\nResolved by: ${wish.resolved_by}` : ''}`;
    this.contextValue = 'wish';
    this.iconPath = wish.resolved_by
      ? new vscode.ThemeIcon('pass', new vscode.ThemeColor('charts.green'))
      : new vscode.ThemeIcon('lightbulb', new vscode.ThemeColor('charts.yellow'));
  }
}

class ProposalNode extends vscode.TreeItem {
  constructor(public readonly proposal: ProposalSummary) {
    super(proposal.title, vscode.TreeItemCollapsibleState.None);
    this.id = `proposal-${proposal.id}`;
    this.description = `[${proposal.state}]`;
    this.tooltip = `${proposal.id}: ${proposal.title}\nOwner: ${proposal.owner}\nState: ${proposal.state}`;
    this.contextValue = 'proposal';
    this.iconPath = proposalIcon(proposal.state);
  }
}

class ExperimentNode extends vscode.TreeItem {
  constructor(public readonly experiment: ExperimentSummary) {
    super(experiment.title, vscode.TreeItemCollapsibleState.None);
    this.id = `experiment-${experiment.id}`;
    this.description = experiment.enabled ? 'enabled' : 'disabled';
    this.tooltip = `${experiment.id}: ${experiment.title}\nType: ${experiment.type}\nProposal: ${experiment.proposal_id}\nEnabled: ${experiment.enabled}`;
    this.contextValue = 'experiment';
    this.iconPath = experiment.enabled
      ? new vscode.ThemeIcon('beaker', new vscode.ThemeColor('charts.green'))
      : new vscode.ThemeIcon('beaker', new vscode.ThemeColor('disabledForeground'));
  }
}

function proposalIcon(state: string): vscode.ThemeIcon {
  switch (state) {
    case 'draft': return new vscode.ThemeIcon('file-text', new vscode.ThemeColor('charts.blue'));
    case 'has_experiment': return new vscode.ThemeIcon('beaker', new vscode.ThemeColor('charts.purple'));
    case 'enabled': return new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('charts.green'));
    default: return new vscode.ThemeIcon('file-text');
  }
}

export class DojoTreeProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private wishes: WishSummary[] = [];
  private proposals: ProposalSummary[] = [];
  private experiments: ExperimentSummary[] = [];
  private loadError: string | null = null;

  constructor(private readonly client: DecibelMcpClient) {}

  refresh(): void {
    this.wishes = [];
    this.proposals = [];
    this.experiments = [];
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

      if (this.wishes.length === 0 && this.proposals.length === 0 && this.experiments.length === 0) {
        return [new MessageNode('No wishes, proposals, or experiments yet', 'info')];
      }

      const wishGroup = new GroupNode(
        'Wishes',
        this.wishes.map(w => new WishNode(w)),
      );

      const proposalGroup = new GroupNode(
        'Proposals',
        this.proposals.map(p => new ProposalNode(p)),
      );

      const experimentGroup = new GroupNode(
        'Experiments',
        this.experiments.map(e => new ExperimentNode(e)),
      );

      return [wishGroup, proposalGroup, experimentGroup];
    }

    if (element instanceof GroupNode) {
      return element.children;
    }

    return [];
  }

  private async loadData(): Promise<void> {
    try {
      const res = await this.client.callFacade<DojoListResponse>('dojo', 'list');
      this.wishes = res.wishes || [];
      this.proposals = res.proposals || [];
      this.experiments = res.experiments || [];
      this.loadError = null;
    } catch (err) {
      this.loadError = err instanceof Error ? err.message : 'Failed to load incubation items';
    }
  }
}
