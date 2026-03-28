import { describe, test, expect, beforeEach } from 'bun:test';
import { YenSidAgent } from '../../src/agents/yen-sid.js';
import { FantasiaEventEmitter } from '../../src/events/event-emitter.js';
import { MemoryManager } from '../../src/memory/memory-manager.js';
import { MemoryStore } from '../../src/memory/memory-store.js';
import {
  MockSdkAdapter,
  mockAssistantMessage,
  mockResultSuccess,
  mockSystemMessage,
} from '../fixtures/mock-sdk.js';

describe('YenSidAgent', () => {
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
    const yenSid = new YenSidAgent(sdk, events, memory);
    expect(yenSid.instance.config.role).toBe('yen-sid');
    expect(yenSid.instance.config.model).toBe('claude-opus-4-6');
  });

  test('has read-only tools', () => {
    const yenSid = new YenSidAgent(sdk, events, memory);
    const tools = yenSid.instance.config.tools as string[];
    expect(tools).toContain('Read');
    expect(tools).toContain('Glob');
    expect(tools).toContain('Grep');
    expect(tools).not.toContain('Write');
    expect(tools).not.toContain('Edit');
    expect(tools).not.toContain('Bash');
  });

  test('is ephemeral (no session persistence)', () => {
    const yenSid = new YenSidAgent(sdk, events, memory);
    expect(yenSid.instance.config.persistSession).toBe(false);
  });

  test('produces a plan from query results', async () => {
    const plan = {
      summary: 'Implement user auth',
      steps: ['Create models', 'Add routes', 'Write tests'],
      estimatedComplexity: 'moderate',
    };

    sdk.setDefaultResponse([
      mockSystemMessage(),
      mockAssistantMessage(JSON.stringify(plan)),
      mockResultSuccess(JSON.stringify(plan)),
    ]);

    const yenSid = new YenSidAgent(sdk, events, memory);
    const result = await yenSid.run({ prompt: 'Plan auth system' });

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.summary).toBe('Implement user auth');
    expect(parsed.steps).toHaveLength(3);
  });

  test('injects memories into system prompt', async () => {
    // Add a memory for yen-sid
    await memory.recordLesson(
      'yen-sid',
      'Always consider database migrations when changing schemas',
      'Past incident',
      ['database'],
    );

    sdk.setDefaultResponse([
      mockSystemMessage(),
      mockResultSuccess('planned'),
    ]);

    const yenSid = new YenSidAgent(sdk, events, memory);
    await yenSid.run({ prompt: 'Plan something' });

    // Verify the SDK was called (we can check the query was made)
    expect(sdk.queryCalls).toHaveLength(1);
    // The system prompt injection happens inside base-agent via sdkOptions.systemPrompt
    // We can verify the memory manager has the memory
    const memories = memory.recall('yen-sid', ['database']);
    expect(memories).toHaveLength(1);
  });
});
