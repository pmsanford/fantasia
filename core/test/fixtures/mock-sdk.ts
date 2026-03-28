import type {
  SdkAdapter,
  SDKOptions,
  SDKQuery,
  SDKUserMessage,
  SDKMessage,
  SDKResultMessage,
  SDKAssistantMessage,
  SdkMcpToolDefinition,
  McpSdkServerConfigWithInstance,
} from '../../src/types.js';
import type { UUID } from 'crypto';

// ─── Helpers for creating mock SDK messages ─────────────────────

let messageCounter = 0;

function makeUUID(): UUID {
  return crypto.randomUUID() as UUID;
}

export function mockAssistantMessage(
  text: string,
  options: { sessionId?: string; parentToolUseId?: string | null } = {},
): SDKAssistantMessage {
  return {
    type: 'assistant',
    message: {
      id: `msg_${++messageCounter}`,
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text }],
      model: 'claude-sonnet-4-6',
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    } as any,
    parent_tool_use_id: options.parentToolUseId ?? null,
    uuid: makeUUID(),
    session_id: options.sessionId ?? 'mock-session',
  };
}

export function mockToolUseMessage(
  toolName: string,
  toolInput: Record<string, unknown>,
  options: { sessionId?: string; toolUseId?: string } = {},
): SDKAssistantMessage {
  const toolUseId = options.toolUseId ?? `toolu_${++messageCounter}`;
  return {
    type: 'assistant',
    message: {
      id: `msg_${++messageCounter}`,
      type: 'message',
      role: 'assistant',
      content: [
        { type: 'tool_use', id: toolUseId, name: toolName, input: toolInput },
      ],
      model: 'claude-sonnet-4-6',
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    } as any,
    parent_tool_use_id: null,
    uuid: makeUUID(),
    session_id: options.sessionId ?? 'mock-session',
  };
}

export function mockResultSuccess(
  result: string,
  options: { sessionId?: string; costUsd?: number; numTurns?: number } = {},
): SDKResultMessage {
  return {
    type: 'result',
    subtype: 'success',
    duration_ms: 1000,
    duration_api_ms: 800,
    is_error: false,
    num_turns: options.numTurns ?? 1,
    result,
    stop_reason: 'end_turn',
    total_cost_usd: options.costUsd ?? 0.01,
    usage: { input_tokens: 100, output_tokens: 50 } as any,
    modelUsage: {},
    permission_denials: [],
    uuid: makeUUID(),
    session_id: options.sessionId ?? 'mock-session',
  };
}

export function mockResultError(
  errors: string[],
  options: { sessionId?: string; subtype?: 'error_during_execution' | 'error_max_turns' | 'error_max_budget_usd' } = {},
): SDKResultMessage {
  return {
    type: 'result',
    subtype: options.subtype ?? 'error_during_execution',
    duration_ms: 1000,
    duration_api_ms: 800,
    is_error: true,
    num_turns: 1,
    stop_reason: null,
    total_cost_usd: 0.01,
    usage: { input_tokens: 100, output_tokens: 50 } as any,
    modelUsage: {},
    permission_denials: [],
    errors,
    uuid: makeUUID(),
    session_id: options.sessionId ?? 'mock-session',
  };
}

export function mockSystemMessage(
  sessionId: string = 'mock-session',
): SDKMessage {
  return {
    type: 'system' as const,
    subtype: 'init' as const,
    uuid: makeUUID(),
    session_id: sessionId,
  } as any;
}

// ─── Script definition for mock queries ─────────────────────────

export interface MockScript {
  /** Pattern to match against prompt text */
  pattern: string | RegExp;
  /** Messages to yield in order */
  messages: SDKMessage[];
  /** If true, script is consumed after first match */
  once?: boolean;
}

// ─── Mock Query (AsyncGenerator + Query methods) ────────────────

export class MockQuery {
  private messages: SDKMessage[];
  private inputStream: AsyncIterable<SDKUserMessage> | null = null;
  private _closed = false;

  constructor(messages: SDKMessage[]) {
    this.messages = messages;
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<SDKMessage, void> {
    for (const msg of this.messages) {
      if (this._closed) return;
      yield msg;
    }
  }

  // Implement the next/return/throw for AsyncGenerator
  async next(): Promise<IteratorResult<SDKMessage, void>> {
    return { done: true, value: undefined };
  }

  async return(): Promise<IteratorResult<SDKMessage, void>> {
    this._closed = true;
    return { done: true, value: undefined };
  }

  async throw(e: any): Promise<IteratorResult<SDKMessage, void>> {
    this._closed = true;
    throw e;
  }

  // Query-specific methods (stubs)
  async interrupt(): Promise<void> {}
  async setPermissionMode(): Promise<void> {}
  async setModel(): Promise<void> {}
  async setMaxThinkingTokens(): Promise<void> {}
  async applyFlagSettings(): Promise<void> {}
  async initializationResult(): Promise<any> { return {}; }
  async supportedCommands(): Promise<any[]> { return []; }
  async supportedModels(): Promise<any[]> { return []; }
  async supportedAgents(): Promise<any[]> { return []; }
  async mcpServerStatus(): Promise<any[]> { return []; }
  async getContextUsage(): Promise<any> { return {}; }
  async reloadPlugins(): Promise<any> { return {}; }
  async accountInfo(): Promise<any> { return {}; }
  async rewindFiles(): Promise<any> { return {}; }
  async seedReadState(): Promise<void> {}
  async reconnectMcpServer(): Promise<void> {}
  async toggleMcpServer(): Promise<void> {}
  async setMcpServers(): Promise<any> { return {}; }
  async stopTask(): Promise<void> {}
  close(): void { this._closed = true; }

  async streamInput(stream: AsyncIterable<SDKUserMessage>): Promise<void> {
    this.inputStream = stream;
  }
}

// ─── Mock SDK Adapter ───────────────────────────────────────────

export class MockSdkAdapter implements SdkAdapter {
  private scripts: MockScript[] = [];
  private defaultMessages: SDKMessage[] = [];
  public queryCalls: Array<{ prompt: string | AsyncIterable<SDKUserMessage>; options?: SDKOptions }> = [];
  public lastQuery: MockQuery | null = null;

  /**
   * Register a scripted response for prompts matching a pattern.
   */
  whenPromptMatches(pattern: string | RegExp, messages: SDKMessage[], once = false): this {
    this.scripts.push({ pattern, messages, once });
    return this;
  }

  /**
   * Register a scripted response for prompts containing a substring.
   */
  whenPromptContains(substring: string, messages: SDKMessage[]): this {
    return this.whenPromptMatches(substring, messages);
  }

  /**
   * Set default messages returned when no script matches.
   */
  setDefaultResponse(messages: SDKMessage[]): this {
    this.defaultMessages = messages;
    return this;
  }

  /**
   * Reset all scripts and recorded calls.
   */
  reset(): void {
    this.scripts = [];
    this.defaultMessages = [];
    this.queryCalls = [];
    this.lastQuery = null;
  }

  query(params: { prompt: string | AsyncIterable<SDKUserMessage>; options?: SDKOptions }): SDKQuery {
    this.queryCalls.push(params);

    const promptText = typeof params.prompt === 'string' ? params.prompt : '<stream>';
    const messages = this.findMessages(promptText);
    const mockQuery = new MockQuery(messages);
    this.lastQuery = mockQuery;
    return mockQuery as unknown as SDKQuery;
  }

  createMcpServer(options: { name: string; version?: string; tools?: Array<SdkMcpToolDefinition<any>> }): McpSdkServerConfigWithInstance {
    // Return a minimal mock that satisfies the type
    return {
      type: 'sdk' as const,
      name: options.name,
      serverInstance: {} as any,
    } as McpSdkServerConfigWithInstance;
  }

  tool<Schema extends Record<string, any>>(
    name: string,
    description: string,
    inputSchema: Schema,
    handler: (args: any, extra: unknown) => Promise<any>,
    extras?: { annotations?: Record<string, boolean> },
  ): SdkMcpToolDefinition<Schema> {
    return {
      name,
      description,
      inputSchema,
      handler,
      ...(extras?.annotations ? { annotations: extras.annotations } : {}),
    } as SdkMcpToolDefinition<Schema>;
  }

  private findMessages(promptText: string): SDKMessage[] {
    for (let i = 0; i < this.scripts.length; i++) {
      const script = this.scripts[i];
      const matches =
        typeof script.pattern === 'string'
          ? promptText.includes(script.pattern)
          : script.pattern.test(promptText);
      if (matches) {
        if (script.once) {
          this.scripts.splice(i, 1);
        }
        return script.messages;
      }
    }
    return this.defaultMessages;
  }
}
