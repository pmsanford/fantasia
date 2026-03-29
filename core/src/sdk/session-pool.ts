import type { SDKQuery, SdkAdapter, SDKOptions, SDKUserMessage } from '../types.js';
import logger from '../logger.js';

const log = logger.child('sessionPool');

interface ManagedSession {
  agentId: string;
  query: SDKQuery;
  startedAt: number;
}

/**
 * Manages the lifecycle of concurrent SDK Query instances.
 */
export class SessionPool {
  private sessions = new Map<string, ManagedSession>();
  private sdk: SdkAdapter;

  constructor(sdk: SdkAdapter) {
    this.sdk = sdk;
  }

  /**
   * Create a new query for an agent.
   */
  createQuery(
    agentId: string,
    prompt: string | AsyncIterable<SDKUserMessage>,
    options?: SDKOptions,
  ): SDKQuery {
    // Close existing query for this agent if any
    this.closeQuery(agentId);

    log.debug('Creating query', { agentId });
    const query = this.sdk.query({ prompt, options });
    this.sessions.set(agentId, {
      agentId,
      query,
      startedAt: Date.now(),
    });
    return query;
  }

  /**
   * Get the active query for an agent.
   */
  getQuery(agentId: string): SDKQuery | undefined {
    return this.sessions.get(agentId)?.query;
  }

  /**
   * Check if an agent has an active query.
   */
  hasQuery(agentId: string): boolean {
    return this.sessions.has(agentId);
  }

  /**
   * Close a specific agent's query.
   */
  closeQuery(agentId: string): void {
    const session = this.sessions.get(agentId);
    if (session) {
      log.debug('Closing query', { agentId });
      session.query.close();
      this.sessions.delete(agentId);
    }
  }

  /**
   * Close all active queries.
   */
  closeAll(): void {
    log.debug('Closing all sessions', { count: this.sessions.size });
    for (const [agentId] of this.sessions) {
      this.closeQuery(agentId);
    }
  }

  /**
   * Get the number of active sessions.
   */
  get size(): number {
    return this.sessions.size;
  }

  /**
   * Get all active agent IDs.
   */
  getActiveAgentIds(): string[] {
    return Array.from(this.sessions.keys());
  }
}
