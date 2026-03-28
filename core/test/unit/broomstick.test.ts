import { describe, test, expect, beforeEach } from 'bun:test';
import { BroomstickAgent } from '../../src/agents/broomstick.js';
import { FantasiaEventEmitter } from '../../src/events/event-emitter.js';
import { MemoryManager } from '../../src/memory/memory-manager.js';
import { MemoryStore } from '../../src/memory/memory-store.js';
import {
  MockSdkAdapter,
  mockAssistantMessage,
  mockResultSuccess,
  mockResultError,
  mockSystemMessage,
} from '../fixtures/mock-sdk.js';

describe('BroomstickAgent', () => {
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

  test('has correct role and is ephemeral', () => {
    const broomstick = new BroomstickAgent(sdk, events, memory, 'Do something');
    expect(broomstick.instance.config.role).toBe('broomstick');
    expect(broomstick.instance.config.persistSession).toBe(false);
  });

  test('name includes unique identifier', () => {
    const b1 = new BroomstickAgent(sdk, events, memory, 'Task 1');
    const b2 = new BroomstickAgent(sdk, events, memory, 'Task 2');
    expect(b1.instance.config.name).not.toBe(b2.instance.config.name);
    expect(b1.instance.config.name).toMatch(/^Broomstick-/);
  });

  test('has full tool access', () => {
    const broomstick = new BroomstickAgent(sdk, events, memory, 'task');
    const allowed = broomstick.instance.config.allowedTools!;
    expect(allowed).toContain('Read');
    expect(allowed).toContain('Write');
    expect(allowed).toContain('Edit');
    expect(allowed).toContain('Bash');
  });

  test('incorporates task description in system prompt', () => {
    const broomstick = new BroomstickAgent(sdk, events, memory, 'Fix the login bug');
    expect(broomstick.instance.config.systemPrompt).toContain('Fix the login bug');
  });

  test('incorporates plan excerpt in system prompt', () => {
    const broomstick = new BroomstickAgent(
      sdk, events, memory,
      'Fix the login bug',
      '1. Check auth middleware\n2. Fix token validation',
    );
    expect(broomstick.instance.config.systemPrompt).toContain('Check auth middleware');
    expect(broomstick.instance.config.systemPrompt).toContain('Fix token validation');
  });

  test('executes and returns success result', async () => {
    sdk.setDefaultResponse([
      mockSystemMessage(),
      mockAssistantMessage('Fixed the bug by updating the validation logic.'),
      mockResultSuccess('Fixed the bug by updating the validation logic.', { costUsd: 0.03 }),
    ]);

    const broomstick = new BroomstickAgent(sdk, events, memory, 'Fix bug');
    const result = await broomstick.run({ prompt: 'Fix bug' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Fixed the bug');
    expect(result.costUsd).toBe(0.03);
  });

  test('handles failure gracefully', async () => {
    sdk.setDefaultResponse([
      mockSystemMessage(),
      mockResultError(['Permission denied: cannot write to /etc/config']),
    ]);

    const broomstick = new BroomstickAgent(sdk, events, memory, 'Modify config');
    const result = await broomstick.run({ prompt: 'Modify config' });

    expect(result.success).toBe(false);
    expect(result.output).toContain('Permission denied');
  });

  test('respects maxTurns override', () => {
    const broomstick = new BroomstickAgent(sdk, events, memory, 'task', undefined, { maxTurns: 10 });
    expect(broomstick.instance.config.maxTurns).toBe(10);
  });

  test('respects maxBudgetUsd override', () => {
    const broomstick = new BroomstickAgent(sdk, events, memory, 'task', undefined, { maxBudgetUsd: 0.5 });
    expect(broomstick.instance.config.maxBudgetUsd).toBe(0.5);
  });
});
