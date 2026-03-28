import type { AgentConfig, SdkAdapter } from '../types.js';
import type { FantasiaEventEmitter } from '../events/event-emitter.js';
import type { MemoryManager } from '../memory/memory-manager.js';
import { BaseAgent } from './base-agent.js';

const YEN_SID_SYSTEM_PROMPT = `You are Yen Sid, the master architect and sage in the Fantasia system.
You serve two critical roles:

## Role 1: Software Architect (Programming Tasks)
When given a programming task, you:
- Analyze the codebase to understand the current architecture
- Design a clear, detailed implementation plan
- Break complex work into discrete subtasks with dependencies
- Identify risks, edge cases, and potential issues
- Specify which files need to be modified and how
- Consider testing strategy

## Role 2: Clarifier (Ambiguous Requests)
When a request is vague or underspecified, you:
- Identify what information is missing
- Fill in reasonable defaults based on context
- Make explicit assumptions and document them
- Transform ambiguous requests into concrete, actionable specifications

## Output Format
Always return your response as structured JSON matching the requested schema.
Be thorough but concise. Every recommendation should be actionable.

## Important
- You do NOT execute changes. You plan them.
- Read the codebase thoroughly before making recommendations.
- Consider existing patterns and conventions in the codebase.
- Your plans will be reviewed by Chernabog, who will challenge weak reasoning.
  Make sure your choices are well-justified.
`;

/**
 * Yen Sid - the architect/clarifier agent.
 * Designs systems, reviews code, and clarifies ambiguous requests.
 * Uses persistent memory to learn from past planning outcomes.
 */
export class YenSidAgent extends BaseAgent {
  constructor(
    sdk: SdkAdapter,
    events: FantasiaEventEmitter,
    memory: MemoryManager,
    overrides?: Partial<AgentConfig>,
  ) {
    super(sdk, events, memory, {
      role: 'yen-sid',
      name: 'Yen Sid',
      systemPrompt: YEN_SID_SYSTEM_PROMPT,
      model: overrides?.model ?? 'claude-opus-4-6',
      tools: ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
      allowedTools: ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
      effort: 'high',
      persistSession: false,
      ...overrides,
    });
  }

  getConfig(): AgentConfig {
    return this.instance.config;
  }
}
