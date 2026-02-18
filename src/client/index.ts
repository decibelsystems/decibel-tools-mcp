// ============================================================================
// @decibelsystems/tools/client — Agent Client SDK
// ============================================================================
// Public API for headless agents to call Decibel facades.
//
// import { FacadeClient } from '@decibelsystems/tools/client';
//
// const client = new FacadeClient({
//   command: 'node', args: ['dist/server.js'],
//   agentId: 'cymoril',
//   projectId: 'my-project',
// });
// await client.connect();
// const epics = await client.call('sentinel', 'list_epics');
// await client.disconnect();
// ============================================================================

export { FacadeClient } from './facade-client.js';

export type {
  FacadeClientConfig,
  FacadeResponse,
  CallResult,
  CallError,
  CallContext,
  BatchCall,
  BatchResult,
} from './types.js';

export type { ClientTransport } from './transports.js';
