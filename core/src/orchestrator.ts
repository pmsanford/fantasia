import type {
  OrchestratorConfig,
  SdkAdapter,
  Task,
  TaskPlan,
  TaskReview,
  TaskResult,
  ReconReport,
  AgentRole,
  AgentMessage,
  SDKUserMessage,
  FantasiaEvent,
  FantasiaEventType,
} from './types.js';
import { FantasiaEventEmitter } from './events/event-emitter.js';
import { MessageBus } from './messaging/message-bus.js';
import { TaskQueue } from './task/task-queue.js';
import { NotificationBus } from './notifications/notification-bus.js';
import type { NotificationBatch } from './notifications/notification-bus.js';
import { ContextStore } from './context/context-store.js';
import { MemoryStore } from './memory/memory-store.js';
import { MemoryManager } from './memory/memory-manager.js';
import { SessionPool } from './sdk/session-pool.js';
import { MickeyAgent } from './agents/mickey.js';
import { YenSidAgent } from './agents/yen-sid.js';
import { ChernabogAgent } from './agents/chernabog.js';
import { BroomstickAgent } from './agents/broomstick.js';
import { ImagineerAgent } from './agents/imagineer.js';
import { JacchusAgent } from './agents/jacchus.js';
import type { HealthReport } from './agents/imagineer.js';
import { createFantasiaTools } from './tools/fantasia-tools.js';
import { createMilestoneTools } from './tools/milestone-tools.js';
import { MilestoneTracker } from './milestones/milestone-tracker.js';
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

    // Set up notification bus for this submit session
    const notificationBus = new NotificationBus(this.events);
    notificationBus.start();

    const queueNotification = (batch: NotificationBatch) => {
      const message = formatNotificationBatch(batch);
      if (message && this.mickey) {
        this.mickey.sendNotification(message).catch((err) => {
          log.warn('Submit: failed to deliver notification to Mickey', { error: String(err) });
        });
      }
    };

    // Create Mickey's MCP tools with event subscription support
    const fantasiaTools = createFantasiaTools(this.sdk, {
      taskQueue: this.taskQueue,
      onDelegateTask: (description, priority, simple) => this.handleDelegateTask(description, priority as any, simple),
      onSubscribeEvents: (eventTypes: string[]) => {
        return notificationBus.subscribe(
          this.mickey!.instance.id,
          eventTypes as FantasiaEventType[],
          queueNotification,
        );
      },
      onUnsubscribeEvents: (subscriptionId: string) => {
        return notificationBus.unsubscribe(subscriptionId);
      },
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

    // Clean up notification bus
    notificationBus.stop();

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
   * Simple tasks go directly to a Broomstick.
   * Complex tasks go through the full Yen Sid -> Chernabog -> Broomstick pipeline.
   */
  private async handleDelegateTask(description: string, priority: 'critical' | 'high' | 'normal' | 'low', simple: boolean): Promise<string> {
    const task = createTask({
      id: crypto.randomUUID(),
      description,
      createdBy: this.mickey?.instance.id ?? 'orchestrator',
      priority,
    });
    this.taskQueue.add(task);
    this.events.emit({ type: 'task:created', task });
    log.info('Task delegated', { taskId: task.id, priority, simple, descriptionLength: description.length });
    log.debug('Task delegated details', { taskId: task.id, description });

    // Run the appropriate pipeline asynchronously so Mickey isn't blocked
    const pipeline = simple
      ? this.runSimpleTaskPipeline(task.id)
      : this.runTaskPipeline(task.id);

    pipeline.catch((error) => {
      log.error('Task pipeline failed with unhandled error', { taskId: task.id, error: String(error) });
      this.events.emit({ type: 'orchestrator:error', error: error as Error });
    });

    return task.id;
  }

  /**
   * Simple task pipeline: direct to a single Broomstick, no planning or review.
   */
  private async runSimpleTaskPipeline(taskId: string): Promise<void> {
    let task = this.taskQueue.get(taskId);
    if (!task) {
      log.warn('runSimpleTaskPipeline: task not found', { taskId });
      return;
    }

    log.info('Simple pipeline: starting', { taskId, description: task.description.slice(0, 100) });

    try {
      task = transitionTask(task, 'in-progress');
      this.taskQueue.update(task);
      this.emitTaskStatusChange(task, 'pending');

      const result = await this.executePlan(task);
      task = completeTask(task, result);
      this.taskQueue.update(task);

      if (result.success) {
        this.events.emit({ type: 'task:completed', taskId: task.id, result });
        log.info('Simple pipeline: completed successfully', { taskId });
      } else {
        this.events.emit({ type: 'task:failed', taskId: task.id, error: result.output });
        log.warn('Simple pipeline: failed', { taskId, error: result.output.slice(0, 200) });
      }
    } catch (error) {
      task = this.taskQueue.get(taskId) ?? task;
      const result: TaskResult = {
        success: false,
        output: `Pipeline error: ${error}`,
      };
      try {
        task = completeTask(task, result);
      } catch {
        task = { ...task, status: 'failed', result, updatedAt: Date.now() };
      }
      this.taskQueue.update(task);
      this.events.emit({ type: 'task:failed', taskId: task.id, error: String(error) });
      log.error('Simple pipeline: unhandled error', { taskId, error: String(error) });
    }
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
        workstreamCount: plan.workstreams?.length ?? 0,
        hasContext: !!plan.context,
        complexity: plan.estimatedComplexity,
      });

      // Phase 2: Review (Chernabog) + Recon (Jacchus) in parallel
      log.info('Pipeline: phase 2 - reviewing + recon', { taskId });
      task = transitionTask(task, 'reviewing');
      this.taskQueue.update(task);
      this.emitTaskStatusChange(task, 'planning');

      let planWasRevised = false;

      // Launch recon in parallel with review (non-fatal if it fails)
      const reconPromise = this.requestRecon(task).catch((err) => {
        log.warn('Pipeline: recon failed, proceeding without', { taskId, error: String(err) });
        return null;
      });

      // Review loop
      const reviewPromise = (async () => {
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
            planWasRevised = true;
            log.info('Pipeline: plan revised', { taskId, summary: plan.summary.slice(0, 100) });
          } else {
            log.warn('Pipeline: max review iterations reached, proceeding with unapproved plan', { taskId });
          }
        }
      })();

      // Wait for both review and recon to complete
      const [reconResult] = await Promise.all([reconPromise, reviewPromise]);

      // Attach recon to task
      if (reconResult) {
        if (planWasRevised) {
          reconResult.potentiallyStale = true;
          log.info('Pipeline: recon marked as potentially stale (plan was revised)', { taskId });
        }
        task = { ...task, recon: reconResult, updatedAt: Date.now() };
        this.taskQueue.update(task);
        log.info('Pipeline: recon attached', {
          taskId,
          commonFiles: reconResult.sharedContext.commonFiles.length,
          subtaskRecon: reconResult.subtaskRecon.length,
          potentiallyStale: reconResult.potentiallyStale,
        });
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
        '- context: string (key findings for workers: architectural decisions, important file paths, patterns to follow, gotchas — concise but enough to avoid redundant exploration)',
        '- workstreams: Array<{name: string, description: string, dependencies?: string[], emits?: Array<{id: string, description: string}>, waitsFor?: Array<{id: string, description: string}>}> (coherent streams of related work, each handled by one worker agent. Group tightly-coupled changes together. Use emits/waitsFor for fine-grained milestone dependencies when one workstream produces an artifact another needs mid-execution — e.g. emits: [{id: "api-types-defined", description: "After writing type definitions to src/types/api.ts"}]. Milestone IDs must be short kebab-case strings. Only use milestones for true data dependencies, not ordering preference.)',
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
        'Address all concerns and required changes. Return a revised JSON plan with the same schema (summary, steps, context, workstreams with optional emits/waitsFor milestone arrays, risks, estimatedComplexity).',
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
   * Request codebase reconnaissance from Jacchus, running in parallel with review.
   */
  private async requestRecon(task: Task): Promise<ReconReport> {
    this.checkBudget();

    const jacchus = new JacchusAgent(this.sdk, this.events, this.memory, {
      model: this.config.modelOverrides.jacchus ?? 'claude-sonnet-4-6',
    });
    this.activeAgents.set(jacchus.instance.id, jacchus);
    this.events.emit({ type: 'agent:spawned', agent: jacchus.instance });
    log.info('requestRecon: Jacchus spawned', { agentId: jacchus.instance.id, taskId: task.id });

    try {
      const plan = task.plan!;
      const prompt = [
        `Explore the codebase and gather reconnaissance for the following task and plan:`,
        '',
        `## Task`,
        task.description,
        '',
        `## Plan Summary`,
        plan.summary,
        '',
        `## Plan Steps`,
        plan.steps.map((s, i) => `${i + 1}. ${s}`).join('\n'),
        '',
        `## Workstreams to Scout For`,
        ...(plan.workstreams ?? []).map((ws, i) =>
          `${i + 1}. **${ws.name}**: ${ws.description}${ws.dependencies?.length ? ` (depends on: ${ws.dependencies.join(', ')})` : ''}`
        ),
        '',
        'Return a JSON recon report with sharedContext and subtaskRecon arrays.',
      ].join('\n');

      log.debug('requestRecon: running Jacchus', { taskId: task.id });
      const result = await jacchus.run({ prompt, cwd: this.config.cwd, env: this.config.env });
      this.context.addCost(jacchus.instance.id, result.costUsd);
      this.emitCostUpdate();

      log.info('requestRecon: Jacchus completed', {
        taskId: task.id,
        agentId: jacchus.instance.id,
        success: result.success,
        costUsd: result.costUsd,
        durationMs: result.durationMs,
      });

      return this.parseReconReport(result.output);
    } finally {
      await jacchus.stop();
      this.activeAgents.delete(jacchus.instance.id);
      log.debug('requestRecon: Jacchus stopped', { agentId: jacchus.instance.id });
    }
  }

  private parseReconReport(output: string): ReconReport {
    try {
      const jsonMatch = output.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          sharedContext: parsed.sharedContext ?? { commonFiles: [], patterns: [], constraints: [] },
          subtaskRecon: parsed.subtaskRecon ?? [],
          potentiallyStale: false,
        };
      }
    } catch {
      log.warn('parseReconReport: failed to parse JSON, returning empty report');
    }
    return {
      sharedContext: { commonFiles: [], patterns: [], constraints: [] },
      subtaskRecon: [],
      potentiallyStale: false,
    };
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

    // If the plan has multiple workstreams, run them in parallel
    if (plan.workstreams && plan.workstreams.length > 1) {
      log.info('executePlan: running parallel workstreams', { taskId: task.id, workstreamCount: plan.workstreams.length });
      return this.executeWorkstreams(task, plan);
    }

    // Single broomstick for simple plans or single workstream
    log.info('executePlan: running single broomstick', { taskId: task.id });
    const planExcerpt = this.formatPlanExcerpt(plan);
    const broomstick = new BroomstickAgent(
      this.sdk, this.events, this.memory,
      task.description, planExcerpt, task.recon,
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
   * Format plan steps and context into an excerpt for broomstick prompts.
   */
  private formatPlanExcerpt(plan: TaskPlan): string {
    const parts: string[] = [];
    if (plan.context) {
      parts.push('## Context from Architect', plan.context, '');
    }
    if (plan.steps.length > 0) {
      parts.push('## Steps');
      parts.push(plan.steps.map((s, i) => `${i + 1}. ${s}`).join('\n'));
    }
    return parts.join('\n');
  }

  /**
   * Execute workstreams in parallel, one broomstick per workstream.
   */
  private async executeWorkstreams(task: Task, plan: TaskPlan): Promise<TaskResult> {
    const workstreams = plan.workstreams!;
    const results: TaskResult[] = [];
    let allSuccess = true;

    log.info('executeWorkstreams: starting', { taskId: task.id, workstreamCount: workstreams.length });

    const planExcerpt = this.formatPlanExcerpt(plan);

    // Shared milestone tracker for coordinating workstreams within this task
    const hasMilestones = workstreams.some(ws => ws.emits?.length || ws.waitsFor?.length);
    const milestoneTracker = hasMilestones ? new MilestoneTracker(this.events) : null;
    if (milestoneTracker) {
      log.info('executeWorkstreams: milestone coordination enabled', { taskId: task.id });
    }

    const promises = workstreams.map(async (workstream, index) => {
      this.checkBudget();

      // Find matching workstream recon by name or description
      const wsRecon = task.recon?.subtaskRecon?.find(
        r => r.subtaskDescription === workstream.name || r.subtaskDescription === workstream.description
      );
      const reconForBroomstick: ReconReport | undefined = task.recon ? {
        ...task.recon,
        subtaskRecon: wsRecon ? [wsRecon] : [],
      } : undefined;

      const wsMilestones = (workstream.emits?.length || workstream.waitsFor?.length)
        ? { emits: workstream.emits, waitsFor: workstream.waitsFor }
        : undefined;

      const broomstick = new BroomstickAgent(
        this.sdk, this.events, this.memory,
        workstream.description,
        planExcerpt,
        reconForBroomstick,
        { model: this.config.modelOverrides.broomstick ?? this.config.model },
        wsMilestones,
      );
      this.activeAgents.set(broomstick.instance.id, broomstick);
      broomstick.instance.currentTaskId = task.id;
      this.events.emit({ type: 'agent:spawned', agent: broomstick.instance });
      log.info('executeWorkstreams: Broomstick spawned for workstream', {
        agentId: broomstick.instance.id,
        taskId: task.id,
        workstreamIndex: index,
        workstreamName: workstream.name,
        emits: workstream.emits?.map(m => m.id),
        waitsFor: workstream.waitsFor?.map(m => m.id),
      });

      // Build run options, attaching milestone MCP tools if needed
      const runOptions: Parameters<typeof broomstick.run>[0] = {
        prompt: workstream.description,
        cwd: this.config.cwd,
        env: this.config.env,
      };
      if (wsMilestones && milestoneTracker) {
        const { server: milestoneServer } = createMilestoneTools(this.sdk, milestoneTracker, workstream.name);
        runOptions.extraSdkOptions = {
          mcpServers: { milestones: milestoneServer },
        };
      }

      try {
        const result = await broomstick.run(runOptions);
        this.context.addCost(broomstick.instance.id, result.costUsd);
        this.emitCostUpdate();

        // Auto-emit any milestones this workstream declared but forgot to emit,
        // so dependent workstreams aren't left waiting after a successful completion.
        if (milestoneTracker && result.success && workstream.emits) {
          for (const m of workstream.emits) {
            if (!milestoneTracker.getReached().includes(m.id)) {
              log.warn('executeWorkstreams: auto-emitting forgotten milestone', {
                milestoneId: m.id,
                workstreamName: workstream.name,
              });
              milestoneTracker.emit(m.id, workstream.name);
            }
          }
        }

        log.info('executeWorkstreams: Broomstick completed workstream', {
          agentId: broomstick.instance.id,
          taskId: task.id,
          workstreamIndex: index,
          workstreamName: workstream.name,
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
        log.error('executeWorkstreams: Broomstick failed', {
          agentId: broomstick.instance.id,
          taskId: task.id,
          workstreamIndex: index,
          workstreamName: workstream.name,
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
    milestoneTracker?.dispose();

    const totalCost = results.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
    const totalDuration = results.reduce((sum, r) => sum + (r.durationMs ?? 0), 0);
    const combinedOutput = workstreams
      .map((ws, i) => `[${ws.name}] ${results[i]?.success ? 'SUCCESS' : 'FAILED'}: ${results[i]?.output ?? 'No result'}`)
      .join('\n\n');

    log.info('executeWorkstreams: all done', {
      taskId: task.id,
      allSuccess,
      totalCost,
      totalDuration,
      workstreamResults: results.length,
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
          context: parsed.context,
          workstreams: parsed.workstreams,
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

// ─── Notification Formatting ─────────────────────────────────────

function formatNotificationBatch(batch: NotificationBatch): string | null {
  if (batch.events.length === 0) return null;

  const lines: string[] = ['[System Notification] The following events occurred:'];

  for (const event of batch.events) {
    switch (event.type) {
      case 'task:completed': {
        const e = event as Extract<FantasiaEvent, { type: 'task:completed' }>;
        lines.push(`- Task ${e.taskId.slice(0, 8)} completed successfully.`);
        if (e.result.output) {
          lines.push(`  Result: ${e.result.output.slice(0, 300)}`);
        }
        break;
      }
      case 'task:failed': {
        const e = event as Extract<FantasiaEvent, { type: 'task:failed' }>;
        lines.push(`- Task ${e.taskId.slice(0, 8)} failed: ${e.error.slice(0, 200)}`);
        break;
      }
      case 'task:status-changed': {
        const e = event as Extract<FantasiaEvent, { type: 'task:status-changed' }>;
        lines.push(`- Task ${e.taskId.slice(0, 8)}: ${e.oldStatus} → ${e.newStatus}`);
        break;
      }
      case 'task:created': {
        const e = event as Extract<FantasiaEvent, { type: 'task:created' }>;
        lines.push(`- New task created: ${e.task.description.slice(0, 100)}`);
        break;
      }
      case 'agent:spawned': {
        const e = event as Extract<FantasiaEvent, { type: 'agent:spawned' }>;
        lines.push(`- Agent spawned: ${e.agent.config.name} (${e.agent.config.role})`);
        break;
      }
      case 'agent:terminated': {
        const e = event as Extract<FantasiaEvent, { type: 'agent:terminated' }>;
        lines.push(`- Agent ${e.agentId.slice(0, 8)} terminated${e.reason ? `: ${e.reason}` : ''}`);
        break;
      }
      case 'cost:update': {
        const e = event as Extract<FantasiaEvent, { type: 'cost:update' }>;
        lines.push(`- Cost update: $${e.totalCostUsd.toFixed(4)}`);
        break;
      }
      default:
        lines.push(`- ${event.type}`);
    }
  }

  lines.push('');
  lines.push('Use get_task_result to retrieve full results for completed tasks. You do NOT need to poll — you will continue receiving notifications for events you subscribed to.');

  return lines.join('\n');
}
