import type { ServiceImpl } from '@connectrpc/connect';
import type { FantasiaEvent as CoreFantasiaEvent } from '@fantasia/core';
import { EventService } from '../gen/fantasia/v1/events_pb.js';
import type { FantasiaEvent as ProtoFantasiaEvent } from '../gen/fantasia/v1/types_pb.js';
import { getOrchestrator, nextSequence } from '../bridge.js';
import { toProtoFantasiaEvent, toProtoFantasiaEvents } from '../convert.js';
import { withErrorHandling } from '../errors.js';
import logger from '../logger.js';

const log = logger.child('events');

function getPayloadCase(event: ProtoFantasiaEvent): string | undefined {
  return event.payload.case;
}

export const eventServiceImpl: ServiceImpl<typeof EventService> = {
  async *subscribe(req) {
    const orch = getOrchestrator();
    const typeFilter = new Set(req.eventTypes);

    log.info('Subscribe: client connected', {
      includeHistory: req.includeHistory,
      afterSequence: req.afterSequence != null ? Number(req.afterSequence) : null,
      filterCount: typeFilter.size,
    });

    const shouldInclude = (event: ProtoFantasiaEvent): boolean => {
      if (typeFilter.size === 0) return true;
      const payloadCase = getPayloadCase(event);
      return payloadCase != null && typeFilter.has(payloadCase);
    };

    // Phase 1: replay history
    if (req.includeHistory) {
      const history = orch.events.history();
      log.debug('Subscribe: replaying history', { count: history.length });
      for (const coreEvent of history) {
        const seq = nextSequence();
        if (req.afterSequence != null && BigInt(seq) <= req.afterSequence) continue;
        const protoEvents = toProtoFantasiaEvents(coreEvent, seq);
        for (const protoEvent of protoEvents) {
          if (shouldInclude(protoEvent)) {
            log.trace('Subscribe: yielding history event', { sequence: seq, payloadCase: getPayloadCase(protoEvent) });
            yield protoEvent;
          }
        }
      }
    }

    // Phase 2: live stream via onAny callback bridged to async queue
    log.debug('Subscribe: entering live stream');
    const queue: CoreFantasiaEvent[] = [];
    let resolve: (() => void) | null = null;
    let done = false;

    const unsubscribe = orch.events.onAny((event: CoreFantasiaEvent) => {
      if (event.type === 'orchestrator:stopped') {
        done = true;
      }
      queue.push(event);
      if (resolve) {
        resolve();
        resolve = null;
      }
    });

    try {
      while (true) {
        // Drain any queued events first (events may have fired synchronously before we awaited)
        while (queue.length > 0) {
          const event = queue.shift()!;
          const seq = nextSequence();
          const protoEvents = toProtoFantasiaEvents(event, seq);
          for (const protoEvent of protoEvents) {
            if (shouldInclude(protoEvent)) {
              log.trace('Subscribe: yielding live event', { sequence: seq, payloadCase: getPayloadCase(protoEvent) });
              yield protoEvent;
            }
          }
        }

        if (done) break;

        // Wait for next event
        await new Promise<void>((r) => {
          resolve = r;
        });
      }
    } finally {
      unsubscribe();
      log.info('Subscribe: stream ended');
    }
  },

  async getHistory(req) {
    return withErrorHandling(async () => {
      log.debug('GetHistory request', { limit: req.limit });
      const orch = getOrchestrator();
      const history = orch.events.history(req.limit ?? undefined);
      log.debug('GetHistory response', { count: history.length });
      return {
        events: history.flatMap(e => toProtoFantasiaEvents(e, nextSequence())),
      };
    });
  },
};
