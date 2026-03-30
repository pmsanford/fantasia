/// Hand-written prost types mirroring fantasia/v1/*.proto

// ─── Enums ──────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, prost::Enumeration)]
#[repr(i32)]
pub enum AgentRole {
    Unspecified = 0,
    Mickey = 1,
    YenSid = 2,
    Chernabog = 3,
    Broomstick = 4,
    Imagineer = 5,
    Jacchus = 6,
}

impl AgentRole {
    pub fn as_str(&self) -> &'static str {
        match self {
            AgentRole::Unspecified => "?",
            AgentRole::Mickey => "Mickey",
            AgentRole::YenSid => "Yen Sid",
            AgentRole::Chernabog => "Chernabog",
            AgentRole::Broomstick => "Broomstick",
            AgentRole::Imagineer => "Imagineer",
            AgentRole::Jacchus => "Jacchus",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, prost::Enumeration)]
#[repr(i32)]
pub enum AgentStatus {
    Unspecified = 0,
    Idle = 1,
    Working = 2,
    Waiting = 3,
    Error = 4,
    Terminated = 5,
}

impl AgentStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            AgentStatus::Unspecified => "?",
            AgentStatus::Idle => "IDLE",
            AgentStatus::Working => "WORK",
            AgentStatus::Waiting => "WAIT",
            AgentStatus::Error => "ERR",
            AgentStatus::Terminated => "TERM",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, prost::Enumeration)]
#[repr(i32)]
pub enum TaskStatus {
    Unspecified = 0,
    Pending = 1,
    Planning = 2,
    Reviewing = 3,
    InProgress = 4,
    Blocked = 5,
    Completed = 6,
    Failed = 7,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, prost::Enumeration)]
#[repr(i32)]
pub enum TaskPriority {
    Unspecified = 0,
    Critical = 1,
    High = 2,
    Normal = 3,
    Low = 4,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, prost::Enumeration)]
#[repr(i32)]
pub enum EstimatedComplexity {
    Unspecified = 0,
    Trivial = 1,
    Simple = 2,
    Moderate = 3,
    Complex = 4,
}

// ─── Agent messages ──────────────────────────────────────────────────────────

#[derive(Clone, PartialEq, prost::Message)]
pub struct AgentConfig {
    #[prost(enumeration = "AgentRole", tag = "1")]
    pub role: i32,
    #[prost(string, tag = "2")]
    pub name: String,
    #[prost(string, tag = "3")]
    pub system_prompt: String,
    #[prost(string, tag = "4")]
    pub model: String,
    #[prost(string, repeated, tag = "5")]
    pub tools: Vec<String>,
    #[prost(uint32, optional, tag = "8")]
    pub max_turns: Option<u32>,
    #[prost(double, optional, tag = "9")]
    pub max_budget_usd: Option<f64>,
    #[prost(string, optional, tag = "10")]
    pub effort: Option<String>,
    #[prost(bool, optional, tag = "12")]
    pub persist_session: Option<bool>,
    #[prost(string, optional, tag = "13")]
    pub permission_mode: Option<String>,
    #[prost(string, optional, tag = "14")]
    pub tools_preset: Option<String>,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct AgentInstance {
    #[prost(string, tag = "1")]
    pub id: String,
    #[prost(message, optional, tag = "2")]
    pub config: Option<AgentConfig>,
    #[prost(enumeration = "AgentStatus", tag = "3")]
    pub status: i32,
    #[prost(string, optional, tag = "4")]
    pub current_task_id: Option<String>,
    #[prost(string, optional, tag = "5")]
    pub session_id: Option<String>,
    #[prost(int64, tag = "6")]
    pub started_at: i64,
    #[prost(int64, tag = "7")]
    pub last_activity_at: i64,
    #[prost(string, optional, tag = "8")]
    pub error: Option<String>,
}

// ─── Task messages ────────────────────────────────────────────────────────────

#[derive(Clone, PartialEq, prost::Message)]
pub struct TaskPlan {
    #[prost(string, tag = "1")]
    pub summary: String,
    #[prost(string, repeated, tag = "2")]
    pub steps: Vec<String>,
    #[prost(string, repeated, tag = "4")]
    pub risks: Vec<String>,
    #[prost(enumeration = "EstimatedComplexity", tag = "5")]
    pub estimated_complexity: i32,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct TaskReview {
    #[prost(bool, tag = "1")]
    pub approved: bool,
    #[prost(string, repeated, tag = "2")]
    pub concerns: Vec<String>,
    #[prost(int32, tag = "5")]
    pub iteration: i32,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct TaskResult {
    #[prost(bool, tag = "1")]
    pub success: bool,
    #[prost(string, tag = "2")]
    pub output: String,
    #[prost(string, repeated, tag = "3")]
    pub artifacts: Vec<String>,
    #[prost(double, optional, tag = "4")]
    pub cost_usd: Option<f64>,
    #[prost(int64, optional, tag = "5")]
    pub duration_ms: Option<i64>,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct Task {
    #[prost(string, tag = "1")]
    pub id: String,
    #[prost(string, optional, tag = "2")]
    pub parent_id: Option<String>,
    #[prost(string, tag = "3")]
    pub description: String,
    #[prost(enumeration = "TaskStatus", tag = "4")]
    pub status: i32,
    #[prost(enumeration = "TaskPriority", tag = "5")]
    pub priority: i32,
    #[prost(string, optional, tag = "6")]
    pub assigned_agent_id: Option<String>,
    #[prost(string, tag = "7")]
    pub created_by: String,
    #[prost(message, optional, tag = "8")]
    pub plan: Option<TaskPlan>,
    #[prost(message, optional, tag = "9")]
    pub review: Option<TaskReview>,
    #[prost(message, optional, tag = "10")]
    pub result: Option<TaskResult>,
    #[prost(string, repeated, tag = "11")]
    pub subtask_ids: Vec<String>,
    #[prost(int64, tag = "12")]
    pub created_at: i64,
    #[prost(int64, tag = "13")]
    pub updated_at: i64,
}

// ─── Cost / Task counts ────────────────────────────────────────────────────────

#[derive(Clone, PartialEq, prost::Message)]
pub struct CostBreakdown {
    #[prost(double, tag = "1")]
    pub total_cost_usd: f64,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct TaskCounts {
    #[prost(int32, tag = "1")]
    pub pending: i32,
    #[prost(int32, tag = "2")]
    pub active: i32,
    #[prost(int32, tag = "3")]
    pub completed: i32,
    #[prost(int32, tag = "4")]
    pub failed: i32,
    #[prost(int32, tag = "5")]
    pub total: i32,
}

// ─── Orchestrator config ───────────────────────────────────────────────────────

#[derive(Clone, PartialEq, prost::Message)]
pub struct OrchestratorConfig {
    #[prost(string, optional, tag = "1")]
    pub model: Option<String>,
    #[prost(string, optional, tag = "2")]
    pub cwd: Option<String>,
    #[prost(string, repeated, tag = "3")]
    pub allowed_tools: Vec<String>,
    #[prost(string, optional, tag = "4")]
    pub permission_mode: Option<String>,
    #[prost(int32, optional, tag = "5")]
    pub max_concurrent_broomsticks: Option<i32>,
    #[prost(double, optional, tag = "6")]
    pub max_budget_usd: Option<f64>,
    #[prost(string, optional, tag = "8")]
    pub memory_dir: Option<String>,
}

// ─── Orchestrator RPC messages ─────────────────────────────────────────────────

#[derive(Clone, PartialEq, prost::Message)]
pub struct InitializeRequest {
    #[prost(message, optional, tag = "1")]
    pub config: Option<OrchestratorConfig>,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct InitializeResponse {}

#[derive(Clone, PartialEq, prost::Message)]
pub struct SubmitRequest {
    #[prost(string, tag = "1")]
    pub user_message: String,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct SubmitResponse {}

#[derive(Clone, PartialEq, prost::Message)]
pub struct GetStatusRequest {}

#[derive(Clone, PartialEq, prost::Message)]
pub struct GetStatusResponse {
    #[prost(bool, tag = "1")]
    pub running: bool,
    #[prost(message, repeated, tag = "2")]
    pub agents: Vec<AgentInstance>,
    #[prost(message, optional, tag = "3")]
    pub task_counts: Option<TaskCounts>,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct GetCostRequest {}

#[derive(Clone, PartialEq, prost::Message)]
pub struct GetCostResponse {
    #[prost(message, optional, tag = "1")]
    pub cost: Option<CostBreakdown>,
}

// ─── Event RPC messages ────────────────────────────────────────────────────────

#[derive(Clone, PartialEq, prost::Message)]
pub struct SubscribeRequest {
    #[prost(string, repeated, tag = "1")]
    pub event_types: Vec<String>,
    #[prost(bool, tag = "2")]
    pub include_history: bool,
    #[prost(uint64, optional, tag = "3")]
    pub after_sequence: Option<u64>,
}

// ─── Event payload messages ────────────────────────────────────────────────────

#[derive(Clone, PartialEq, prost::Message)]
pub struct AgentSpawnedEvent {
    #[prost(message, optional, tag = "1")]
    pub agent: Option<AgentInstance>,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct AgentStatusChangedEvent {
    #[prost(string, tag = "1")]
    pub agent_id: String,
    #[prost(enumeration = "AgentStatus", tag = "2")]
    pub old_status: i32,
    #[prost(enumeration = "AgentStatus", tag = "3")]
    pub new_status: i32,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct AgentTerminatedEvent {
    #[prost(string, tag = "1")]
    pub agent_id: String,
    #[prost(string, optional, tag = "2")]
    pub reason: Option<String>,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct AgentMessageEvent {
    #[prost(string, tag = "1")]
    pub agent_id: String,
    #[prost(string, tag = "2")]
    pub content: String,
    #[prost(bool, tag = "3")]
    pub is_partial: bool,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct TaskCreatedEvent {
    #[prost(message, optional, tag = "1")]
    pub task: Option<Task>,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct TaskStatusChangedEvent {
    #[prost(string, tag = "1")]
    pub task_id: String,
    #[prost(enumeration = "TaskStatus", tag = "2")]
    pub old_status: i32,
    #[prost(enumeration = "TaskStatus", tag = "3")]
    pub new_status: i32,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct TaskCompletedEvent {
    #[prost(string, tag = "1")]
    pub task_id: String,
    #[prost(message, optional, tag = "2")]
    pub result: Option<TaskResult>,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct TaskFailedEvent {
    #[prost(string, tag = "1")]
    pub task_id: String,
    #[prost(string, tag = "2")]
    pub error: String,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct OrchestratorReadyEvent {}

#[derive(Clone, PartialEq, prost::Message)]
pub struct OrchestratorErrorEvent {
    #[prost(string, tag = "1")]
    pub error_message: String,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct OrchestratorStoppedEvent {}

#[derive(Clone, PartialEq, prost::Message)]
pub struct UserInputNeededEvent {
    #[prost(string, tag = "1")]
    pub prompt: String,
    #[prost(string, optional, tag = "2")]
    pub task_id: Option<String>,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct CostUpdateEvent {
    #[prost(double, tag = "1")]
    pub total_cost_usd: f64,
}

// ─── Unified event wrapper ─────────────────────────────────────────────────────

#[derive(Clone, PartialEq, prost::Message)]
pub struct FantasiaEvent {
    #[prost(int64, tag = "1")]
    pub timestamp: i64,
    #[prost(uint64, tag = "2")]
    pub sequence: u64,
    #[prost(
        oneof = "fantasia_event::Payload",
        tags = "10, 11, 12, 13, 20, 21, 22, 23, 30, 31, 32, 33, 40"
    )]
    pub payload: Option<fantasia_event::Payload>,
}

pub mod fantasia_event {
    #[derive(Clone, PartialEq, prost::Oneof)]
    pub enum Payload {
        #[prost(message, tag = "10")]
        AgentSpawned(super::AgentSpawnedEvent),
        #[prost(message, tag = "11")]
        AgentStatusChanged(super::AgentStatusChangedEvent),
        #[prost(message, tag = "12")]
        AgentTerminated(super::AgentTerminatedEvent),
        #[prost(message, tag = "13")]
        AgentMessage(super::AgentMessageEvent),
        #[prost(message, tag = "20")]
        TaskCreated(super::TaskCreatedEvent),
        #[prost(message, tag = "21")]
        TaskStatusChanged(super::TaskStatusChangedEvent),
        #[prost(message, tag = "22")]
        TaskCompleted(super::TaskCompletedEvent),
        #[prost(message, tag = "23")]
        TaskFailed(super::TaskFailedEvent),
        #[prost(message, tag = "30")]
        OrchestratorReady(super::OrchestratorReadyEvent),
        #[prost(message, tag = "31")]
        OrchestratorError(super::OrchestratorErrorEvent),
        #[prost(message, tag = "32")]
        OrchestratorStopped(super::OrchestratorStoppedEvent),
        #[prost(message, tag = "33")]
        UserInputNeeded(super::UserInputNeededEvent),
        #[prost(message, tag = "40")]
        CostUpdate(super::CostUpdateEvent),
    }
}
