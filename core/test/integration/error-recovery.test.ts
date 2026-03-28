import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Orchestrator } from '../../src/orchestrator.js';
import { ImagineerAgent } from '../../src/agents/imagineer.js';
import type { HealthReport } from '../../src/agents/imagineer.js';
import { FantasiaEventEmitter } from '../../src/events/event-emitter.js';
import { MemoryManager } from '../../src/memory/memory-manager.js';
import { MemoryStore } from '../../src/memory/memory-store.js';
import {
  MockSdkAdapter,
  mockResultSuccess,
  mockResultError,
  mockSystemMessage,
} from '../fixtures/mock-sdk.js';
import type { FantasiaEvent } from '../../src/types.js';

describe('Error Recovery Integration', () => {
  let sdk: MockSdkAdapter;
  let orchestrator: Orchestrator;

  beforeEach(async () => {
    sdk = new MockSdkAdapter();
    orchestrator = new Orchestrator(sdk, {
      memoryDir: `/tmp/fantasia-err-${crypto.randomUUID()}`,
      maxBudgetUsd: 100,
      enabledAgents: { imagineer: false },
    });
  });

  afterEach(async () => {
    await orchestrator.stop();
  });

  test('Yen Sid failure results in task failure, not crash', async () => {
    // Yen Sid returns garbage (no valid JSON)
    sdk.whenPromptMatches(/Create a detailed implementation plan/, [
      mockSystemMessage(),
      mockResultSuccess('This is not valid JSON at all'),
    ]);

    // Chernabog gets whatever plan was parsed
    sdk.whenPromptMatches(/Review the following implementation plan/, [
      mockSystemMessage(),
      mockResultSuccess(JSON.stringify({
        approved: true, concerns: [], requiredChanges: [], strengths: [],
      })),
    ]);

    // Broomstick
    sdk.setDefaultResponse([
      mockSystemMessage(),
      mockResultSuccess('done'),
    ]);

    await orchestrator.start();
    const taskId = await (orchestrator as any).handleDelegateTask('Fuzzy input task', 'normal');
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Task should still complete - parsePlan falls back to raw text
    const task = orchestrator.getTask(taskId);
    expect(task).toBeDefined();
    expect(task!.plan).toBeDefined();
    expect(task!.plan!.summary).toContain('This is not valid JSON');
  });

  test('Chernabog returning invalid JSON defaults to approved', async () => {
    sdk.whenPromptMatches(/Create a detailed implementation plan/, [
      mockSystemMessage(),
      mockResultSuccess(JSON.stringify({
        summary: 'Good plan',
        steps: ['step 1'],
        estimatedComplexity: 'simple',
      })),
    ]);

    // Chernabog returns invalid JSON
    sdk.whenPromptMatches(/Review the following implementation plan/, [
      mockSystemMessage(),
      mockResultSuccess('I approve this plan but forgot to use JSON'),
    ]);

    sdk.setDefaultResponse([
      mockSystemMessage(),
      mockResultSuccess('executed'),
    ]);

    await orchestrator.start();
    const taskId = await (orchestrator as any).handleDelegateTask('Test graceful review', 'normal');
    await new Promise((resolve) => setTimeout(resolve, 500));

    const task = orchestrator.getTask(taskId);
    expect(task).toBeDefined();
    // Should complete because parseReview defaults to approved on parse failure
    expect(task!.status).toBe('completed');
    expect(task!.review!.approved).toBe(true);
  });

  test('SDK error during Broomstick execution is caught', async () => {
    sdk.whenPromptMatches(/Create a detailed implementation plan/, [
      mockSystemMessage(),
      mockResultSuccess(JSON.stringify({
        summary: 'Plan',
        steps: ['execute'],
        estimatedComplexity: 'simple',
      })),
    ]);

    sdk.whenPromptMatches(/Review the following implementation plan/, [
      mockSystemMessage(),
      mockResultSuccess(JSON.stringify({
        approved: true, concerns: [], requiredChanges: [], strengths: [],
      })),
    ]);

    // Broomstick gets an error result
    sdk.setDefaultResponse([
      mockSystemMessage(),
      mockResultError(['Internal server error', 'API rate limited'], { subtype: 'error_during_execution' }),
    ]);

    const failEvents: FantasiaEvent[] = [];
    orchestrator.events.on('task:failed', (e) => failEvents.push(e));

    await orchestrator.start();
    const taskId = await (orchestrator as any).handleDelegateTask('Failing execution', 'normal');
    await new Promise((resolve) => setTimeout(resolve, 500));

    const task = orchestrator.getTask(taskId);
    expect(task).toBeDefined();
    expect(task!.status).toBe('failed');
    expect(task!.result!.success).toBe(false);
    expect(failEvents).toHaveLength(1);
  });

  test('max turns error is handled gracefully', async () => {
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
      mockResultError(['Exceeded maximum turns'], { subtype: 'error_max_turns' }),
    ]);

    await orchestrator.start();
    const taskId = await (orchestrator as any).handleDelegateTask('Long running task', 'normal');
    await new Promise((resolve) => setTimeout(resolve, 500));

    const task = orchestrator.getTask(taskId);
    expect(task!.status).toBe('failed');
    expect(task!.result!.output).toContain('Exceeded maximum turns');
  });

  test('Imagineer detects and flags stuck agents', async () => {
    const store = new MemoryStore(`/tmp/fantasia-imag-test-${crypto.randomUUID()}`);
    const memory = new MemoryManager(store);
    await memory.initialize();
    const events = new FantasiaEventEmitter();

    const imagineer = new ImagineerAgent(sdk, events, memory);

    const now = Date.now();
    const report: HealthReport = {
      agents: [
        { id: 'a1', role: 'mickey', name: 'Mickey', status: 'idle', lastActivityAt: now },
        {
          id: 'a2',
          role: 'broomstick',
          name: 'Broomstick-1',
          status: 'working',
          lastActivityAt: now - 10 * 60 * 1000, // 10 minutes ago - stuck
          currentTaskId: 'task-1',
        },
        {
          id: 'a3',
          role: 'broomstick',
          name: 'Broomstick-2',
          status: 'error',
          lastActivityAt: now - 30 * 1000,
          error: 'Connection reset',
        },
      ],
      taskCounts: { pending: 0, active: 2, completed: 3, failed: 1 },
      totalCostUsd: 2.5,
      timestamp: now,
    };

    const interventions = imagineer.analyzeHealth(report);

    expect(interventions).toHaveLength(2);
    // Stuck broomstick
    const stuckIntervention = interventions.find((i) => i.agentId === 'a2');
    expect(stuckIntervention).toBeDefined();
    expect(stuckIntervention!.action).toBe('restart');

    // Error broomstick
    const errorIntervention = interventions.find((i) => i.agentId === 'a3');
    expect(errorIntervention).toBeDefined();
    expect(errorIntervention!.action).toBe('restart');
    expect(errorIntervention!.reason).toContain('Connection reset');
  });

  test('orchestrator stop during active pipeline is graceful', async () => {
    sdk.whenPromptMatches(/Create a detailed implementation plan/, [
      mockSystemMessage(),
      // Simulate slow response by returning quickly
      mockResultSuccess(JSON.stringify({
        summary: 'Plan',
        steps: ['step'],
        estimatedComplexity: 'simple',
      })),
    ]);

    sdk.whenPromptMatches(/Review/, [
      mockSystemMessage(),
      mockResultSuccess(JSON.stringify({
        approved: true, concerns: [], requiredChanges: [], strengths: [],
      })),
    ]);

    sdk.setDefaultResponse([
      mockSystemMessage(),
      mockResultSuccess('done'),
    ]);

    await orchestrator.start();

    // Start a task and immediately stop
    (orchestrator as any).handleDelegateTask('Quick stop test', 'normal');
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Stop should not throw
    await orchestrator.stop();

    const events: FantasiaEvent[] = [];
    orchestrator.events.onAny((e) => events.push(e));
    // After stop, submitting should throw
    expect(orchestrator.submit('should fail')).rejects.toThrow('not running');
  });

  test('one subtask failure in parallel execution marks overall task as failed', async () => {
    sdk.whenPromptMatches(/Create a detailed implementation plan/, [
      mockSystemMessage(),
      mockResultSuccess(JSON.stringify({
        summary: 'Parallel plan',
        steps: ['A', 'B'],
        subtasks: [
          { description: 'Subtask A - will succeed' },
          { description: 'Subtask B - will fail' },
        ],
        estimatedComplexity: 'moderate',
      })),
    ]);

    sdk.whenPromptMatches(/Review the following implementation plan/, [
      mockSystemMessage(),
      mockResultSuccess(JSON.stringify({
        approved: true, concerns: [], requiredChanges: [], strengths: [],
      })),
    ]);

    // First broomstick succeeds, second fails
    let callCount = 0;
    sdk.setDefaultResponse([
      mockSystemMessage(),
      mockResultSuccess('subtask done'),
    ]);
    // Override for the second call specifically is tricky with current mock,
    // so we'll use a pattern match instead
    sdk.whenPromptMatches(/will fail/, [
      mockSystemMessage(),
      mockResultError(['Subtask B crashed']),
    ]);

    await orchestrator.start();
    const taskId = await (orchestrator as any).handleDelegateTask('Parallel with failure', 'normal');
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const task = orchestrator.getTask(taskId);
    expect(task).toBeDefined();
    expect(task!.status).toBe('failed');
    expect(task!.result!.output).toContain('FAILED');
  });
});
