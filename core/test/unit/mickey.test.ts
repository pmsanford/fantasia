import { describe, test, expect, beforeEach } from 'bun:test';
import { MickeyAgent } from '../../src/agents/mickey.js';
import { FantasiaEventEmitter } from '../../src/events/event-emitter.js';
import { MemoryManager } from '../../src/memory/memory-manager.js';
import { MemoryStore } from '../../src/memory/memory-store.js';
import {
  MockSdkAdapter,
  mockAssistantMessage,
  mockResultSuccess,
  mockSystemMessage,
} from '../fixtures/mock-sdk.js';
import type { FantasiaEvent } from '../../src/types.js';

describe('MickeyAgent', () => {
  let sdk: MockSdkAdapter;
  let events: FantasiaEventEmitter;
  let memory: MemoryManager;
  let mickey: MickeyAgent;

  beforeEach(async () => {
    sdk = new MockSdkAdapter();
    events = new FantasiaEventEmitter();
    const store = new MemoryStore(`/tmp/fantasia-test-${crypto.randomUUID()}`);
    memory = new MemoryManager(store);
    await memory.initialize();
    mickey = new MickeyAgent(sdk, events, memory);
  });

  test('has correct role and name', () => {
    expect(mickey.instance.config.role).toBe('mickey');
    expect(mickey.instance.config.name).toBe('Mickey');
  });

  test('run executes query and returns result', async () => {
    sdk.setDefaultResponse([
      mockSystemMessage(),
      mockAssistantMessage('Hello! I\'m Mickey.'),
      mockResultSuccess('Hello! I\'m Mickey.', { costUsd: 0.02 }),
    ]);

    const result = await mickey.run({ prompt: 'Hello' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Mickey');
    expect(result.costUsd).toBe(0.02);
  });

  test('emits agent:message events', async () => {
    sdk.setDefaultResponse([
      mockSystemMessage(),
      mockAssistantMessage('Test response'),
      mockResultSuccess('Test response'),
    ]);

    const messages: FantasiaEvent[] = [];
    events.on('agent:message', (e) => messages.push(e));

    await mickey.run({ prompt: 'test' });

    expect(messages).toHaveLength(1);
    if (messages[0].type === 'agent:message') {
      expect(messages[0].content).toBe('Test response');
    }
  });

  test('emits status changes', async () => {
    sdk.setDefaultResponse([
      mockSystemMessage(),
      mockResultSuccess('ok'),
    ]);

    const statusChanges: FantasiaEvent[] = [];
    events.on('agent:status-changed', (e) => statusChanges.push(e));

    await mickey.run({ prompt: 'test' });

    // Should go idle -> working -> idle
    expect(statusChanges.length).toBeGreaterThanOrEqual(2);
  });

  test('handles SDK errors gracefully', async () => {
    sdk.setDefaultResponse([]); // Empty response, will iterate with no result

    const result = await mickey.run({ prompt: 'test' });
    // With no result message, output should be empty and success true (default)
    expect(result.output).toBe('');
  });

  test('stop terminates the agent', async () => {
    await mickey.stop();
    expect(mickey.instance.status).toBe('terminated');
  });

  test('uses model override', () => {
    const custom = new MickeyAgent(sdk, events, memory, { model: 'claude-opus-4-6' });
    expect(custom.instance.config.model).toBe('claude-opus-4-6');
  });
});
