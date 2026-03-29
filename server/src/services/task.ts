import type { ServiceImpl } from '@connectrpc/connect';
import { TaskService } from '../gen/fantasia/v1/task_pb.js';
import { getOrchestrator } from '../bridge.js';
import { toProtoTask, toProtoTaskCounts } from '../convert.js';
import { withErrorHandling } from '../errors.js';
import logger from '../logger.js';

const log = logger.child('task');

export const taskServiceImpl: ServiceImpl<typeof TaskService> = {
  async getTask(req) {
    return withErrorHandling(async () => {
      log.debug('GetTask request', { taskId: req.taskId });
      const orch = getOrchestrator();
      const task = orch.getTask(req.taskId);
      log.debug('GetTask response', { found: !!task });
      return {
        task: task ? toProtoTask(task) : undefined,
      };
    });
  },

  async listTasks() {
    return withErrorHandling(async () => {
      log.debug('ListTasks request');
      const orch = getOrchestrator();
      const tasks = orch.getTasks().map(toProtoTask);
      log.debug('ListTasks response', { count: tasks.length });
      return { tasks };
    });
  },

  async getTaskCounts() {
    return withErrorHandling(async () => {
      log.debug('GetTaskCounts request');
      const orch = getOrchestrator();
      const counts = toProtoTaskCounts(orch.taskQueue.getCounts());
      log.debug('GetTaskCounts response', { counts });
      return { counts };
    });
  },
};
