use std::collections::HashMap;
use std::time::Instant;

/// Count the number of visual rows text will occupy with word wrapping.
/// Simulates ratatui's Wrap { trim: false } behavior.
fn wrap_line_count(text: &str, width: usize) -> usize {
    let mut total = 0;
    for line in text.split('\n') {
        if line.is_empty() {
            total += 1;
            continue;
        }
        let mut col = 0;
        let mut rows = 1;
        for word in line.split_inclusive(' ') {
            let wlen = word.len();
            if col + wlen > width && col > 0 {
                rows += 1;
                col = 0;
            }
            if wlen > width {
                let remaining = wlen - (width - col).min(wlen);
                col = remaining % width;
                rows += (remaining + width - 1) / width;
                if col == 0 {
                    col = width;
                }
            } else {
                col += wlen;
            }
        }
        total += rows;
    }
    total
}

use crate::proto::{AgentInstance, AgentRole, Task, TaskCounts};

// ─── Message types ────────────────────────────────────────────────────────────

/// Filter that determines which messages appear in a chat tab.
#[derive(Debug, Clone)]
pub enum TabFilter {
    /// Show all messages.
    All,
    /// Show only messages from these agent names (plus User and System).
    Agents(Vec<String>),
}

impl TabFilter {
    pub fn matches(&self, role: &MessageRole) -> bool {
        match self {
            TabFilter::All => true,
            TabFilter::Agents(names) => match role {
                MessageRole::User | MessageRole::System => true,
                MessageRole::Agent(name) => names.iter().any(|n| name.starts_with(n)),
            },
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum MessageRole {
    User,
    Agent(String),
    System,
}

#[derive(Debug, Clone)]
pub struct ChatMessage {
    pub role: MessageRole,
    pub content: String,
}

#[derive(Debug, Clone)]
pub struct PartialMessage {
    pub agent_id: String,
    pub agent_name: String,
    pub content: String,
}

// ─── Tool use tracking ────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct ToolResultEntry {
    pub is_error: bool,
    pub output: String,
}

#[derive(Debug, Clone)]
pub struct ToolUseEntry {
    pub tool_use_id: String,
    pub tool_name: String,
    pub input_json: String,
    pub result: Option<ToolResultEntry>,
}

// ─── Tab system ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub enum AgentSubTab {
    Status,
    Prompt,
    Messages,
    ToolLog,
}

impl AgentSubTab {
    pub fn next(&self) -> Self {
        match self {
            AgentSubTab::Status => AgentSubTab::Prompt,
            AgentSubTab::Prompt => AgentSubTab::Messages,
            AgentSubTab::Messages => AgentSubTab::ToolLog,
            AgentSubTab::ToolLog => AgentSubTab::Status,
        }
    }

    pub fn prev(&self) -> Self {
        match self {
            AgentSubTab::Status => AgentSubTab::ToolLog,
            AgentSubTab::Prompt => AgentSubTab::Status,
            AgentSubTab::Messages => AgentSubTab::Prompt,
            AgentSubTab::ToolLog => AgentSubTab::Messages,
        }
    }

    pub fn label(&self) -> &'static str {
        match self {
            AgentSubTab::Status => "Status",
            AgentSubTab::Prompt => "Prompt",
            AgentSubTab::Messages => "Messages",
            AgentSubTab::ToolLog => "Tool Log",
        }
    }
}

#[derive(Debug, Clone)]
pub enum TabKind {
    Chat {
        filter: TabFilter,
        scroll_offset: usize,
    },
    Plan {
        /// Index of the selected workstream in the list.
        selected_index: usize,
        scroll_offset: usize,
    },
    AgentDetail {
        agent_id: String,
        sub_tab: AgentSubTab,
        scroll_offset: usize,
    },
}

#[derive(Debug, Clone)]
pub struct Tab {
    pub name: String,
    pub kind: TabKind,
}

// ─── App state ────────────────────────────────────────────────────────────────

pub struct AppState {
    /// Committed chat messages (global log).
    pub messages: Vec<ChatMessage>,
    /// In-progress streaming message from an agent.
    pub partial_message: Option<PartialMessage>,

    /// Text the user is currently typing.
    pub input_buffer: String,
    /// Byte-offset cursor position in input_buffer.
    pub cursor_position: usize,

    /// Latest known agent list.
    pub agents: Vec<AgentInstance>,
    /// Latest task counts.
    pub task_counts: TaskCounts,
    /// Latest total cost.
    pub total_cost_usd: f64,
    /// Whether the orchestrator is running.
    pub orchestrator_running: bool,

    /// True while waiting for a Submit RPC to return.
    pub submitting: bool,

    /// All tabs.
    pub tabs: Vec<Tab>,
    /// Index of the currently active tab.
    pub active_tab: usize,

    /// Ephemeral status/error message with expiry.
    pub status_line: Option<(String, Instant)>,

    /// When we last received any event/response from the server.
    pub last_server_update: Option<Instant>,

    /// Toggles every 500ms for cursor blink.
    pub blink_state: bool,
    pub last_blink: Instant,

    /// Full task objects keyed by task ID.
    pub tasks: HashMap<String, Task>,

    /// Milestones that have been reached: (milestone_id, workstream_name).
    pub milestones_reached: Vec<(String, String)>,

    /// Per-agent tool use history, keyed by agent_id.
    pub tool_uses: HashMap<String, Vec<ToolUseEntry>>,

    /// Per-agent message history, keyed by agent_id.
    pub agent_messages: HashMap<String, Vec<ChatMessage>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            messages: Vec::new(),
            partial_message: None,
            input_buffer: String::new(),
            cursor_position: 0,
            agents: Vec::new(),
            task_counts: TaskCounts::default(),
            total_cost_usd: 0.0,
            orchestrator_running: false,
            submitting: false,
            last_server_update: None,
            tabs: vec![
                Tab {
                    name: "Mickey".into(),
                    kind: TabKind::Chat {
                        filter: TabFilter::Agents(vec!["Mickey".into()]),
                        scroll_offset: 0,
                    },
                },
                Tab {
                    name: "All".into(),
                    kind: TabKind::Chat {
                        filter: TabFilter::All,
                        scroll_offset: 0,
                    },
                },
                Tab {
                    name: "Plan".into(),
                    kind: TabKind::Plan {
                        selected_index: 0,
                        scroll_offset: 0,
                    },
                },
            ],
            active_tab: 0,
            status_line: None,
            blink_state: true,
            last_blink: Instant::now(),
            tasks: HashMap::new(),
            milestones_reached: Vec::new(),
            tool_uses: HashMap::new(),
            agent_messages: HashMap::new(),
        }
    }

    /// Look up an agent's display name from its ID.
    pub fn agent_name(&self, agent_id: &str) -> String {
        for agent in &self.agents {
            if agent.id == agent_id {
                let role = AgentRole::try_from(
                    agent.config.as_ref().map(|c| c.role).unwrap_or(0),
                )
                .unwrap_or(AgentRole::Unspecified);
                // For broomsticks, use their actual name from config
                if role == AgentRole::Broomstick {
                    if let Some(config) = &agent.config {
                        if !config.name.is_empty() {
                            return config.name.clone();
                        }
                    }
                }
                return role.as_str().to_string();
            }
        }
        format!("Agent({})", &agent_id[..agent_id.len().min(8)])
    }

    pub fn set_status(&mut self, msg: impl Into<String>) {
        self.status_line = Some((msg.into(), Instant::now()));
    }

    /// Expire status_line after 5 seconds.
    pub fn tick_status(&mut self) {
        if let Some((_, ts)) = &self.status_line {
            if ts.elapsed().as_secs() >= 5 {
                self.status_line = None;
            }
        }
    }

    pub fn tick_blink(&mut self) {
        if self.last_blink.elapsed().as_millis() >= 500 {
            self.blink_state = !self.blink_state;
            self.last_blink = Instant::now();
        }
    }

    /// Insert a character at the current cursor position.
    pub fn insert_char(&mut self, ch: char) {
        self.input_buffer.insert(self.cursor_position, ch);
        self.cursor_position += ch.len_utf8();
    }

    /// Delete the character before the cursor (backspace).
    pub fn delete_before_cursor(&mut self) {
        if self.cursor_position == 0 {
            return;
        }
        let before = &self.input_buffer[..self.cursor_position];
        if let Some(ch) = before.chars().next_back() {
            let new_pos = self.cursor_position - ch.len_utf8();
            self.input_buffer.remove(new_pos);
            self.cursor_position = new_pos;
        }
    }

    /// Move cursor left by one character.
    pub fn move_cursor_left(&mut self) {
        if self.cursor_position == 0 {
            return;
        }
        let before = &self.input_buffer[..self.cursor_position];
        if let Some(ch) = before.chars().next_back() {
            self.cursor_position -= ch.len_utf8();
        }
    }

    /// Move cursor right by one character.
    pub fn move_cursor_right(&mut self) {
        if self.cursor_position >= self.input_buffer.len() {
            return;
        }
        let after = &self.input_buffer[self.cursor_position..];
        if let Some(ch) = after.chars().next() {
            self.cursor_position += ch.len_utf8();
        }
    }

    /// Compute how many rows the input area needs (including border).
    pub fn input_height(&self, width: u16) -> u16 {
        let inner_width = (width.saturating_sub(2) as usize).max(1);
        let text = if self.input_buffer.is_empty() {
            "Type a message (Enter to send, Shift+Enter for newline, Esc to quit)".to_string()
        } else {
            format!("> {}", self.input_buffer)
        };
        let rows = wrap_line_count(&text, inner_width);
        (rows as u16).clamp(1, 8) + 2
    }

    /// Take the input buffer and reset it.
    pub fn take_input(&mut self) -> String {
        self.cursor_position = 0;
        std::mem::take(&mut self.input_buffer)
    }

    /// Scroll offset for the active tab.
    pub fn scroll_offset(&self) -> usize {
        match &self.tabs[self.active_tab].kind {
            TabKind::Chat { scroll_offset, .. } => *scroll_offset,
            TabKind::Plan { scroll_offset, .. } => *scroll_offset,
            TabKind::AgentDetail { scroll_offset, .. } => *scroll_offset,
        }
    }

    /// Mutable reference to scroll offset for the active tab.
    pub fn scroll_offset_mut(&mut self) -> &mut usize {
        match &mut self.tabs[self.active_tab].kind {
            TabKind::Chat { scroll_offset, .. } => scroll_offset,
            TabKind::Plan { scroll_offset, .. } => scroll_offset,
            TabKind::AgentDetail { scroll_offset, .. } => scroll_offset,
        }
    }

    /// Switch to the next tab.
    pub fn next_tab(&mut self) {
        self.active_tab = (self.active_tab + 1) % self.tabs.len();
    }

    /// Switch to the previous tab.
    pub fn prev_tab(&mut self) {
        self.active_tab = if self.active_tab == 0 {
            self.tabs.len() - 1
        } else {
            self.active_tab - 1
        };
    }

    /// Open an agent detail tab for the given agent, switching to it.
    pub fn open_agent_detail(&mut self, agent_id: String, agent_name: String) {
        // Check if a detail tab for this agent already exists
        for (i, tab) in self.tabs.iter().enumerate() {
            if let TabKind::AgentDetail { agent_id: id, .. } = &tab.kind {
                if *id == agent_id {
                    self.active_tab = i;
                    return;
                }
            }
        }
        self.tabs.push(Tab {
            name: agent_name,
            kind: TabKind::AgentDetail {
                agent_id,
                sub_tab: AgentSubTab::Status,
                scroll_offset: 0,
            },
        });
        self.active_tab = self.tabs.len() - 1;
    }

    /// Close the current tab (if it's an AgentDetail) and return to previous tab.
    pub fn close_active_tab(&mut self) {
        if self.tabs.len() <= 1 {
            return;
        }
        if matches!(self.tabs[self.active_tab].kind, TabKind::AgentDetail { .. }) {
            self.tabs.remove(self.active_tab);
            self.active_tab = self.active_tab.saturating_sub(1).min(self.tabs.len() - 1);
        }
    }

    /// Add a chat message and reset scroll to bottom on all Chat tabs.
    pub fn push_message(&mut self, role: MessageRole, content: String) {
        self.messages.push(ChatMessage { role, content });
        for tab in &mut self.tabs {
            if let TabKind::Chat { scroll_offset, .. } = &mut tab.kind {
                *scroll_offset = 0;
            }
        }
    }

    /// Returns the most recent task that has a plan with workstreams, for Plan tab display.
    pub fn active_plan_task(&self) -> Option<&Task> {
        self.tasks
            .values()
            .filter(|t| t.plan.as_ref().map_or(false, |p| !p.workstreams.is_empty()))
            .max_by_key(|t| t.created_at)
    }

    /// Check if a milestone has been reached.
    pub fn milestone_reached(&self, id: &str) -> bool {
        self.milestones_reached.iter().any(|(mid, _)| mid == id)
    }

    /// Find the broomstick agent assigned to a given workstream name.
    pub fn agent_for_workstream(&self, workstream_name: &str) -> Option<&AgentInstance> {
        self.agents.iter().find(|a| {
            a.workstream_name.as_deref() == Some(workstream_name)
        })
    }
}
