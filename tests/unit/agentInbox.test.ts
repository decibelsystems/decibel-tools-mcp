import { describe, it, expect, beforeEach } from 'vitest';
import {
  enqueueCommand,
  drainCommands,
  hasInbox,
  inboxDepth,
  clearInbox,
  setSessionToken,
  getSessionToken,
  dropSessionToken,
  ackOwnerOf,
  clearAckOwner,
  type InboxCommand,
} from '../../src/agentInbox.js';

const ORG = 'org-A';
function cmd(id: string, kind = 'message', org = ORG): InboxCommand {
  return { id, org_id: org, kind, payload: { text: 'hi' }, enqueued_at: Date.now() };
}

describe('agentInbox', () => {
  beforeEach(() => clearInbox());

  describe('enqueue / drain', () => {
    it('enqueues and drains commands for a session', () => {
      enqueueCommand('s1', cmd('c1'));
      enqueueCommand('s1', cmd('c2'));
      expect(hasInbox('s1')).toBe(true);
      const drained = drainCommands('s1', ORG);
      expect(drained.map((c) => c.id)).toEqual(['c1', 'c2']);
      // draining removes them
      expect(hasInbox('s1')).toBe(false);
      expect(drainCommands('s1', ORG)).toEqual([]);
    });

    it('is idempotent on duplicate command ids', () => {
      enqueueCommand('s1', cmd('dup'));
      enqueueCommand('s1', cmd('dup'));
      expect(drainCommands('s1', ORG).length).toBe(1);
    });

    it('isolates sessions from each other', () => {
      enqueueCommand('a', cmd('ca'));
      enqueueCommand('b', cmd('cb'));
      expect(drainCommands('a', ORG).map((c) => c.id)).toEqual(['ca']);
      expect(drainCommands('b', ORG).map((c) => c.id)).toEqual(['cb']);
    });

    it('returns [] for an unknown session (so a stray SDK poll is harmless)', () => {
      expect(drainCommands('never-seen', ORG)).toEqual([]);
      expect(hasInbox('never-seen')).toBe(false);
    });

    it('evicts stale commands past the TTL on drain', () => {
      enqueueCommand('s1', { id: 'old', org_id: ORG, kind: 'message', payload: {}, enqueued_at: Date.now() - 10 * 60_000 });
      enqueueCommand('s1', cmd('fresh'));
      const drained = drainCommands('s1', ORG);
      expect(drained.map((c) => c.id)).toEqual(['fresh']); // stale evicted
    });

    it('caps per-session queue depth (backstop against floods)', () => {
      for (let i = 0; i < 150; i++) enqueueCommand('flood', cmd(`c${i}`));
      const drained = drainCommands('flood', ORG);
      expect(drained.length).toBeLessThanOrEqual(100);
      expect(drained[drained.length - 1].id).toBe('c149'); // keeps the newest
    });

    it('inboxDepth reflects total across sessions', () => {
      enqueueCommand('a', cmd('1'));
      enqueueCommand('a', cmd('2'));
      enqueueCommand('b', cmd('3'));
      expect(inboxDepth()).toBe(3);
      drainCommands('a', ORG);
      expect(inboxDepth()).toBe(1);
    });
  });

  describe('cross-org guard (org-id-first invariant)', () => {
    it('drain only returns commands matching the caller org; others are dropped', () => {
      enqueueCommand('s1', cmd('mine', 'message', 'org-A'));
      enqueueCommand('s1', cmd('theirs', 'message', 'org-B'));
      const drained = drainCommands('s1', 'org-A');
      expect(drained.map((c) => c.id)).toEqual(['mine']); // org-B command not delivered
      // and the session is cleared (the foreign command is dropped, not left to leak)
      expect(hasInbox('s1')).toBe(false);
    });
  });

  describe('session capability tokens', () => {
    it('stores, returns, and drops a session token', () => {
      expect(getSessionToken('s1')).toBeUndefined();
      setSessionToken('s1', 'secret-abc');
      expect(getSessionToken('s1')).toBe('secret-abc');
      dropSessionToken('s1');
      expect(getSessionToken('s1')).toBeUndefined();
    });

    it('clearInbox wipes tokens too', () => {
      setSessionToken('s1', 'secret');
      clearInbox();
      expect(getSessionToken('s1')).toBeUndefined();
    });
  });

  describe('ack ownership map', () => {
    it('records id→session on enqueue and clears on demand', () => {
      enqueueCommand('s1', cmd('cmd-1'));
      expect(ackOwnerOf('cmd-1')).toBe('s1'); // survives even after drain (ack comes later)
      drainCommands('s1', ORG);
      expect(ackOwnerOf('cmd-1')).toBe('s1');
      clearAckOwner('cmd-1');
      expect(ackOwnerOf('cmd-1')).toBeUndefined();
    });

    it('returns undefined for an unknown command id (ack cannot be authorized)', () => {
      expect(ackOwnerOf('never')).toBeUndefined();
    });

    it('evicts stale ack-owners past the TTL on drain', () => {
      enqueueCommand('s1', { id: 'oldack', org_id: ORG, kind: 'message', payload: {}, enqueued_at: Date.now() - 10 * 60_000 });
      // trigger evictStale via a drain on any session
      drainCommands('s1', ORG);
      expect(ackOwnerOf('oldack')).toBeUndefined();
    });
  });
});
