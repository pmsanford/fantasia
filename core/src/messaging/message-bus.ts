import type { AgentMessage, MessageType } from '../types.js';

type MessageHandler = (message: AgentMessage) => void;

/**
 * Internal pub/sub message bus for inter-agent coordination.
 * All agent communication is mediated by the orchestrator through this bus.
 */
export class MessageBus {
  private agentSubscribers = new Map<string, Set<MessageHandler>>();
  private topicSubscribers = new Map<MessageType, Set<MessageHandler>>();
  private wildcardSubscribers = new Set<MessageHandler>();
  private messageHistory: AgentMessage[] = [];
  private maxHistory: number;

  constructor(maxHistory = 500) {
    this.maxHistory = maxHistory;
  }

  /**
   * Subscribe to messages directed to a specific agent.
   * Returns an unsubscribe function.
   */
  subscribe(agentId: string, handler: MessageHandler): () => void {
    if (!this.agentSubscribers.has(agentId)) {
      this.agentSubscribers.set(agentId, new Set());
    }
    this.agentSubscribers.get(agentId)!.add(handler);
    return () => {
      this.agentSubscribers.get(agentId)?.delete(handler);
    };
  }

  /**
   * Subscribe to messages of a specific type.
   * Returns an unsubscribe function.
   */
  subscribeTopic(type: MessageType, handler: MessageHandler): () => void {
    if (!this.topicSubscribers.has(type)) {
      this.topicSubscribers.set(type, new Set());
    }
    this.topicSubscribers.get(type)!.add(handler);
    return () => {
      this.topicSubscribers.get(type)?.delete(handler);
    };
  }

  /**
   * Subscribe to all messages.
   */
  subscribeAll(handler: MessageHandler): () => void {
    this.wildcardSubscribers.add(handler);
    return () => {
      this.wildcardSubscribers.delete(handler);
    };
  }

  /**
   * Publish a message to the bus.
   */
  publish(message: AgentMessage): void {
    this.messageHistory.push(message);
    if (this.messageHistory.length > this.maxHistory) {
      this.messageHistory.shift();
    }

    // Deliver to target agent subscriber(s)
    if (message.to === 'broadcast') {
      for (const [, handlers] of this.agentSubscribers) {
        for (const handler of handlers) {
          handler(message);
        }
      }
    } else {
      const agentHandlers = this.agentSubscribers.get(message.to);
      if (agentHandlers) {
        for (const handler of agentHandlers) {
          handler(message);
        }
      }
    }

    // Deliver to topic subscribers
    const topicHandlers = this.topicSubscribers.get(message.type);
    if (topicHandlers) {
      for (const handler of topicHandlers) {
        handler(message);
      }
    }

    // Deliver to wildcard subscribers
    for (const handler of this.wildcardSubscribers) {
      handler(message);
    }
  }

  /**
   * Get message history, optionally filtered.
   */
  getHistory(filter?: { agentId?: string; type?: MessageType; correlationId?: string }): AgentMessage[] {
    if (!filter) return [...this.messageHistory];

    return this.messageHistory.filter((msg) => {
      if (filter.agentId && msg.from !== filter.agentId && msg.to !== filter.agentId) return false;
      if (filter.type && msg.type !== filter.type) return false;
      if (filter.correlationId && msg.correlationId !== filter.correlationId) return false;
      return true;
    });
  }

  /**
   * Clear all subscribers and history.
   */
  clear(): void {
    this.agentSubscribers.clear();
    this.topicSubscribers.clear();
    this.wildcardSubscribers.clear();
    this.messageHistory = [];
  }
}
