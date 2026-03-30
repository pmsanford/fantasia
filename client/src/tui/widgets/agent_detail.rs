use ratatui::{
    layout::{Constraint, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph, Wrap},
    Frame,
};

use crate::app::{
    state::{AgentSubTab, TabKind},
    AppState,
};
use crate::proto::{AgentRole, AgentStatus};

use super::chat::{agent_color, render_message};

pub fn render(f: &mut Frame, area: Rect, state: &AppState) {
    let (agent_id, sub_tab) = match &state.tabs[state.active_tab].kind {
        TabKind::AgentDetail { agent_id, sub_tab, .. } => (agent_id.clone(), sub_tab.clone()),
        _ => return,
    };

    let agent = state.agents.iter().find(|a| a.id == agent_id);

    // Split: sub-tab bar + content
    let chunks = Layout::vertical([
        Constraint::Length(1),
        Constraint::Fill(1),
    ])
    .split(area);

    render_subtab_bar(f, chunks[0], &sub_tab, agent.and_then(|a| a.config.as_ref()).map(|c| c.name.as_str()).unwrap_or("Agent"));

    match sub_tab {
        AgentSubTab::Status => render_status(f, chunks[1], state, &agent_id),
        AgentSubTab::Prompt => render_prompt(f, chunks[1], state, &agent_id),
        AgentSubTab::Messages => render_messages(f, chunks[1], state, &agent_id),
        AgentSubTab::ToolLog => render_tool_log(f, chunks[1], state, &agent_id),
    }
}

fn render_subtab_bar(f: &mut Frame, area: Rect, active: &AgentSubTab, agent_name: &str) {
    let subtabs = [
        AgentSubTab::Status,
        AgentSubTab::Prompt,
        AgentSubTab::Messages,
        AgentSubTab::ToolLog,
    ];
    let mut spans: Vec<Span<'static>> = Vec::new();
    spans.push(Span::styled(
        format!(" {} ", agent_name),
        Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD),
    ));
    spans.push(Span::raw("│ "));
    for st in &subtabs {
        if st == active {
            spans.push(Span::styled(
                format!(" {} ", st.label()),
                Style::default().fg(Color::Black).bg(Color::White).add_modifier(Modifier::BOLD),
            ));
        } else {
            spans.push(Span::styled(
                format!(" {} ", st.label()),
                Style::default().fg(Color::DarkGray),
            ));
        }
        spans.push(Span::raw(" "));
    }
    spans.push(Span::styled(
        "(←/→ switch  Esc close)",
        Style::default().fg(Color::DarkGray),
    ));
    f.render_widget(Line::from(spans), area);
}

fn render_status(f: &mut Frame, area: Rect, state: &AppState, agent_id: &str) {
    let agent = match state.agents.iter().find(|a| a.id == agent_id) {
        Some(a) => a,
        None => {
            let p = Paragraph::new("Agent not found (may have terminated).")
                .block(Block::default().borders(Borders::ALL).title(" Status "))
                .style(Style::default().fg(Color::DarkGray));
            f.render_widget(p, area);
            return;
        }
    };

    let config = agent.config.as_ref();
    let status = AgentStatus::try_from(agent.status).unwrap_or(AgentStatus::Unspecified);
    let role = AgentRole::try_from(config.map(|c| c.role).unwrap_or(0))
        .unwrap_or(AgentRole::Unspecified);

    let status_color = match status {
        AgentStatus::Working => Color::Yellow,
        AgentStatus::Waiting => Color::Blue,
        AgentStatus::Error => Color::Red,
        AgentStatus::Terminated => Color::DarkGray,
        AgentStatus::Idle => Color::DarkGray,
        _ => Color::DarkGray,
    };

    let name = config.map(|c| c.name.as_str()).unwrap_or("?");
    let agent_col = agent_color(name);

    let mut lines: Vec<Line<'static>> = Vec::new();

    lines.push(Line::from(vec![
        Span::styled("Name:       ", Style::default().fg(Color::DarkGray)),
        Span::styled(name.to_owned(), Style::default().fg(agent_col).add_modifier(Modifier::BOLD)),
    ]));
    lines.push(Line::from(vec![
        Span::styled("Role:       ", Style::default().fg(Color::DarkGray)),
        Span::styled(role.as_str().to_owned(), Style::default().fg(Color::White)),
    ]));
    lines.push(Line::from(vec![
        Span::styled("Status:     ", Style::default().fg(Color::DarkGray)),
        Span::styled(
            format!("[{}]", status.as_str()),
            Style::default().fg(status_color).add_modifier(Modifier::BOLD),
        ),
    ]));
    if let Some(ws) = &agent.workstream_name {
        lines.push(Line::from(vec![
            Span::styled("Workstream: ", Style::default().fg(Color::DarkGray)),
            Span::styled(ws.clone(), Style::default().fg(Color::Cyan)),
        ]));
    }
    if let Some(task_id) = &agent.current_task_id {
        lines.push(Line::from(vec![
            Span::styled("Task:       ", Style::default().fg(Color::DarkGray)),
            Span::styled(task_id.clone(), Style::default().fg(Color::White)),
        ]));
    }
    if let Some(model) = config.map(|c| c.model.as_str()).filter(|m| !m.is_empty()) {
        lines.push(Line::from(vec![
            Span::styled("Model:      ", Style::default().fg(Color::DarkGray)),
            Span::styled(model.to_owned(), Style::default().fg(Color::White)),
        ]));
    }
    if let Some(budget) = config.and_then(|c| c.max_budget_usd) {
        lines.push(Line::from(vec![
            Span::styled("Budget:     ", Style::default().fg(Color::DarkGray)),
            Span::styled(format!("${:.2}", budget), Style::default().fg(Color::White)),
        ]));
    }
    if let Some(turns) = config.and_then(|c| c.max_turns) {
        lines.push(Line::from(vec![
            Span::styled("Max turns:  ", Style::default().fg(Color::DarkGray)),
            Span::styled(format!("{}", turns), Style::default().fg(Color::White)),
        ]));
    }
    if let Some(err) = &agent.error {
        lines.push(Line::raw(""));
        lines.push(Line::from(vec![
            Span::styled("Error: ", Style::default().fg(Color::Red)),
            Span::styled(err.clone(), Style::default().fg(Color::Red)),
        ]));
    }

    // Tool counts
    let tool_count = state.tool_uses.get(agent_id).map(|v| v.len()).unwrap_or(0);
    let msg_count = state.agent_messages.get(agent_id).map(|v| v.len()).unwrap_or(0);
    lines.push(Line::raw(""));
    lines.push(Line::from(vec![
        Span::styled("Messages:   ", Style::default().fg(Color::DarkGray)),
        Span::styled(format!("{}", msg_count), Style::default().fg(Color::White)),
    ]));
    lines.push(Line::from(vec![
        Span::styled("Tool calls: ", Style::default().fg(Color::DarkGray)),
        Span::styled(format!("{}", tool_count), Style::default().fg(Color::White)),
    ]));

    // Allowed tools
    if let Some(tools) = config.map(|c| &c.tools).filter(|t| !t.is_empty()) {
        lines.push(Line::raw(""));
        lines.push(Line::styled("Tools:", Style::default().fg(Color::DarkGray)));
        for tool in tools {
            lines.push(Line::from(vec![
                Span::raw("  · "),
                Span::styled(tool.clone(), Style::default().fg(Color::Gray)),
            ]));
        }
    }

    let scroll = state.scroll_offset() as u16;
    let p = Paragraph::new(lines)
        .block(Block::default().borders(Borders::ALL).title(" Status "))
        .wrap(Wrap { trim: false })
        .scroll((scroll, 0));
    f.render_widget(p, area);
}

fn render_prompt(f: &mut Frame, area: Rect, state: &AppState, agent_id: &str) {
    let prompt = state.agents.iter()
        .find(|a| a.id == agent_id)
        .and_then(|a| a.config.as_ref())
        .map(|c| c.system_prompt.clone())
        .unwrap_or_else(|| "(no system prompt available)".into());

    let scroll = state.scroll_offset() as u16;
    let p = Paragraph::new(prompt)
        .block(Block::default().borders(Borders::ALL).title(" System Prompt "))
        .style(Style::default().fg(Color::Gray))
        .wrap(Wrap { trim: false })
        .scroll((scroll, 0));
    f.render_widget(p, area);
}

fn render_messages(f: &mut Frame, area: Rect, state: &AppState, agent_id: &str) {
    let inner_width = area.width.saturating_sub(2) as usize;
    let mut lines: Vec<Line<'static>> = Vec::new();

    if let Some(msgs) = state.agent_messages.get(agent_id) {
        if msgs.is_empty() {
            lines.push(Line::styled(
                "No messages yet.",
                Style::default().fg(Color::DarkGray),
            ));
        } else {
            for msg in msgs {
                render_message(&mut lines, &msg.role, &msg.content, inner_width);
            }
        }
    } else {
        lines.push(Line::styled(
            "No messages yet.",
            Style::default().fg(Color::DarkGray),
        ));
    }

    let scroll = state.scroll_offset() as u16;
    let p = Paragraph::new(lines)
        .block(Block::default().borders(Borders::ALL).title(" Messages "))
        .wrap(Wrap { trim: false })
        .scroll((scroll, 0));
    f.render_widget(p, area);
}

fn render_tool_log(f: &mut Frame, area: Rect, state: &AppState, agent_id: &str) {
    let mut lines: Vec<Line<'static>> = Vec::new();

    let entries = state.tool_uses.get(agent_id);
    match entries {
        None => {
            lines.push(Line::styled(
                "No tool calls yet.",
                Style::default().fg(Color::DarkGray),
            ));
        }
        Some(entries) if entries.is_empty() => {
            lines.push(Line::styled(
                "No tool calls yet.",
                Style::default().fg(Color::DarkGray),
            ));
        }
        Some(entries) => {
            for (i, entry) in entries.iter().enumerate() {
                let (result_icon, result_color) = match &entry.result {
                    None => ("⏳", Color::Yellow),
                    Some(r) if r.is_error => ("✗", Color::Red),
                    Some(_) => ("✓", Color::Green),
                };

                // Parse input JSON to get a brief summary
                let input_summary = summarize_tool_input(&entry.tool_name, &entry.input_json);

                lines.push(Line::from(vec![
                    Span::styled(
                        format!("[{:>3}] ", i + 1),
                        Style::default().fg(Color::DarkGray),
                    ),
                    Span::styled(result_icon.to_owned(), Style::default().fg(result_color)),
                    Span::raw(" "),
                    Span::styled(
                        entry.tool_name.clone(),
                        Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD),
                    ),
                    Span::styled(
                        format!("({})", input_summary),
                        Style::default().fg(Color::Gray),
                    ),
                ]));

                // Show error output if present
                if let Some(result) = &entry.result {
                    if result.is_error && !result.output.is_empty() {
                        let truncated = if result.output.len() > 120 {
                            format!("{}…", &result.output[..119])
                        } else {
                            result.output.clone()
                        };
                        lines.push(Line::from(vec![
                            Span::raw("       "),
                            Span::styled(truncated, Style::default().fg(Color::Red)),
                        ]));
                    }
                }
            }
        }
    }

    let scroll = state.scroll_offset() as u16;
    let p = Paragraph::new(lines)
        .block(Block::default().borders(Borders::ALL).title(" Tool Log "))
        .wrap(Wrap { trim: false })
        .scroll((scroll, 0));
    f.render_widget(p, area);
}

/// Produce a short human-readable summary of a tool call's input.
fn summarize_tool_input(tool_name: &str, input_json: &str) -> String {
    // Try to extract the most relevant field from the JSON
    let v: serde_json::Value = match serde_json::from_str(input_json) {
        Ok(v) => v,
        Err(_) => return truncate(input_json, 60),
    };

    // Common patterns per tool name
    let summary = match tool_name {
        "Read" | "read_file" => v.get("file_path").or_else(|| v.get("path")),
        "Write" | "write_file" => v.get("file_path").or_else(|| v.get("path")),
        "Edit" | "edit_file" => v.get("file_path").or_else(|| v.get("path")),
        "Glob" => v.get("pattern"),
        "Grep" => v.get("pattern"),
        "Bash" => v.get("command"),
        "emit_milestone" | "wait_for_milestone" => v.get("milestone_id"),
        _ => None,
    };

    if let Some(s) = summary.and_then(|v| v.as_str()) {
        return truncate(s, 60);
    }

    // Fall back: first string field value
    if let Some(obj) = v.as_object() {
        for (_, val) in obj.iter() {
            if let Some(s) = val.as_str() {
                return truncate(s, 60);
            }
        }
    }

    truncate(input_json, 60)
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}…", &s[..max.saturating_sub(1)])
    }
}
