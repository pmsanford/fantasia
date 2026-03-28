import { describe, test, expect, beforeEach } from 'bun:test';
import { MessageBus } from '../../src/messaging/message-bus.js';
import type { AgentMessage } from '../../src/types.js';

describe('MessageBus', () => {
  let bus: MessageBus;

  beforeEach(() => {
    bus = new MessageBus(100);
  });

  function makeMessage(overrides: Partial<AgentMessage> = {}): AgentMessage {
    return {
      id: crypto.randomUUID(),
      type: 'status-update',
      from: 'agent-1',
      to: 'agent-2',
      payload: { status: 'ok' },
      timestamp: Date.now(),
      ...overrides,
    };
  }

  test('subscribe delivers messages to target agent', () => {
    const received: AgentMessage[] = [];
    bus.subscribe('agent-2', (msg) => received.push(msg));

    bus.publish(makeMessage({ to: 'agent-2' }));
    bus.publish(makeMessage({ to: 'agent-3' }));

    expect(received).toHaveLength(1);
  });

  test('broadcast delivers to all agent subscribers', () => {
    const received1: AgentMessage[] = [];
    const received2: AgentMessage[] = [];

    bus.subscribe('agent-1', (msg) => received1.push(msg));
    bus.subscribe('agent-2', (msg) => received2.push(msg));

    bus.publish(makeMessage({ to: 'broadcast' }));

    expect(received1).toHaveLength(1);
    expect(received2).toHaveLength(1);
  });

  test('subscribeTopic delivers messages of matching type', () => {
    const received: AgentMessage[] = [];
    bus.subscribeTopic('task-result', (msg) => received.push(msg));

    bus.publish(makeMessage({ type: 'task-result' }));
    bus.publish(makeMessage({ type: 'status-update' }));

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('task-result');
  });

  test('subscribeAll receives everything', () => {
    const received: AgentMessage[] = [];
    bus.subscribeAll((msg) => received.push(msg));

    bus.publish(makeMessage({ to: 'agent-1' }));
    bus.publish(makeMessage({ to: 'agent-2', type: 'task-result' }));

    expect(received).toHaveLength(2);
  });

  test('unsubscribe stops delivery', () => {
    const received: AgentMessage[] = [];
    const unsub = bus.subscribe('agent-1', (msg) => received.push(msg));

    bus.publish(makeMessage({ to: 'agent-1' }));
    expect(received).toHaveLength(1);

    unsub();
    bus.publish(makeMessage({ to: 'agent-1' }));
    expect(received).toHaveLength(1);
  });

  test('getHistory returns all messages', () => {
    bus.publish(makeMessage());
    bus.publish(makeMessage());
    expect(bus.getHistory()).toHaveLength(2);
  });

  test('getHistory filters by agentId', () => {
    bus.publish(makeMessage({ from: 'a1', to: 'a2' }));
    bus.publish(makeMessage({ from: 'a3', to: 'a4' }));

    expect(bus.getHistory({ agentId: 'a1' })).toHaveLength(1);
    expect(bus.getHistory({ agentId: 'a2' })).toHaveLength(1);
    expect(bus.getHistory({ agentId: 'a5' })).toHaveLength(0);
  });

  test('getHistory filters by type', () => {
    bus.publish(makeMessage({ type: 'task-result' }));
    bus.publish(makeMessage({ type: 'status-update' }));
    bus.publish(makeMessage({ type: 'task-result' }));

    expect(bus.getHistory({ type: 'task-result' })).toHaveLength(2);
  });

  test('getHistory filters by correlationId', () => {
    bus.publish(makeMessage({ correlationId: 'corr-1' }));
    bus.publish(makeMessage({ correlationId: 'corr-2' }));
    bus.publish(makeMessage({ correlationId: 'corr-1' }));

    expect(bus.getHistory({ correlationId: 'corr-1' })).toHaveLength(2);
  });

  test('history respects max size', () => {
    const smallBus = new MessageBus(3);
    for (let i = 0; i < 5; i++) {
      smallBus.publish(makeMessage());
    }
    expect(smallBus.getHistory()).toHaveLength(3);
  });

  test('clear removes all subscribers and history', () => {
    const received: AgentMessage[] = [];
    bus.subscribe('agent-1', (msg) => received.push(msg));
    bus.publish(makeMessage({ to: 'agent-1' }));

    bus.clear();

    bus.publish(makeMessage({ to: 'agent-1' }));
    expect(received).toHaveLength(1); // Only the one before clear (subscriber was removed)
    expect(bus.getHistory()).toHaveLength(1); // New message was added to fresh history
  });
});
