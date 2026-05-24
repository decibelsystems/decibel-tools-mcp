// ============================================================================
// FsStore — box-local .decibel/*.md project intelligence (dev / self-host)
// ============================================================================
// Preserves the git-tracked, offline local workflow. Reads/writes sentinel
// issue .md files via the markdown (de)serializer — markdown-safe, no YAML
// round-trip that drops the body. Default store when DECIBEL_STORE is unset.
// ============================================================================

import fs from 'fs/promises';
import path from 'path';
import { resolveProjectPaths } from '../projectRegistry.js';
import { ensureDir } from '../dataRoot.js';
import { parseIssueMarkdown, serializeIssueMarkdown } from './markdown.js';
import type {
  IssueRecord,
  IssueListFilter,
  IssueStore,
  Store,
  StoreContext,
} from './types.js';

function issuesDir(projectKey: string): string {
  return resolveProjectPaths(projectKey).subPath('sentinel', 'issues');
}

class FsIssueStore implements IssueStore {
  async list(ctx: StoreContext, filter?: IssueListFilter): Promise<IssueRecord[]> {
    const dir = issuesDir(ctx.projectKey);
    let files: string[];
    try {
      files = await fs.readdir(dir);
    } catch {
      return [];
    }
    const out: IssueRecord[] = [];
    for (const f of files) {
      if (!f.endsWith('.md')) continue;
      try {
        const content = await fs.readFile(path.join(dir, f), 'utf-8');
        const issue = parseIssueMarkdown(f, content);
        if (!filter?.status || issue.status === filter.status) out.push(issue);
      } catch {
        // skip unreadable file
      }
    }
    return out;
  }

  async get(ctx: StoreContext, sourceKey: string): Promise<IssueRecord | null> {
    const dir = issuesDir(ctx.projectKey);
    const want = sourceKey.replace(/\.md$/i, '');
    let files: string[];
    try {
      files = await fs.readdir(dir);
    } catch {
      return null;
    }
    const match = files.find((f) => f.replace(/\.md$/i, '') === want);
    if (!match) return null;
    const content = await fs.readFile(path.join(dir, match), 'utf-8');
    return parseIssueMarkdown(match, content);
  }

  async upsert(ctx: StoreContext, issue: IssueRecord): Promise<IssueRecord> {
    const dir = issuesDir(ctx.projectKey);
    ensureDir(dir);
    const filename = `${issue.source_key.replace(/\.md$/i, '')}.md`;
    const existing = await this.get(ctx, issue.source_key);
    const merged: IssueRecord = {
      ...existing,
      ...issue,
      created_at: existing?.created_at ?? issue.created_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await fs.writeFile(path.join(dir, filename), serializeIssueMarkdown(ctx.projectKey, merged), 'utf-8');
    return merged;
  }
}

export class FsStore implements Store {
  readonly kind = 'fs' as const;
  issues: IssueStore = new FsIssueStore();
}
