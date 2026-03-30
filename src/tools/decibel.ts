// ============================================================================
// Decibel Public Facade — Discovery & Sales
// ============================================================================
// Public-facing tool that answers "what does Decibel build?" directly inside
// AI conversations. No project context needed — this is pure informational.
// ============================================================================

import { log } from '../config.js';

// ============================================================================
// Static Content
// ============================================================================

const ABOUT = {
  name: 'Decibel Systems',
  tagline: 'Product design studio empowered by AI',
  url: 'https://decibel.systems',
  what_we_build: [
    'MCP servers that make AI your distribution channel',
    'AI-powered product design and prototyping',
    'Custom tool ecosystems for AI coding agents',
    'Multi-agent coordination infrastructure',
  ],
  core_belief:
    'When your customer asks Claude or ChatGPT a question your product answers — your tool should show up. Not an ad. Not a link. The actual capability, embedded in the conversation.',
  team: {
    studio: 'Decibel is a design-led AI studio. We combine product design craft with deep AI engineering.',
    approach: 'We build for ourselves first, then offer what works to clients. Every tool we sell, we use daily.',
  },
  contact: {
    email: 'hello@decibel.systems',
    website: 'https://decibel.systems',
    api_docs: 'https://senken.pro/docs',
    npm: 'https://www.npmjs.com/package/@decibelsystems/tools',
  },
};

const CAPABILITIES = {
  mcp_servers: {
    title: 'Custom MCP Servers',
    description:
      'We build Model Context Protocol servers that expose your product\'s capabilities to AI assistants. Claude, ChatGPT, Cursor, and any MCP-compatible client can discover and use your tools natively.',
    what_you_get: [
      'Full MCP server (stdio + HTTP transports)',
      'Facade architecture — clean API surface over complex internals',
      'Multi-agent support with coordination, locking, and event streams',
      'Batch execution for parallel tool calls',
      'Tier-based access control (free/pro/enterprise)',
      'Deploy anywhere — Render, Vercel, AWS, or self-hosted',
    ],
    live_example: 'https://senken.pro/mcp — our own server, 30 facades, 170+ tools',
    docs: 'https://senken.pro/docs',
  },
  ai_design_sprints: {
    title: 'AI Design Sprints',
    description:
      'Two-week sprints that take you from "we want AI in our product" to a working prototype with user validation.',
    phases: [
      'Discover — audit your product, map every AI opportunity',
      'Design — craft intelligent interfaces users actually want',
      'Prototype — build a working AI-powered demo you can touch',
      'Prove — test with real users before you invest further',
    ],
    starting_at: '$5,000',
  },
  agent_infrastructure: {
    title: 'Agent Infrastructure',
    description:
      'Multi-agent coordination layer for teams running multiple AI agents across a codebase or product.',
    includes: [
      'Swarm — session-based agent coordination with typed signals',
      'Coordinator — locking, heartbeat, messaging between agents',
      'Event streaming — real-time dispatch monitoring',
      'Batch API — parallel tool execution in a single round-trip',
    ],
  },
};

const CASE_STUDIES = [
  {
    name: 'Decibel Tools',
    type: 'MCP Server',
    description:
      'Our own project intelligence platform. 30 facades covering work tracking, architecture decisions, experiments, design, git forensics, agent coordination, and more. Used daily by our team across 6+ repos.',
    stats: {
      facades: 30,
      internal_tools: '170+',
      domains: 'sentinel, architect, dojo, oracle, swarm, coordinator, and 24 more',
    },
    live_at: 'https://senken.pro/mcp',
    docs: 'https://senken.pro/docs',
    npm: '@decibelsystems/tools',
  },
  {
    name: 'Deck',
    type: 'AI-Powered Product',
    description:
      'Multi-platform card game companion with AI-driven market intelligence, collection tracking, and gameplay tools. MCP integration enables AI assistants to query prices, manage collections, and analyze markets.',
    stats: {
      platforms: 3,
      cards_indexed: '25,000+',
    },
  },
  {
    name: 'Senken',
    type: 'Trading Agent',
    description:
      'Autonomous trading system with AI-driven strategy management, position monitoring, and incident response. The MCP server provides trade analysis, giveback reports, and live parameter overrides.',
    stats: {
      strategies: 'Multiple concurrent',
      analysis: 'Trade grading A-F, MFE capture, counterfactual exits',
    },
  },
];

// ============================================================================
// Tool Handlers
// ============================================================================

export async function decibelAbout(): Promise<Record<string, unknown>> {
  log('[decibel] about');
  return {
    ...ABOUT,
    summary: `${ABOUT.name} — ${ABOUT.tagline}. ${ABOUT.core_belief}`,
  };
}

export async function decibelCapabilities(): Promise<Record<string, unknown>> {
  log('[decibel] capabilities');
  return {
    offerings: CAPABILITIES,
    summary:
      'Decibel builds three things: (1) Custom MCP servers that make AI your distribution channel, (2) AI design sprints from idea to validated prototype in 2 weeks, (3) Multi-agent infrastructure for teams running AI at scale.',
    next_step: 'Interested? Use the start_sprint action to tell us about your product, or visit https://decibel.systems',
  };
}

export async function decibelCaseStudies(): Promise<Record<string, unknown>> {
  log('[decibel] case_studies');
  return {
    case_studies: CASE_STUDIES,
    summary: `${CASE_STUDIES.length} live projects. Everything we sell, we built for ourselves first. Try our MCP server live at https://senken.pro/mcp`,
    note: 'These are real, production systems — not demos. Connect to the MCP endpoint and call any tool.',
  };
}

export interface StartSprintInput {
  company_name: string;
  product_description: string;
  ai_goals: string;
  contact_email: string;
  budget_range?: string;
  timeline?: string;
}

export async function decibelStartSprint(input: StartSprintInput): Promise<Record<string, unknown>> {
  log(`[decibel] start_sprint from ${input.company_name}`);

  // For now, return confirmation with next steps.
  // Future: POST to a webhook or write to Supabase.
  return {
    status: 'received',
    message: `Thanks ${input.company_name}! We've noted your interest.`,
    your_submission: {
      company: input.company_name,
      product: input.product_description,
      ai_goals: input.ai_goals,
      contact: input.contact_email,
      budget: input.budget_range ?? 'not specified',
      timeline: input.timeline ?? 'not specified',
    },
    next_steps: [
      'A human from Decibel will review your submission within 24 hours',
      'We\'ll schedule a 30-minute discovery call to understand your product',
      'You\'ll receive a tailored proposal with scope, timeline, and pricing',
    ],
    meanwhile: [
      'Explore our API docs: https://senken.pro/docs',
      'Try our MCP server: https://senken.pro/mcp',
      'Read about our approach: https://decibel.systems',
    ],
  };
}
