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
import logger from '../logger.js';

const log = logger.child('agent');

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
  protected lastSessionId: string | null = null;

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
    log.debug('Agent created', { id: this.instance.id, role: config.role, name: config.name });
  }

  /**
   * Get the agent configuration. Subclasses define their role-specific config.
   */
  abstract getConfig(): AgentConfig;

  /**
   * Run this agent with a prompt and return the result.
   */
  async run(options: AgentRunOptions): Promise<AgentRunResult> {
    const agentLog = log.child(this.instance.config.role);
    agentLog.info('run: starting', {
      id: this.instance.id,
      name: this.instance.config.name,
      promptLength: options.prompt.length,
    });

    this.setStatus('working');

    const config = this.instance.config;
    const memoryBlock = this.getMemoryBlock();
    if (memoryBlock) {
      agentLog.debug('run: memory block injected', { memoryBlockLength: memoryBlock.length });
    }

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
      ...(options.env && Object.keys(options.env).length > 0 ? { env: options.env } : {}),
      ...(this.lastSessionId ? { resume: this.lastSessionId } : {}),
      stderr: (data: string) => {
        agentLog.debug('run: stderr', { data: data.trim() });
      },
      ...options.extraSdkOptions,
    };

    agentLog.debug('run: calling sdk.query', { model: config.model, resumeSession: this.lastSessionId ?? 'none' });

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
      let messageCount = 0;

      for await (const message of query) {
        messageCount++;
        this.instance.lastActivityAt = Date.now();

        agentLog.trace('run: sdk message received', {
          id: this.instance.id,
          messageType: message.type,
          messageCount,
        });

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
            agentLog.trace('run: assistant text', { id: this.instance.id, textLength: text.length });
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
            agentLog.warn('run: non-success result', {
              id: this.instance.id,
              subtype: message.subtype,
              output: output.slice(0, 200),
            });
          }
        }
      }

      this.currentQuery = null;
      this.setStatus('idle');

      // Store session ID for resuming conversation on next run
      if (sessionId) {
        this.lastSessionId = sessionId;
      }

      agentLog.info('run: completed', {
        id: this.instance.id,
        name: this.instance.config.name,
        success,
        costUsd,
        numTurns,
        durationMs,
        messageCount,
        sessionId,
      });

      return { success, output, structuredOutput, costUsd, numTurns, durationMs, sessionId };
    } catch (error) {
      this.currentQuery = null;
      this.setStatus('error');
      this.instance.error = String(error);
      const errObj = error as any;
      agentLog.error('run: failed', {
        id: this.instance.id,
        name: this.instance.config.name,
        error: String(error),
        stderr: errObj?.stderr,
        stdout: errObj?.stdout,
        exitCode: errObj?.exitCode ?? errObj?.code,
        stack: errObj?.stack,
        cause: errObj?.cause ? String(errObj.cause) : undefined,
        keys: error && typeof error === 'object' ? Object.keys(error) : undefined,
      });
      throw new AgentError(
        `Agent ${this.instance.config.name} failed: ${error}`,
        this.instance.id,
        this.instance.config.role,
      );
    }
  }

  /**
   * Send a notification message into the agent's active conversation.
   * Uses streamInput to inject a user message without interrupting the session.
   * Returns false if no active query.
   */
  async sendNotification(message: string): Promise<boolean> {
    if (!this.currentQuery) return false;
    try {
      const userMessage: SDKUserMessage = {
        type: 'user',
        message: { role: 'user', content: message },
        parent_tool_use_id: null,
      };
      // Create a one-shot async iterable
      async function* singleMessage() {
        yield userMessage;
      }
      await this.currentQuery.streamInput(singleMessage());
      log.debug('Notification sent to agent', { id: this.instance.id, messageLength: message.length });
      return true;
    } catch (err) {
      log.warn('Failed to send notification to agent', { id: this.instance.id, error: String(err) });
      return false;
    }
  }

  /**
   * Stop the current query if running.
   */
  async stop(): Promise<void> {
    log.debug('Agent stopping', { id: this.instance.id, role: this.instance.config.role, name: this.instance.config.name });
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
    log.debug('Agent stopped', { id: this.instance.id });
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
    log.trace('Agent status changed', { id: this.instance.id, oldStatus, newStatus: status });
    this.events.emit({
      type: 'agent:status-changed',
      agentId: this.instance.id,
      oldStatus,
      newStatus: status,
    });
  }
}
