import type { Task, TaskStatus, TaskPriority, TaskPlan, TaskReview, TaskResult } from '../types.js';
import { TaskError } from '../errors.js';

const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  'pending': ['planning', 'in-progress', 'failed'],
  'planning': ['reviewing', 'in-progress', 'failed'],
  'reviewing': ['planning', 'in-progress', 'failed'],
  'in-progress': ['blocked', 'completed', 'failed'],
  'blocked': ['in-progress', 'failed'],
  'completed': [],
  'failed': ['pending'], // Allow retry
};

/**
 * Create a new task.
 */
export function createTask(params: {
  id: string;
  description: string;
  createdBy: string;
  priority?: TaskPriority;
  parentId?: string;
  metadata?: Record<string, unknown>;
}): Task {
  const now = Date.now();
  return {
    id: params.id,
    parentId: params.parentId,
    description: params.description,
    status: 'pending',
    priority: params.priority ?? 'normal',
    createdBy: params.createdBy,
    subtaskIds: [],
    createdAt: now,
    updatedAt: now,
    metadata: params.metadata ?? {},
  };
}

/**
 * Transition a task to a new status, validating the transition.
 */
export function transitionTask(task: Task, newStatus: TaskStatus): Task {
  const allowed = VALID_TRANSITIONS[task.status];
  if (!allowed.includes(newStatus)) {
    throw new TaskError(
      `Invalid transition: ${task.status} -> ${newStatus}`,
      task.id,
    );
  }
  return {
    ...task,
    status: newStatus,
    updatedAt: Date.now(),
  };
}

/**
 * Assign an agent to a task.
 */
export function assignTask(task: Task, agentId: string): Task {
  return {
    ...task,
    assignedAgentId: agentId,
    updatedAt: Date.now(),
  };
}

/**
 * Set the plan on a task.
 */
export function setPlan(task: Task, plan: TaskPlan): Task {
  return {
    ...task,
    plan,
    updatedAt: Date.now(),
  };
}

/**
 * Set the review on a task.
 */
export function setReview(task: Task, review: TaskReview): Task {
  return {
    ...task,
    review,
    updatedAt: Date.now(),
  };
}

/**
 * Complete a task with a result.
 */
export function completeTask(task: Task, result: TaskResult): Task {
  return {
    ...transitionTask(task, result.success ? 'completed' : 'failed'),
    result,
  };
}

/**
 * Add a subtask ID to a parent task.
 */
export function addSubtask(task: Task, subtaskId: string): Task {
  return {
    ...task,
    subtaskIds: [...task.subtaskIds, subtaskId],
    updatedAt: Date.now(),
  };
}

/**
 * Check if a task is in a terminal state.
 */
export function isTerminal(task: Task): boolean {
  return task.status === 'completed' || task.status === 'failed';
}

/**
 * Get valid transitions from the current status.
 */
export function getValidTransitions(status: TaskStatus): TaskStatus[] {
  return VALID_TRANSITIONS[status];
}
