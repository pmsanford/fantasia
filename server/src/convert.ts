import { create } from '@bufbuild/protobuf';
import type {
  AgentRole as CoreAgentRole,
  AgentStatus as CoreAgentStatus,
  AgentConfig as CoreAgentConfig,
  AgentInstance as CoreAgentInstance,
  TaskStatus as CoreTaskStatus,
  TaskPriority as CoreTaskPriority,
  TaskPlan as CoreTaskPlan,
  TaskReview as CoreTaskReview,
  TaskResult as CoreTaskResult,
  Task as CoreTask,
  MemoryType as CoreMemoryType,
  MemoryEntry as CoreMemoryEntry,
  FantasiaEvent as CoreFantasiaEvent,
  OrchestratorConfig as CoreOrchestratorConfig,
} from '@fantasia/core';

import {
  AgentRole,
  AgentStatus,
  TaskStatus,
  TaskPriority,
  MemoryType,
  EstimatedComplexity,
  AgentConfigSchema,
  AgentInstanceSchema,
  TaskPlanSchema,
  TaskReviewSchema,
  TaskResultSchema,
  TaskSchema,
  MemoryEntrySchema,
  FantasiaEventSchema,
  AgentSpawnedEventSchema,
  AgentStatusChangedEventSchema,
  AgentTerminatedEventSchema,
  AgentMessageEventSchema,
  TaskCreatedEventSchema,
  TaskStatusChangedEventSchema,
  TaskCompletedEventSchema,
  TaskFailedEventSchema,
  OrchestratorReadyEventSchema,
  OrchestratorErrorEventSchema,
  OrchestratorStoppedEventSchema,
  UserInputNeededEventSchema,
  CostUpdateEventSchema,
  SdkMessageEventSchema,
  SubtaskDefSchema,
  TaskCountsSchema,
  CostBreakdownSchema,
} from './gen/fantasia/v1/types_pb.js';

import type {
  AgentConfig as ProtoAgentConfig,
  AgentInstance as ProtoAgentInstance,
  Task as ProtoTask,
  TaskResult as ProtoTaskResult,
  MemoryEntry as ProtoMemoryEntry,
  FantasiaEvent as ProtoFantasiaEvent,
  OrchestratorConfig as ProtoOrchestratorConfig,
  TaskCounts as ProtoTaskCounts,
  CostBreakdown as ProtoCostBreakdown,
} from './gen/fantasia/v1/types_pb.js';

// ─── Agent Role ─────────────────────────────────────

const ROLE_TO_PROTO: Record<CoreAgentRole, AgentRole> = {
  'mickey': AgentRole.MICKEY,
  'yen-sid': AgentRole.YEN_SID,
  'chernabog': AgentRole.CHERNABOG,
  'broomstick': AgentRole.BROOMSTICK,
  'imagineer': AgentRole.IMAGINEER,
  'jacchus': AgentRole.JACCHUS,
};

const PROTO_TO_ROLE: Record<number, CoreAgentRole> = {
  [AgentRole.MICKEY]: 'mickey',
  [AgentRole.YEN_SID]: 'yen-sid',
  [AgentRole.CHERNABOG]: 'chernabog',
  [AgentRole.BROOMSTICK]: 'broomstick',
  [AgentRole.IMAGINEER]: 'imagineer',
  [AgentRole.JACCHUS]: 'jacchus',
};

export function toProtoAgentRole(role: CoreAgentRole): AgentRole {
  return ROLE_TO_PROTO[role];
}

export function fromProtoAgentRole(role: AgentRole): CoreAgentRole {
  const result = PROTO_TO_ROLE[role];
  if (!result) throw new Error(`Unknown AgentRole: ${role}`);
  return result;
}

// ─── Agent Status ───────────────────────────────────

const STATUS_TO_PROTO: Record<CoreAgentStatus, AgentStatus> = {
  'idle': AgentStatus.IDLE,
  'working': AgentStatus.WORKING,
  'waiting': AgentStatus.WAITING,
  'error': AgentStatus.ERROR,
  'terminated': AgentStatus.TERMINATED,
};

export function toProtoAgentStatus(status: CoreAgentStatus): AgentStatus {
  return STATUS_TO_PROTO[status];
}

// ─── Task Status ────────────────────────────────────

const TASK_STATUS_TO_PROTO: Record<CoreTaskStatus, TaskStatus> = {
  'pending': TaskStatus.PENDING,
  'planning': TaskStatus.PLANNING,
  'reviewing': TaskStatus.REVIEWING,
  'in-progress': TaskStatus.IN_PROGRESS,
  'blocked': TaskStatus.BLOCKED,
  'completed': TaskStatus.COMPLETED,
  'failed': TaskStatus.FAILED,
};

const PROTO_TO_TASK_STATUS: Record<number, CoreTaskStatus> = {
  [TaskStatus.PENDING]: 'pending',
  [TaskStatus.PLANNING]: 'planning',
  [TaskStatus.REVIEWING]: 'reviewing',
  [TaskStatus.IN_PROGRESS]: 'in-progress',
  [TaskStatus.BLOCKED]: 'blocked',
  [TaskStatus.COMPLETED]: 'completed',
  [TaskStatus.FAILED]: 'failed',
};

export function toProtoTaskStatus(status: CoreTaskStatus): TaskStatus {
  return TASK_STATUS_TO_PROTO[status];
}

export function fromProtoTaskStatus(status: TaskStatus): CoreTaskStatus {
  const result = PROTO_TO_TASK_STATUS[status];
  if (!result) throw new Error(`Unknown TaskStatus: ${status}`);
  return result;
}

// ─── Task Priority ──────────────────────────────────

const PRIORITY_TO_PROTO: Record<CoreTaskPriority, TaskPriority> = {
  'critical': TaskPriority.CRITICAL,
  'high': TaskPriority.HIGH,
  'normal': TaskPriority.NORMAL,
  'low': TaskPriority.LOW,
};

export function toProtoTaskPriority(priority: CoreTaskPriority): TaskPriority {
  return PRIORITY_TO_PROTO[priority];
}

// ─── Memory Type ────────────────────────────────────

const MEMORY_TYPE_TO_PROTO: Record<CoreMemoryType, MemoryType> = {
  'lesson': MemoryType.LESSON,
  'rejection': MemoryType.REJECTION,
  'preference': MemoryType.PREFERENCE,
  'pattern': MemoryType.PATTERN,
};

const PROTO_TO_MEMORY_TYPE: Record<number, CoreMemoryType> = {
  [MemoryType.LESSON]: 'lesson',
  [MemoryType.REJECTION]: 'rejection',
  [MemoryType.PREFERENCE]: 'preference',
  [MemoryType.PATTERN]: 'pattern',
};

export function toProtoMemoryType(type: CoreMemoryType): MemoryType {
  return MEMORY_TYPE_TO_PROTO[type];
}

export function fromProtoMemoryType(type: MemoryType): CoreMemoryType {
  const result = PROTO_TO_MEMORY_TYPE[type];
  if (!result) throw new Error(`Unknown MemoryType: ${type}`);
  return result;
}

// ─── Estimated Complexity ───────────────────────────

const COMPLEXITY_TO_PROTO: Record<string, EstimatedComplexity> = {
  'trivial': EstimatedComplexity.TRIVIAL,
  'simple': EstimatedComplexity.SIMPLE,
  'moderate': EstimatedComplexity.MODERATE,
  'complex': EstimatedComplexity.COMPLEX,
};

// ─── Agent Config ───────────────────────────────────

export function toProtoAgentConfig(config: CoreAgentConfig): ProtoAgentConfig {
  const tools: string[] = [];
  let toolsPreset: string | undefined;

  if (config.tools) {
    if (Array.isArray(config.tools)) {
      tools.push(...config.tools);
    } else {
      toolsPreset = config.tools.preset;
    }
  }

  return create(AgentConfigSchema, {
    role: toProtoAgentRole(config.role),
    name: config.name,
    systemPrompt: config.systemPrompt,
    model: config.model,
    tools,
    disallowedTools: config.disallowedTools ?? [],
    allowedTools: config.allowedTools ?? [],
    maxTurns: config.maxTurns,
    maxBudgetUsd: config.maxBudgetUsd,
    effort: config.effort as string | undefined,
    outputFormat: config.outputFormat as string | undefined,
    persistSession: config.persistSession,
    permissionMode: config.permissionMode as string | undefined,
    toolsPreset,
  });
}

// ─── Agent Instance ─────────────────────────────────

export function toProtoAgentInstance(instance: CoreAgentInstance): ProtoAgentInstance {
  return create(AgentInstanceSchema, {
    id: instance.id,
    config: toProtoAgentConfig(instance.config),
    status: toProtoAgentStatus(instance.status),
    currentTaskId: instance.currentTaskId,
    sessionId: instance.sessionId,
    startedAt: BigInt(instance.startedAt),
    lastActivityAt: BigInt(instance.lastActivityAt),
    error: instance.error,
  });
}

// ─── Task Plan ──────────────────────────────────────

export function toProtoTaskPlan(plan: CoreTaskPlan) {
  return create(TaskPlanSchema, {
    summary: plan.summary,
    steps: plan.steps,
    subtasks: (plan.subtasks ?? []).map((s: { description: string; dependencies?: string[] }) =>
      create(SubtaskDefSchema, {
        description: s.description,
        dependencies: s.dependencies ?? [],
      })
    ),
    risks: plan.risks ?? [],
    estimatedComplexity: COMPLEXITY_TO_PROTO[plan.estimatedComplexity] ?? EstimatedComplexity.UNSPECIFIED,
  });
}

// ─── Task Review ────────────────────────────────────

export function toProtoTaskReview(review: CoreTaskReview) {
  return create(TaskReviewSchema, {
    approved: review.approved,
    concerns: review.concerns,
    requiredChanges: review.requiredChanges,
    strengths: review.strengths,
    iteration: review.iteration,
  });
}

// ─── Task Result ────────────────────────────────────

export function toProtoTaskResult(result: CoreTaskResult) {
  return create(TaskResultSchema, {
    success: result.success,
    output: result.output,
    artifacts: result.artifacts ?? [],
    costUsd: result.costUsd,
    durationMs: result.durationMs != null ? BigInt(result.durationMs) : undefined,
    tokenUsageJson: result.tokenUsage
      ? new TextEncoder().encode(JSON.stringify(result.tokenUsage))
      : new Uint8Array(),
    modelUsageJson: result.modelUsage
      ? new TextEncoder().encode(JSON.stringify(result.modelUsage))
      : new Uint8Array(),
  });
}

// ─── Task ───────────────────────────────────────────

export function toProtoTask(task: CoreTask) {
  return create(TaskSchema, {
    id: task.id,
    parentId: task.parentId,
    description: task.description,
    status: toProtoTaskStatus(task.status),
    priority: toProtoTaskPriority(task.priority),
    assignedAgentId: task.assignedAgentId,
    createdBy: task.createdBy,
    plan: task.plan ? toProtoTaskPlan(task.plan) : undefined,
    review: task.review ? toProtoTaskReview(task.review) : undefined,
    result: task.result ? toProtoTaskResult(task.result) : undefined,
    subtaskIds: task.subtaskIds,
    createdAt: BigInt(task.createdAt),
    updatedAt: BigInt(task.updatedAt),
    metadataJson: new TextEncoder().encode(JSON.stringify(task.metadata)),
  });
}

// ─── Memory Entry ───────────────────────────────────

export function toProtoMemoryEntry(entry: CoreMemoryEntry): ProtoMemoryEntry {
  return create(MemoryEntrySchema, {
    id: entry.id,
    agentRole: toProtoAgentRole(entry.agentRole),
    type: toProtoMemoryType(entry.type),
    content: entry.content,
    context: entry.context,
    tags: entry.tags,
    timestamp: BigInt(entry.timestamp),
    relevanceScore: entry.relevanceScore,
  });
}

// ─── Task Counts ────────────────────────────────────

export function toProtoTaskCounts(counts: {
  pending: number;
  active: number;
  completed: number;
  failed: number;
  total: number;
}): ProtoTaskCounts {
  return create(TaskCountsSchema, counts);
}

// ─── Cost Breakdown ─────────────────────────────────

export function toProtoCostBreakdown(
  totalCostUsd: number,
  byAgent: Record<string, number>,
): ProtoCostBreakdown {
  return create(CostBreakdownSchema, { totalCostUsd, byAgent });
}

// ─── Fantasia Event ─────────────────────────────────

export function toProtoFantasiaEvent(
  event: CoreFantasiaEvent,
  sequence: number,
): ProtoFantasiaEvent {
  const base = {
    timestamp: BigInt(Date.now()),
    sequence: BigInt(sequence),
  };

  switch (event.type) {
    case 'agent:spawned':
      return create(FantasiaEventSchema, {
        ...base,
        payload: {
          case: 'agentSpawned' as const,
          value: create(AgentSpawnedEventSchema, {
            agent: toProtoAgentInstance(event.agent),
          }),
        },
      });
    case 'agent:status-changed':
      return create(FantasiaEventSchema, {
        ...base,
        payload: {
          case: 'agentStatusChanged' as const,
          value: create(AgentStatusChangedEventSchema, {
            agentId: event.agentId,
            oldStatus: toProtoAgentStatus(event.oldStatus),
            newStatus: toProtoAgentStatus(event.newStatus),
          }),
        },
      });
    case 'agent:terminated':
      return create(FantasiaEventSchema, {
        ...base,
        payload: {
          case: 'agentTerminated' as const,
          value: create(AgentTerminatedEventSchema, {
            agentId: event.agentId,
            reason: event.reason,
          }),
        },
      });
    case 'agent:message':
      return create(FantasiaEventSchema, {
        ...base,
        payload: {
          case: 'agentMessage' as const,
          value: create(AgentMessageEventSchema, {
            agentId: event.agentId,
            content: event.content,
            isPartial: event.isPartial,
          }),
        },
      });
    case 'task:created':
      return create(FantasiaEventSchema, {
        ...base,
        payload: {
          case: 'taskCreated' as const,
          value: create(TaskCreatedEventSchema, {
            task: toProtoTask(event.task),
          }),
        },
      });
    case 'task:status-changed':
      return create(FantasiaEventSchema, {
        ...base,
        payload: {
          case: 'taskStatusChanged' as const,
          value: create(TaskStatusChangedEventSchema, {
            taskId: event.taskId,
            oldStatus: toProtoTaskStatus(event.oldStatus),
            newStatus: toProtoTaskStatus(event.newStatus),
          }),
        },
      });
    case 'task:completed':
      return create(FantasiaEventSchema, {
        ...base,
        payload: {
          case: 'taskCompleted' as const,
          value: create(TaskCompletedEventSchema, {
            taskId: event.taskId,
            result: toProtoTaskResult(event.result),
          }),
        },
      });
    case 'task:failed':
      return create(FantasiaEventSchema, {
        ...base,
        payload: {
          case: 'taskFailed' as const,
          value: create(TaskFailedEventSchema, {
            taskId: event.taskId,
            error: event.error,
          }),
        },
      });
    case 'orchestrator:ready':
      return create(FantasiaEventSchema, {
        ...base,
        payload: {
          case: 'orchestratorReady' as const,
          value: create(OrchestratorReadyEventSchema, {}),
        },
      });
    case 'orchestrator:error':
      return create(FantasiaEventSchema, {
        ...base,
        payload: {
          case: 'orchestratorError' as const,
          value: create(OrchestratorErrorEventSchema, {
            errorMessage: event.error.message,
          }),
        },
      });
    case 'orchestrator:stopped':
      return create(FantasiaEventSchema, {
        ...base,
        payload: {
          case: 'orchestratorStopped' as const,
          value: create(OrchestratorStoppedEventSchema, {}),
        },
      });
    case 'user:input-needed':
      return create(FantasiaEventSchema, {
        ...base,
        payload: {
          case: 'userInputNeeded' as const,
          value: create(UserInputNeededEventSchema, {
            prompt: event.prompt,
            taskId: event.taskId,
          }),
        },
      });
    case 'cost:update':
      return create(FantasiaEventSchema, {
        ...base,
        payload: {
          case: 'costUpdate' as const,
          value: create(CostUpdateEventSchema, {
            totalCostUsd: event.totalCostUsd,
            breakdown: event.breakdown,
          }),
        },
      });
    case 'sdk:message':
      return create(FantasiaEventSchema, {
        ...base,
        payload: {
          case: 'sdkMessage' as const,
          value: create(SdkMessageEventSchema, {
            agentId: event.agentId,
            sdkMessageJson: new TextEncoder().encode(JSON.stringify(event.sdkMessage)),
          }),
        },
      });
  }
}

// ─── OrchestratorConfig (from proto) ────────────────

export function fromProtoOrchestratorConfig(config: ProtoOrchestratorConfig): CoreOrchestratorConfig {
  const result: CoreOrchestratorConfig = {};

  if (config.model != null) result.model = config.model;
  if (config.cwd != null) result.cwd = config.cwd;
  if (config.allowedTools.length > 0) result.allowedTools = config.allowedTools;
  if (config.permissionMode != null) result.permissionMode = config.permissionMode as CoreOrchestratorConfig['permissionMode'];
  if (config.maxConcurrentBroomsticks != null) result.maxConcurrentBroomsticks = config.maxConcurrentBroomsticks;
  if (config.maxBudgetUsd != null) result.maxBudgetUsd = config.maxBudgetUsd;
  if (config.memoryDir != null) result.memoryDir = config.memoryDir;

  if (Object.keys(config.env).length > 0) {
    result.env = config.env;
  }

  if (Object.keys(config.modelOverrides).length > 0) {
    const overrides: Partial<Record<CoreAgentRole, string>> = {};
    for (const [key, value] of Object.entries(config.modelOverrides)) {
      overrides[key as CoreAgentRole] = value;
    }
    result.modelOverrides = overrides;
  }

  if (Object.keys(config.enabledAgents).length > 0) {
    const enabled: Partial<Record<CoreAgentRole, boolean>> = {};
    for (const [key, value] of Object.entries(config.enabledAgents)) {
      enabled[key as CoreAgentRole] = value;
    }
    result.enabledAgents = enabled;
  }

  return result;
}
