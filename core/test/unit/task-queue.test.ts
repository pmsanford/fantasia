import { describe, test, expect, beforeEach } from 'bun:test';
import { TaskQueue } from '../../src/task/task-queue.js';
import { createTask, transitionTask } from '../../src/task/task.js';

describe('TaskQueue', () => {
  let queue: TaskQueue;

  beforeEach(() => {
    queue = new TaskQueue(3);
  });

  function makeTask(id: string, priority: 'critical' | 'high' | 'normal' | 'low' = 'normal') {
    return createTask({ id, description: `Task ${id}`, createdBy: 'test', priority });
  }

  test('add and retrieve tasks', () => {
    const task = makeTask('t1');
    queue.add(task);
    expect(queue.get('t1')).toEqual(task);
    expect(queue.get('nonexistent')).toBeUndefined();
  });

  test('getPending returns tasks sorted by priority', () => {
    queue.add(makeTask('low1', 'low'));
    queue.add(makeTask('crit1', 'critical'));
    queue.add(makeTask('norm1', 'normal'));
    queue.add(makeTask('high1', 'high'));

    const pending = queue.getPending();
    expect(pending.map((t) => t.id)).toEqual(['crit1', 'high1', 'norm1', 'low1']);
  });

  test('getActive returns non-terminal, non-pending tasks', () => {
    const task = makeTask('t1');
    queue.add(task);
    expect(queue.getActive()).toHaveLength(0);

    const planning = transitionTask(task, 'planning');
    queue.update(planning);
    expect(queue.getActive()).toHaveLength(1);
  });

  test('canStartMore respects concurrency limit', () => {
    expect(queue.canStartMore()).toBe(true);

    // Add 3 in-progress tasks (concurrency limit is 3)
    for (let i = 0; i < 3; i++) {
      let task = makeTask(`t${i}`);
      task = transitionTask(task, 'in-progress');
      queue.add(task);
    }
    expect(queue.canStartMore()).toBe(false);
  });

  test('getNext returns highest priority pending task', () => {
    queue.add(makeTask('low1', 'low'));
    queue.add(makeTask('high1', 'high'));

    const next = queue.getNext();
    expect(next?.id).toBe('high1');
  });

  test('getNext returns undefined when at concurrency limit', () => {
    for (let i = 0; i < 3; i++) {
      let task = makeTask(`active${i}`);
      task = transitionTask(task, 'in-progress');
      queue.add(task);
    }
    queue.add(makeTask('pending1'));
    expect(queue.getNext()).toBeUndefined();
  });

  test('getCounts returns accurate summary', () => {
    queue.add(makeTask('pending1'));
    let t2 = makeTask('active1');
    t2 = transitionTask(t2, 'in-progress');
    queue.add(t2);
    let t3 = makeTask('done1');
    t3 = transitionTask(t3, 'in-progress');
    t3 = transitionTask(t3, 'completed');
    queue.add(t3);

    const counts = queue.getCounts();
    expect(counts.pending).toBe(1);
    expect(counts.active).toBe(1);
    expect(counts.completed).toBe(1);
    expect(counts.total).toBe(3);
  });

  test('getSubtasks filters by parentId', () => {
    const parent = makeTask('parent');
    const child1 = createTask({ id: 'child1', description: 'c1', createdBy: 'test', parentId: 'parent' });
    const child2 = createTask({ id: 'child2', description: 'c2', createdBy: 'test', parentId: 'parent' });
    const unrelated = makeTask('other');

    queue.add(parent);
    queue.add(child1);
    queue.add(child2);
    queue.add(unrelated);

    const subs = queue.getSubtasks('parent');
    expect(subs).toHaveLength(2);
    expect(subs.map((t) => t.id).sort()).toEqual(['child1', 'child2']);
  });

  test('remove deletes a task', () => {
    queue.add(makeTask('t1'));
    expect(queue.remove('t1')).toBe(true);
    expect(queue.get('t1')).toBeUndefined();
    expect(queue.remove('t1')).toBe(false);
  });

  test('clear removes all tasks', () => {
    queue.add(makeTask('t1'));
    queue.add(makeTask('t2'));
    queue.clear();
    expect(queue.getAll()).toHaveLength(0);
  });

  test('concurrencyLimit getter/setter', () => {
    expect(queue.concurrencyLimit).toBe(3);
    queue.concurrencyLimit = 10;
    expect(queue.concurrencyLimit).toBe(10);
    queue.concurrencyLimit = 0; // Should clamp to 1
    expect(queue.concurrencyLimit).toBe(1);
  });
});
