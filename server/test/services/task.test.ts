import { describe, test, expect, afterEach } from 'bun:test';
import { createRouterTransport, createClient, ConnectError, Code } from '@connectrpc/connect';
import { TaskService } from '../../src/gen/fantasia/v1/task_pb.js';
import { TaskStatus, TaskPriority } from '../../src/gen/fantasia/v1/types_pb.js';
import { registerRoutes } from '../../src/server.js';
import { __setOrchestratorForTesting } from '../../src/bridge.js';
import { createMockOrchestrator } from '../helpers/mock-core.js';
import { createTask } from '@fantasia/core';

function createTestClient() {
  const transport = createRouterTransport(registerRoutes);
  return createClient(TaskService, transport);
}

describe('TaskService', () => {
  afterEach(() => {
    __setOrchestratorForTesting(null);
  });

  test('ListTasks returns empty when no tasks', async () => {
    const mock = await createMockOrchestrator();
    __setOrchestratorForTesting(mock as any);

    const client = createTestClient();
    const response = await client.listTasks({});
    expect(response.tasks).toHaveLength(0);
  });

  test('ListTasks returns tasks', async () => {
    const mock = await createMockOrchestrator();
    const task = createTask({ id: 'task-1', description: 'Test task', createdBy: 'mickey' });
    mock.taskQueue.add(task);
    __setOrchestratorForTesting(mock as any);

    const client = createTestClient();
    const response = await client.listTasks({});
    expect(response.tasks).toHaveLength(1);
    expect(response.tasks[0].id).toBe('task-1');
    expect(response.tasks[0].description).toBe('Test task');
    expect(response.tasks[0].status).toBe(TaskStatus.PENDING);
    expect(response.tasks[0].priority).toBe(TaskPriority.NORMAL);
  });

  test('GetTask returns task when found', async () => {
    const mock = await createMockOrchestrator();
    const task = createTask({ id: 'task-2', description: 'Another', createdBy: 'mickey', priority: 'high' });
    mock.taskQueue.add(task);
    __setOrchestratorForTesting(mock as any);

    const client = createTestClient();
    const response = await client.getTask({ taskId: 'task-2' });
    expect(response.task).toBeDefined();
    expect(response.task?.id).toBe('task-2');
    expect(response.task?.priority).toBe(TaskPriority.HIGH);
  });

  test('GetTask returns empty when not found', async () => {
    const mock = await createMockOrchestrator();
    __setOrchestratorForTesting(mock as any);

    const client = createTestClient();
    const response = await client.getTask({ taskId: 'nonexistent' });
    expect(response.task).toBeUndefined();
  });

  test('GetTaskCounts returns counts', async () => {
    const mock = await createMockOrchestrator();
    mock.taskQueue.add(createTask({ id: 't1', description: 'a', createdBy: 'x' }));
    mock.taskQueue.add(createTask({ id: 't2', description: 'b', createdBy: 'x' }));
    __setOrchestratorForTesting(mock as any);

    const client = createTestClient();
    const response = await client.getTaskCounts({});
    expect(response.counts?.pending).toBe(2);
    expect(response.counts?.total).toBe(2);
  });

  test('fails when not initialized', async () => {
    const client = createTestClient();
    try {
      await client.listTasks({});
      expect(true).toBe(false);
    } catch (err) {
      expect((err as ConnectError).code).toBe(Code.FailedPrecondition);
    }
  });
});
