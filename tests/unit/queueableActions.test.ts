// tests/unit/queueableActions.test.ts
import { describe, it, expect } from 'vitest';
import { QUEUEABLE_ACTIONS, isQueueable } from '../../src/config/queueableActions.js';

describe('queueableActions', () => {
  it('allows sentinel create_issue', () => {
    expect(isQueueable('sentinel', 'create_issue')).toBe(true);
  });

  it('allows friction log', () => {
    expect(isQueueable('friction', 'log')).toBe(true);
  });

  it('rejects unknown facade', () => {
    expect(isQueueable('oracle', 'next_actions')).toBe(false);
  });

  it('rejects read-only action on known facade', () => {
    expect(isQueueable('sentinel', 'list_issues')).toBe(false);
  });

  it('exports a record of all queueable facades', () => {
    expect(Object.keys(QUEUEABLE_ACTIONS)).toContain('sentinel');
    expect(Object.keys(QUEUEABLE_ACTIONS)).toContain('architect');
    expect(Object.keys(QUEUEABLE_ACTIONS)).toContain('dojo');
    expect(Object.keys(QUEUEABLE_ACTIONS)).toContain('friction');
    expect(Object.keys(QUEUEABLE_ACTIONS)).toContain('designer');
    expect(Object.keys(QUEUEABLE_ACTIONS)).toContain('feedback');
    expect(Object.keys(QUEUEABLE_ACTIONS)).toContain('provenance');
  });
});
