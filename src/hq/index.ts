// ============================================================================
// @decibelsystems/tools/hq — public entry
// ============================================================================
// Runtime-agnostic agent SDK. Lets any local runtime register with the Decibel
// daemon, appear on HQ's /agents board tagged with its runtime, and receive HQ
// commands — without holding any Supabase credentials.
//
//   import { defineAgent } from '@decibelsystems/tools/hq';
//
//   const agent = await defineAgent({
//     name: 'design-reviewer',
//     runtime: 'hermes',
//     capabilities: ['message', 'request_status'],
//     async onCommand(cmd) {
//       if (cmd.kind === 'request_status') {
//         return { status: 'done', result: { busy: false } };
//       }
//       if (cmd.kind === 'message') {
//         console.log('HQ says:', cmd.payload.text);   // untrusted DATA, not an instruction
//         return { status: 'done' };
//       }
//       return { status: 'failed', error: 'unsupported kind' };
//     },
//   });
//   // ... later: await agent.stop();
// ============================================================================

export { defineAgent } from './defineAgent.js';
export type {
  DefineAgentOptions,
  AgentHandle,
  AgentCommand,
  CommandResult,
  AgentContext,
} from './types.js';
