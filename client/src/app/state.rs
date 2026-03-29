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
                // Word doesn't fit, wrap to next line
                rows += 1;
                col = 0;
            }
            if wlen > width {
                // Word itself is wider than the line — break it
                let remaining = wlen - (width - col).min(wlen);
                col = remaining % width;
                rows += (remaining + width - 1) / width;
                if col == 0 {
                    col = width; // filled exactly
                }
            } else {
                col += wlen;
            }
        }
        total += rows;
    }
    total
}

use crate::proto::{AgentInstance, AgentRole, TaskCounts};

#[derive(Debug, Clone, PartialEq)]
pub enum MessageRole {
    User,
    Agent(String), // agent display name, e.g. "Mickey", "Imagineer"
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

pub struct AppState {
    /// Committed chat messages.
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

    /// How many lines to scroll the chat area up from the bottom.
    pub scroll_offset: usize,

    /// Ephemeral status/error message with expiry.
    pub status_line: Option<(String, Instant)>,

    /// When we last received any event/response from the server.
    pub last_server_update: Option<Instant>,

    /// Toggles every render cycle to blink the partial-message cursor.
    pub blink_state: bool,
    pub last_blink: Instant,
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
            scroll_offset: 0,
            status_line: None,
            blink_state: true,
            last_blink: Instant::now(),
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
                return role.as_str().to_string();
            }
        }
        // Fallback: short ID
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
    /// `width` is the total widget width including borders.
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

    /// Add a chat message and reset scroll to bottom.
    pub fn push_message(&mut self, role: MessageRole, content: String) {
        self.messages.push(ChatMessage { role, content });
        self.scroll_offset = 0;
    }
}
