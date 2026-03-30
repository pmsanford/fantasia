import type { AgentConfig, SdkAdapter, ReconReport } from '../types.js';
import type { FantasiaEventEmitter } from '../events/event-emitter.js';
import type { MemoryManager } from '../memory/memory-manager.js';
import { BaseAgent } from './base-agent.js';

export interface BroomstickMilestones {
  emits?: Array<{ id: string; description: string }>;
  waitsFor?: Array<{ id: string; description: string }>;
}

/**
 * Create a system prompt for a broomstick worker, injecting the task plan and recon data.
 */
function makeBroomstickPrompt(taskDescription: string, planExcerpt?: string, recon?: ReconReport, milestones?: BroomstickMilestones): string {
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

  if (recon) {
    parts.push('', '## Reconnaissance Report');

    if (recon.potentiallyStale) {
      parts.push('> Note: This report was generated before a plan revision. Verify findings.');
    }

    if (recon.sharedContext.patterns.length > 0) {
      parts.push('', '### Patterns & Conventions');
      recon.sharedContext.patterns.forEach(p => parts.push(`- ${p}`));
    }
    if (recon.sharedContext.constraints.length > 0) {
      parts.push('', '### Constraints');
      recon.sharedContext.constraints.forEach(c => parts.push(`- ${c}`));
    }
    if (recon.sharedContext.commonFiles.length > 0) {
      parts.push('', '### Key Files');
      recon.sharedContext.commonFiles.forEach(f => parts.push(`- \`${f.path}\` — ${f.purpose}`));
    }

    for (const sr of recon.subtaskRecon) {
      if (sr.relevantFiles.length > 0) {
        parts.push('', '### Relevant Files');
        sr.relevantFiles.forEach(f => {
          let line = `- \`${f.path}\` — ${f.reason}`;
          if (f.keyLines) line += `\n  \`\`\`\n  ${f.keyLines}\n  \`\`\``;
          parts.push(line);
        });
      }
      if (sr.references.length > 0) {
        parts.push('', '### Reference Implementations');
        sr.references.forEach(r => parts.push(`- \`${r.path}\` — ${r.description}`));
      }
      if (sr.warnings.length > 0) {
        parts.push('', '### Warnings');
        sr.warnings.forEach(w => parts.push(`- ${w}`));
      }
    }
  }

  if (milestones && (milestones.emits?.length || milestones.waitsFor?.length)) {
    parts.push('', '## Milestone Coordination');
    parts.push(
      'You have milestone tools for coordinating with other parallel workstreams.',
      'Subscribe to milestones you need at the very start of your work so you never miss an early emit.',
    );

    if (milestones.waitsFor?.length) {
      parts.push('', '### Milestones to WAIT FOR');
      parts.push('Call `wait_for_milestone` BEFORE starting the dependent sub-task described below:');
      for (const m of milestones.waitsFor) {
        parts.push(`- \`${m.id}\`: ${m.description}`);
      }
      parts.push('', 'IMPORTANT: Call `wait_for_milestone` as early as possible (ideally at the start of your');
      parts.push('session) so that if the milestone is already reached, you proceed without delay.');
    }

    if (milestones.emits?.length) {
      parts.push('', '### Milestones to EMIT');
      parts.push('Call `emit_milestone` immediately after completing the sub-task described below:');
      for (const m of milestones.emits) {
        parts.push(`- \`${m.id}\`: ${m.description}`);
      }
      parts.push('', 'IMPORTANT: Emit these milestones as soon as the described work is complete,');
      parts.push('even if you still have remaining tasks. Other workstreams may be waiting.');
    }
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
    recon?: ReconReport,
    overrides?: Partial<AgentConfig>,
    milestones?: BroomstickMilestones,
  ) {
    const hasMilestones = !!(milestones?.emits?.length || milestones?.waitsFor?.length);
    const milestoneTools = hasMilestones
      ? ['mcp__milestones__emit_milestone', 'mcp__milestones__wait_for_milestone']
      : [];
    super(sdk, events, memory, {
      role: 'broomstick',
      name: `Broomstick-${crypto.randomUUID().slice(0, 8)}`,
      systemPrompt: makeBroomstickPrompt(taskDescription, planExcerpt, recon, milestones),
      model: overrides?.model ?? 'claude-sonnet-4-6',
      tools: { type: 'preset', preset: 'claude_code' },
      allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'WebSearch', 'WebFetch', ...milestoneTools],
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
