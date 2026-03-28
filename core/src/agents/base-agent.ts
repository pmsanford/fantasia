import type {
  AgentConfig,
  AgentInstance,
  AgentStatus,
  SDKMessage,
  SDKQuery,
  SDKUserMessage,
  SDKOptions,
  SdkAdapter,
  TaskResult,
} from '../types.js';
import type { FantasiaEventEmitter } from '../events/event-emitter.js';
import type { MemoryManager } from '../memory/memory-manager.js';
import { AgentError } from '../errors.js';

export interface AgentRunOptions {
  prompt: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
  extraSdkOptions?: Partial<SDKOptions>;
}

export interface AgentRunResult {
  success: boolean;
  output: string;
  structuredOutput?: unknown;
  costUsd: number;
  numTurns: number;
  durationMs: number;
  sessionId: string;
}

/**
 * Base agent class that wraps SDK query() calls.
 * Each concrete agent overrides getConfig() and optionally processResult().
 */
export abstract class BaseAgent {
  readonly instance: AgentInstance;
  protected sdk: SdkAdapter;
  protected events: FantasiaEventEmitter;
  protected memory: MemoryManager;
  protected currentQuery: SDKQuery | null = null;

  constructor(
    sdk: SdkAdapter,
    events: FantasiaEventEmitter,
    memory: MemoryManager,
    config: AgentConfig,
  ) {
    this.sdk = sdk;
    this.events = events;
    this.memory = memory;
    this.instance = {
      id: crypto.randomUUID(),
      config,
      status: 'idle',
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
    };
  }

  /**
   * Get the agent configuration. Subclasses define their role-specific config.
   */
  abstract getConfig(): AgentConfig;

  /**
   * Run this agent with a prompt and return the result.
   */
  async run(options: AgentRunOptions): Promise<AgentRunResult> {
    this.setStatus('working');

    const config = this.instance.config;
    const memoryBlock = this.getMemoryBlock();

    const systemPrompt = memoryBlock
      ? `${config.systemPrompt}\n\n${memoryBlock}`
      : config.systemPrompt;

    const sdkOptions: SDKOptions = {
      model: config.model,
      tools: config.tools,
      disallowedTools: config.disallowedTools,
      allowedTools: config.allowedTools,
      maxTurns: config.maxTurns,
      maxBudgetUsd: config.maxBudgetUsd,
      effort: config.effort,
      outputFormat: config.outputFormat,
      persistSession: config.persistSession ?? false,
      permissionMode: config.permissionMode ?? 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      systemPrompt: { type: 'preset', preset: 'claude_code', append: systemPrompt },
      cwd: options.cwd,
      env: options.env,
      ...options.extraSdkOptions,
    };

    try {
      const query = this.sdk.query({ prompt: options.prompt, options: sdkOptions });
      this.currentQuery = query;

      let output = '';
      let structuredOutput: unknown;
      let costUsd = 0;
      let numTurns = 0;
      let durationMs = 0;
      let sessionId = '';
      let success = true;

      for await (const message of query) {
        this.instance.lastActivityAt = Date.now();

        this.events.emit({
          type: 'sdk:message',
          agentId: this.instance.id,
          sdkMessage: message,
        });

        if (message.type === 'assistant') {
          const textBlocks = (message.message.content as any[])
            .filter((b: any) => b.type === 'text')
            .map((b: any) => b.text);
          if (textBlocks.length > 0) {
            const text = textBlocks.join('\n');
            this.events.emit({
              type: 'agent:message',
              agentId: this.instance.id,
              content: text,
              isPartial: false,
            });
          }
        }

        if (message.type === 'result') {
          sessionId = message.session_id;
          costUsd = message.total_cost_usd;
          numTurns = message.num_turns;
          durationMs = message.duration_ms;

          if (message.subtype === 'success') {
            output = message.result;
            structuredOutput = (message as any).structured_output;
          } else {
            success = false;
            output = (message as any).errors?.join('\n') ?? `Error: ${message.subtype}`;
          }
        }
      }

      this.currentQuery = null;
      this.setStatus('idle');

      return { success, output, structuredOutput, costUsd, numTurns, durationMs, sessionId };
    } catch (error) {
      this.currentQuery = null;
      this.setStatus('error');
      this.instance.error = String(error);
      throw new AgentError(
        `Agent ${this.instance.config.name} failed: ${error}`,
        this.instance.id,
        this.instance.config.role,
      );
    }
  }

  /**
   * Stop the current query if running.
   */
  async stop(): Promise<void> {
    if (this.currentQuery) {
      this.currentQuery.close();
      this.currentQuery = null;
    }
    this.setStatus('terminated');
    this.events.emit({
      type: 'agent:terminated',
      agentId: this.instance.id,
      reason: 'stopped',
    });
  }

  /**
   * Get relevant memories formatted for prompt injection.
   */
  protected getMemoryBlock(contextTags?: string[]): string {
    const memories = this.memory.recall(this.instance.config.role, contextTags);
    return this.memory.formatForPrompt(memories);
  }

  protected setStatus(status: AgentStatus): void {
    const oldStatus = this.instance.status;
    if (oldStatus === status) return;
    this.instance.status = status;
    this.events.emit({
      type: 'agent:status-changed',
      agentId: this.instance.id,
      oldStatus,
      newStatus: status,
    });
  }
}
