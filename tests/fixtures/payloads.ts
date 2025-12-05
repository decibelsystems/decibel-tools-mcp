/**
 * Sample input payloads for testing Decibel MCP tools.
 * Use these for consistent test data across unit, integration, and E2E tests.
 */

import type { RecordDesignDecisionInput } from '../../src/tools/designer.js';
import type { RecordArchDecisionInput } from '../../src/tools/architect.js';
import type {
  CreateIssueInput,
  Severity,
  LogEpicInput,
  ListEpicsInput,
  GetEpicInput,
  GetEpicIssuesInput,
  ResolveEpicInput,
  EpicStatus,
  Priority,
} from '../../src/tools/sentinel.js';
import type { NextActionsInput } from '../../src/tools/oracle.js';

// ============================================================================
// Designer Payloads
// ============================================================================

export const designerPayloads = {
  /** Minimal valid payload */
  minimal: {
    project_id: 'test-project',
    area: 'API',
    summary: 'Use REST endpoints',
  } satisfies RecordDesignDecisionInput,

  /** Full payload with all fields */
  full: {
    project_id: 'ecommerce-platform',
    area: 'Database',
    summary: 'Use PostgreSQL for relational data',
    details: `We evaluated several database options:
- PostgreSQL: Strong JSON support, ACID compliance, mature ecosystem
- MySQL: Good performance but weaker JSON support
- MongoDB: Flexible but harder to maintain consistency

Decision: PostgreSQL provides the best balance of flexibility and reliability.`,
  } satisfies RecordDesignDecisionInput,

  /** UI/UX decision */
  uiDecision: {
    project_id: 'mobile-app',
    area: 'UI/UX',
    summary: 'Implement dark mode as default',
    details: 'User research shows 73% of users prefer dark mode. Battery savings on OLED screens.',
  } satisfies RecordDesignDecisionInput,

  /** Security decision */
  securityDecision: {
    project_id: 'auth-service',
    area: 'Security',
    summary: 'Use JWT with short expiry and refresh tokens',
    details: 'Access tokens expire in 15 minutes. Refresh tokens stored httpOnly, rotated on use.',
  } satisfies RecordDesignDecisionInput,

  /** Decision with special characters */
  specialChars: {
    project_id: 'test-project',
    area: 'API',
    summary: 'Handle UTF-8 & special chars: "quotes", <brackets>, émojis 🎉',
  } satisfies RecordDesignDecisionInput,

  /** Decision with very long summary (for slug truncation) */
  longSummary: {
    project_id: 'test-project',
    area: 'Architecture',
    summary: 'This is an extremely long summary that should be truncated when generating the filename slug because it exceeds the maximum allowed length for filesystem safety',
  } satisfies RecordDesignDecisionInput,
};

// ============================================================================
// Architect Payloads
// ============================================================================

export const architectPayloads = {
  /** Minimal valid payload */
  minimal: {
    system_id: 'main-backend',
    change: 'Add caching layer',
    rationale: 'Reduce database load during peak traffic',
  } satisfies RecordArchDecisionInput,

  /** Full ADR with impact */
  full: {
    system_id: 'payment-system',
    change: 'Migrate from monolith to microservices',
    rationale: `Current challenges:
1. Deployments require full system restart
2. Single point of failure
3. Teams blocked on shared codebase

Microservices allow independent deployment and scaling.`,
    impact: `Breaking changes:
- API versioning required
- New infrastructure (K8s, service mesh)
- Team restructuring around services
- 3-6 month migration timeline`,
  } satisfies RecordArchDecisionInput,

  /** Database migration ADR */
  databaseMigration: {
    system_id: 'data-platform',
    change: 'Switch from MySQL to PostgreSQL',
    rationale: 'Need better JSON support and advanced indexing for analytics workloads.',
    impact: 'Requires data migration scripts and ORM updates. Estimated 2 weeks of work.',
  } satisfies RecordArchDecisionInput,

  /** Event-driven architecture ADR */
  eventDriven: {
    system_id: 'order-service',
    change: 'Implement event sourcing for order lifecycle',
    rationale: 'Need complete audit trail and ability to replay events for debugging.',
    impact: 'New event store required. Existing queries need CQRS read models.',
  } satisfies RecordArchDecisionInput,

  /** Security architecture ADR */
  securityArch: {
    system_id: 'api-gateway',
    change: 'Add rate limiting and circuit breaker patterns',
    rationale: 'Protect downstream services from traffic spikes and cascading failures.',
  } satisfies RecordArchDecisionInput,
};

// ============================================================================
// Sentinel Payloads
// ============================================================================

export const sentinelPayloads = {
  /** Low severity issue */
  low: {
    repo: 'frontend-app',
    severity: 'low' as Severity,
    title: 'Typo in error message',
    details: 'Login error says "Invlaid password" instead of "Invalid password".',
  } satisfies CreateIssueInput,

  /** Medium severity issue */
  med: {
    repo: 'api-service',
    severity: 'med' as Severity,
    title: 'Slow query on user search',
    details: 'User search endpoint takes >2s for queries with wildcards. Missing index suspected.',
  } satisfies CreateIssueInput,

  /** High severity issue */
  high: {
    repo: 'payment-service',
    severity: 'high' as Severity,
    title: 'Memory leak in transaction processor',
    details: `Memory usage grows from 256MB to 2GB over 24 hours.
Suspected cause: unclosed database connections in batch processor.
Workaround: Daily restart via cron.`,
  } satisfies CreateIssueInput,

  /** Critical severity issue */
  critical: {
    repo: 'auth-service',
    severity: 'critical' as Severity,
    title: 'SQL injection vulnerability in login endpoint',
    details: `CRITICAL: User input not sanitized in login query.
Discovered during security audit.
Immediate action required - consider taking endpoint offline.`,
  } satisfies CreateIssueInput,

  /** Security issue */
  securityIssue: {
    repo: 'api-gateway',
    severity: 'high' as Severity,
    title: 'Exposed API keys in error responses',
    details: 'Stack traces in 500 errors include environment variables with API keys.',
  } satisfies CreateIssueInput,

  /** Performance issue */
  performanceIssue: {
    repo: 'search-service',
    severity: 'med' as Severity,
    title: 'Search latency increased 3x after deployment',
    details: 'P99 latency went from 200ms to 600ms after v2.3.0 deployment. Rollback pending.',
  } satisfies CreateIssueInput,

  /** Issue linked to epic */
  withEpic: {
    repo: 'ecommerce-platform',
    severity: 'med' as Severity,
    title: 'Payment timeout handling',
    details: 'Need to handle Stripe webhook timeouts gracefully.',
    epic_id: 'EPIC-0001',
  } satisfies CreateIssueInput,
};

// ============================================================================
// Epic Payloads
// ============================================================================

export const epicPayloads = {
  /** Minimal valid payload */
  minimal: {
    repo: 'test-repo',
    title: 'Test Epic',
    summary: 'A test epic for validation',
  } satisfies LogEpicInput,

  /** Full payload with all fields */
  full: {
    repo: 'ecommerce-platform',
    title: 'Checkout Flow Redesign',
    summary: 'Complete overhaul of the checkout experience to reduce abandonment.',
    priority: 'high' as Priority,
    status: 'in_progress' as EpicStatus,
  } satisfies LogEpicInput,

  /** Feature epic */
  feature: {
    repo: 'mobile-app',
    title: 'Dark Mode Implementation',
    summary: 'Add dark mode theme support across all screens.',
    priority: 'med' as Priority,
    status: 'planned' as EpicStatus,
  } satisfies LogEpicInput,

  /** Security epic */
  security: {
    repo: 'auth-service',
    title: 'OAuth 2.0 Migration',
    summary: 'Migrate from custom auth to OAuth 2.0 with PKCE.',
    priority: 'critical' as Priority,
    status: 'in_progress' as EpicStatus,
  } satisfies LogEpicInput,

  /** Performance epic */
  performance: {
    repo: 'api-service',
    title: 'Database Query Optimization',
    summary: 'Optimize slow queries identified in APM dashboard.',
    priority: 'high' as Priority,
    status: 'planned' as EpicStatus,
  } satisfies LogEpicInput,

  /** Completed epic */
  shipped: {
    repo: 'frontend-app',
    title: 'Accessibility Improvements',
    summary: 'WCAG 2.1 AA compliance for all public pages.',
    priority: 'med' as Priority,
    status: 'shipped' as EpicStatus,
  } satisfies LogEpicInput,

  /** On-hold epic */
  onHold: {
    repo: 'data-platform',
    title: 'Real-time Analytics Pipeline',
    summary: 'Stream processing for live dashboards.',
    priority: 'low' as Priority,
    status: 'on_hold' as EpicStatus,
  } satisfies LogEpicInput,
};

export const listEpicsPayloads = {
  /** List all epics for a repo */
  all: {
    repo: 'test-repo',
  } satisfies ListEpicsInput,

  /** List epics filtered by status */
  byStatus: {
    repo: 'test-repo',
    status: 'in_progress' as EpicStatus,
  } satisfies ListEpicsInput,

  /** List epics for empty repo */
  emptyRepo: {
    repo: 'non-existent-repo-12345',
  } satisfies ListEpicsInput,
};

export const getEpicPayloads = {
  /** Get a specific epic */
  valid: {
    repo: 'test-repo',
    epic_id: 'EPIC-0001',
  } satisfies GetEpicInput,

  /** Get non-existent epic */
  nonExistent: {
    repo: 'test-repo',
    epic_id: 'EPIC-9999',
  } satisfies GetEpicInput,
};

export const getEpicIssuesPayloads = {
  /** Get issues for an epic */
  valid: {
    repo: 'test-repo',
    epic_id: 'EPIC-0001',
  } satisfies GetEpicIssuesInput,

  /** Get issues for epic with no issues */
  empty: {
    repo: 'test-repo',
    epic_id: 'EPIC-0002',
  } satisfies GetEpicIssuesInput,
};

export const resolveEpicPayloads = {
  /** Search by epic ID */
  byId: {
    query: 'EPIC-0001',
  } satisfies ResolveEpicInput,

  /** Search by title keyword */
  byKeyword: {
    query: 'MCP Server',
  } satisfies ResolveEpicInput,

  /** Search with limit */
  withLimit: {
    query: 'Epic',
    limit: 3,
  } satisfies ResolveEpicInput,

  /** Search with no matches expected */
  noMatches: {
    query: 'xyz-nonexistent-12345',
  } satisfies ResolveEpicInput,

  /** Case insensitive search */
  caseInsensitive: {
    query: 'mcp SERVER',
  } satisfies ResolveEpicInput,

  /** Partial word match */
  partialMatch: {
    query: 'auth',
  } satisfies ResolveEpicInput,
};

// ============================================================================
// Oracle Payloads
// ============================================================================

export const oraclePayloads = {
  /** Simple project query */
  simpleQuery: {
    project_id: 'test-project',
  } satisfies NextActionsInput,

  /** Query with focus filter */
  withFocus: {
    project_id: 'test-project',
    focus: 'sentinel',
  } satisfies NextActionsInput,

  /** Query for non-existent project */
  emptyProject: {
    project_id: 'non-existent-project-12345',
  } satisfies NextActionsInput,

  /** Query with keyword focus */
  keywordFocus: {
    project_id: 'test-project',
    focus: 'security',
  } satisfies NextActionsInput,

  /** Query for architect focus */
  architectFocus: {
    project_id: 'test-project',
    focus: 'architect',
  } satisfies NextActionsInput,

  /** Query for designer focus */
  designerFocus: {
    project_id: 'test-project',
    focus: 'designer',
  } satisfies NextActionsInput,
};

// ============================================================================
// Combined Scenarios
// ============================================================================

/**
 * A complete project scenario with multiple decisions and issues.
 * Use this to populate a test project with realistic data.
 */
export const projectScenario = {
  projectId: 'ecommerce-platform',

  designDecisions: [
    {
      project_id: 'ecommerce-platform',
      area: 'API',
      summary: 'Use GraphQL for product catalog',
      details: 'Flexible querying for varied frontend needs.',
    },
    {
      project_id: 'ecommerce-platform',
      area: 'Payments',
      summary: 'Integrate Stripe for payment processing',
      details: 'Best developer experience and global coverage.',
    },
  ] satisfies RecordDesignDecisionInput[],

  archDecisions: [
    {
      system_id: 'ecommerce-platform',
      change: 'Implement CQRS for order management',
      rationale: 'Separate read/write concerns for scalability.',
      impact: 'Requires event store and projection rebuilding.',
    },
  ] satisfies RecordArchDecisionInput[],

  issues: [
    {
      repo: 'ecommerce-platform',
      severity: 'high' as Severity,
      title: 'Cart abandonment rate increased',
      details: 'Checkout flow has 40% abandonment. Investigate UX issues.',
    },
    {
      repo: 'ecommerce-platform',
      severity: 'med' as Severity,
      title: 'Image CDN latency in Asia',
      details: 'Product images slow to load in APAC region.',
    },
  ] satisfies CreateIssueInput[],
};

// ============================================================================
// Invalid Payloads (for error testing)
// ============================================================================

export const invalidPayloads = {
  designer: {
    missingProjectId: { area: 'API', summary: 'Test' },
    missingArea: { project_id: 'test', summary: 'Test' },
    missingSummary: { project_id: 'test', area: 'API' },
    emptyProjectId: { project_id: '', area: 'API', summary: 'Test' },
  },

  architect: {
    missingSystemId: { change: 'Test', rationale: 'Test' },
    missingChange: { system_id: 'test', rationale: 'Test' },
    missingRationale: { system_id: 'test', change: 'Test' },
  },

  sentinel: {
    missingRepo: { severity: 'low', title: 'Test', details: 'Test' },
    missingSeverity: { repo: 'test', title: 'Test', details: 'Test' },
    missingTitle: { repo: 'test', severity: 'low', details: 'Test' },
    missingDetails: { repo: 'test', severity: 'low', title: 'Test' },
    invalidSeverity: { repo: 'test', severity: 'invalid', title: 'Test', details: 'Test' },
  },

  epic: {
    missingRepo: { title: 'Test', summary: 'Test' },
    missingTitle: { repo: 'test', summary: 'Test' },
    missingSummary: { repo: 'test', title: 'Test' },
    invalidPriority: { repo: 'test', title: 'Test', summary: 'Test', priority: 'invalid' },
    invalidStatus: { repo: 'test', title: 'Test', summary: 'Test', status: 'invalid' },
  },

  oracle: {
    missingProjectId: {},
    emptyProjectId: { project_id: '' },
  },
};
