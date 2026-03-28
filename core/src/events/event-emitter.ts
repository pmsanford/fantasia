import type { FantasiaEvent, FantasiaEventType } from '../types.js';

type Handler<T extends FantasiaEvent = FantasiaEvent> = (event: T) => void;

/**
 * Typed event emitter for Fantasia UI integration.
 * Emits FantasiaEvent objects that UIs can subscribe to.
 */
export class FantasiaEventEmitter {
  private handlers = new Map<string, Set<Handler<any>>>();
  private wildcardHandlers = new Set<Handler<FantasiaEvent>>();
  private eventHistory: FantasiaEvent[] = [];
  private maxHistory = 1000;

  // For the async stream
  private streamResolvers: Array<(event: FantasiaEvent) => void> = [];
  private streamBuffer: FantasiaEvent[] = [];
  private streamActive = false;

  /**
   * Subscribe to a specific event type.
   * Returns an unsubscribe function.
   */
  on<T extends FantasiaEventType>(
    type: T,
    handler: (event: Extract<FantasiaEvent, { type: T }>) => void,
  ): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);
    return () => {
      this.handlers.get(type)?.delete(handler);
    };
  }

  /**
   * Subscribe to a specific event type for one emission only.
   */
  once<T extends FantasiaEventType>(
    type: T,
    handler: (event: Extract<FantasiaEvent, { type: T }>) => void,
  ): () => void {
    const unsubscribe = this.on(type, (event) => {
      unsubscribe();
      handler(event);
    });
    return unsubscribe;
  }

  /**
   * Subscribe to all events.
   * Returns an unsubscribe function.
   */
  onAny(handler: (event: FantasiaEvent) => void): () => void {
    this.wildcardHandlers.add(handler);
    return () => {
      this.wildcardHandlers.delete(handler);
    };
  }

  /**
   * Emit an event to all subscribers.
   */
  emit(event: FantasiaEvent): void {
    this.eventHistory.push(event);
    if (this.eventHistory.length > this.maxHistory) {
      this.eventHistory.shift();
    }

    // Notify type-specific handlers
    const typeHandlers = this.handlers.get(event.type);
    if (typeHandlers) {
      for (const handler of typeHandlers) {
        handler(event);
      }
    }

    // Notify wildcard handlers
    for (const handler of this.wildcardHandlers) {
      handler(event);
    }

    // Feed the async stream
    if (this.streamResolvers.length > 0) {
      const resolver = this.streamResolvers.shift()!;
      resolver(event);
    } else if (this.streamActive) {
      this.streamBuffer.push(event);
    }
  }

  /**
   * Returns an async generator that yields all events.
   * Useful for CLI-style consumers that want to `for await` over events.
   */
  async *stream(): AsyncGenerator<FantasiaEvent> {
    this.streamActive = true;
    try {
      while (this.streamActive) {
        if (this.streamBuffer.length > 0) {
          yield this.streamBuffer.shift()!;
        } else {
          const event = await new Promise<FantasiaEvent>((resolve) => {
            this.streamResolvers.push(resolve);
          });
          yield event;
        }
      }
    } finally {
      this.streamActive = false;
      this.streamResolvers = [];
      this.streamBuffer = [];
    }
  }

  /**
   * Stop the async stream.
   */
  stopStream(): void {
    this.streamActive = false;
    // Resolve any pending stream promises with a sentinel
    // (the stream generator will exit on next iteration)
    for (const resolver of this.streamResolvers) {
      resolver({ type: 'orchestrator:stopped' } as FantasiaEvent);
    }
    this.streamResolvers = [];
  }

  /**
   * Get recent event history.
   */
  history(limit?: number): FantasiaEvent[] {
    if (limit) {
      return this.eventHistory.slice(-limit);
    }
    return [...this.eventHistory];
  }

  /**
   * Clear all handlers and history.
   */
  clear(): void {
    this.handlers.clear();
    this.wildcardHandlers.clear();
    this.eventHistory = [];
    this.stopStream();
  }

  /**
   * Wait for a specific event type. Returns a promise that resolves with the event.
   */
  waitFor<T extends FantasiaEventType>(
    type: T,
    timeout?: number,
  ): Promise<Extract<FantasiaEvent, { type: T }>> {
    return new Promise((resolve, reject) => {
      const unsubscribe = this.once(type, (event) => {
        if (timer) clearTimeout(timer);
        resolve(event);
      });

      let timer: ReturnType<typeof setTimeout> | undefined;
      if (timeout) {
        timer = setTimeout(() => {
          unsubscribe();
          reject(new Error(`Timeout waiting for event: ${type}`));
        }, timeout);
      }
    });
  }
}
