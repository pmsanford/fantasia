import { describe, test, expect, beforeEach } from 'bun:test';
import { ChernabogAgent } from '../../src/agents/chernabog.js';
import { FantasiaEventEmitter } from '../../src/events/event-emitter.js';
import { MemoryManager } from '../../src/memory/memory-manager.js';
import { MemoryStore } from '../../src/memory/memory-store.js';
import {
  MockSdkAdapter,
  mockAssistantMessage,
  mockResultSuccess,
  mockSystemMessage,
} from '../fixtures/mock-sdk.js';

describe('ChernabogAgent', () => {
  let sdk: MockSdkAdapter;
  let events: FantasiaEventEmitter;
  let memory: MemoryManager;

  beforeEach(async () => {
    sdk = new MockSdkAdapter();
    events = new FantasiaEventEmitter();
    const store = new MemoryStore(`/tmp/fantasia-test-${crypto.randomUUID()}`);
    memory = new MemoryManager(store);
    await memory.initialize();
  });

  test('has correct role and uses opus model', () => {
    const chernabog = new ChernabogAgent(sdk, events, memory);
    expect(chernabog.instance.config.role).toBe('chernabog');
    expect(chernabog.instance.config.model).toBe('claude-opus-4-6');
  });

  test('has strictly read-only tools', () => {
    const chernabog = new ChernabogAgent(sdk, events, memory);
    const tools = chernabog.instance.config.tools as string[];
    expect(tools).toContain('Read');
    expect(tools).toContain('Glob');
    expect(tools).toContain('Grep');
    expect(tools).not.toContain('WebSearch'); // More restricted than Yen Sid
    expect(tools).not.toContain('Write');
  });

  test('produces a review from query results', async () => {
    const review = {
      approved: false,
      concerns: ['No error handling for token expiry', 'Missing rate limiting'],
      requiredChanges: ['Add token refresh logic'],
      strengths: ['Good separation of concerns'],
    };

    sdk.setDefaultResponse([
      mockSystemMessage(),
      mockAssistantMessage(JSON.stringify(review)),
      mockResultSuccess(JSON.stringify(review)),
    ]);

    const chernabog = new ChernabogAgent(sdk, events, memory);
    const result = await chernabog.run({ prompt: 'Review this plan' });

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.approved).toBe(false);
    expect(parsed.concerns).toHaveLength(2);
    expect(parsed.requiredChanges).toHaveLength(1);
  });

  test('can approve a plan', async () => {
    const review = {
      approved: true,
      concerns: [],
      requiredChanges: [],
      strengths: ['Thorough approach', 'Good test coverage plan'],
    };

    sdk.setDefaultResponse([
      mockSystemMessage(),
      mockResultSuccess(JSON.stringify(review)),
    ]);

    const chernabog = new ChernabogAgent(sdk, events, memory);
    const result = await chernabog.run({ prompt: 'Review this plan' });

    const parsed = JSON.parse(result.output);
    expect(parsed.approved).toBe(true);
  });
});
