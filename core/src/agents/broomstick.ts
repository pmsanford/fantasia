import type { AgentConfig, SdkAdapter } from '../types.js';
import type { FantasiaEventEmitter } from '../events/event-emitter.js';
import type { MemoryManager } from '../memory/memory-manager.js';
import { BaseAgent } from './base-agent.js';

/**
 * Create a system prompt for a broomstick worker, injecting the task plan.
 */
function makeBroomstickPrompt(taskDescription: string, planExcerpt?: string): string {
  const parts = [
    `You are a Broomstick, an ephemeral worker agent in the Fantasia system.`,
    `You have been created to complete a specific task. Focus entirely on this task.`,
    '',
    `## Your Task`,
    taskDescription,
  ];

  if (planExcerpt) {
    parts.push('', '## Implementation Plan', planExcerpt);
  }

  parts.push(
    '',
    '## Guidelines',
    '- Execute the task as described. Do not deviate.',
    '- If you encounter an error or blocker, describe it clearly in your output.',
    '- Be thorough but efficient. Complete the work, verify it works, and finish.',
    '- If the task involves code changes, run relevant tests to verify correctness.',
    '- Report what you did, what files you changed, and any issues encountered.',
  );

  return parts.join('\n');
}

/**
 * Broomstick - ephemeral worker agent.
 * Created for specific tasks, runs with full tool access, then terminates.
 */
export class BroomstickAgent extends BaseAgent {
  constructor(
    sdk: SdkAdapter,
    events: FantasiaEventEmitter,
    memory: MemoryManager,
    taskDescription: string,
    planExcerpt?: string,
    overrides?: Partial<AgentConfig>,
  ) {
    super(sdk, events, memory, {
      role: 'broomstick',
      name: `Broomstick-${crypto.randomUUID().slice(0, 8)}`,
      systemPrompt: makeBroomstickPrompt(taskDescription, planExcerpt),
      model: overrides?.model ?? 'claude-sonnet-4-6',
      tools: { type: 'preset', preset: 'claude_code' },
      allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
      maxTurns: overrides?.maxTurns ?? 50,
      maxBudgetUsd: overrides?.maxBudgetUsd ?? 1.0,
      effort: 'high',
      persistSession: false,
      ...overrides,
    });
  }

  getConfig(): AgentConfig {
    return this.instance.config;
  }
}
