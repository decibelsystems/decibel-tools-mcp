// ============================================================================
// Proposal kinds — an artifact that does not say what it is cannot say what it owes
// ============================================================================
// "Proposal" was one word doing three jobs. The dojo shape is experiment-shaped
// by construction (problem -> hypothesis -> scaffold -> run -> graduate), which
// is the right question for a technique and the wrong one for a surface other
// software calls, or for a positioning argument with no module at all. Both
// turned up in the same hour (WISH-0023), which is what made this real.
//
// The two properties worth pinning are the ones a later simplification would
// quietly drop: that `kind` has NO default, and that each kind refuses the
// fields belonging to another shape. Both exist for the same reason — an
// artifact full of empty hypothesis fields is worse than a document, and a
// defaulted kind would let every caller keep meaning "experiment" while
// teaching us nothing about whether the split is real.
// ============================================================================

import { describe, it, expect } from 'vitest';
import { validateProposalKind, type CreateProposalInput } from '../../src/tools/dojo.js';

const base = { title: 'T', problem: 'P' } as CreateProposalInput;

describe('validateProposalKind', () => {
  it('refuses a proposal with no kind, rather than assuming experiment', () => {
    const err = validateProposalKind({ ...base } as CreateProposalInput);
    expect(err).toContain('kind must be one of');
    // The reason is load-bearing, so it is stated to the caller.
    expect(err).toContain('no default');
  });

  it('refuses a kind it does not know', () => {
    const err = validateProposalKind({ ...base, kind: 'proposal' as never });
    expect(err).toContain('kind must be one of');
  });

  describe("kind:'experiment' — the original shape", () => {
    it('accepts problem plus hypothesis', () => {
      expect(validateProposalKind({ ...base, kind: 'experiment', hypothesis: 'H' })).toBeNull();
    });

    it('requires the hypothesis, which is the whole point of an experiment', () => {
      expect(validateProposalKind({ ...base, kind: 'experiment' })).toContain('hypothesis');
    });

    it('treats a whitespace-only hypothesis as missing', () => {
      expect(validateProposalKind({ ...base, kind: 'experiment', hypothesis: '   ' })).toContain('hypothesis');
    });
  });

  describe("kind:'tool' — a contract for something already decided", () => {
    const tool = {
      ...base,
      kind: 'tool' as const,
      facade: 'sentinel',
      action_name: 'close_issue',
      tier: 'core' as const,
      absence_semantics: 'Returns found:false; a read failure is an isError payload naming the store.',
      backing_store: 'Project .decibel files; ENOENT on the dir is reported, not rendered as empty.',
    };

    it('accepts the five fields that each cost us a filed bug', () => {
      expect(validateProposalKind(tool)).toBeNull();
    });

    it.each([
      ['facade', 'ISS-0171 — tier enforced by path prefix, so four routes fell outside it'],
      ['action_name', 'the surface has to be nameable before it can be reviewed'],
      ['tier', 'ISS-0171 — a core caller reached billed endpoints'],
      ['absence_semantics', 'ISS-0166 — a failed read rendered identically to an empty one'],
      ['backing_store', 'ISS-0162 — a slow backend is not a broken transport'],
    ])('requires %s (%s)', (field) => {
      const partial = { ...tool };
      delete (partial as Record<string, unknown>)[field];
      expect(validateProposalKind(partial)).toContain(field);
    });

    it('names every missing field at once, not just the first', () => {
      const err = validateProposalKind({ ...base, kind: 'tool' });
      for (const f of ['facade', 'action_name', 'tier', 'absence_semantics', 'backing_store']) {
        expect(err).toContain(f);
      }
    });

    it('refuses a hypothesis — a decided contract has no belief to test', () => {
      const err = validateProposalKind({ ...tool, hypothesis: 'it will be good' });
      expect(err).toContain('hypothesis');
      expect(err).toContain('must not carry');
    });
  });

  describe("kind:'strategy' — an argument, not code", () => {
    it('needs nothing beyond title and problem', () => {
      expect(validateProposalKind({ ...base, kind: 'strategy' })).toBeNull();
    });

    it('refuses hypothesis and target_module, the fields it would leave empty', () => {
      const err = validateProposalKind({
        ...base,
        kind: 'strategy',
        hypothesis: 'H',
        target_module: 'sentinel',
      });
      expect(err).toContain('hypothesis');
      expect(err).toContain('target_module');
    });
  });

  it('reports what is missing AND what does not belong in one answer', () => {
    // A caller who guessed the shape wrong should learn the whole shape at once
    // rather than by repeated rejection.
    const err = validateProposalKind({ ...base, kind: 'tool', hypothesis: 'H' });
    expect(err).toContain('requires');
    expect(err).toContain('must not carry');
  });
});
