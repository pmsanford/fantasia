import type { AgentConfig, AgentInstance, SdkAdapter } from '../types.js';
import type { FantasiaEventEmitter } from '../events/event-emitter.js';
import type { MemoryManager } from '../memory/memory-manager.js';
import { BaseAgent } from './base-agent.js';

const IMAGINEER_SYSTEM_PROMPT = `You are the Imagineer, the monitoring and repair agent in the Fantasia system.
Your role is to watch over other agents and intervene when things go wrong.

## What You Monitor
You receive periodic health reports about all running agents. For each agent you see:
- Current status (idle, working, waiting, error)
- How long they've been in their current state
- Their assigned task
- Any errors they've encountered

## When to Intervene
- An agent has been "working" for too long (stuck)
- An agent is in "error" state
- A task has been in "in-progress" for too long without progress
- Multiple agents are failing on the same kind of error (systemic issue)

## How to Intervene
When you detect an issue, describe it clearly using the report_issue tool.
Include:
- Which agent is affected
- What the problem appears to be
- Your recommended action (restart, abort, retry with different parameters)

## Important
- Be conservative. Don't intervene unless there's a real problem.
- Brief delays are normal. Only flag things that are genuinely stuck.
- Consider whether an agent might be legitimately working on a complex task.
`;

export interface HealthReport {
  agents: Array<{
    id: string;
    role: string;
    name: string;
    status: string;
    currentTaskId?: string;
    lastActivityAt: number;
    error?: string;
  }>;
  taskCounts: {
    pending: number;
    active: number;
    completed: number;
    failed: number;
  };
  totalCostUsd: number;
  timestamp: number;
}

export interface Intervention {
  agentId: string;
  action: 'restart' | 'abort' | 'retry' | 'escalate';
  reason: string;
}

/**
 * Imagineer - the monitor/fixer agent.
 * Watches all other agents and intervenes when things go wrong.
 */
export class ImagineerAgent extends BaseAgent {
  constructor(
    sdk: SdkAdapter,
    events: FantasiaEventEmitter,
    memory: MemoryManager,
    overrides?: Partial<AgentConfig>,
  ) {
    super(sdk, events, memory, {
      role: 'imagineer',
      name: 'Imagineer',
      systemPrompt: IMAGINEER_SYSTEM_PROMPT,
      model: overrides?.model ?? 'claude-sonnet-4-6',
      tools: ['Read', 'Glob', 'Grep'],
      allowedTools: ['Read', 'Glob', 'Grep'],
      effort: 'medium',
      persistSession: false,
      ...overrides,
    });
  }

  getConfig(): AgentConfig {
    return this.instance.config;
  }

  /**
   * Analyze a health report and determine if intervention is needed.
   * This is a lightweight local check, not an SDK call.
   */
  analyzeHealth(report: HealthReport): Intervention[] {
    const interventions: Intervention[] = [];
    const now = report.timestamp;
    const STUCK_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

    for (const agent of report.agents) {
      // Check for error state
      if (agent.status === 'error') {
        interventions.push({
          agentId: agent.id,
          action: 'restart',
          reason: `Agent ${agent.name} is in error state: ${agent.error ?? 'unknown error'}`,
        });
        continue;
      }

      // Check for stuck agents
      if (agent.status === 'working') {
        const elapsed = now - agent.lastActivityAt;
        if (elapsed > STUCK_THRESHOLD_MS) {
          interventions.push({
            agentId: agent.id,
            action: 'restart',
            reason: `Agent ${agent.name} has been working for ${Math.round(elapsed / 1000)}s without activity`,
          });
        }
      }
    }

    return interventions;
  }
}
