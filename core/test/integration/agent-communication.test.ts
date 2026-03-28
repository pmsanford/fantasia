import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Orchestrator } from '../../src/orchestrator.js';
import { MessageBus } from '../../src/messaging/message-bus.js';
import { FantasiaEventEmitter } from '../../src/events/event-emitter.js';
import {
  MockSdkAdapter,
  mockResultSuccess,
  mockSystemMessage,
} from '../fixtures/mock-sdk.js';
import type { FantasiaEvent, AgentMessage } from '../../src/types.js';

/**
 * Tests that verify agent-to-agent communication flows correctly
 * through the orchestrator's message bus and event system.
 */
describe('Agent Communication Integration', () => {
  let sdk: MockSdkAdapter;
  let orchestrator: Orchestrator;

  beforeEach(async () => {
    sdk = new MockSdkAdapter();
    orchestrator = new Orchestrator(sdk, {
      memoryDir: `/tmp/fantasia-comm-${crypto.randomUUID()}`,
      maxBudgetUsd: 100,
      enabledAgents: { imagineer: false },
    });
  });

  afterEach(async () => {
    await orchestrator.stop();
  });

  test('agent spawn events include full agent info', async () => {
    sdk.setDefaultResponse([
      mockSystemMessage(),
      mockResultSuccess('ok'),
    ]);

    const spawnEvents: FantasiaEvent[] = [];
    orchestrator.events.on('agent:spawned', (e) => spawnEvents.push(e));

    await orchestrator.start();

    // Mickey should be spawned
    expect(spawnEvents).toHaveLength(1);
    const mickeySpawn = spawnEvents[0];
    if (mickeySpawn.type === 'agent:spawned') {
      expect(mickeySpawn.agent.config.role).toBe('mickey');
      expect(mickeySpawn.agent.config.name).toBe('Mickey');
      expect(mickeySpawn.agent.id).toBeTruthy();
      expect(mickeySpawn.agent.status).toBe('idle');
    }
  });

  test('pipeline spawns and terminates agents in correct order', async () => {
    sdk.whenPromptMatches(/Create a detailed implementation plan/, [
      mockSystemMessage(),
      mockResultSuccess(JSON.stringify({
        summary: 'Test plan',
        steps: ['step 1'],
        estimatedComplexity: 'simple',
      })),
    ]);

    sdk.whenPromptMatches(/Review the following implementation plan/, [
      mockSystemMessage(),
      mockResultSuccess(JSON.stringify({
        approved: true, concerns: [], requiredChanges: [], strengths: [],
      })),
    ]);

    sdk.setDefaultResponse([
      mockSystemMessage(),
      mockResultSuccess('done'),
    ]);

    const agentEvents: FantasiaEvent[] = [];
    orchestrator.events.on('agent:spawned', (e) => agentEvents.push(e));
    orchestrator.events.on('agent:terminated', (e) => agentEvents.push(e));

    await orchestrator.start();
    await (orchestrator as any).handleDelegateTask('Test task', 'normal');
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Should have spawned: Mickey (at start) + Yen Sid + Chernabog + Broomstick
    const spawns = agentEvents.filter((e) => e.type === 'agent:spawned');
    const roles = spawns.map((e) => (e as any).agent.config.role);
    expect(roles).toContain('mickey');
    expect(roles).toContain('yen-sid');
    expect(roles).toContain('chernabog');
    expect(roles).toContain('broomstick');

    // Ephemeral agents should be terminated
    const terminations = agentEvents.filter((e) => e.type === 'agent:terminated');
    expect(terminations.length).toBeGreaterThanOrEqual(3); // yen-sid, chernabog, broomstick
  });

  test('task status transitions emit events in correct order', async () => {
    sdk.whenPromptMatches(/Create a detailed implementation plan/, [
      mockSystemMessage(),
      mockResultSuccess(JSON.stringify({
        summary: 'Plan',
        steps: ['step'],
        estimatedComplexity: 'simple',
      })),
    ]);

    sdk.whenPromptMatches(/Review the following implementation plan/, [
      mockSystemMessage(),
      mockResultSuccess(JSON.stringify({
        approved: true, concerns: [], requiredChanges: [], strengths: [],
      })),
    ]);

    sdk.setDefaultResponse([
      mockSystemMessage(),
      mockResultSuccess('done'),
    ]);

    const statusChanges: string[] = [];
    orchestrator.events.on('task:status-changed', (e) => {
      statusChanges.push(`${e.oldStatus} -> ${e.newStatus}`);
    });

    await orchestrator.start();
    await (orchestrator as any).handleDelegateTask('Track statuses', 'normal');
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Expected flow: pending -> planning -> reviewing -> in-progress
    expect(statusChanges).toContain('pending -> planning');
    expect(statusChanges).toContain('planning -> reviewing');
    expect(statusChanges).toContain('reviewing -> in-progress');
  });

  test('message bus tracks orchestrator activity', async () => {
    const allMessages: AgentMessage[] = [];
    orchestrator.messageBus.subscribeAll((msg) => allMessages.push(msg));

    sdk.setDefaultResponse([
      mockSystemMessage(),
      mockResultSuccess('ok'),
    ]);

    await orchestrator.start();
    await orchestrator.submit('hello');

    // The message bus is internal - verify it's functional
    orchestrator.messageBus.publish({
      id: crypto.randomUUID(),
      type: 'status-update',
      from: 'test',
      to: 'broadcast',
      payload: { test: true },
      timestamp: Date.now(),
    });

    expect(allMessages).toHaveLength(1);
    expect(allMessages[0].type).toBe('status-update');
  });

  test('SDK message passthrough events include agent ID', async () => {
    sdk.setDefaultResponse([
      mockSystemMessage(),
      mockResultSuccess('ok'),
    ]);

    const sdkEvents: FantasiaEvent[] = [];
    orchestrator.events.on('sdk:message', (e) => sdkEvents.push(e));

    await orchestrator.start();
    await orchestrator.submit('test');

    expect(sdkEvents.length).toBeGreaterThan(0);
    for (const e of sdkEvents) {
      if (e.type === 'sdk:message') {
        expect(e.agentId).toBeTruthy();
        expect(e.sdkMessage).toBeDefined();
      }
    }
  });

  test('cost tracking across multiple agents', async () => {
    sdk.whenPromptMatches(/Create a detailed implementation plan/, [
      mockSystemMessage(),
      mockResultSuccess(JSON.stringify({
        summary: 'Plan',
        steps: ['step'],
        estimatedComplexity: 'simple',
      }), { costUsd: 0.10 }),
    ]);

    sdk.whenPromptMatches(/Review the following implementation plan/, [
      mockSystemMessage(),
      mockResultSuccess(JSON.stringify({
        approved: true, concerns: [], requiredChanges: [], strengths: [],
      }), { costUsd: 0.08 }),
    ]);

    sdk.setDefaultResponse([
      mockSystemMessage(),
      mockResultSuccess('done', { costUsd: 0.05 }),
    ]);

    const costEvents: FantasiaEvent[] = [];
    orchestrator.events.on('cost:update', (e) => costEvents.push(e));

    await orchestrator.start();
    await (orchestrator as any).handleDelegateTask('Expensive task', 'normal');
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Should have cost updates from multiple agents
    expect(costEvents.length).toBeGreaterThanOrEqual(3);

    // Total cost should be sum of all agents
    const lastCost = costEvents[costEvents.length - 1];
    if (lastCost.type === 'cost:update') {
      expect(lastCost.totalCostUsd).toBeGreaterThan(0.1);
    }
  });
});
