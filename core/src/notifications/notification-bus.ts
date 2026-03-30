import type { FantasiaEvent, FantasiaEventType } from '../types.js';
import type { FantasiaEventEmitter } from '../events/event-emitter.js';
import logger from '../logger.js';

const log = logger.child('notifications');

const DEFAULT_BATCH_INTERVAL_MS = 3000;
const DEFAULT_MAX_BATCH_SIZE = 20;

export interface NotificationSubscription {
  id: string;
  subscriberId: string;
  eventTypes: FantasiaEventType[];
}

export interface NotificationBatch {
  subscriberId: string;
  events: FantasiaEvent[];
  timestamp: number;
}

/**
 * Batches Fantasia events and delivers them to subscribers.
 * Designed so agents (or other consumers) can subscribe to specific event types
 * and receive periodic batched notifications instead of per-event callbacks.
 */
export class NotificationBus {
  private subscriptions = new Map<string, NotificationSubscription>();
  private pendingEvents = new Map<string, FantasiaEvent[]>(); // subscriberId -> buffered events
  private deliveryCallbacks = new Map<string, (batch: NotificationBatch) => void>();
  private unsubscribeHandles: Array<() => void> = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private batchIntervalMs: number;
  private maxBatchSize: number;

  constructor(
    private events: FantasiaEventEmitter,
    options?: { batchIntervalMs?: number; maxBatchSize?: number },
  ) {
    this.batchIntervalMs = options?.batchIntervalMs ?? DEFAULT_BATCH_INTERVAL_MS;
    this.maxBatchSize = options?.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE;
  }

  /**
   * Start listening for events and batching them.
   */
  start(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => this.flush(), this.batchIntervalMs);
    log.debug('NotificationBus started', { batchIntervalMs: this.batchIntervalMs });
  }

  /**
   * Stop the bus and clean up.
   */
  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    // Final flush
    this.flush();
    // Clean up event subscriptions
    for (const unsub of this.unsubscribeHandles) {
      unsub();
    }
    this.unsubscribeHandles = [];
    this.subscriptions.clear();
    this.pendingEvents.clear();
    this.deliveryCallbacks.clear();
    log.debug('NotificationBus stopped');
  }

  /**
   * Subscribe to specific event types. Returns subscription ID.
   * The onBatch callback is called with batched events at the configured interval.
   */
  subscribe(
    subscriberId: string,
    eventTypes: FantasiaEventType[],
    onBatch: (batch: NotificationBatch) => void,
  ): string {
    const subId = crypto.randomUUID();

    const subscription: NotificationSubscription = {
      id: subId,
      subscriberId,
      eventTypes,
    };

    this.subscriptions.set(subId, subscription);
    this.pendingEvents.set(subId, []);
    this.deliveryCallbacks.set(subId, onBatch);

    // Subscribe to each event type on the emitter
    for (const eventType of eventTypes) {
      const unsub = this.events.on(eventType, (event) => {
        const pending = this.pendingEvents.get(subId);
        if (pending && pending.length < this.maxBatchSize) {
          pending.push(event);
        }
      });
      this.unsubscribeHandles.push(unsub);
    }

    log.info('Subscription created', { subId, subscriberId, eventTypes });
    return subId;
  }

  /**
   * Unsubscribe by subscription ID.
   */
  unsubscribe(subscriptionId: string): boolean {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) return false;

    // Flush remaining events for this subscription
    this.flushSubscription(subscriptionId);

    this.subscriptions.delete(subscriptionId);
    this.pendingEvents.delete(subscriptionId);
    this.deliveryCallbacks.delete(subscriptionId);

    log.info('Subscription removed', { subId: subscriptionId, subscriberId: sub.subscriberId });
    return true;
  }

  /**
   * Flush all pending batches now.
   */
  flush(): void {
    for (const [subId] of this.subscriptions) {
      this.flushSubscription(subId);
    }
  }

  private flushSubscription(subId: string): void {
    const pending = this.pendingEvents.get(subId);
    const callback = this.deliveryCallbacks.get(subId);
    const sub = this.subscriptions.get(subId);
    if (!pending || !callback || !sub || pending.length === 0) return;

    const batch: NotificationBatch = {
      subscriberId: sub.subscriberId,
      events: pending.splice(0), // drain
      timestamp: Date.now(),
    };

    log.debug('Flushing batch', { subId, subscriberId: sub.subscriberId, eventCount: batch.events.length });

    try {
      callback(batch);
    } catch (err) {
      log.warn('Batch delivery failed', { subId, error: String(err) });
    }
  }
}
