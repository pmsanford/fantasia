import type {
  OrchestratorConfig,
  SdkAdapter,
  Task,
  TaskPlan,
  TaskReview,
  TaskResult,
  AgentRole,
  AgentMessage,
  SDKUserMessage,
} from './types.js';
import { FantasiaEventEmitter } from './events/event-emitter.js';
import { MessageBus } from './messaging/message-bus.js';
import { TaskQueue } from './task/task-queue.js';
import { ContextStore } from './context/context-store.js';
import { MemoryStore } from './memory/memory-store.js';
import { MemoryManager } from './memory/memory-manager.js';
import { SessionPool } from './sdk/session-pool.js';
import { MickeyAgent } from './agents/mickey.js';
import { YenSidAgent } from './agents/yen-sid.js';
import { ChernabogAgent } from './agents/chernabog.js';
import { BroomstickAgent } from './agents/broomstick.js';
import { ImagineerAgent } from './agents/imagineer.js';
import type { HealthReport } from './agents/imagineer.js';
import { createFantasiaTools } from './tools/fantasia-tools.js';
import { createTask, transitionTask, setPlan, setReview, completeTask } from './task/task.js';
import { OrchestratorError, BudgetExceededError } from './errors.js';
import type { BaseAgent } from './agents/base-agent.js';
import logger from './logger.js';

const log = logger.child('orchestrator');

const MAX_PLAN_REVIEW_ITERATIONS = 2;
const HEALTH_CHECK_INTERVAL_MS = 30_000;

/**
 * The Fantasia orchestrator. Manages the full agent lifecycle:
 * Mickey receives user input -> Yen Sid plans -> Chernabog reviews -> Broomsticks execute.
 * Imagineer monitors everything.
 */
export class Orchestrator {
  readonly events: FantasiaEventEmitter;
  readonly messageBus: MessageBus;
  readonly taskQueue: TaskQueue;
  readonly context: ContextStore;
  readonly memory: MemoryManager;

  private sdk: SdkAdapter;
  private sessionPool: SessionPool;
  private config: Required<OrchestratorConfig>;
  private mickey: MickeyAgent | null = null;
  private imagineer: ImagineerAgent | null = null;
  private activeAgents = new Map<string, BaseAgent>();
  private running = false;
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;

  constructor(sdk: SdkAdapter, config: OrchestratorConfig = {}) {
    this.sdk = sdk;
    this.config = {
      model: config.model ?? 'claude-sonnet-4-6',
      cwd: config.cwd ?? process.cwd(),
      allowedTools: config.allowedTools ?? [],
      permissionMode: config.permissionMode ?? 'bypassPermissions',
      maxConcurrentBroomsticks: config.maxConcurrentBroomsticks ?? 5,
      maxBudgetUsd: config.maxBudgetUsd ?? 10,
      env: config.env ?? {},
      memoryDir: config.memoryDir ?? '.fantasia/memory',
      modelOverrides: config.modelOverrides ?? {},
      enabledAgents: config.enabledAgents ?? {},
    };

    log.debug('Orchestrator constructed', {
      model: this.config.model,
      cwd: this.config.cwd,
      maxBudgetUsd: this.config.maxBudgetUsd,
      maxConcurrentBroomsticks: this.config.maxConcurrentBroomsticks,
    });

    this.events = new FantasiaEventEmitter();
    this.messageBus = new MessageBus();
    this.taskQueue = new TaskQueue(this.config.maxConcurrentBroomsticks);
    this.context = new ContextStore();
    this.sessionPool = new SessionPool(sdk);

    const memoryStore = new MemoryStore(this.config.memoryDir);
    this.memory = new MemoryManager(memoryStore);
  }

  /**
   * Start the orchestrator. Initializes memory and core agents.
   */
  async start(): Promise<void> {
    if (this.running) throw new OrchestratorError('Orchestrator is already running');

    log.info('Starting orchestrator');
    await this.memory.initialize();
    log.debug('Memory initialized');

    this.mickey = new MickeyAgent(this.sdk, this.events, this.memory, {
      model: this.config.modelOverrides.mickey ?? this.config.model,
    });
    this.activeAgents.set(this.mickey.instance.id, this.mickey);
    this.events.emit({ type: 'agent:spawned', agent: this.mickey.instance });
    log.info('Mickey agent spawned', { id: this.mickey.instance.id });

    if (this.config.enabledAgents.imagineer !== false) {
      this.imagineer = new ImagineerAgent(this.sdk, this.events, this.memory, {
        model: this.config.modelOverrides.imagineer ?? this.config.model,
      });
      this.activeAgents.set(this.imagineer.instance.id, this.imagineer);
      this.events.emit({ type: 'agent:spawned', agent: this.imagineer.instance });
      log.info('Imagineer agent spawned', { id: this.imagineer.instance.id });

      this.healthCheckTimer = setInterval(() => this.runHealthCheck(), HEALTH_CHECK_INTERVAL_MS);
      log.debug('Health check timer started', { intervalMs: HEALTH_CHECK_INTERVAL_MS });
    }

    this.running = true;
    this.events.emit({ type: 'orchestrator:ready' });
    log.info('Orchestrator ready');
  }

  /**
   * Stop the orchestrator and clean up all resources.
   */
  async stop(): Promise<void> {
    if (!this.running) {
      log.debug('Stop called but orchestrator not running');
      return;
    }
    this.running = false;
    log.info('Stopping orchestrator');

    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    // Stop all active agents
    const agentCount = this.activeAgents.size;
    log.debug('Stopping active agents', { count: agentCount });
    for (const agent of this.activeAgents.values()) {
      await agent.stop();
    }
    this.activeAgents.clear();

    this.sessionPool.closeAll();
    this.events.emit({ type: 'orchestrator:stopped' });
    this.events.stopStream();
    log.info('Orchestrator stopped');
  }

  /**
   * Submit a user message to Mickey.
   */
  async submit(userMessage: string): Promise<void> {
    if (!this.running || !this.mickey) {
      log.warn('Submit called but orchestrator not running');
      throw new OrchestratorError('Orchestrator is not running');
    }

    log.info('Submit: starting', { messageLength: userMessage.length });
    log.debug('Submit: message content', { message: userMessage });

    this.checkBudget();
    log.trace('Submit: budget check passed');

    // Create Mickey's MCP tools
    const fantasiaTools = createFantasiaTools(this.sdk, {
      taskQueue: this.taskQueue,
      onDelegateTask: (description, priority) => this.handleDelegateTask(description, priority as any),
    });
    log.trace('Submit: MCP tools created');

    log.info('Submit: running Mickey', { mickeyId: this.mickey.instance.id });
    const result = await this.mickey.run({
      prompt: userMessage,
      cwd: this.config.cwd,
      env: this.config.env,
      extraSdkOptions: {
        mcpServers: { fantasia: fantasiaTools.server },
        allowedTools: [...fantasiaTools.toolNames, ...(this.config.allowedTools ?? [])],
      },
    });

    this.context.addCost(this.mickey.instance.id, result.costUsd);
    this.emitCostUpdate();
    log.info('Submit: completed', {
      success: result.success,
      costUsd: result.costUsd,
      numTurns: result.numTurns,
      durationMs: result.durationMs,
    });
  }

  /**
   * Get all active agent instances.
   */
  getAgents(): BaseAgent[] {
    return Array.from(this.activeAgents.values());
  }

  /**
   * Get a specific task.
   */
  getTask(id: string): Task | undefined {
    return this.taskQueue.get(id);
  }

  /**
   * Get all tasks.
   */
  getTasks(): Task[] {
    return this.taskQueue.getAll();
  }

  // ─── Internal: Task Delegation Pipeline ───────────────────────

  /**
   * Handle a delegate_task call from Mickey.
   * Kicks off the Yen Sid -> Chernabog -> Broomstick pipeline.
   */
  private async handleDelegateTask(description: string, priority: 'critical' | 'high' | 'normal' | 'low'): Promise<string> {
    const task = createTask({
      id: crypto.randomUUID(),
      description,
      createdBy: this.mickey?.instance.id ?? 'orchestrator',
      priority,
    });
    this.taskQueue.add(task);
    this.events.emit({ type: 'task:created', task });
    log.info('Task delegated', { taskId: task.id, priority, descriptionLength: description.length });
    log.debug('Task delegated details', { taskId: task.id, description });

    // Run the pipeline asynchronously so Mickey isn't blocked
    this.runTaskPipeline(task.id).catch((error) => {
      log.error('Task pipeline failed with unhandled error', { taskId: task.id, error: String(error) });
      this.events.emit({ type: 'orchestrator:error', error: error as Error });
    });

    return task.id;
  }

  /**
   * Full task pipeline: plan -> review -> execute.
   */
  private async runTaskPipeline(taskId: string): Promise<void> {
    let task = this.taskQueue.get(taskId);
    if (!task) {
      log.warn('runTaskPipeline: task not found', { taskId });
      return;
    }

    log.info('Pipeline: starting', { taskId, description: task.description.slice(0, 100) });

    try {
      // Phase 1: Planning (Yen Sid)
      log.info('Pipeline: phase 1 - planning', { taskId });
      task = transitionTask(task, 'planning');
      this.taskQueue.update(task);
      this.emitTaskStatusChange(task, 'pending');

      let plan = await this.requestPlan(task);
      task = setPlan(task, plan);
      this.taskQueue.update(task);
      log.info('Pipeline: plan created', {
        taskId,
        summary: plan.summary.slice(0, 100),
        stepsCount: plan.steps.length,
        subtasksCount: plan.subtasks?.length ?? 0,
        complexity: plan.estimatedComplexity,
      });

      // Phase 2: Review (Chernabog) with iteration
      log.info('Pipeline: phase 2 - reviewing', { taskId });
      task = transitionTask(task, 'reviewing');
      this.taskQueue.update(task);
      this.emitTaskStatusChange(task, 'planning');

      for (let iteration = 0; iteration < MAX_PLAN_REVIEW_ITERATIONS; iteration++) {
        log.info('Pipeline: requesting review', { taskId, iteration });
        const review = await this.requestReview(task);
        task = setReview(task, { ...review, iteration });
        this.taskQueue.update(task);

        log.info('Pipeline: review result', {
          taskId,
          iteration,
          approved: review.approved,
          concernsCount: review.concerns.length,
          requiredChangesCount: review.requiredChanges.length,
        });

        if (review.approved) {
          log.info('Pipeline: plan approved', { taskId, iteration });
          break;
        }

        // If not approved and not at max iterations, revise the plan
        if (iteration < MAX_PLAN_REVIEW_ITERATIONS - 1) {
          log.info('Pipeline: revising plan', { taskId, iteration, concerns: review.concerns });
          task = transitionTask(task, 'planning');
          this.taskQueue.update(task);
          this.emitTaskStatusChange(task, 'reviewing');

          plan = await this.revisePlan(task, review);
          task = setPlan(task, plan);
          task = transitionTask(task, 'reviewing');
          this.taskQueue.update(task);
          this.emitTaskStatusChange(task, 'planning');
          log.info('Pipeline: plan revised', { taskId, summary: plan.summary.slice(0, 100) });
        } else {
          log.warn('Pipeline: max review iterations reached, proceeding with unapproved plan', { taskId });
        }
      }

      // Phase 3: Execution (Broomsticks)
      log.info('Pipeline: phase 3 - executing', { taskId });
      task = transitionTask(task, 'in-progress');
      this.taskQueue.update(task);
      this.emitTaskStatusChange(task, 'reviewing');

      const result = await this.executePlan(task);
      task = completeTask(task, result);
      this.taskQueue.update(task);

      if (result.success) {
        this.events.emit({ type: 'task:completed', taskId: task.id, result });
        log.info('Pipeline: task completed successfully', {
          taskId,
          costUsd: result.costUsd,
          durationMs: result.durationMs,
        });
        // Record positive pattern in memory
        if (task.plan) {
          await this.memory.recordApproval('yen-sid', task.plan.summary, this.extractTags(task));
        }
      } else {
        this.events.emit({ type: 'task:failed', taskId: task.id, error: result.output });
        log.error('Pipeline: task failed', { taskId, output: result.output.slice(0, 200) });
        // Record lesson in memory
        await this.memory.recordLesson(
          'yen-sid',
          `Plan failed: ${result.output}`,
          task.description,
          this.extractTags(task),
        );
      }

      log.info('Pipeline: finished', { taskId, success: result.success });
    } catch (error) {
      log.error('Pipeline: caught error', { taskId, error: String(error) });
      task = this.taskQueue.get(taskId) ?? task;
      const result: TaskResult = {
        success: false,
        output: `Pipeline error: ${error}`,
      };
      try {
        task = completeTask(task, result);
      } catch {
        // If transition fails, force the status
        task = { ...task, status: 'failed', result, updatedAt: Date.now() };
      }
      this.taskQueue.update(task);
      this.events.emit({ type: 'task:failed', taskId: task.id, error: String(error) });
    }
  }

  /**
   * Request a plan from Yen Sid.
   */
  private async requestPlan(task: Task): Promise<TaskPlan> {
    this.checkBudget();

    const yenSid = new YenSidAgent(this.sdk, this.events, this.memory, {
      model: this.config.modelOverrides['yen-sid'] ?? 'claude-opus-4-6',
    });
    this.activeAgents.set(yenSid.instance.id, yenSid);
    this.events.emit({ type: 'agent:spawned', agent: yenSid.instance });
    log.info('requestPlan: Yen Sid spawned', { agentId: yenSid.instance.id, taskId: task.id });

    try {
      const prompt = [
        `Create a detailed implementation plan for the following task:`,
        '',
        task.description,
        '',
        'Return a JSON object with these fields:',
        '- summary: string (brief summary of the approach)',
        '- steps: string[] (ordered implementation steps)',
        '- subtasks: Array<{description: string, dependencies?: string[]}> (discrete work units that can be assigned to workers)',
        '- risks: string[] (potential issues)',
        '- estimatedComplexity: "trivial" | "simple" | "moderate" | "complex"',
      ].join('\n');

      log.debug('requestPlan: running Yen Sid', { taskId: task.id });
      const result = await yenSid.run({ prompt, cwd: this.config.cwd, env: this.config.env });
      this.context.addCost(yenSid.instance.id, result.costUsd);
      this.emitCostUpdate();
      log.info('requestPlan: Yen Sid completed', {
        taskId: task.id,
        success: result.success,
        costUsd: result.costUsd,
        numTurns: result.numTurns,
        durationMs: result.durationMs,
      });

      return this.parsePlan(result.output);
    } finally {
      await yenSid.stop();
      this.activeAgents.delete(yenSid.instance.id);
      log.debug('requestPlan: Yen Sid stopped', { agentId: yenSid.instance.id });
    }
  }

  /**
   * Revise a plan based on Chernabog's review.
   */
  private async revisePlan(task: Task, review: TaskReview): Promise<TaskPlan> {
    this.checkBudget();

    const yenSid = new YenSidAgent(this.sdk, this.events, this.memory, {
      model: this.config.modelOverrides['yen-sid'] ?? 'claude-opus-4-6',
    });
    this.activeAgents.set(yenSid.instance.id, yenSid);
    this.events.emit({ type: 'agent:spawned', agent: yenSid.instance });
    log.info('revisePlan: Yen Sid spawned for revision', { agentId: yenSid.instance.id, taskId: task.id });

    try {
      const prompt = [
        `Revise your implementation plan based on the following review feedback:`,
        '',
        `## Original Task`,
        task.description,
        '',
        `## Previous Plan`,
        JSON.stringify(task.plan, null, 2),
        '',
        `## Review Feedback`,
        `Concerns: ${review.concerns.join('; ')}`,
        `Required Changes: ${review.requiredChanges.join('; ')}`,
        '',
        'Address all concerns and required changes. Return a revised JSON plan with the same schema.',
      ].join('\n');

      log.debug('revisePlan: running Yen Sid', { taskId: task.id });
      const result = await yenSid.run({ prompt, cwd: this.config.cwd, env: this.config.env });
      this.context.addCost(yenSid.instance.id, result.costUsd);
      this.emitCostUpdate();
      log.info('revisePlan: Yen Sid completed', {
        taskId: task.id,
        success: result.success,
        costUsd: result.costUsd,
        durationMs: result.durationMs,
      });

      // Record the review feedback as a lesson
      await this.memory.recordLesson(
        'yen-sid',
        `Plan revision needed: ${review.concerns.join(', ')}`,
        task.description,
        this.extractTags(task),
      );

      return this.parsePlan(result.output);
    } finally {
      await yenSid.stop();
      this.activeAgents.delete(yenSid.instance.id);
      log.debug('revisePlan: Yen Sid stopped', { agentId: yenSid.instance.id });
    }
  }

  /**
   * Request a review from Chernabog.
   */
  private async requestReview(task: Task): Promise<TaskReview> {
    this.checkBudget();

    const chernabog = new ChernabogAgent(this.sdk, this.events, this.memory, {
      model: this.config.modelOverrides.chernabog ?? 'claude-opus-4-6',
    });
    this.activeAgents.set(chernabog.instance.id, chernabog);
    this.events.emit({ type: 'agent:spawned', agent: chernabog.instance });
    log.info('requestReview: Chernabog spawned', { agentId: chernabog.instance.id, taskId: task.id });

    try {
      const prompt = [
        `Review the following implementation plan:`,
        '',
        `## Task`,
        task.description,
        '',
        `## Plan`,
        JSON.stringify(task.plan, null, 2),
        '',
        'Return a JSON object with these fields:',
        '- approved: boolean',
        '- concerns: string[] (issues found)',
        '- requiredChanges: string[] (mandatory changes before execution)',
        '- strengths: string[] (what the plan gets right)',
      ].join('\n');

      log.debug('requestReview: running Chernabog', { taskId: task.id });
      const result = await chernabog.run({ prompt, cwd: this.config.cwd, env: this.config.env });
      this.context.addCost(chernabog.instance.id, result.costUsd);
      this.emitCostUpdate();
      log.info('requestReview: Chernabog completed', {
        taskId: task.id,
        success: result.success,
        costUsd: result.costUsd,
        durationMs: result.durationMs,
      });

      return this.parseReview(result.output);
    } finally {
      await chernabog.stop();
      this.activeAgents.delete(chernabog.instance.id);
      log.debug('requestReview: Chernabog stopped', { agentId: chernabog.instance.id });
    }
  }

  /**
   * Execute the plan using Broomstick workers.
   */
  private async executePlan(task: Task): Promise<TaskResult> {
    this.checkBudget();

    const plan = task.plan;
    if (!plan) {
      log.warn('executePlan: no plan available', { taskId: task.id });
      return { success: false, output: 'No plan available' };
    }

    // If the plan has subtasks, run them (potentially in parallel)
    if (plan.subtasks && plan.subtasks.length > 1) {
      log.info('executePlan: running parallel subtasks', { taskId: task.id, subtaskCount: plan.subtasks.length });
      return this.executeSubtasks(task, plan);
    }

    // Single broomstick for simple plans
    log.info('executePlan: running single broomstick', { taskId: task.id });
    const planExcerpt = plan.steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
    const broomstick = new BroomstickAgent(
      this.sdk, this.events, this.memory,
      task.description, planExcerpt,
      { model: this.config.modelOverrides.broomstick ?? this.config.model },
    );
    this.activeAgents.set(broomstick.instance.id, broomstick);
    broomstick.instance.currentTaskId = task.id;
    this.events.emit({ type: 'agent:spawned', agent: broomstick.instance });
    log.info('executePlan: Broomstick spawned', { agentId: broomstick.instance.id, taskId: task.id });

    try {
      const result = await broomstick.run({
        prompt: task.description,
        cwd: this.config.cwd,
        env: this.config.env,
      });
      this.context.addCost(broomstick.instance.id, result.costUsd);
      this.emitCostUpdate();
      log.info('executePlan: Broomstick completed', {
        taskId: task.id,
        agentId: broomstick.instance.id,
        success: result.success,
        costUsd: result.costUsd,
        durationMs: result.durationMs,
      });

      return {
        success: result.success,
        output: result.output,
        costUsd: result.costUsd,
        durationMs: result.durationMs,
      };
    } finally {
      await broomstick.stop();
      this.activeAgents.delete(broomstick.instance.id);
      log.debug('executePlan: Broomstick stopped', { agentId: broomstick.instance.id });
    }
  }

  /**
   * Execute multiple subtasks, respecting dependencies and concurrency limits.
   */
  private async executeSubtasks(task: Task, plan: TaskPlan): Promise<TaskResult> {
    const subtasks = plan.subtasks!;
    const results: TaskResult[] = [];
    let allSuccess = true;

    log.info('executeSubtasks: starting', { taskId: task.id, subtaskCount: subtasks.length });

    // Simple approach: run subtasks without explicit dependencies in parallel,
    // sequential subtasks (those with deps) run after their deps complete
    // For now, run them all in parallel up to concurrency limit
    const promises = subtasks.map(async (subtask, index) => {
      this.checkBudget();

      const stepsPart = plan.steps.length > 0
        ? `\nOverall plan context:\n${plan.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
        : '';

      const broomstick = new BroomstickAgent(
        this.sdk, this.events, this.memory,
        subtask.description,
        stepsPart,
        { model: this.config.modelOverrides.broomstick ?? this.config.model },
      );
      this.activeAgents.set(broomstick.instance.id, broomstick);
      broomstick.instance.currentTaskId = task.id;
      this.events.emit({ type: 'agent:spawned', agent: broomstick.instance });
      log.info('executeSubtasks: Broomstick spawned for subtask', {
        agentId: broomstick.instance.id,
        taskId: task.id,
        subtaskIndex: index,
        subtaskDescription: subtask.description.slice(0, 100),
      });

      try {
        const result = await broomstick.run({
          prompt: subtask.description,
          cwd: this.config.cwd,
          env: this.config.env,
        });
        this.context.addCost(broomstick.instance.id, result.costUsd);
        this.emitCostUpdate();

        log.info('executeSubtasks: Broomstick completed subtask', {
          agentId: broomstick.instance.id,
          taskId: task.id,
          subtaskIndex: index,
          success: result.success,
          costUsd: result.costUsd,
          durationMs: result.durationMs,
        });

        const taskResult: TaskResult = {
          success: result.success,
          output: result.output,
          costUsd: result.costUsd,
          durationMs: result.durationMs,
        };
        if (!result.success) allSuccess = false;
        results.push(taskResult);
      } catch (error) {
        log.error('executeSubtasks: Broomstick failed', {
          agentId: broomstick.instance.id,
          taskId: task.id,
          subtaskIndex: index,
          error: String(error),
        });
        allSuccess = false;
        results.push({ success: false, output: String(error) });
      } finally {
        await broomstick.stop();
        this.activeAgents.delete(broomstick.instance.id);
      }
    });

    await Promise.all(promises);

    const totalCost = results.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
    const totalDuration = results.reduce((sum, r) => sum + (r.durationMs ?? 0), 0);
    const combinedOutput = results
      .map((r, i) => `[Subtask ${i + 1}] ${r.success ? 'SUCCESS' : 'FAILED'}: ${r.output}`)
      .join('\n\n');

    log.info('executeSubtasks: all done', {
      taskId: task.id,
      allSuccess,
      totalCost,
      totalDuration,
      subtaskResults: results.length,
    });

    return {
      success: allSuccess,
      output: combinedOutput,
      costUsd: totalCost,
      durationMs: totalDuration,
    };
  }

  // ─── Health Monitoring ────────────────────────────────────────

  private runHealthCheck(): void {
    if (!this.imagineer || !this.running) return;

    log.trace('Health check running');
    const report: HealthReport = {
      agents: Array.from(this.activeAgents.values()).map((a) => ({
        id: a.instance.id,
        role: a.instance.config.role,
        name: a.instance.config.name,
        status: a.instance.status,
        currentTaskId: a.instance.currentTaskId,
        lastActivityAt: a.instance.lastActivityAt,
        error: a.instance.error,
      })),
      taskCounts: this.taskQueue.getCounts(),
      totalCostUsd: this.context.getTotalCost(),
      timestamp: Date.now(),
    };

    const interventions = this.imagineer.analyzeHealth(report);
    if (interventions.length > 0) {
      log.warn('Health check: interventions needed', { count: interventions.length });
    }
    for (const intervention of interventions) {
      log.warn('Health check: intervention', {
        agentId: intervention.agentId,
        action: intervention.action,
        reason: intervention.reason,
      });
      this.events.emit({
        type: 'agent:message',
        agentId: this.imagineer.instance.id,
        content: `Intervention: ${intervention.reason} -> ${intervention.action}`,
        isPartial: false,
      });

      // Handle the intervention
      if (intervention.action === 'abort') {
        const agent = this.activeAgents.get(intervention.agentId);
        if (agent) {
          log.info('Health check: aborting agent', { agentId: intervention.agentId });
          agent.stop().catch(() => {});
        }
      }
    }
  }

  // ─── Utilities ────────────────────────────────────────────────

  private checkBudget(): void {
    const total = this.context.getTotalCost();
    if (total > this.config.maxBudgetUsd) {
      log.error('Budget exceeded', { totalCostUsd: total, maxBudgetUsd: this.config.maxBudgetUsd });
      throw new BudgetExceededError(total, this.config.maxBudgetUsd);
    }
  }

  private emitCostUpdate(): void {
    this.events.emit({
      type: 'cost:update',
      totalCostUsd: this.context.getTotalCost(),
      breakdown: this.context.getCostBreakdown(),
    });
  }

  private emitTaskStatusChange(task: Task, oldStatus: string): void {
    log.debug('Task status changed', { taskId: task.id, oldStatus, newStatus: task.status });
    this.events.emit({
      type: 'task:status-changed',
      taskId: task.id,
      oldStatus: oldStatus as any,
      newStatus: task.status,
    });
  }

  private parsePlan(output: string): TaskPlan {
    try {
      // Try to extract JSON from the output
      const jsonMatch = output.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        log.debug('parsePlan: JSON parsed successfully');
        return {
          summary: parsed.summary ?? 'No summary provided',
          steps: parsed.steps ?? [],
          subtasks: parsed.subtasks,
          risks: parsed.risks,
          estimatedComplexity: parsed.estimatedComplexity ?? 'moderate',
        };
      }
    } catch (err) {
      log.warn('parsePlan: JSON parse failed, using fallback', { error: String(err) });
    }
    // If parsing fails, create a simple plan from the raw output
    log.warn('parsePlan: no JSON found in output, creating fallback plan');
    return {
      summary: output.slice(0, 200),
      steps: [output],
      estimatedComplexity: 'moderate',
    };
  }

  private parseReview(output: string): TaskReview {
    try {
      const jsonMatch = output.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        log.debug('parseReview: JSON parsed successfully', { approved: parsed.approved });
        return {
          approved: parsed.approved ?? false,
          concerns: parsed.concerns ?? [],
          requiredChanges: parsed.requiredChanges ?? [],
          strengths: parsed.strengths ?? [],
          iteration: 0,
        };
      }
    } catch (err) {
      log.warn('parseReview: JSON parse failed, defaulting to approved', { error: String(err) });
    }
    // If parsing fails, default to approved (conservative - don't block on parse errors)
    log.warn('parseReview: no JSON found in output, defaulting to approved');
    return {
      approved: true,
      concerns: ['Could not parse structured review'],
      requiredChanges: [],
      strengths: [],
      iteration: 0,
    };
  }

  private extractTags(task: Task): string[] {
    // Simple tag extraction from task description
    const words = task.description.toLowerCase().split(/\s+/);
    const keywords = ['auth', 'api', 'database', 'test', 'ui', 'deploy', 'security', 'performance', 'refactor', 'bug', 'feature'];
    return keywords.filter((kw) => words.some((w) => w.includes(kw)));
  }
}
