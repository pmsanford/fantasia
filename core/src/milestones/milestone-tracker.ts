import type { FantasiaEventEmitter } from '../events/event-emitter.js';
import logger from '../logger.js';

const log = logger.child('milestones');

interface Waiter {
  resolve: () => void;
  reject: (err: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * Latch-based milestone tracker for coordinating parallel workstreams.
 *
 * Handles the race condition: if a milestone is emitted before a broomstick
 * calls waitFor, waitFor returns immediately from the reached set.
 */
export class MilestoneTracker {
  private reached = new Set<string>();
  private waiters = new Map<string, Waiter[]>();
  private disposed = false;

  constructor(private events: FantasiaEventEmitter) {}

  /**
   * Mark a milestone as reached. Resolves all pending waiters for this milestone.
   * Idempotent — emitting the same milestone twice is a no-op.
   */
  emit(milestoneId: string, workstreamName: string): void {
    if (this.reached.has(milestoneId)) {
      log.debug('milestone:reached (duplicate, ignored)', { milestoneId, workstreamName });
      return;
    }
    log.info('milestone:reached', { milestoneId, workstreamName });
    this.reached.add(milestoneId);
    this.events.emit({ type: 'milestone:reached', milestoneId, workstreamName });

    const pending = this.waiters.get(milestoneId);
    if (pending) {
      for (const waiter of pending) {
        if (waiter.timer) clearTimeout(waiter.timer);
        waiter.resolve();
      }
      this.waiters.delete(milestoneId);
    }
  }

  /**
   * Wait for a milestone to be reached. Returns immediately if already reached.
   * Rejects after timeoutMs if the milestone never fires.
   */
  async waitFor(milestoneId: string, timeoutMs = 300_000): Promise<void> {
    if (this.reached.has(milestoneId)) {
      log.debug('milestone:waitFor (already reached)', { milestoneId });
      return;
    }
    if (this.disposed) {
      throw new Error(`MilestoneTracker disposed while waiting for "${milestoneId}"`);
    }

    log.debug('milestone:waitFor (blocking)', { milestoneId, timeoutMs });
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject };

      waiter.timer = setTimeout(() => {
        const list = this.waiters.get(milestoneId);
        if (list) {
          const idx = list.indexOf(waiter);
          if (idx !== -1) list.splice(idx, 1);
          if (list.length === 0) this.waiters.delete(milestoneId);
        }
        reject(new Error(`Timeout waiting for milestone "${milestoneId}" after ${timeoutMs}ms`));
      }, timeoutMs);

      if (!this.waiters.has(milestoneId)) {
        this.waiters.set(milestoneId, []);
      }
      this.waiters.get(milestoneId)!.push(waiter);
    });
  }

  /** Get all milestones that have been reached so far. */
  getReached(): string[] {
    return [...this.reached];
  }

  /**
   * Reject all pending waiters. Call after Promise.all completes to avoid
   * hanging promises from failed workstreams that never emitted their milestones.
   */
  dispose(): void {
    this.disposed = true;
    for (const [milestoneId, waiters] of this.waiters) {
      for (const waiter of waiters) {
        if (waiter.timer) clearTimeout(waiter.timer);
        waiter.reject(new Error(`MilestoneTracker disposed — milestone "${milestoneId}" was never reached`));
      }
    }
    this.waiters.clear();
    log.debug('MilestoneTracker disposed', { reached: [...this.reached] });
  }
}
