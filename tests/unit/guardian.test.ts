// Regression tests for ISS-0117 and the ISS-0114 allowlist path.
//
// ISS-0117: guardian graded devDependency advisories, so once production deps
// were clean the pre-push gate still reported F and could not be satisfied by
// any change to the repository — which trains people to bypass the gate.
//
// ISS-0114: the .decibel/guardian/allowlist.yaml entries must actually suppress
// matching secret findings (known-safe Supabase *anon* keys).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import {
  parseAuditJson,
  countBySeverity,
  scanSecrets,
  type DepAdvisory,
} from '../../src/tools/guardian.js';
import {
  createTestContext,
  cleanupTestContext,
  TestContext,
} from '../utils/test-context.js';

describe('guardian dependency scanning (ISS-0117)', () => {
  const AUDIT_JSON = JSON.stringify({
    vulnerabilities: {
      ws: {
        severity: 'high',
        via: [{ title: 'ws: Uninitialized memory disclosure', url: 'https://example/ws' }],
        fixAvailable: true,
      },
      vite: {
        severity: 'high',
        via: [{ title: 'Vite path traversal', url: 'https://example/vite' }],
        fixAvailable: true,
      },
      vitest: { severity: 'critical', via: ['@vitest/mocker'], fixAvailable: true },
    },
  });

  it('parses npm audit JSON into a flat advisory list', () => {
    const advisories = parseAuditJson(AUDIT_JSON);

    expect(advisories).toHaveLength(3);
    const ws = advisories.find((a) => a.name === 'ws')!;
    expect(ws.severity).toBe('high');
    expect(ws.title).toBe('ws: Uninitialized memory disclosure');
    expect(ws.url).toBe('https://example/ws');
    expect(ws.fix_available).toBe(true);
  });

  it('falls back to the raw `via` entry when it is a bare string, not an object', () => {
    const advisories = parseAuditJson(AUDIT_JSON);
    // vitest's via is ['@vitest/mocker'] — a string, not {title,url}
    expect(advisories.find((a) => a.name === 'vitest')!.title).toBe('@vitest/mocker');
  });

  it('tolerates an empty/clean audit', () => {
    expect(parseAuditJson('{}')).toEqual([]);
    expect(parseAuditJson(JSON.stringify({ vulnerabilities: {} }))).toEqual([]);
  });

  it('counts by severity', () => {
    expect(countBySeverity(parseAuditJson(AUDIT_JSON))).toEqual({ high: 2, critical: 1 });
    expect(countBySeverity([])).toEqual({});
  });

  it('separates dev-only advisories from the graded production set', () => {
    // This is the ISS-0117 shape: the full audit is a superset of the
    // production one, and the difference must not be graded.
    const all = parseAuditJson(AUDIT_JSON);
    const prod = all.filter((a) => a.name === 'ws');

    const gradedNames = new Set(prod.map((a) => a.name));
    const devOnly: DepAdvisory[] = all.filter((a) => !gradedNames.has(a.name));

    expect(prod.map((a) => a.name)).toEqual(['ws']);
    expect(devOnly.map((a) => a.name).sort()).toEqual(['vite', 'vitest']);
    // The 'critical' lives entirely in the dev set — it must not reach the grade
    expect(countBySeverity(prod).critical).toBeUndefined();
    expect(countBySeverity(devOnly).critical).toBe(1);
  });
});

describe('guardian secret allowlist (ISS-0114)', () => {
  let ctx: TestContext;
  const JWT =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJvbGUiOiJhbm9uIn0.c2lnbmF0dXJl';

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await cleanupTestContext(ctx);
  });

  async function writeSource(relPath: string) {
    const full = path.join(ctx.rootDir, relPath);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, `const ANON_KEY = '${JWT}';\n`, 'utf-8');
    return full;
  }

  it('reports an inline JWT when no allowlist is present', async () => {
    await writeSource('src/license.ts');

    const result = await scanSecrets({ directories: [path.join(ctx.rootDir, 'src')] });

    expect(result.total_findings).toBe(1);
    expect(result.allowlisted).toBe(0);
    expect(result.findings[0].pattern).toBe('jwt');
  });

  it('suppresses findings whose file path matches an allowlist entry', async () => {
    await writeSource('src/license.ts');
    const guardianDir = path.join(ctx.rootDir, '.decibel', 'guardian');
    await fs.mkdir(guardianDir, { recursive: true });
    await fs.writeFile(
      path.join(guardianDir, 'allowlist.yaml'),
      'entries:\n  - src/license.ts\n',
      'utf-8'
    );

    const result = await scanSecrets({
      project_id: ctx.rootDir,
      directories: [path.join(ctx.rootDir, 'src')],
    });

    expect(result.total_findings).toBe(0);
    expect(result.allowlisted).toBe(1);
  });

  it('keeps flagging files outside the allowlist', async () => {
    await writeSource('src/license.ts');
    await writeSource('src/leaky.ts');
    const guardianDir = path.join(ctx.rootDir, '.decibel', 'guardian');
    await fs.mkdir(guardianDir, { recursive: true });
    await fs.writeFile(
      path.join(guardianDir, 'allowlist.yaml'),
      'entries:\n  - src/license.ts\n',
      'utf-8'
    );

    const result = await scanSecrets({
      project_id: ctx.rootDir,
      directories: [path.join(ctx.rootDir, 'src')],
    });

    expect(result.allowlisted).toBe(1);
    expect(result.total_findings).toBe(1);
    expect(result.findings[0].file).toContain('leaky.ts');
  });
});
