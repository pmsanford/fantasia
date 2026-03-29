import type { ServiceImpl } from '@connectrpc/connect';
import { MemoryService } from '../gen/fantasia/v1/memory_pb.js';
import { getOrchestrator } from '../bridge.js';
import { fromProtoAgentRole, fromProtoMemoryType, toProtoMemoryEntry } from '../convert.js';
import { withErrorHandling } from '../errors.js';
import logger from '../logger.js';

const log = logger.child('memory');

export const memoryServiceImpl: ServiceImpl<typeof MemoryService> = {
  async remember(req) {
    return withErrorHandling(async () => {
      const role = fromProtoAgentRole(req.agentRole);
      const type = fromProtoMemoryType(req.type);
      log.debug('Remember request', { role, type, tags: req.tags });
      const orch = getOrchestrator();
      const entry = await orch.memory.remember({
        agentRole: role,
        type,
        content: req.content,
        context: req.context,
        tags: req.tags,
      });
      log.debug('Remember completed', { id: entry.id });
      return { entry: toProtoMemoryEntry(entry) };
    });
  },

  async forget(req) {
    return withErrorHandling(async () => {
      log.debug('Forget request', { id: req.id });
      const orch = getOrchestrator();
      const deleted = await orch.memory.forget(req.id);
      log.debug('Forget completed', { deleted });
      return { deleted };
    });
  },

  async recall(req) {
    return withErrorHandling(async () => {
      const role = fromProtoAgentRole(req.role);
      log.debug('Recall request', { role, tags: req.tags });
      const orch = getOrchestrator();
      const entries = orch.memory.recall(
        role,
        req.tags.length > 0 ? req.tags : undefined,
      );
      log.debug('Recall response', { count: entries.length });
      return { entries: entries.map(toProtoMemoryEntry) };
    });
  },

  async recordApproval(req) {
    return withErrorHandling(async () => {
      const role = fromProtoAgentRole(req.agentRole);
      log.debug('RecordApproval request', { role });
      const orch = getOrchestrator();
      const entry = await orch.memory.recordApproval(
        role,
        req.planSummary,
        req.tags,
      );
      log.debug('RecordApproval completed', { id: entry.id });
      return { entry: toProtoMemoryEntry(entry) };
    });
  },

  async recordRejection(req) {
    return withErrorHandling(async () => {
      const role = fromProtoAgentRole(req.agentRole);
      log.debug('RecordRejection request', { role });
      const orch = getOrchestrator();
      const entry = await orch.memory.recordRejection(
        role,
        req.suggestion,
        req.reason,
        req.tags,
      );
      log.debug('RecordRejection completed', { id: entry.id });
      return { entry: toProtoMemoryEntry(entry) };
    });
  },

  async recordLesson(req) {
    return withErrorHandling(async () => {
      const role = fromProtoAgentRole(req.agentRole);
      log.debug('RecordLesson request', { role });
      const orch = getOrchestrator();
      const entry = await orch.memory.recordLesson(
        role,
        req.lesson,
        req.context,
        req.tags,
      );
      log.debug('RecordLesson completed', { id: entry.id });
      return { entry: toProtoMemoryEntry(entry) };
    });
  },

  async prune(req) {
    return withErrorHandling(async () => {
      const maxPerRole = req.maxPerRole ?? undefined;
      log.info('Prune request', { maxPerRole });
      const orch = getOrchestrator();
      const prunedCount = await orch.memory.prune(maxPerRole);
      log.info('Prune completed', { prunedCount });
      return { prunedCount };
    });
  },

  async getAll() {
    return withErrorHandling(async () => {
      log.debug('GetAll request');
      const orch = getOrchestrator();
      const entries = orch.memory.getAll().map(toProtoMemoryEntry);
      log.debug('GetAll response', { count: entries.length });
      return { entries };
    });
  },
};
