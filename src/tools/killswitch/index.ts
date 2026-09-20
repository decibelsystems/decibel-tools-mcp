/**
 * killswitch facade — RUN / STOP for unattended work (ISS-0178).
 *
 * Three actions and no more, because the point of a red button is that there is
 * nothing to learn before pressing it.
 *
 * Reachable over stdio and HTTP alike, which matters: the physical button on
 * the desk will speak HTTP to the daemon, and it must hit exactly the same code
 * path a person does. Two paths to one stop is how one of them rots.
 */

import type { ToolSpec } from '../types.js';
import { toolSuccess, toolError } from '../shared/response.js';
import {
  engageStop,
  releaseStop,
  readKillSwitch,
  KILL_SWITCH_PATH,
} from '../../killSwitch.js';

const killswitchStopTool: ToolSpec = {
  definition: {
    name: 'killswitch_stop',
    description:
      'Engage the kill switch: unattended work (agentic queue replay, dojo experiment runs) ' +
      'refuses until released. Interactive tools keep working so you can diagnose. Idempotent — ' +
      'a second press reports the first stop rather than replacing it.',
    annotations: {
      title: 'STOP',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description:
            'Why work is being stopped. Optional — a physical button has no keyboard — but a ' +
            'stop without one is recorded as unattributed and will puzzle whoever finds it.',
        },
        actor: {
          type: 'string',
          description: "Who pressed it: an agent id, a person, or 'button' for the physical one.",
        },
        source: {
          type: 'string',
          description: "Where the press came from, e.g. 'mcp', 'http', 'device'.",
        },
      },
      required: [],
    },
  },
  handler: async (args) => {
    try {
      const { state, already } = engageStop({
        reason: args.reason as string | undefined,
        actor: args.actor as string | undefined,
        source: (args.source as string | undefined) || 'mcp',
      });
      return toolSuccess({
        stopped: true,
        // Distinguished deliberately: "I stopped it" and "it was already
        // stopped" are different facts, and a button gets pressed twice.
        newly_engaged: !already,
        state,
        state_path: KILL_SWITCH_PATH,
        blocks: ['agentic queue replay', 'dojo experiment runs'],
        note: already
          ? 'Already stopped — reporting the original stop, which is left untouched.'
          : 'Unattended work will now refuse. killswitch_status and killswitch_resume are never blocked.',
      });
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

const killswitchResumeTool: ToolSpec = {
  definition: {
    name: 'killswitch_resume',
    description:
      'Release the kill switch and let unattended work run again. Never blocked by the ' +
      'switch itself — you can never stop yourself out of resuming.',
    annotations: {
      title: 'RUN',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  handler: async () => {
    try {
      const { released } = releaseStop();
      return toolSuccess({
        stopped: false,
        // Again two different facts: releasing a stop, versus confirming there
        // was nothing to release.
        was_stopped: released !== null,
        released,
        note: released
          ? 'Kill switch released. Unattended work may run again.'
          : 'Nothing to release — the kill switch was not engaged.',
      });
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

const killswitchStatusTool: ToolSpec = {
  definition: {
    name: 'killswitch_status',
    description:
      'Report whether the kill switch is engaged, and if so who pressed it, when and why. ' +
      'Never blocked.',
    annotations: {
      title: 'Kill Switch Status',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  handler: async () => {
    try {
      const state = readKillSwitch();
      return toolSuccess({
        ...state,
        state_path: KILL_SWITCH_PATH,
        // Stated rather than implied. A caller must be able to tell "running"
        // from "I could not find out", which is the distinction this codebase
        // keeps losing elsewhere.
        blocks: state.stopped ? ['agentic queue replay', 'dojo experiment runs'] : [],
        never_blocked: ['killswitch_status', 'killswitch_resume'],
      });
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

export const killswitchTools: ToolSpec[] = [
  killswitchStopTool,
  killswitchResumeTool,
  killswitchStatusTool,
];
