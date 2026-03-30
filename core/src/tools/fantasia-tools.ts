import { z } from 'zod/v4';
import type { SdkAdapter, McpSdkServerConfigWithInstance, SdkMcpToolDefinition, FantasiaEventType } from '../types.js';
import type { TaskQueue } from '../task/task-queue.js';
import { createTask, isTerminal } from '../task/task.js';
import logger from '../logger.js';

const log = logger.child('tools');

export interface FantasiaToolContext {
  taskQueue: TaskQueue;
  onDelegateTask: (description: string, priority: string, simple: boolean) => Promise<string>;
  onSubscribeEvents?: (eventTypes: string[]) => string;
  onUnsubscribeEvents?: (subscriptionId: string) => boolean;
}

/**
 * Create Mickey's MCP tools for task delegation and management.
 * These tools allow Mickey to delegate work without blocking.
 */
export function createFantasiaTools(
  sdk: SdkAdapter,
  context: FantasiaToolContext,
): { server: McpSdkServerConfigWithInstance; toolNames: string[] } {
  const delegateTask = sdk.tool(
    'delegate_task',
    'Delegate a task to specialist agents. For simple single-step tasks, set simple=true to send directly to a worker. For complex multi-step tasks, set simple=false to go through planning and review first.',
    {
      description: z.string().describe('Clear description of what needs to be done'),
      priority: z.enum(['critical', 'high', 'normal', 'low']).describe('Task priority'),
      simple: z.boolean().describe('true for simple single-step tasks (direct to worker), false for complex tasks needing planning/review'),
    },
    async (args) => {
      log.info('delegate_task called', { priority: args.priority, simple: args.simple, descriptionLength: args.description.length });
      log.debug('delegate_task details', { description: args.description });
      const taskId = await context.onDelegateTask(args.description, args.priority, args.simple);
      log.info('delegate_task created', { taskId, simple: args.simple });
      const route = args.simple ? 'A worker will handle this directly.' : 'Specialist agents will plan, review, and execute this.';
      return {
        content: [{
          type: 'text' as const,
          text: `Task created with ID: ${taskId}. ${route} You can check status with check_task_status.`,
        }],
      };
    },
    { annotations: { readOnlyHint: false } },
  );

  const checkTaskStatus = sdk.tool(
    'check_task_status',
    'Check the current status of a delegated task.',
    {
      task_id: z.string().describe('The task ID to check'),
    },
    async (args) => {
      log.debug('check_task_status called', { taskId: args.task_id });
      const task = context.taskQueue.get(args.task_id);
      if (!task) {
        log.debug('check_task_status: task not found', { taskId: args.task_id });
        return {
          content: [{ type: 'text' as const, text: `Task ${args.task_id} not found.` }],
          isError: true,
        };
      }
      const statusInfo = [
        `Task: ${task.description}`,
        `Status: ${task.status}`,
        `Priority: ${task.priority}`,
      ];
      if (task.assignedAgentId) statusInfo.push(`Assigned to: ${task.assignedAgentId}`);
      if (task.plan) statusInfo.push(`Plan: ${task.plan.summary}`);
      if (task.result) {
        statusInfo.push(`Result: ${task.result.success ? 'Success' : 'Failed'}`);
        statusInfo.push(`Output: ${task.result.output}`);
      }
      return {
        content: [{ type: 'text' as const, text: statusInfo.join('\n') }],
      };
    },
    { annotations: { readOnlyHint: true } },
  );

  const getTaskResult = sdk.tool(
    'get_task_result',
    'Get the full result of a completed task.',
    {
      task_id: z.string().describe('The task ID to get results for'),
    },
    async (args) => {
      const task = context.taskQueue.get(args.task_id);
      if (!task) {
        return {
          content: [{ type: 'text' as const, text: `Task ${args.task_id} not found.` }],
          isError: true,
        };
      }
      if (!isTerminal(task)) {
        return {
          content: [{ type: 'text' as const, text: `Task ${args.task_id} is still ${task.status}. Check back later.` }],
        };
      }
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            taskId: task.id,
            description: task.description,
            status: task.status,
            result: task.result,
          }, null, 2),
        }],
      };
    },
    { annotations: { readOnlyHint: true } },
  );

  const listTasks = sdk.tool(
    'list_tasks',
    'List all current tasks and their statuses.',
    {},
    async () => {
      const tasks = context.taskQueue.getAll();
      if (tasks.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No tasks.' }] };
      }
      const summary = tasks.map((t) =>
        `[${t.id.slice(0, 8)}] ${t.status.padEnd(12)} ${t.priority.padEnd(8)} ${t.description.slice(0, 80)}`
      ).join('\n');
      const counts = context.taskQueue.getCounts();
      return {
        content: [{
          type: 'text' as const,
          text: `Tasks (${counts.total} total: ${counts.active} active, ${counts.pending} pending, ${counts.completed} done, ${counts.failed} failed):\n\n${summary}`,
        }],
      };
    },
    { annotations: { readOnlyHint: true } },
  );

  const subscribeEvents = sdk.tool(
    'subscribe_events',
    'Subscribe to receive batched notifications about system events. Events are delivered as messages in the conversation. You do NOT need to poll — just subscribe and continue with other work. You will be notified when relevant events occur.',
    {
      event_types: z.array(z.string()).describe('Event types to subscribe to. Available: "task:completed", "task:failed", "task:status-changed", "task:created", "agent:message", "agent:spawned", "agent:terminated", "cost:update"'),
    },
    async (args) => {
      if (!context.onSubscribeEvents) {
        return { content: [{ type: 'text' as const, text: 'Event subscriptions are not available.' }], isError: true };
      }
      log.info('subscribe_events called', { eventTypes: args.event_types });
      const subId = context.onSubscribeEvents(args.event_types);
      return {
        content: [{
          type: 'text' as const,
          text: `Subscribed to events: ${args.event_types.join(', ')}. Subscription ID: ${subId}. You will receive batched notifications automatically — no need to poll.`,
        }],
      };
    },
    { annotations: { readOnlyHint: true } },
  );

  const unsubscribeEvents = sdk.tool(
    'unsubscribe_events',
    'Unsubscribe from event notifications.',
    {
      subscription_id: z.string().describe('The subscription ID to cancel'),
    },
    async (args) => {
      if (!context.onUnsubscribeEvents) {
        return { content: [{ type: 'text' as const, text: 'Event subscriptions are not available.' }], isError: true };
      }
      log.info('unsubscribe_events called', { subscriptionId: args.subscription_id });
      const removed = context.onUnsubscribeEvents(args.subscription_id);
      return {
        content: [{
          type: 'text' as const,
          text: removed ? `Unsubscribed (${args.subscription_id}).` : `Subscription ${args.subscription_id} not found.`,
        }],
      };
    },
    { annotations: { readOnlyHint: true } },
  );

  const allTools = [delegateTask, checkTaskStatus, getTaskResult, listTasks, subscribeEvents, unsubscribeEvents];

  const server = sdk.createMcpServer({
    name: 'fantasia',
    version: '0.1.0',
    tools: allTools,
  });

  const toolNames = [
    'mcp__fantasia__delegate_task',
    'mcp__fantasia__check_task_status',
    'mcp__fantasia__get_task_result',
    'mcp__fantasia__list_tasks',
    'mcp__fantasia__subscribe_events',
    'mcp__fantasia__unsubscribe_events',
  ];

  return { server, toolNames };
}
