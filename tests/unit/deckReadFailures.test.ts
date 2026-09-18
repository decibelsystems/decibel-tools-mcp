// ============================================================================
// deck.stores — a failed read must not be served as an absence
// ============================================================================
// The defect this file pins down was found by the torture gate, not by a test.
// S4 saw deck.stores answer `latest_price_update: null` on the stdio pass and a
// timestamp on the other three. The live value had not changed for fifteen
// hours either side of the sweep, so nothing in the data moved — a read failed,
// and `|| null` dressed the failure up as "no card has ever been priced".
//
// That shape defeats two mechanisms at once. A caller cannot tell the two
// meanings apart, and S4's transient-backend classifier (ISS-0162) cannot
// either, because it matches the backend's error text inside the payload and
// this payload had thrown the error away.
//
// The assertions below are about the reporting, not about Supabase: the helper
// takes the four read results and decides what the caller is told.
// ============================================================================

import { describe, it, expect } from 'vitest';
import { describeReadFailures } from '../../src/tools/deck.js';

describe('deck.stores — describeReadFailures', () => {
  it('says nothing when every read succeeded — the only case the summary may be believed', () => {
    expect(
      describeReadFailures([
        ['card count', null],
        ['price sources', null],
        ['latest price update', null],
        ['mover periods', null],
      ])
    ).toBeNull();
  });

  it('treats an absent error the same as an explicit null', () => {
    expect(
      describeReadFailures([
        ['card count', undefined],
        ['price sources', undefined],
      ])
    ).toBeNull();
  });

  it('names the read that failed, and carries the backend message with it', () => {
    const failure = describeReadFailures([
      ['card count', null],
      ['price sources', null],
      ['latest price update', { message: 'canceling statement due to statement timeout' }],
      ['mover periods', null],
    ]);

    expect(failure).toContain('latest price update');
    // The message is what S4's transient classifier matches on. Dropping it
    // would leave the row looking like an ordinary disagreement again.
    expect(failure).toContain('canceling statement due to statement timeout');
    // A read that succeeded is not implicated.
    expect(failure).not.toContain('card count');
  });

  it('reports every failed read, not just the first', () => {
    const failure = describeReadFailures([
      ['card count', { message: '429 Too Many Requests' }],
      ['price sources', null],
      ['latest price update', { message: 'fetch failed' }],
      ['mover periods', null],
    ]);

    expect(failure).toContain('card count');
    expect(failure).toContain('latest price update');
    expect(failure).toContain('429 Too Many Requests');
    expect(failure).toContain('fetch failed');
  });

  it('is distinguishable from a successful answer whatever the values are', () => {
    // The regression in one line: before this, the failure below and a store
    // with no priced cards produced the same bytes.
    const failed = describeReadFailures([
      ['latest price update', { message: 'fetch failed' }],
    ]);
    const empty = describeReadFailures([['latest price update', null]]);

    expect(failed).not.toBeNull();
    expect(empty).toBeNull();
    expect(failed).not.toEqual(empty);
  });
});
