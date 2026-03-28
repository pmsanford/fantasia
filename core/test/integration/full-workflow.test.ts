import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Orchestrator } from '../../src/orchestrator.js';
import {
  MockSdkAdapter,
  mockAssistantMessage,
  mockResultSuccess,
  mockResultError,
  mockSystemMessage,
} from '../fixtures/mock-sdk.js';
import type { FantasiaEvent, Task, TaskResult } from '../../src/types.js';

/**
 * Full workflow integration tests using the mock SDK.
 * These test the complete orchestration pipeline end-to-end.
 */
describe('Full Workflow Integration', () => {
  let sdk: MockSdkAdapter;
  let orchestrator: Orchestrator;
  let events: FantasiaEvent[];

  beforeEach(async () => {
    sdk = new MockSdkAdapter();
    events = [];
    orchestrator = new Orchestrator(sdk, {
      memoryDir: `/tmp/fantasia-integ-${crypto.randomUUID()}`,
      maxBudgetUsd: 100,
      enabledAgents: { imagineer: false },
    });
    orchestrator.events.onAny((e) => events.push(e));
  });

  afterEach(async () => {
    await orchestrator.stop();
  });

  test('trivial task: Mickey handles directly without delegation', async () => {
    sdk.setDefaultResponse([
      mockSystemMessage(),
      mockAssistantMessage('The capital of France is Paris.'),
      mockResultSuccess('The capital of France is Paris.'),
    ]);

    await orchestrator.start();
    await orchestrator.submit("What's the capital of France?");

    // Should have Mickey's response but no task creation
    const agentMessages = events.filter((e) => e.type === 'agent:message');
    expect(agentMessages.length).toBeGreaterThan(0);

    const taskCreated = events.filter((e) => e.type === 'task:created');
    expect(taskCreated).toHaveLength(0);

    // Verify SDK was called exactly once (Mickey only)
    expect(sdk.queryCalls).toHaveLength(1);
  });

  test('complete pipeline: plan -> review (approved) -> execute', async () => {
    // Yen Sid plans
    sdk.whenPromptMatches(/Create a detailed implementation plan/, [
      mockSystemMessage(),
      mockResultSuccess(JSON.stringify({
        summary: 'Implement user auth',
        steps: ['Add middleware', 'Create routes', 'Write tests'],
        subtasks: [{ description: 'Build auth module' }],
        estimatedComplexity: 'moderate',
      })),
    ]);

    // Chernabog approves
    sdk.whenPromptMatches(/Review the following implementation plan/, [
      mockSystemMessage(),
      mockResultSuccess(JSON.stringify({
        approved: true,
        concerns: ['Consider rate limiting'],
        requiredChanges: [],
        strengths: ['Good modular approach'],
      })),
    ]);

    // Broomstick executes
    sdk.setDefaultResponse([
      mockSystemMessage(),
      mockAssistantMessage('Auth module implemented successfully.'),
      mockResultSuccess('Auth module implemented successfully.', { costUsd: 0.05 }),
    ]);

    await orchestrator.start();

    // Trigger the pipeline directly
    const taskId = await (orchestrator as any).handleDelegateTask('Add user authentication', 'normal');

    // Wait for async pipeline
    await new Promise((resolve) => setTimeout(resolve, 500));

    const task = orchestrator.getTask(taskId);
    expect(task).toBeDefined();
    expect(task!.status).toBe('completed');
    expect(task!.plan).toBeDefined();
    expect(task!.plan!.summary).toBe('Implement user auth');
    expect(task!.review).toBeDefined();
    expect(task!.review!.approved).toBe(true);
    expect(task!.result).toBeDefined();
    expect(task!.result!.success).toBe(true);

    // Verify event flow
    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain('task:created');
    expect(eventTypes).toContain('task:status-changed');
    expect(eventTypes).toContain('agent:spawned');
    expect(eventTypes).toContain('task:completed');
    expect(eventTypes).toContain('cost:update');
  });

  test('plan rejection: Chernabog rejects, Yen Sid revises, then approved', async () => {
    let planCallCount = 0;

    // First plan
    sdk.whenPromptMatches(/Create a detailed implementation plan/, [
      mockSystemMessage(),
      mockResultSuccess(JSON.stringify({
        summary: 'Simple implementation v1',
        steps: ['Do it quickly'],
        estimatedComplexity: 'simple',
      })),
    ]);

    // Chernabog rejects first plan
    sdk.whenPromptMatches(/Review the following implementation plan/, [
      mockSystemMessage(),
      mockResultSuccess(JSON.stringify({
        approved: false,
        concerns: ['Too simplistic', 'No error handling'],
        requiredChanges: ['Add proper error handling', 'Add input validation'],
        strengths: [],
      })),
    ]);

    // Revised plan (matches "Revise your implementation plan")
    sdk.whenPromptMatches(/Revise your implementation plan/, [
      mockSystemMessage(),
      mockResultSuccess(JSON.stringify({
        summary: 'Robust implementation v2',
        steps: ['Add validation', 'Implement with error handling', 'Test edge cases'],
        estimatedComplexity: 'moderate',
      })),
    ]);

    // Broomstick executes
    sdk.setDefaultResponse([
      mockSystemMessage(),
      mockResultSuccess('Done.', { costUsd: 0.03 }),
    ]);

    await orchestrator.start();
    const taskId = await (orchestrator as any).handleDelegateTask('Build feature X', 'normal');
    await new Promise((resolve) => setTimeout(resolve, 500));

    const task = orchestrator.getTask(taskId);
    expect(task).toBeDefined();
    // Plan should have been revised
    expect(task!.plan!.summary).toBe('Robust implementation v2');
    // Task should complete successfully despite initial rejection
    expect(task!.status).toBe('completed');

    // Verify Yen Sid was called twice (initial + revision)
    const planCalls = sdk.queryCalls.filter(
      (c) => typeof c.prompt === 'string' && (c.prompt.includes('Create a detailed') || c.prompt.includes('Revise your')),
    );
    expect(planCalls).toHaveLength(2);
  });

  test('parallel broomstick execution with multiple subtasks', async () => {
    // Plan with multiple subtasks
    sdk.whenPromptMatches(/Create a detailed implementation plan/, [
      mockSystemMessage(),
      mockResultSuccess(JSON.stringify({
        summary: 'Multi-part implementation',
        steps: ['Part 1', 'Part 2', 'Part 3'],
        subtasks: [
          { description: 'Build component A' },
          { description: 'Build component B' },
          { description: 'Build component C' },
        ],
        estimatedComplexity: 'complex',
      })),
    ]);

    // Chernabog approves
    sdk.whenPromptMatches(/Review the following implementation plan/, [
      mockSystemMessage(),
      mockResultSuccess(JSON.stringify({
        approved: true,
        concerns: [],
        requiredChanges: [],
        strengths: ['Good decomposition'],
      })),
    ]);

    // All broomsticks succeed
    sdk.setDefaultResponse([
      mockSystemMessage(),
      mockResultSuccess('Component built.', { costUsd: 0.02 }),
    ]);

    await orchestrator.start();
    const taskId = await (orchestrator as any).handleDelegateTask('Build complex system', 'high');
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const task = orchestrator.getTask(taskId);
    expect(task).toBeDefined();
    expect(task!.status).toBe('completed');
    expect(task!.result!.success).toBe(true);
    expect(task!.result!.output).toContain('Subtask 1');
    expect(task!.result!.output).toContain('Subtask 2');
    expect(task!.result!.output).toContain('Subtask 3');

    // Verify multiple broomsticks were spawned
    const broomstickSpawns = events.filter(
      (e) => e.type === 'agent:spawned' && (e as any).agent.config.role === 'broomstick',
    );
    expect(broomstickSpawns).toHaveLength(3);
  });

  test('broomstick failure results in failed task', async () => {
    sdk.whenPromptMatches(/Create a detailed implementation plan/, [
      mockSystemMessage(),
      mockResultSuccess(JSON.stringify({
        summary: 'Failing plan',
        steps: ['Try something impossible'],
        estimatedComplexity: 'simple',
      })),
    ]);

    sdk.whenPromptMatches(/Review the following implementation plan/, [
      mockSystemMessage(),
      mockResultSuccess(JSON.stringify({
        approved: true,
        concerns: [],
        requiredChanges: [],
        strengths: [],
      })),
    ]);

    // Broomstick fails
    sdk.setDefaultResponse([
      mockSystemMessage(),
      mockResultError(['Permission denied', 'Cannot access file']),
    ]);

    await orchestrator.start();
    const taskId = await (orchestrator as any).handleDelegateTask('Do impossible thing', 'normal');
    await new Promise((resolve) => setTimeout(resolve, 500));

    const task = orchestrator.getTask(taskId);
    expect(task).toBeDefined();
    expect(task!.status).toBe('failed');
    expect(task!.result!.success).toBe(false);

    const failEvents = events.filter((e) => e.type === 'task:failed');
    expect(failEvents.length).toBeGreaterThanOrEqual(1);
  });

  test('budget enforcement stops pipeline', async () => {
    const cheapOrchestrator = new Orchestrator(sdk, {
      memoryDir: `/tmp/fantasia-integ-${crypto.randomUUID()}`,
      maxBudgetUsd: 0.001, // Very low budget
      enabledAgents: { imagineer: false },
    });

    sdk.setDefaultResponse([
      mockSystemMessage(),
      mockResultSuccess('ok', { costUsd: 0.01 }), // Over budget
    ]);

    await cheapOrchestrator.start();

    // First submit works but blows the budget
    await cheapOrchestrator.submit('hello');

    // Second submit should throw budget error
    try {
      await cheapOrchestrator.submit('hello again');
      expect(true).toBe(false); // Should not reach here
    } catch (error: any) {
      expect(error.code).toBe('BUDGET_EXCEEDED');
    }

    await cheapOrchestrator.stop();
  });

  test('multiple concurrent tasks can be tracked', async () => {
    sdk.whenPromptMatches(/Create a detailed implementation plan/, [
      mockSystemMessage(),
      mockResultSuccess(JSON.stringify({
        summary: 'Quick plan',
        steps: ['Do it'],
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
      mockResultSuccess('Done', { costUsd: 0.01 }),
    ]);

    await orchestrator.start();

    // Start multiple tasks
    const id1 = await (orchestrator as any).handleDelegateTask('Task A', 'normal');
    const id2 = await (orchestrator as any).handleDelegateTask('Task B', 'high');
    const id3 = await (orchestrator as any).handleDelegateTask('Task C', 'low');

    await new Promise((resolve) => setTimeout(resolve, 1000));

    // All tasks should exist
    expect(orchestrator.getTasks()).toHaveLength(3);
    expect(orchestrator.getTask(id1)).toBeDefined();
    expect(orchestrator.getTask(id2)).toBeDefined();
    expect(orchestrator.getTask(id3)).toBeDefined();
  });

  test('event stream works for async consumers', async () => {
    sdk.setDefaultResponse([
      mockSystemMessage(),
      mockAssistantMessage('Hello!'),
      mockResultSuccess('Hello!'),
    ]);

    await orchestrator.start();

    // Collect events from stream
    const streamEvents: FantasiaEvent[] = [];
    const streamPromise = (async () => {
      for await (const event of orchestrator.events.stream()) {
        streamEvents.push(event);
        if (event.type === 'orchestrator:stopped') break;
      }
    })();

    await orchestrator.submit('hi');
    await orchestrator.stop();

    // Give stream time to flush
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(streamEvents.length).toBeGreaterThan(0);
  });

  test('memory persists lessons from failed plans', async () => {
    sdk.whenPromptMatches(/Create a detailed implementation plan/, [
      mockSystemMessage(),
      mockResultSuccess(JSON.stringify({
        summary: 'Bad plan',
        steps: ['Skip error handling'],
        estimatedComplexity: 'simple',
      })),
    ]);

    sdk.whenPromptMatches(/Review the following implementation plan/, [
      mockSystemMessage(),
      mockResultSuccess(JSON.stringify({
        approved: true, concerns: [], requiredChanges: [], strengths: [],
      })),
    ]);

    // Broomstick fails
    sdk.setDefaultResponse([
      mockSystemMessage(),
      mockResultError(['Execution failed']),
    ]);

    await orchestrator.start();
    await (orchestrator as any).handleDelegateTask('Do something', 'normal');
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Check that a lesson was recorded
    const memories = orchestrator.memory.recall('yen-sid');
    expect(memories.some((m) => m.type === 'lesson')).toBe(true);
  });
});
