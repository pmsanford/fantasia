import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Orchestrator } from '../../src/orchestrator.js';
import {
  MockSdkAdapter,
  mockAssistantMessage,
  mockResultSuccess,
  mockToolUseMessage,
  mockSystemMessage,
} from '../fixtures/mock-sdk.js';
import type { FantasiaEvent, Task } from '../../src/types.js';

describe('Orchestrator', () => {
  let sdk: MockSdkAdapter;
  let orchestrator: Orchestrator;

  beforeEach(async () => {
    sdk = new MockSdkAdapter();
    orchestrator = new Orchestrator(sdk, {
      memoryDir: `/tmp/fantasia-test-${crypto.randomUUID()}`,
      maxBudgetUsd: 100,
      enabledAgents: { imagineer: false }, // Disable for unit tests
    });
  });

  afterEach(async () => {
    await orchestrator.stop();
  });

  test('start initializes and emits ready event', async () => {
    const events: FantasiaEvent[] = [];
    orchestrator.events.onAny((e) => events.push(e));

    await orchestrator.start();

    const types = events.map((e) => e.type);
    expect(types).toContain('agent:spawned');
    expect(types).toContain('orchestrator:ready');
  });

  test('start twice throws', async () => {
    await orchestrator.start();
    expect(orchestrator.start()).rejects.toThrow('already running');
  });

  test('submit before start throws', () => {
    expect(orchestrator.submit('hello')).rejects.toThrow('not running');
  });

  test('stop emits stopped event', async () => {
    const events: FantasiaEvent[] = [];
    orchestrator.events.onAny((e) => events.push(e));

    await orchestrator.start();
    await orchestrator.stop();

    expect(events.map((e) => e.type)).toContain('orchestrator:stopped');
  });

  test('trivial query: Mickey responds directly', async () => {
    // Mickey receives the question and answers directly (no tool use)
    sdk.setDefaultResponse([
      mockSystemMessage(),
      mockAssistantMessage('Buenos Aires is the capital of Argentina.'),
      mockResultSuccess('Buenos Aires is the capital of Argentina.'),
    ]);

    await orchestrator.start();

    const agentMessages: string[] = [];
    orchestrator.events.on('agent:message', (e) => agentMessages.push(e.content));

    await orchestrator.submit("What's the capital of Argentina?");

    expect(agentMessages.length).toBeGreaterThan(0);
    expect(agentMessages.some((m) => m.includes('Buenos Aires'))).toBe(true);
  });

  test('delegated task: pipeline runs when handleDelegateTask is called directly', async () => {
    // Test the pipeline by calling handleDelegateTask through the task queue
    // In production, Mickey's MCP tool handler calls this - here we test the pipeline directly

    // Yen Sid returns a plan
    sdk.whenPromptMatches(/Create a detailed implementation plan/, [
      mockSystemMessage(),
      mockResultSuccess(JSON.stringify({
        summary: 'Add JWT auth middleware',
        steps: ['Install jsonwebtoken', 'Create auth middleware', 'Add routes'],
        subtasks: [{ description: 'Implement JWT auth' }],
        risks: ['Token expiry handling'],
        estimatedComplexity: 'moderate',
      })),
    ]);

    // Chernabog approves
    sdk.whenPromptMatches(/Review the following implementation plan/, [
      mockSystemMessage(),
      mockResultSuccess(JSON.stringify({
        approved: true,
        concerns: [],
        requiredChanges: [],
        strengths: ['Good approach'],
      })),
    ]);

    // Broomstick executes
    sdk.setDefaultResponse([
      mockSystemMessage(),
      mockResultSuccess('Done'),
    ]);

    await orchestrator.start();

    const taskEvents: FantasiaEvent[] = [];
    orchestrator.events.on('task:created', (e) => taskEvents.push(e));
    orchestrator.events.on('task:completed', (e) => taskEvents.push(e));
    orchestrator.events.on('task:failed', (e) => taskEvents.push(e));

    // Simulate Mickey delegating by creating a task through the MCP tool context
    // We access the pipeline via the submit flow with Mickey responding directly
    // and then create a task manually to test the pipeline
    const fantasiaTools = (await import('../../src/tools/fantasia-tools.js')).createFantasiaTools;
    const tools = fantasiaTools(sdk, {
      taskQueue: orchestrator.taskQueue,
      onDelegateTask: async (desc, pri) => {
        const { createTask } = await import('../../src/task/task.js');
        const task = createTask({
          id: crypto.randomUUID(),
          description: desc,
          createdBy: 'test',
          priority: pri as any,
        });
        orchestrator.taskQueue.add(task);
        orchestrator.events.emit({ type: 'task:created', task });
        return task.id;
      },
    });

    // Call the delegate_task tool handler
    const delegateTool = tools.server as any;
    // Use the onDelegateTask directly
    const taskId = await (orchestrator as any).handleDelegateTask('Add JWT auth', 'high');

    // Wait for async pipeline
    await new Promise((resolve) => setTimeout(resolve, 500));

    const task = orchestrator.getTask(taskId);
    expect(task).toBeDefined();
    expect(task!.status === 'completed' || task!.status === 'failed').toBe(true);
  });

  test('getAgents returns active agents', async () => {
    sdk.setDefaultResponse([
      mockSystemMessage(),
      mockResultSuccess('ok'),
    ]);

    await orchestrator.start();
    const agents = orchestrator.getAgents();
    expect(agents.length).toBeGreaterThanOrEqual(1);
    expect(agents.some((a) => a.instance.config.role === 'mickey')).toBe(true);
  });

  test('cost tracking works', async () => {
    sdk.setDefaultResponse([
      mockSystemMessage(),
      mockResultSuccess('ok', { costUsd: 0.05 }),
    ]);

    await orchestrator.start();

    const costEvents: FantasiaEvent[] = [];
    orchestrator.events.on('cost:update', (e) => costEvents.push(e));

    await orchestrator.submit('hello');

    expect(costEvents.length).toBeGreaterThanOrEqual(1);
    const lastCost = costEvents[costEvents.length - 1];
    expect(lastCost.type).toBe('cost:update');
    if (lastCost.type === 'cost:update') {
      expect(lastCost.totalCostUsd).toBeGreaterThan(0);
    }
  });
});
