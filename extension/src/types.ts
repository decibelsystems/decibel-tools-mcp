// Response interfaces matching MCP server shapes
// See: src/tools/sentinel.ts, src/tools/dojo.ts

export interface EpicSummary {
  id: string;       // "EPIC-0001"
  title: string;
  status: 'planned' | 'in_progress' | 'shipped' | 'on_hold' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'critical';
}

export interface IssueSummary {
  id: string;       // filename-based
  title: string;
  severity: 'low' | 'med' | 'high' | 'critical';
  status: 'open' | 'closed' | 'wontfix';
}

export interface WishSummary {
  id: string;       // "WISH-0001"
  capability: string;
  reason: string;
  resolved_by?: string;
}

export interface ProposalSummary {
  id: string;       // "DOJO-PROP-0001"
  title: string;
  owner: 'ai' | 'human';
  state: 'draft' | 'has_experiment' | 'enabled';
}

export interface ExperimentSummary {
  id: string;       // "DOJO-EXP-0001"
  proposal_id: string;
  title: string;
  type: 'script' | 'tool' | 'check' | 'prompt';
  enabled: boolean;
}

// Sentinel response envelopes
export interface ListEpicsResponse {
  epics: EpicSummary[];
}

export interface ListIssuesResponse {
  issues: IssueSummary[];
}

export interface CreateIssueResponse {
  id: string;
  timestamp: string;
  path: string;
  status: string;
}

// Dojo response envelope
export interface DojoListResponse {
  proposals: ProposalSummary[];
  experiments: ExperimentSummary[];
  wishes: WishSummary[];
  summary: {
    total_proposals: number;
    total_experiments: number;
    total_wishes: number;
    enabled_count: number;
  };
}

// Error response
export interface ErrorResponse {
  error: string;
  message?: string;
  suggestion?: string;
}
