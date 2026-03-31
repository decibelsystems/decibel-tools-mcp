/**
 * Allowlist of facade+action pairs that remote agents can queue.
 * Only write operations should be listed here.
 * Both httpServer.ts (queue detection) and agent_queue_sync (replay) use this.
 */
export const QUEUEABLE_ACTIONS: Record<string, string[]> = {
  sentinel:   ['create_issue', 'log_epic'],
  architect:  ['create_adr'],
  dojo:       ['add_wish', 'create_proposal'],
  friction:   ['log', 'bump'],
  designer:   ['record_design_decision'],
  feedback:   ['submit'],
  provenance: ['emit'],
};

/**
 * Check if a facade+action pair is queueable by remote agents.
 */
export function isQueueable(facade: string, action: string): boolean {
  const actions = QUEUEABLE_ACTIONS[facade];
  return !!actions && actions.includes(action);
}
