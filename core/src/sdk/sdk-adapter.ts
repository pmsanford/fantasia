import {
  query,
  createSdkMcpServer,
  tool,
} from '@anthropic-ai/claude-agent-sdk';
import type { SdkAdapter, SDKOptions, SDKQuery, SDKUserMessage, SdkMcpToolDefinition, McpSdkServerConfigWithInstance } from '../types.js';

/**
 * Production SDK adapter that delegates to the real Claude Agent SDK.
 */
export class RealSdkAdapter implements SdkAdapter {
  query(params: { prompt: string | AsyncIterable<SDKUserMessage>; options?: SDKOptions }): SDKQuery {
    return query(params);
  }

  createMcpServer(options: { name: string; version?: string; tools?: Array<SdkMcpToolDefinition<any>> }): McpSdkServerConfigWithInstance {
    return createSdkMcpServer(options);
  }

  tool<Schema extends Record<string, any>>(
    name: string,
    description: string,
    inputSchema: Schema,
    handler: (args: any, extra: unknown) => Promise<any>,
    extras?: { annotations?: Record<string, boolean>; searchHint?: string; alwaysLoad?: boolean },
  ): SdkMcpToolDefinition<Schema> {
    return tool(name, description, inputSchema, handler, extras);
  }
}
