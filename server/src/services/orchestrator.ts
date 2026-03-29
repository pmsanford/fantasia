import type { ServiceImpl } from '@connectrpc/connect';
import { OrchestratorService } from '../gen/fantasia/v1/orchestrator_pb.js';
import { getOrchestrator, isInitialized, initialize, shutdown } from '../bridge.js';
import { fromProtoOrchestratorConfig, toProtoAgentInstance, toProtoTaskCounts, toProtoCostBreakdown } from '../convert.js';
import { withErrorHandling } from '../errors.js';
import logger from '../logger.js';

const log = logger.child('orchestrator');

export const orchestratorServiceImpl: ServiceImpl<typeof OrchestratorService> = {
  async initialize(req) {
    return withErrorHandling(async () => {
      if (isInitialized()) {
        const { ConnectError, Code } = await import('@connectrpc/connect');
        throw new ConnectError('Orchestrator already initialized', Code.AlreadyExists);
      }
      const config = req.config ? fromProtoOrchestratorConfig(req.config) : {};
      log.info('Initialize request', { model: config.model, cwd: config.cwd, maxBudgetUsd: config.maxBudgetUsd });
      await initialize(config);
      log.info('Orchestrator initialized successfully');
      return {};
    });
  },

  async submit(req) {
    return withErrorHandling(async () => {
      log.info('Submit request', { messageLength: req.userMessage.length });
      log.debug('Submit message', { message: req.userMessage });
      const orch = getOrchestrator();
      await orch.submit(req.userMessage);
      log.info('Submit completed');
      return {};
    });
  },

  async stop() {
    return withErrorHandling(async () => {
      log.info('Stop request');
      await shutdown();
      log.info('Stop completed');
      return {};
    });
  },

  async getStatus() {
    return withErrorHandling(async () => {
      log.debug('GetStatus request');
      const orch = getOrchestrator();
      const agents = orch.getAgents().map(a => toProtoAgentInstance(a.instance));
      const taskCounts = toProtoTaskCounts(orch.taskQueue.getCounts());
      log.debug('GetStatus response', { agentCount: agents.length, taskCounts: taskCounts });
      return {
        running: true,
        agents,
        taskCounts,
      };
    });
  },

  async getCost() {
    return withErrorHandling(async () => {
      log.debug('GetCost request');
      const orch = getOrchestrator();
      const totalCostUsd = orch.context.getTotalCost();
      const byAgent = orch.context.getCostBreakdown();
      log.debug('GetCost response', { totalCostUsd });
      return {
        cost: toProtoCostBreakdown(totalCostUsd, byAgent),
      };
    });
  },
};
