import { z } from 'zod/v4';
import type { SdkAdapter, McpSdkServerConfigWithInstance } from '../types.js';
import type { MilestoneTracker } from '../milestones/milestone-tracker.js';
import logger from '../logger.js';

const log = logger.child('milestone-tools');

/**
 * Create milestone coordination MCP tools for a broomstick worker.
 * Each broomstick gets its own server instance (with workstreamName bound),
 * but all share the same MilestoneTracker.
 */
export function createMilestoneTools(
  sdk: SdkAdapter,
  tracker: MilestoneTracker,
  workstreamName: string,
): { server: McpSdkServerConfigWithInstance; toolNames: string[] } {
  const emitMilestone = sdk.tool(
    'emit_milestone',
    'Signal that a milestone has been reached. Other parallel workstreams waiting on this milestone will be immediately unblocked. Idempotent — safe to call more than once.',
    {
      milestone_id: z.string().describe('The milestone ID to emit (e.g. "api-types-defined")'),
    },
    async (args) => {
      log.info('emit_milestone called', { milestoneId: args.milestone_id, workstreamName });
      tracker.emit(args.milestone_id, workstreamName);
      return {
        content: [{
          type: 'text' as const,
          text: `Milestone "${args.milestone_id}" emitted. Any workstreams waiting on it have been unblocked.`,
        }],
      };
    },
    { annotations: { readOnlyHint: false } },
  );

  const waitForMilestone = sdk.tool(
    'wait_for_milestone',
    'Wait for a milestone from another parallel workstream before proceeding. Returns immediately if the milestone was already reached. Blocks until the milestone is emitted or the timeout expires.',
    {
      milestone_id: z.string().describe('The milestone ID to wait for (e.g. "db-schema-migrated")'),
      timeout_seconds: z.number().optional().describe('How long to wait in seconds (default: 300)'),
    },
    async (args) => {
      const timeoutMs = (args.timeout_seconds ?? 300) * 1000;
      log.info('wait_for_milestone called', { milestoneId: args.milestone_id, workstreamName, timeoutMs });
      try {
        await tracker.waitFor(args.milestone_id, timeoutMs);
        log.info('wait_for_milestone resolved', { milestoneId: args.milestone_id, workstreamName });
        return {
          content: [{
            type: 'text' as const,
            text: `Milestone "${args.milestone_id}" has been reached. You may proceed.`,
          }],
        };
      } catch (err) {
        log.warn('wait_for_milestone failed', { milestoneId: args.milestone_id, workstreamName, error: String(err) });
        return {
          content: [{
            type: 'text' as const,
            text: `Failed waiting for milestone "${args.milestone_id}": ${err}`,
          }],
          isError: true,
        };
      }
    },
    { annotations: { readOnlyHint: true } },
  );

  const server = sdk.createMcpServer({
    name: 'milestones',
    version: '0.1.0',
    tools: [emitMilestone, waitForMilestone],
  });

  return {
    server,
    toolNames: ['mcp__milestones__emit_milestone', 'mcp__milestones__wait_for_milestone'],
  };
}
