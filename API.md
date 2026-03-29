# Fantasia API Reference

Fantasia is a multi-agent orchestration system built on the Claude Agent SDK. It
consists of a **core library** (`core/`) and a **gRPC server** (`server/`) that
exposes the core library over Connect RPC on a Unix domain socket.

---

## Table of Contents

- [Server Protocol](#server-protocol)
- [Proto Services](#proto-services)
  - [OrchestratorService](#orchestratorservice)
  - [TaskService](#taskservice)
  - [MemoryService](#memoryservice)
  - [EventService](#eventservice)
- [Proto Types](#proto-types)
  - [Enums](#enums)
  - [Messages](#messages)
  - [Event Payloads](#event-payloads)
- [Error Handling](#error-handling)
- [Core Library API](#core-library-api)
  - [Orchestrator](#orchestrator)
  - [Agent System](#agent-system)
  - [Task System](#task-system)
  - [Memory System](#memory-system)
  - [Event System](#event-system)
  - [Context Store](#context-store)
  - [Session Pool](#session-pool)
  - [Message Bus](#message-bus)
  - [Fantasia Tools](#fantasia-tools)
  - [Error Classes](#error-classes)

---

## Server Protocol

- **Transport:** Connect RPC (HTTP/1.1, **not** HTTP/2 gRPC)
- **Socket:** Unix domain socket at `/tmp/fantasia.sock`
  (configurable via `FANTASIA_SOCKET` env var or CLI argument)
- **Wire format:** Binary protobuf
- **Entry point:** `server/src/index.ts`

### Unary RPCs

```
POST /{package}.{Service}/{Method}
Content-Type: application/proto
Connect-Protocol-Version: 1
Body: raw protobuf bytes (no envelope)
Response: raw protobuf bytes
```

### Server-Streaming RPCs

```
POST /{package}.{Service}/{Method}
Content-Type: application/connect+proto
Connect-Protocol-Version: 1
Body: 5-byte envelope + protobuf bytes
  - byte 0: flags (0x00 = data frame)
  - bytes 1-4: big-endian uint32 message length
  - followed by message bytes
Response: chunked stream of envelope-framed messages
  - flags 0x00 = data frame, 0x02 = end-stream trailers
```

---

## Proto Services

### OrchestratorService

**Path prefix:** `/fantasia.v1.OrchestratorService/`

#### Initialize

Start the orchestrator. Must be called before other RPCs.

```
rpc Initialize(InitializeRequest) returns (InitializeResponse)
```

| Field | Type | Description |
|-------|------|-------------|
| `config` | `OrchestratorConfig` | Orchestrator configuration (all fields optional) |

**Response:** empty.

**Errors:**
- `AlreadyExists` — orchestrator already initialized (call `Stop` first)

**Side effects:** Creates orchestrator instance, starts Mickey and Imagineer agents, emits `orchestrator:ready`.

---

#### Submit

Send a user message to Mickey.

```
rpc Submit(SubmitRequest) returns (SubmitResponse)
```

| Field | Type | Description |
|-------|------|-------------|
| `user_message` | `string` | The user's message or instruction |

**Response:** empty (processing is asynchronous; watch events for results).

**Errors:**
- `FailedPrecondition` — not initialized
- `ResourceExhausted` — budget exceeded

---

#### Stop

Gracefully shut down the orchestrator.

```
rpc Stop(StopRequest) returns (StopResponse)
```

**Request/Response:** empty.

**Side effects:** Terminates all agents, clears sessions, resets event sequence counter, emits `orchestrator:stopped`.

---

#### GetStatus

Get a snapshot of current orchestrator state.

```
rpc GetStatus(GetStatusRequest) returns (GetStatusResponse)
```

**Response:**

| Field | Type | Description |
|-------|------|-------------|
| `running` | `bool` | Always `true` if initialized |
| `agents` | `repeated AgentInstance` | All active agents |
| `task_counts` | `TaskCounts` | Counts by status category |

---

#### GetCost

Get accumulated cost information.

```
rpc GetCost(GetCostRequest) returns (GetCostResponse)
```

**Response:**

| Field | Type | Description |
|-------|------|-------------|
| `cost` | `CostBreakdown` | Total and per-agent cost breakdown |

---

### TaskService

**Path prefix:** `/fantasia.v1.TaskService/`

#### GetTask

```
rpc GetTask(GetTaskRequest) returns (GetTaskResponse)
```

| Field | Type | Description |
|-------|------|-------------|
| `task_id` | `string` | Task UUID |

**Response:** `task: Task` (may be null if not found).

---

#### ListTasks

```
rpc ListTasks(ListTasksRequest) returns (ListTasksResponse)
```

**Response:** `tasks: repeated Task` — all tasks in the queue.

---

#### GetTaskCounts

```
rpc GetTaskCounts(GetTaskCountsRequest) returns (GetTaskCountsResponse)
```

**Response:** `counts: TaskCounts`.

---

### MemoryService

**Path prefix:** `/fantasia.v1.MemoryService/`

#### Remember

Store a new memory entry.

```
rpc Remember(RememberRequest) returns (RememberResponse)
```

| Field | Type | Description |
|-------|------|-------------|
| `agent_role` | `AgentRole` | Which agent this memory belongs to |
| `type` | `MemoryType` | `LESSON`, `REJECTION`, `PREFERENCE`, or `PATTERN` |
| `content` | `string` | The memory content |
| `context` | `string` | Context where memory is relevant |
| `tags` | `repeated string` | Categorization tags |

**Response:** `entry: MemoryEntry` — the created entry with assigned ID and timestamp.

---

#### Forget

Delete a memory entry by ID.

```
rpc Forget(ForgetRequest) returns (ForgetResponse)
```

| Field | Type |
|-------|------|
| `id` | `string` |

**Response:** `deleted: bool`.

---

#### Recall

Retrieve memories for a given agent role, optionally filtered by tags.

```
rpc Recall(RecallRequest) returns (RecallResponse)
```

| Field | Type | Description |
|-------|------|-------------|
| `role` | `AgentRole` | Agent to recall for |
| `tags` | `repeated string` | Optional tag filter (empty = all) |

**Response:** `entries: repeated MemoryEntry` — sorted by tag overlap + recency.

---

#### RecordApproval

Record that an agent's plan was approved. Creates a `PREFERENCE`-type entry.

```
rpc RecordApproval(RecordApprovalRequest) returns (RecordApprovalResponse)
```

| Field | Type |
|-------|------|
| `agent_role` | `AgentRole` |
| `plan_summary` | `string` |
| `tags` | `repeated string` |

---

#### RecordRejection

Record that an agent's suggestion was rejected. Creates a `REJECTION`-type entry.

```
rpc RecordRejection(RecordRejectionRequest) returns (RecordRejectionResponse)
```

| Field | Type |
|-------|------|
| `agent_role` | `AgentRole` |
| `suggestion` | `string` |
| `reason` | `string` |
| `tags` | `repeated string` |

---

#### RecordLesson

Record a lesson learned. Creates a `LESSON`-type entry.

```
rpc RecordLesson(RecordLessonRequest) returns (RecordLessonResponse)
```

| Field | Type |
|-------|------|
| `agent_role` | `AgentRole` |
| `lesson` | `string` |
| `context` | `string` |
| `tags` | `repeated string` |

---

#### Prune

Remove old/low-relevance memories.

```
rpc Prune(PruneRequest) returns (PruneResponse)
```

| Field | Type | Description |
|-------|------|-------------|
| `max_per_role` | `optional int32` | Max memories to keep per role |

**Response:** `pruned_count: int32`.

---

#### GetAll

Return every memory entry.

```
rpc GetAll(GetAllMemoriesRequest) returns (GetAllMemoriesResponse)
```

**Response:** `entries: repeated MemoryEntry`.

---

### EventService

**Path prefix:** `/fantasia.v1.EventService/`

#### Subscribe

Server-streaming RPC. Streams events matching a filter.

```
rpc Subscribe(SubscribeRequest) returns (stream FantasiaEvent)
```

| Field | Type | Description |
|-------|------|-------------|
| `event_types` | `repeated string` | Filter by payload field name (empty = all) |
| `include_history` | `bool` | Replay historical events before streaming live |
| `after_sequence` | `optional uint64` | If set with `include_history`, only replay events after this sequence |

**Behavior:**
1. If `include_history`: replays historical events (optionally after `after_sequence`).
2. Subscribes to live events via `orchestrator.events.onAny()`.
3. Each event gets an incrementing `sequence` number.
4. Stream ends when the orchestrator stops or the client disconnects.

**Filter values** for `event_types` are the proto oneof field names:
`agent_spawned`, `agent_status_changed`, `agent_terminated`, `agent_message`,
`task_created`, `task_status_changed`, `task_completed`, `task_failed`,
`orchestrator_ready`, `orchestrator_error`, `orchestrator_stopped`,
`user_input_needed`, `cost_update`, `sdk_message`.

---

#### GetHistory

Non-streaming history fetch.

```
rpc GetHistory(GetHistoryRequest) returns (GetHistoryResponse)
```

| Field | Type | Description |
|-------|------|-------------|
| `limit` | `optional int32` | Max events to return |

**Response:** `events: repeated FantasiaEvent`.

---

## Proto Types

### Enums

#### AgentRole

| Value | Number | Core string |
|-------|--------|-------------|
| `AGENT_ROLE_UNSPECIFIED` | 0 | — |
| `AGENT_ROLE_MICKEY` | 1 | `mickey` |
| `AGENT_ROLE_YEN_SID` | 2 | `yen-sid` |
| `AGENT_ROLE_CHERNABOG` | 3 | `chernabog` |
| `AGENT_ROLE_BROOMSTICK` | 4 | `broomstick` |
| `AGENT_ROLE_IMAGINEER` | 5 | `imagineer` |

#### AgentStatus

| Value | Number | Core string |
|-------|--------|-------------|
| `AGENT_STATUS_UNSPECIFIED` | 0 | — |
| `AGENT_STATUS_IDLE` | 1 | `idle` |
| `AGENT_STATUS_WORKING` | 2 | `working` |
| `AGENT_STATUS_WAITING` | 3 | `waiting` |
| `AGENT_STATUS_ERROR` | 4 | `error` |
| `AGENT_STATUS_TERMINATED` | 5 | `terminated` |

#### TaskStatus

| Value | Number | Core string |
|-------|--------|-------------|
| `TASK_STATUS_UNSPECIFIED` | 0 | — |
| `TASK_STATUS_PENDING` | 1 | `pending` |
| `TASK_STATUS_PLANNING` | 2 | `planning` |
| `TASK_STATUS_REVIEWING` | 3 | `reviewing` |
| `TASK_STATUS_IN_PROGRESS` | 4 | `in-progress` |
| `TASK_STATUS_BLOCKED` | 5 | `blocked` |
| `TASK_STATUS_COMPLETED` | 6 | `completed` |
| `TASK_STATUS_FAILED` | 7 | `failed` |

#### TaskPriority

| Value | Number | Core string |
|-------|--------|-------------|
| `TASK_PRIORITY_UNSPECIFIED` | 0 | — |
| `TASK_PRIORITY_CRITICAL` | 1 | `critical` |
| `TASK_PRIORITY_HIGH` | 2 | `high` |
| `TASK_PRIORITY_NORMAL` | 3 | `normal` |
| `TASK_PRIORITY_LOW` | 4 | `low` |

#### MemoryType

| Value | Number | Core string |
|-------|--------|-------------|
| `MEMORY_TYPE_UNSPECIFIED` | 0 | — |
| `MEMORY_TYPE_LESSON` | 1 | `lesson` |
| `MEMORY_TYPE_REJECTION` | 2 | `rejection` |
| `MEMORY_TYPE_PREFERENCE` | 3 | `preference` |
| `MEMORY_TYPE_PATTERN` | 4 | `pattern` |

#### EstimatedComplexity

| Value | Number | Core string |
|-------|--------|-------------|
| `ESTIMATED_COMPLEXITY_UNSPECIFIED` | 0 | — |
| `ESTIMATED_COMPLEXITY_TRIVIAL` | 1 | `trivial` |
| `ESTIMATED_COMPLEXITY_SIMPLE` | 2 | `simple` |
| `ESTIMATED_COMPLEXITY_MODERATE` | 3 | `moderate` |
| `ESTIMATED_COMPLEXITY_COMPLEX` | 4 | `complex` |

---

### Messages

#### OrchestratorConfig

| Tag | Field | Type | Description |
|-----|-------|------|-------------|
| 1 | `model` | `optional string` | Default LLM model (default: `claude-sonnet-4-6`) |
| 2 | `cwd` | `optional string` | Working directory |
| 3 | `allowed_tools` | `repeated string` | Default allowed tools |
| 4 | `permission_mode` | `optional string` | Permission mode (default: `bypassPermissions`) |
| 5 | `max_concurrent_broomsticks` | `optional int32` | Max parallel workers (default: 5) |
| 6 | `max_budget_usd` | `optional double` | Session cost limit (default: 10.0) |
| 7 | `env` | `map<string, string>` | Environment variables |
| 8 | `memory_dir` | `optional string` | Memory persistence directory (default: `.fantasia/memory`) |
| 9 | `model_overrides` | `map<string, string>` | Role name → model override |
| 10 | `enabled_agents` | `map<string, bool>` | Role name → enabled flag |

#### AgentConfig

| Tag | Field | Type | Description |
|-----|-------|------|-------------|
| 1 | `role` | `AgentRole` | |
| 2 | `name` | `string` | Display name |
| 3 | `system_prompt` | `string` | |
| 4 | `model` | `string` | LLM model |
| 5 | `tools` | `repeated string` | Tool names (when not using a preset) |
| 6 | `disallowed_tools` | `repeated string` | |
| 7 | `allowed_tools` | `repeated string` | |
| 8 | `max_turns` | `optional uint32` | |
| 9 | `max_budget_usd` | `optional double` | |
| 10 | `effort` | `optional string` | |
| 11 | `output_format` | `optional string` | |
| 12 | `persist_session` | `optional bool` | |
| 13 | `permission_mode` | `optional string` | |
| 14 | `tools_preset` | `optional string` | e.g. `claude_code` |

#### AgentInstance

| Tag | Field | Type |
|-----|-------|------|
| 1 | `id` | `string` |
| 2 | `config` | `AgentConfig` |
| 3 | `status` | `AgentStatus` |
| 4 | `current_task_id` | `optional string` |
| 5 | `session_id` | `optional string` |
| 6 | `started_at` | `int64` (unix ms) |
| 7 | `last_activity_at` | `int64` (unix ms) |
| 8 | `error` | `optional string` |

#### Task

| Tag | Field | Type |
|-----|-------|------|
| 1 | `id` | `string` |
| 2 | `parent_id` | `optional string` |
| 3 | `description` | `string` |
| 4 | `status` | `TaskStatus` |
| 5 | `priority` | `TaskPriority` |
| 6 | `assigned_agent_id` | `optional string` |
| 7 | `created_by` | `string` |
| 8 | `plan` | `optional TaskPlan` |
| 9 | `review` | `optional TaskReview` |
| 10 | `result` | `optional TaskResult` |
| 11 | `subtask_ids` | `repeated string` |
| 12 | `created_at` | `int64` (unix ms) |
| 13 | `updated_at` | `int64` (unix ms) |
| 14 | `metadata_json` | `bytes` (JSON-encoded `Record<string, unknown>`) |

#### TaskPlan

| Tag | Field | Type |
|-----|-------|------|
| 1 | `summary` | `string` |
| 2 | `steps` | `repeated string` |
| 3 | `subtasks` | `repeated SubtaskDef` |
| 4 | `risks` | `repeated string` |
| 5 | `estimated_complexity` | `EstimatedComplexity` |

#### SubtaskDef

| Tag | Field | Type |
|-----|-------|------|
| 1 | `description` | `string` |
| 2 | `dependencies` | `repeated string` |

#### TaskReview

| Tag | Field | Type |
|-----|-------|------|
| 1 | `approved` | `bool` |
| 2 | `concerns` | `repeated string` |
| 3 | `required_changes` | `repeated string` |
| 4 | `strengths` | `repeated string` |
| 5 | `iteration` | `int32` |

#### TaskResult

| Tag | Field | Type |
|-----|-------|------|
| 1 | `success` | `bool` |
| 2 | `output` | `string` |
| 3 | `artifacts` | `repeated string` |
| 4 | `cost_usd` | `optional double` |
| 5 | `duration_ms` | `optional int64` |
| 6 | `token_usage_json` | `bytes` (JSON) |
| 7 | `model_usage_json` | `bytes` (JSON) |

#### MemoryEntry

| Tag | Field | Type |
|-----|-------|------|
| 1 | `id` | `string` |
| 2 | `agent_role` | `AgentRole` |
| 3 | `type` | `MemoryType` |
| 4 | `content` | `string` |
| 5 | `context` | `string` |
| 6 | `tags` | `repeated string` |
| 7 | `timestamp` | `int64` (unix ms) |
| 8 | `relevance_score` | `optional double` |

#### TaskCounts

| Tag | Field | Type | Description |
|-----|-------|------|-------------|
| 1 | `pending` | `int32` | `PENDING` |
| 2 | `active` | `int32` | `PLANNING` + `REVIEWING` + `IN_PROGRESS` + `BLOCKED` |
| 3 | `completed` | `int32` | `COMPLETED` |
| 4 | `failed` | `int32` | `FAILED` |
| 5 | `total` | `int32` | Sum of all |

#### CostBreakdown

| Tag | Field | Type |
|-----|-------|------|
| 1 | `total_cost_usd` | `double` |
| 2 | `by_agent` | `map<string, double>` |

---

### Event Payloads

#### FantasiaEvent (wrapper)

| Tag | Field | Type |
|-----|-------|------|
| 1 | `timestamp` | `int64` (unix ms) |
| 2 | `sequence` | `uint64` (incrementing) |
| 10–41 | `payload` | oneof (see below) |

#### Payload oneof

| Tag | Field name | Message | Description |
|-----|-----------|---------|-------------|
| 10 | `agent_spawned` | `AgentSpawnedEvent` | Agent instance created |
| 11 | `agent_status_changed` | `AgentStatusChangedEvent` | Agent state transition |
| 12 | `agent_terminated` | `AgentTerminatedEvent` | Agent shut down |
| 13 | `agent_message` | `AgentMessageEvent` | Agent text output (may be partial/streaming) |
| 20 | `task_created` | `TaskCreatedEvent` | New task enqueued |
| 21 | `task_status_changed` | `TaskStatusChangedEvent` | Task state transition |
| 22 | `task_completed` | `TaskCompletedEvent` | Task finished successfully |
| 23 | `task_failed` | `TaskFailedEvent` | Task failed |
| 30 | `orchestrator_ready` | `OrchestratorReadyEvent` | Server ready |
| 31 | `orchestrator_error` | `OrchestratorErrorEvent` | Server error |
| 32 | `orchestrator_stopped` | `OrchestratorStoppedEvent` | Server shutting down |
| 33 | `user_input_needed` | `UserInputNeededEvent` | Waiting for user |
| 40 | `cost_update` | `CostUpdateEvent` | Cost tracking updated |
| 41 | `sdk_message` | `SdkMessageEvent` | Raw SDK telemetry |

#### Event message fields

| Message | Fields |
|---------|--------|
| `AgentSpawnedEvent` | `agent: AgentInstance` |
| `AgentStatusChangedEvent` | `agent_id: string`, `old_status: AgentStatus`, `new_status: AgentStatus` |
| `AgentTerminatedEvent` | `agent_id: string`, `reason: optional string` |
| `AgentMessageEvent` | `agent_id: string`, `content: string`, `is_partial: bool` |
| `TaskCreatedEvent` | `task: Task` |
| `TaskStatusChangedEvent` | `task_id: string`, `old_status: TaskStatus`, `new_status: TaskStatus` |
| `TaskCompletedEvent` | `task_id: string`, `result: TaskResult` |
| `TaskFailedEvent` | `task_id: string`, `error: string` |
| `OrchestratorReadyEvent` | _(empty)_ |
| `OrchestratorErrorEvent` | `error_message: string` |
| `OrchestratorStoppedEvent` | _(empty)_ |
| `UserInputNeededEvent` | `prompt: string`, `task_id: optional string` |
| `CostUpdateEvent` | `total_cost_usd: double`, `breakdown: map<string, double>` |
| `SdkMessageEvent` | `agent_id: string`, `sdk_message_json: bytes` |

---

## Error Handling

The server maps core exceptions to Connect error codes:

| Core Error | Connect Code | Meaning |
|------------|-------------|---------|
| `BudgetExceededError` | `ResourceExhausted` | Session cost limit exceeded |
| `MaxRetriesError` | `ResourceExhausted` | Retry limit reached |
| `OrchestratorError` (message contains "already") | `AlreadyExists` | Already initialized |
| `OrchestratorError` (other) | `FailedPrecondition` | Not ready / bad state |
| `TaskError` | `NotFound` | Task not found |
| `AgentError` | `Internal` | Agent execution error |
| `FantasiaError` | `Internal` | Generic Fantasia error |
| Other `Error` | `Internal` | Unknown error |

---

## Core Library API

### Orchestrator

**Location:** `core/src/orchestrator.ts`

```typescript
class Orchestrator {
  constructor(sdk: SdkAdapter, config?: OrchestratorConfig)

  // Public properties
  events: FantasiaEventEmitter
  messageBus: MessageBus
  taskQueue: TaskQueue
  context: ContextStore
  memory: MemoryManager

  // Lifecycle
  async start(): Promise<void>       // Initialize memory, spawn Mickey + Imagineer
  async stop(): Promise<void>        // Terminate all agents, cleanup

  // Interaction
  async submit(userMessage: string): Promise<void>  // Send message to Mickey

  // Queries
  getAgents(): BaseAgent[]
  getTask(id: string): Task | undefined
  getTasks(): Task[]
}
```

**OrchestratorConfig:**

```typescript
interface OrchestratorConfig {
  model?: string                                      // Default: 'claude-sonnet-4-6'
  cwd?: string                                        // Working directory
  allowedTools?: string[]
  permissionMode?: PermissionMode                     // Default: 'bypassPermissions'
  maxConcurrentBroomsticks?: number                   // Default: 5
  maxBudgetUsd?: number                               // Default: 10
  env?: Record<string, string | undefined>
  memoryDir?: string                                  // Default: '.fantasia/memory'
  modelOverrides?: Partial<Record<AgentRole, string>>
  enabledAgents?: Partial<Record<AgentRole, boolean>>
}
```

---

### Agent System

**Location:** `core/src/agents/`

#### BaseAgent

```typescript
abstract class BaseAgent {
  readonly instance: AgentInstance
  abstract getConfig(): AgentConfig

  async run(options: AgentRunOptions): Promise<AgentRunResult>
  async stop(): Promise<void>
  protected getMemoryBlock(contextTags?: string[]): string
}

interface AgentRunOptions {
  prompt: string
  cwd?: string
  env?: Record<string, string | undefined>
  extraSdkOptions?: Partial<SDKOptions>
}

interface AgentRunResult {
  success: boolean
  output: string
  structuredOutput?: unknown
  costUsd: number
  numTurns: number
  durationMs: number
  sessionId: string
}
```

#### Agent Configurations

| Agent | Role | Default Model | Tools | Session | Notes |
|-------|------|--------------|-------|---------|-------|
| **Mickey** | `mickey` | claude-sonnet-4-6 | `claude_code` preset | persistent | User-facing coordinator. Triages requests, delegates non-trivial work. |
| **Yen Sid** | `yen-sid` | claude-opus-4-6 | Read, Glob, Grep, WebSearch, WebFetch | ephemeral | Master architect/planner. Designs implementation plans. |
| **Chernabog** | `chernabog` | claude-opus-4-6 | Read, Glob, Grep | ephemeral | Adversarial critic. Reviews plans for weaknesses. |
| **Broomstick** | `broomstick` | claude-sonnet-4-6 | `claude_code` preset (Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch) | ephemeral | Ephemeral worker. Executes approved plans. Max turns: 50, budget: $1.00. |
| **Imagineer** | `imagineer` | claude-sonnet-4-6 | Read, Glob, Grep | ephemeral | Monitor agent. Watches other agents every 30s, detects stuck/error states. Stuck threshold: 5 min. |

#### Core Types

```typescript
type AgentRole = 'mickey' | 'yen-sid' | 'chernabog' | 'broomstick' | 'imagineer'
type AgentStatus = 'idle' | 'working' | 'waiting' | 'error' | 'terminated'

interface AgentConfig {
  role: AgentRole
  name: string
  systemPrompt: string
  model: string
  tools?: string[] | { type: 'preset'; preset: 'claude_code' }
  disallowedTools?: string[]
  allowedTools?: string[]
  maxTurns?: number
  maxBudgetUsd?: number
  effort?: EffortLevel
  outputFormat?: OutputFormat
  persistSession?: boolean
  permissionMode?: PermissionMode
}

interface AgentInstance {
  id: string
  config: AgentConfig
  status: AgentStatus
  currentTaskId?: string
  sessionId?: string
  startedAt: number
  lastActivityAt: number
  error?: string
}
```

---

### Task System

**Location:** `core/src/task/`

#### TaskQueue

```typescript
class TaskQueue {
  constructor(maxConcurrent?: number)   // Default: 5

  // CRUD
  add(task: Task): void
  update(task: Task): void
  get(taskId: string): Task | undefined
  remove(taskId: string): boolean

  // Queries
  getPending(): Task[]         // Sorted by priority (critical > high > normal > low)
  getActive(): Task[]          // Non-terminal, non-pending
  getCompleted(): Task[]
  getFailed(): Task[]
  getAll(): Task[]
  getSubtasks(parentId: string): Task[]
  getCounts(): { pending: number; active: number; completed: number; failed: number; total: number }

  // Scheduling
  canStartMore(): boolean      // Under concurrency limit?
  getNext(): Task | undefined  // Next pending task by priority

  clear(): void

  get/set concurrencyLimit: number   // Minimum 1
}
```

#### Task Functions

```typescript
function createTask(params: {
  id: string; description: string; createdBy: string;
  priority?: TaskPriority; parentId?: string; metadata?: Record<string, unknown>
}): Task

function transitionTask(task: Task, newStatus: TaskStatus): Task  // Validates transition
function assignTask(task: Task, agentId: string): Task
function setPlan(task: Task, plan: TaskPlan): Task
function setReview(task: Task, review: TaskReview): Task
function completeTask(task: Task, result: TaskResult): Task       // Auto-transitions based on result.success
function addSubtask(task: Task, subtaskId: string): Task
function isTerminal(task: Task): boolean
function getValidTransitions(status: TaskStatus): TaskStatus[]
```

#### Task State Machine

```
pending → planning | in-progress | failed
planning → reviewing | in-progress | failed
reviewing → planning | in-progress | failed
in-progress → blocked | completed | failed
blocked → in-progress | failed
completed → (terminal)
failed → pending (retry)
```

#### Core Types

```typescript
type TaskStatus = 'pending' | 'planning' | 'reviewing' | 'in-progress' | 'blocked' | 'completed' | 'failed'
type TaskPriority = 'critical' | 'high' | 'normal' | 'low'

interface Task {
  id: string
  parentId?: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  assignedAgentId?: string
  createdBy: string
  plan?: TaskPlan
  review?: TaskReview
  result?: TaskResult
  subtaskIds: string[]
  createdAt: number
  updatedAt: number
  metadata: Record<string, unknown>
}

interface TaskPlan {
  summary: string
  steps: string[]
  subtasks?: Array<{ description: string; dependencies?: string[] }>
  risks?: string[]
  estimatedComplexity: 'trivial' | 'simple' | 'moderate' | 'complex'
}

interface TaskReview {
  approved: boolean
  concerns: string[]
  requiredChanges: string[]
  strengths: string[]
  iteration: number
}

interface TaskResult {
  success: boolean
  output: string
  artifacts?: string[]
  costUsd?: number
  tokenUsage?: NonNullableUsage
  modelUsage?: Record<string, ModelUsage>
  durationMs?: number
}
```

---

### Memory System

**Location:** `core/src/memory/`

#### MemoryStore (low-level, file-backed)

```typescript
class MemoryStore {
  constructor(dir: string)

  async initialize(): Promise<void>           // Ensure dir exists, load entries
  async save(entry: MemoryEntry): Promise<void>
  get(id: string): MemoryEntry | undefined
  async delete(id: string): Promise<boolean>
  getByRole(role: AgentRole): MemoryEntry[]
  getByTags(tags: string[]): MemoryEntry[]    // Matches any tag
  search(query: string): MemoryEntry[]        // Content substring
  getAll(): MemoryEntry[]
  get size: number
}
```

#### MemoryManager (high-level)

```typescript
class MemoryManager {
  constructor(store: MemoryStore)

  async initialize(): Promise<void>

  // Core operations
  async remember(params: {
    agentRole: AgentRole; type: MemoryType; content: string;
    context: string; tags?: string[]
  }): Promise<MemoryEntry>
  async forget(id: string): Promise<boolean>
  recall(role: AgentRole, contextTags?: string[]): MemoryEntry[]  // Sorted by tag overlap + recency
  formatForPrompt(memories: MemoryEntry[], maxEntries?: number): string

  // Convenience methods
  async recordApproval(agentRole: AgentRole, planSummary: string, tags: string[]): Promise<MemoryEntry>
  async recordRejection(agentRole: AgentRole, suggestion: string, reason: string, tags: string[]): Promise<MemoryEntry>
  async recordLesson(agentRole: AgentRole, lesson: string, context: string, tags: string[]): Promise<MemoryEntry>
  async prune(maxPerRole?: number): Promise<number>   // Default: 50

  getAll(): MemoryEntry[]
  get size: number
}
```

#### Core Types

```typescript
type MemoryType = 'lesson' | 'rejection' | 'preference' | 'pattern'

interface MemoryEntry {
  id: string
  agentRole: AgentRole
  type: MemoryType
  content: string
  context: string
  tags: string[]
  timestamp: number
  relevanceScore?: number
}
```

---

### Event System

**Location:** `core/src/events/event-emitter.ts`

```typescript
class FantasiaEventEmitter {
  // Subscriptions (all return unsubscribe function)
  on<T extends FantasiaEventType>(type: T, handler): () => void
  once<T extends FantasiaEventType>(type: T, handler): () => void
  onAny(handler: (event: FantasiaEvent) => void): () => void

  // Emitting
  emit(event: FantasiaEvent): void

  // Streaming
  async *stream(): AsyncGenerator<FantasiaEvent>
  stopStream(): void

  // History
  history(limit?: number): FantasiaEvent[]   // Up to 1000 kept

  // Waiting
  waitFor<T extends FantasiaEventType>(type: T, timeout?: number): Promise<...>

  clear(): void
}
```

#### Event Types

```typescript
type FantasiaEvent =
  | { type: 'agent:spawned'; agent: AgentInstance }
  | { type: 'agent:status-changed'; agentId: string; oldStatus: AgentStatus; newStatus: AgentStatus }
  | { type: 'agent:terminated'; agentId: string; reason?: string }
  | { type: 'agent:message'; agentId: string; content: string; isPartial: boolean }
  | { type: 'task:created'; task: Task }
  | { type: 'task:status-changed'; taskId: string; oldStatus: TaskStatus; newStatus: TaskStatus }
  | { type: 'task:completed'; taskId: string; result: TaskResult }
  | { type: 'task:failed'; taskId: string; error: string }
  | { type: 'orchestrator:ready' }
  | { type: 'orchestrator:error'; error: Error }
  | { type: 'orchestrator:stopped' }
  | { type: 'user:input-needed'; prompt: string; taskId?: string }
  | { type: 'cost:update'; totalCostUsd: number; breakdown: Record<string, number> }
  | { type: 'sdk:message'; agentId: string; sdkMessage: SDKMessage }
```

---

### Context Store

**Location:** `core/src/context/context-store.ts`

```typescript
class ContextStore {
  set<T>(key: string, value: T): void
  get<T>(key: string): T | undefined
  has(key: string): boolean
  delete(key: string): boolean
  addCost(agentId: string, costUsd: number): void
  getCostBreakdown(): Record<string, number>
  getTotalCost(): number
  clear(): void
}
```

---

### Session Pool

**Location:** `core/src/sdk/session-pool.ts`

```typescript
class SessionPool {
  constructor(sdk: SdkAdapter)

  createQuery(agentId: string, prompt: string | AsyncIterable<SDKUserMessage>, options?: SDKOptions): SDKQuery
  getQuery(agentId: string): SDKQuery | undefined
  hasQuery(agentId: string): boolean
  closeQuery(agentId: string): void
  closeAll(): void
  get size: number
  getActiveAgentIds(): string[]
}
```

---

### Message Bus

**Location:** `core/src/messaging/message-bus.ts`

```typescript
class MessageBus {
  constructor(maxHistory?: number)   // Default: 500

  subscribe(agentId: string, handler: MessageHandler): () => void
  subscribeTopic(type: MessageType, handler: MessageHandler): () => void
  subscribeAll(handler: MessageHandler): () => void
  publish(message: AgentMessage): void
  getHistory(filter?: { agentId?: string; type?: MessageType; correlationId?: string }): AgentMessage[]
  clear(): void
}
```

**Message Types:**

```typescript
type MessageType =
  | 'task-assignment' | 'task-result'
  | 'plan-request' | 'plan-response'
  | 'review-request' | 'review-response'
  | 'status-update' | 'health-check' | 'health-report'
  | 'intervention' | 'user-input' | 'user-output'

interface AgentMessage {
  id: string
  type: MessageType
  from: string
  to: string | 'broadcast'
  payload: unknown
  timestamp: number
  correlationId?: string
}
```

---

### SdkAdapter Interface

**Location:** `core/src/types.ts`

```typescript
interface SdkAdapter {
  query(params: { prompt: string | AsyncIterable<SDKUserMessage>; options?: SDKOptions }): SDKQuery

  createMcpServer(options: {
    name: string; version?: string;
    tools?: Array<SdkMcpToolDefinition<any>>
  }): McpSdkServerConfigWithInstance

  tool<Schema extends Record<string, any>>(
    name: string, description: string, inputSchema: Schema,
    handler: (args: any, extra: unknown) => Promise<any>,
    extras?: { annotations?: Record<string, boolean>; searchHint?: string; alwaysLoad?: boolean }
  ): SdkMcpToolDefinition<Schema>
}
```

The production implementation is `RealSdkAdapter` in `core/src/sdk/sdk-adapter.ts`, which delegates to the Claude Agent SDK.

---

### Fantasia Tools

**Location:** `core/src/tools/fantasia-tools.ts`

These are MCP tools available to Mickey for task delegation:

#### `delegate_task`

Delegate work to specialist agents (non-blocking).

| Parameter | Type | Description |
|-----------|------|-------------|
| `description` | `string` | Clear description of what needs to be done |
| `priority` | `'critical' \| 'high' \| 'normal' \| 'low'` | Task priority |

**Returns:** text with the created task ID.

#### `check_task_status`

Poll a task's current state.

| Parameter | Type |
|-----------|------|
| `task_id` | `string` |

**Returns:** text with status, priority, assigned agent, plan summary, and result if complete.

#### `get_task_result`

Get the full result of a completed task.

| Parameter | Type |
|-----------|------|
| `task_id` | `string` |

**Returns:** JSON with `taskId`, `description`, `status`, and `result`. Errors if task is still in progress or not found.

#### `list_tasks`

List all tasks and their statuses. No parameters.

**Returns:** formatted text with all tasks (ID, status, priority, description) and summary counts.

---

### Error Classes

**Location:** `core/src/errors.ts`

```typescript
class FantasiaError extends Error { constructor(message: string, code: string) }
class AgentError extends FantasiaError { constructor(message: string, agentId: string, agentRole: string) }
class TaskError extends FantasiaError { constructor(message: string, taskId: string) }
class OrchestratorError extends FantasiaError { constructor(message: string) }
class BudgetExceededError extends FantasiaError { constructor(currentCostUsd: number, maxBudgetUsd: number) }
class MaxRetriesError extends FantasiaError { constructor(message: string, retries: number) }
```

---

### Task Pipeline

The orchestrator processes tasks through this pipeline:

1. **User submits message** → Mickey receives it via `submit()`
2. **Mickey triages** — if trivial, handles directly; if not, calls `delegate_task`
3. **Task created** → enters `pending` status in TaskQueue
4. **Yen Sid plans** → task moves to `planning`, produces a `TaskPlan`
5. **Chernabog reviews** → task moves to `reviewing`, produces a `TaskReview`
   - If rejected, may iterate back to planning (up to 2 iterations)
6. **Broomstick executes** → task moves to `in-progress`, produces a `TaskResult`
   - Multiple broomsticks can run in parallel (up to `maxConcurrentBroomsticks`)
7. **Imagineer monitors** → watches all agents every 30s, detects stuck/error states
8. **Task completes** → `completed` or `failed`; memory updated with outcomes
