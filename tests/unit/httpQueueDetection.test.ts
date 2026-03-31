import { describe, it, expect } from 'vitest';
import { shouldQueueForAgent, parseToolCall } from '../../src/httpQueueDetection.js';

describe('parseToolCall', () => {
  it('parses facade-style tool name', () => {
    const result = parseToolCall('sentinel', { action: 'create_issue', severity: 'high' });
    expect(result).toEqual({ facade: 'sentinel', action: 'create_issue' });
  });

  it('parses underscore-style tool name', () => {
    const result = parseToolCall('sentinel_create_issue', {});
    expect(result).toEqual({ facade: 'sentinel', action: 'create_issue' });
  });

  it('returns null for unparseable tool name', () => {
    const result = parseToolCall('unknown', {});
    expect(result).toBeNull();
  });

  it('prefers action in args over underscore parsing', () => {
    const result = parseToolCall('sentinel', { action: 'log_epic' });
    expect(result).toEqual({ facade: 'sentinel', action: 'log_epic' });
  });
});

describe('shouldQueueForAgent', () => {
  it('returns true for queueable action from remote agent', () => {
    expect(shouldQueueForAgent('sentinel', { action: 'create_issue' }, 'agent:test')).toBe(true);
  });

  it('returns false when no agent ID', () => {
    expect(shouldQueueForAgent('sentinel', { action: 'create_issue' }, undefined)).toBe(false);
  });

  it('returns false for non-queueable action', () => {
    expect(shouldQueueForAgent('oracle', { action: 'next_actions' }, 'agent:test')).toBe(false);
  });

  it('returns false for read action on queueable facade', () => {
    expect(shouldQueueForAgent('sentinel', { action: 'list_issues' }, 'agent:test')).toBe(false);
  });

  it('works with underscore-style tool names', () => {
    expect(shouldQueueForAgent('friction_log', {}, 'agent:test')).toBe(true);
  });
});
