import type { Task, TaskPriority } from '../types.js';
import { isTerminal } from './task.js';
import logger from '../logger.js';

const log = logger.child('taskQueue');

const PRIORITY_ORDER: Record<TaskPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

/**
 * Priority task queue with concurrency control.
 * Manages pending, active, and completed tasks.
 */
export class TaskQueue {
  private tasks = new Map<string, Task>();
  private maxConcurrent: number;

  constructor(maxConcurrent = 5) {
    this.maxConcurrent = maxConcurrent;
  }

  /**
   * Add a task to the queue.
   */
  add(task: Task): void {
    log.debug('Task added', { taskId: task.id, priority: task.priority, status: task.status });
    this.tasks.set(task.id, task);
  }

  /**
   * Update a task in the queue.
   */
  update(task: Task): void {
    log.trace('Task updated', { taskId: task.id, status: task.status });
    this.tasks.set(task.id, task);
  }

  /**
   * Get a task by ID.
   */
  get(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Remove a task from the queue.
   */
  remove(taskId: string): boolean {
    log.debug('Task removed', { taskId });
    return this.tasks.delete(taskId);
  }

  /**
   * Get all pending tasks sorted by priority.
   */
  getPending(): Task[] {
    return Array.from(this.tasks.values())
      .filter((t) => t.status === 'pending')
      .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
  }

  /**
   * Get all active (non-terminal, non-pending) tasks.
   */
  getActive(): Task[] {
    return Array.from(this.tasks.values())
      .filter((t) => !isTerminal(t) && t.status !== 'pending');
  }

  /**
   * Get all completed tasks.
   */
  getCompleted(): Task[] {
    return Array.from(this.tasks.values())
      .filter((t) => t.status === 'completed');
  }

  /**
   * Get all failed tasks.
   */
  getFailed(): Task[] {
    return Array.from(this.tasks.values())
      .filter((t) => t.status === 'failed');
  }

  /**
   * Get all tasks.
   */
  getAll(): Task[] {
    return Array.from(this.tasks.values());
  }

  /**
   * Get tasks by parent ID (subtasks of a given task).
   */
  getSubtasks(parentId: string): Task[] {
    return Array.from(this.tasks.values())
      .filter((t) => t.parentId === parentId);
  }

  /**
   * Check if more tasks can be started (under concurrency limit).
   */
  canStartMore(): boolean {
    return this.getActive().filter((t) => t.status === 'in-progress').length < this.maxConcurrent;
  }

  /**
   * Get the next task that can be started.
   * Returns undefined if no pending tasks or at concurrency limit.
   */
  getNext(): Task | undefined {
    if (!this.canStartMore()) return undefined;
    const pending = this.getPending();
    return pending[0];
  }

  /**
   * Get count summary.
   */
  getCounts(): { pending: number; active: number; completed: number; failed: number; total: number } {
    const all = Array.from(this.tasks.values());
    return {
      pending: all.filter((t) => t.status === 'pending').length,
      active: all.filter((t) => !isTerminal(t) && t.status !== 'pending').length,
      completed: all.filter((t) => t.status === 'completed').length,
      failed: all.filter((t) => t.status === 'failed').length,
      total: all.length,
    };
  }

  /**
   * Get/set concurrency limit.
   */
  get concurrencyLimit(): number {
    return this.maxConcurrent;
  }

  set concurrencyLimit(limit: number) {
    this.maxConcurrent = Math.max(1, limit);
  }

  /**
   * Clear all tasks.
   */
  clear(): void {
    this.tasks.clear();
  }
}
