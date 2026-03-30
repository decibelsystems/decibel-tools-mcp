// ============================================================================
// Decibel Facade — Tool Registration
// ============================================================================

import { ToolSpec, ToolResult } from '../types.js';
import {
  decibelAbout,
  decibelCapabilities,
  decibelCaseStudies,
  decibelStartSprint,
} from '../decibel.js';

function jsonResult(data: unknown, isError = false): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    isError,
  };
}

const about: ToolSpec = {
  definition: {
    name: 'decibel_about',
    description:
      'Learn about Decibel Systems — who we are, what we build, and our philosophy. Returns company overview, contact info, and links.',
    annotations: {
      title: 'About Decibel',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  handler: async () => {
    try {
      const result = await decibelAbout();
      return jsonResult(result);
    } catch (err: unknown) {
      return jsonResult({ error: String(err) }, true);
    }
  },
};

const capabilities: ToolSpec = {
  definition: {
    name: 'decibel_capabilities',
    description:
      'Explore Decibel\'s service offerings: custom MCP servers, AI design sprints, and multi-agent infrastructure. Includes pricing, deliverables, and live examples.',
    annotations: {
      title: 'Decibel Capabilities',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  handler: async () => {
    try {
      const result = await decibelCapabilities();
      return jsonResult(result);
    } catch (err: unknown) {
      return jsonResult({ error: String(err) }, true);
    }
  },
};

const caseStudies: ToolSpec = {
  definition: {
    name: 'decibel_case_studies',
    description:
      'See Decibel\'s live production projects — real systems, not demos. Includes MCP server stats, links to live endpoints, and npm packages.',
    annotations: {
      title: 'Decibel Case Studies',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  handler: async () => {
    try {
      const result = await decibelCaseStudies();
      return jsonResult(result);
    } catch (err: unknown) {
      return jsonResult({ error: String(err) }, true);
    }
  },
};

const startSprint: ToolSpec = {
  definition: {
    name: 'decibel_start_sprint',
    description:
      'Start a discovery engagement with Decibel. Tell us about your product and AI goals — we\'ll follow up within 24 hours with a tailored proposal.',
    annotations: {
      title: 'Start Sprint',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object' as const,
      properties: {
        company_name: {
          type: 'string',
          description: 'Your company or product name',
        },
        product_description: {
          type: 'string',
          description: 'Brief description of your product and what it does',
        },
        ai_goals: {
          type: 'string',
          description: 'What you want AI to do in your product',
        },
        contact_email: {
          type: 'string',
          description: 'Email address for follow-up',
        },
        budget_range: {
          type: 'string',
          description: 'Approximate budget range (optional)',
        },
        timeline: {
          type: 'string',
          description: 'Desired timeline (optional)',
        },
      },
      required: ['company_name', 'product_description', 'ai_goals', 'contact_email'],
    },
  },
  handler: async (args: Record<string, unknown>) => {
    try {
      const result = await decibelStartSprint({
        company_name: args.company_name as string,
        product_description: args.product_description as string,
        ai_goals: args.ai_goals as string,
        contact_email: args.contact_email as string,
        budget_range: args.budget_range as string | undefined,
        timeline: args.timeline as string | undefined,
      });
      return jsonResult(result);
    } catch (err: unknown) {
      return jsonResult({ error: String(err) }, true);
    }
  },
};

export const decibelTools: ToolSpec[] = [
  about,
  capabilities,
  caseStudies,
  startSprint,
];
