/**
 * Concepts Domain — pre-project product ideas.
 *
 * Discrete from dojo: dojo wishes/proposals are *feature-scoped* (a capability
 * inside an existing project). Concepts are *project-scoped* — a candidate for
 * a NEW project that doesn't yet exist. Once a concept is committed, it
 * graduates to a real project (project_init + registry_add stay separate
 * deliberately, so the user sees what's happening).
 *
 * Storage: ~/.decibel/concepts/<id>.yaml — user-level, cross-project. Concepts
 * have no project_id by definition; they are pre-project artifacts. The
 * graduated_to field links a committed concept to its eventual project_id.
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import YAML from 'yaml';
import { ToolSpec } from './types.js';
import { toolSuccess, toolError, requireFields } from './shared/index.js';

// ============================================================================
// Types & Storage
// ============================================================================

export type ConceptStatus = 'ideating' | 'exploring' | 'committed' | 'shelved';

export interface Concept {
  id: string;
  title: string;
  pitch: string;
  problem: string;
  why_now?: string;
  status: ConceptStatus;
  tags: string[];
  prior_attempts: string[];
  graduated_to: string | null;
  graduated_at: string | null;
  shelved_reason: string | null;
  shelved_at: string | null;
  created_at: string;
  updated_at: string;
}

const CONCEPTS_DIR = path.join(os.homedir(), '.decibel', 'concepts');

async function ensureConceptsDir(): Promise<void> {
  await fs.mkdir(CONCEPTS_DIR, { recursive: true });
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);
}

function generateId(title: string, when = new Date()): string {
  const date = when.toISOString().slice(0, 10);
  const slug = slugify(title) || 'concept';
  const suffix = Math.random().toString(36).slice(2, 5);
  return `concept-${date}-${slug}-${suffix}`;
}

function conceptPath(id: string): string {
  return path.join(CONCEPTS_DIR, `${id}.yaml`);
}

async function readConcept(id: string): Promise<Concept | null> {
  try {
    const raw = await fs.readFile(conceptPath(id), 'utf-8');
    return YAML.parse(raw) as Concept;
  } catch {
    return null;
  }
}

async function writeConcept(concept: Concept): Promise<void> {
  await ensureConceptsDir();
  const yaml = YAML.stringify(concept, { lineWidth: 0 });
  await fs.writeFile(conceptPath(concept.id), yaml, 'utf-8');
}

// ============================================================================
// Tools
// ============================================================================

export const conceptsAddTool: ToolSpec = {
  definition: {
    name: 'concepts_add',
    description:
      'Capture a new product concept — a candidate for a new project that does not yet exist. Distinct from dojo_add_wish (feature-scoped, inside an existing project). Use this when the idea is project-scale: "we should build a new app for X" rather than "we should add feature Y to project Z".',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short name for the concept (becomes part of the id).' },
        pitch: { type: 'string', description: 'One-sentence elevator pitch.' },
        problem: { type: 'string', description: 'What problem this concept would solve.' },
        why_now: { type: 'string', description: 'Why this is worth exploring now (optional).' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for filtering (e.g. ["desktop", "ui", "agents"]).',
        },
        prior_attempts: {
          type: 'array',
          items: { type: 'string' },
          description: 'Project ids of prior failed attempts at this concept (e.g. ["vector"] for HQ).',
        },
      },
      required: ['title', 'pitch', 'problem'],
    },
  },
  handler: async (args) => {
    try {
      requireFields(args, 'title', 'pitch', 'problem');

      const now = new Date();
      const concept: Concept = {
        id: generateId(args.title as string, now),
        title: args.title as string,
        pitch: args.pitch as string,
        problem: args.problem as string,
        why_now: (args.why_now as string) || undefined,
        status: 'ideating',
        tags: (args.tags as string[]) || [],
        prior_attempts: (args.prior_attempts as string[]) || [],
        graduated_to: null,
        graduated_at: null,
        shelved_reason: null,
        shelved_at: null,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      };

      await writeConcept(concept);
      return toolSuccess({
        id: concept.id,
        path: conceptPath(concept.id),
        status: concept.status,
      });
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

export const conceptsListTool: ToolSpec = {
  definition: {
    name: 'concepts_list',
    description:
      'List captured product concepts from ~/.decibel/concepts/. Optional filter by status. Returns id, title, pitch, status, tags, graduated_to, created_at — sorted newest first.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['ideating', 'exploring', 'committed', 'shelved'],
          description: 'Filter by lifecycle status.',
        },
        tag: { type: 'string', description: 'Filter to concepts containing this tag.' },
      },
    },
  },
  handler: async (args) => {
    try {
      await ensureConceptsDir();
      const files = await fs.readdir(CONCEPTS_DIR);
      const yamlFiles = files.filter((f) => f.endsWith('.yaml'));

      const concepts: Concept[] = [];
      for (const file of yamlFiles) {
        const id = file.replace(/\.yaml$/, '');
        const c = await readConcept(id);
        if (c) concepts.push(c);
      }

      let filtered = concepts;
      if (args.status) filtered = filtered.filter((c) => c.status === args.status);
      if (args.tag) filtered = filtered.filter((c) => c.tags.includes(args.tag as string));

      filtered.sort((a, b) => (b.created_at > a.created_at ? 1 : -1));

      return toolSuccess({
        concepts: filtered.map((c) => ({
          id: c.id,
          title: c.title,
          pitch: c.pitch,
          status: c.status,
          tags: c.tags,
          graduated_to: c.graduated_to,
          created_at: c.created_at,
        })),
        count: filtered.length,
        storage_dir: CONCEPTS_DIR,
      });
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

export const conceptsReadTool: ToolSpec = {
  definition: {
    name: 'concepts_read',
    description: 'Read a single concept by id. Returns the full YAML record.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Concept id (e.g. "concept-2026-04-26-decibel-hq-7f").' },
      },
      required: ['id'],
    },
  },
  handler: async (args) => {
    try {
      requireFields(args, 'id');
      const concept = await readConcept(args.id as string);
      if (!concept) {
        return toolError(`Concept "${args.id}" not found`, `Storage dir: ${CONCEPTS_DIR}. Use concepts_list to see all.`);
      }
      return toolSuccess({ concept, path: conceptPath(concept.id) });
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

export const conceptsCommitTool: ToolSpec = {
  definition: {
    name: 'concepts_commit',
    description:
      'Mark a concept as committed — i.e. you are going to build it. Optionally links to a project_id (existing or about-to-be-created). Does NOT call project_init or registry_add — those stay separate so you see what is happening. Status moves to "committed", graduated_to + graduated_at recorded.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Concept id to commit.' },
        project_id: {
          type: 'string',
          description: 'The project_id this concept graduates into (optional — can be set later via concepts_commit again).',
        },
      },
      required: ['id'],
    },
  },
  handler: async (args) => {
    try {
      requireFields(args, 'id');
      const concept = await readConcept(args.id as string);
      if (!concept) {
        return toolError(`Concept "${args.id}" not found`);
      }

      const now = new Date().toISOString();
      // Kernel normalizes incoming project_id → projectId before reaching handlers.
      const incomingProjectId = (args.projectId as string) || (args.project_id as string);
      concept.status = 'committed';
      concept.graduated_to = incomingProjectId || concept.graduated_to;
      concept.graduated_at = concept.graduated_at || now;
      concept.updated_at = now;

      await writeConcept(concept);
      return toolSuccess({
        id: concept.id,
        status: concept.status,
        graduated_to: concept.graduated_to,
        graduated_at: concept.graduated_at,
        next_step: concept.graduated_to
          ? `Concept linked to project_id "${concept.graduated_to}". Run project_init + registry_add separately if it does not exist yet.`
          : 'Set project_id later by running concepts_commit again with a project_id.',
      });
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

export const conceptsShelveTool: ToolSpec = {
  definition: {
    name: 'concepts_shelve',
    description:
      'Park a concept with a reason. Status moves to "shelved". Use when you decide not to pursue (yet) — the record stays so future Claudes can see prior thinking and avoid re-litigating.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Concept id to shelve.' },
        reason: { type: 'string', description: 'Why this is being shelved (timing, scope, redundant, etc.).' },
      },
      required: ['id', 'reason'],
    },
  },
  handler: async (args) => {
    try {
      requireFields(args, 'id', 'reason');
      const concept = await readConcept(args.id as string);
      if (!concept) {
        return toolError(`Concept "${args.id}" not found`);
      }

      const now = new Date().toISOString();
      concept.status = 'shelved';
      concept.shelved_reason = args.reason as string;
      concept.shelved_at = now;
      concept.updated_at = now;

      await writeConcept(concept);
      return toolSuccess({
        id: concept.id,
        status: concept.status,
        shelved_reason: concept.shelved_reason,
        shelved_at: concept.shelved_at,
      });
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

export const conceptsTools: ToolSpec[] = [
  conceptsAddTool,
  conceptsListTool,
  conceptsReadTool,
  conceptsCommitTool,
  conceptsShelveTool,
];
