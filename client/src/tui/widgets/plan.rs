use ratatui::{
    layout::Rect,
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph, Wrap},
    Frame,
};

use crate::app::{
    state::TabKind,
    AppState,
};
use crate::proto::{AgentStatus, TaskStatus};

pub fn render(f: &mut Frame, area: Rect, state: &AppState) {
    // Get selected index from tab kind
    let selected_index = match &state.tabs[state.active_tab].kind {
        TabKind::Plan { selected_index, .. } => *selected_index,
        _ => return,
    };

    // Find the most relevant task with a plan
    let task = match state.active_plan_task() {
        Some(t) => t,
        None => {
            let p = Paragraph::new("No plan available yet. Submit a complex task to see workstreams here.")
                .block(Block::default().borders(Borders::ALL).title(" Plan "))
                .style(Style::default().fg(Color::DarkGray))
                .wrap(Wrap { trim: false });
            f.render_widget(p, area);
            return;
        }
    };

    let plan = match &task.plan {
        Some(p) => p,
        None => return,
    };

    let task_status = TaskStatus::try_from(task.status).unwrap_or(TaskStatus::Unspecified);
    let status_color = task_status_color(task_status);

    // Build lines for the plan view
    let mut lines: Vec<Line<'static>> = Vec::new();

    // Header: task description + status
    let status_label = task_status_label(task_status);
    lines.push(Line::from(vec![
        Span::styled("Task: ", Style::default().fg(Color::DarkGray)),
        Span::styled(
            truncate(&task.description, 80),
            Style::default().fg(Color::White).add_modifier(Modifier::BOLD),
        ),
        Span::raw("  "),
        Span::styled(
            format!("[{}]", status_label),
            Style::default().fg(status_color).add_modifier(Modifier::BOLD),
        ),
    ]));
    lines.push(Line::raw(""));

    // Plan summary
    if !plan.summary.is_empty() {
        lines.push(Line::from(vec![
            Span::styled("Summary: ", Style::default().fg(Color::DarkGray)),
            Span::styled(plan.summary.clone(), Style::default().fg(Color::White)),
        ]));
        lines.push(Line::raw(""));
    }

    // Plan context
    if let Some(ctx) = &plan.context {
        if !ctx.is_empty() {
            lines.push(Line::styled("Context:", Style::default().fg(Color::DarkGray)));
            for cline in ctx.lines() {
                lines.push(Line::from(vec![
                    Span::raw("  "),
                    Span::styled(cline.to_owned(), Style::default().fg(Color::Gray)),
                ]));
            }
            lines.push(Line::raw(""));
        }
    }

    // Workstreams section
    if !plan.workstreams.is_empty() {
        lines.push(Line::styled(
            "─── Workstreams ─────────────────────────────────────────",
            Style::default().fg(Color::DarkGray),
        ));
        lines.push(Line::raw(""));

        for (i, ws) in plan.workstreams.iter().enumerate() {
            let is_selected = i == selected_index;

            // Determine workstream status from agent
            let agent = state.agent_for_workstream(&ws.name);
            let (ws_status_label, ws_status_color) = workstream_status(state, &ws.name, &ws.emits.iter().map(|m| m.id.as_str()).collect::<Vec<_>>());

            // Workstream name line
            let selector = if is_selected { "▶ " } else { "  " };
            let name_style = if is_selected {
                Style::default().fg(Color::White).add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(Color::Gray)
            };

            lines.push(Line::from(vec![
                Span::styled(selector.to_owned(), Style::default().fg(Color::Cyan)),
                Span::styled(
                    format!("[{}] ", ws_status_label),
                    Style::default().fg(ws_status_color).add_modifier(Modifier::BOLD),
                ),
                Span::styled(ws.name.clone(), name_style),
                if let Some(agent) = agent {
                    Span::styled(
                        format!("  ({})", agent.config.as_ref().map(|c| c.name.as_str()).unwrap_or("?")),
                        Style::default().fg(Color::DarkGray),
                    )
                } else {
                    Span::raw("")
                },
            ]));

            // Description (truncated)
            if is_selected || plan.workstreams.len() <= 5 {
                lines.push(Line::from(vec![
                    Span::raw("     "),
                    Span::styled(
                        truncate(&ws.description, 100),
                        Style::default().fg(Color::DarkGray),
                    ),
                ]));
            }

            // Milestones this workstream emits
            for m in &ws.emits {
                let reached = state.milestone_reached(&m.id);
                let (icon, color) = if reached { ("✓", Color::Green) } else { ("○", Color::DarkGray) };
                lines.push(Line::from(vec![
                    Span::raw("     "),
                    Span::styled("emits: ", Style::default().fg(Color::DarkGray)),
                    Span::styled(
                        format!("{} {}", icon, m.id),
                        Style::default().fg(color),
                    ),
                ]));
            }

            // Milestones this workstream waits for
            for m in &ws.waits_for {
                let reached = state.milestone_reached(&m.id);
                let (icon, color) = if reached { ("✓", Color::Green) } else { ("⏳", Color::Yellow) };
                lines.push(Line::from(vec![
                    Span::raw("     "),
                    Span::styled("waits: ", Style::default().fg(Color::DarkGray)),
                    Span::styled(
                        format!("{} {}", icon, m.id),
                        Style::default().fg(color),
                    ),
                ]));
            }

            if is_selected {
                lines.push(Line::from(vec![
                    Span::raw("     "),
                    Span::styled(
                        "↵ Enter to view agent detail",
                        Style::default().fg(Color::DarkGray).add_modifier(Modifier::ITALIC),
                    ),
                ]));
            }

            lines.push(Line::raw(""));
        }

        // DAG visualization
        render_dag(&mut lines, state, plan);
    } else {
        // No workstreams yet — show task stage info
        lines.push(Line::from(vec![
            Span::styled("Stage: ", Style::default().fg(Color::DarkGray)),
            Span::styled(task_status_label(task_status), Style::default().fg(status_color)),
        ]));
    }

    // Navigation hint at bottom
    lines.push(Line::styled(
        "↑/↓ select workstream  ↵ view agent  Tab/Shift+Tab switch tabs",
        Style::default().fg(Color::DarkGray).add_modifier(Modifier::ITALIC),
    ));

    let scroll = state.scroll_offset() as u16;
    let paragraph = Paragraph::new(lines)
        .block(Block::default().borders(Borders::ALL).title(" Plan "))
        .wrap(Wrap { trim: false })
        .scroll((scroll, 0));
    f.render_widget(paragraph, area);
}

fn render_dag(lines: &mut Vec<Line<'static>>, state: &AppState, plan: &crate::proto::TaskPlan) {
    // Build a list of dependency edges: (emitter_name, milestone_id, waiter_name)
    let mut edges: Vec<(String, String, String)> = Vec::new();
    for ws in &plan.workstreams {
        for m in &ws.waits_for {
            // Find who emits this milestone
            if let Some(emitter) = plan.workstreams.iter().find(|w| w.emits.iter().any(|e| e.id == m.id)) {
                edges.push((emitter.name.clone(), m.id.clone(), ws.name.clone()));
            }
        }
    }

    if edges.is_empty() {
        return;
    }

    lines.push(Line::styled(
        "─── Dependency Graph ─────────────────────────────────────",
        Style::default().fg(Color::DarkGray),
    ));
    lines.push(Line::raw(""));

    for (emitter, milestone_id, waiter) in &edges {
        let reached = state.milestone_reached(milestone_id);
        let (icon, mid_color) = if reached { ("✓", Color::Green) } else { ("⏳", Color::Yellow) };
        lines.push(Line::from(vec![
            Span::styled(
                format!("[{}]", truncate(emitter, 18)),
                Style::default().fg(Color::Cyan),
            ),
            Span::styled(" ─── ", Style::default().fg(Color::DarkGray)),
            Span::styled(
                format!("{} {}", icon, truncate(milestone_id, 24)),
                Style::default().fg(mid_color),
            ),
            Span::styled(" ──→ ", Style::default().fg(Color::DarkGray)),
            Span::styled(
                format!("[{}]", truncate(waiter, 18)),
                Style::default().fg(Color::Cyan),
            ),
        ]));
    }
    lines.push(Line::raw(""));
}

fn workstream_status<'a>(
    state: &AppState,
    workstream_name: &str,
    emits: &[&str],
) -> (&'static str, Color) {
    // Check if all emitted milestones are reached → DONE
    if !emits.is_empty() && emits.iter().all(|id| state.milestone_reached(id)) {
        return ("DONE", Color::Green);
    }

    // Check agent status
    if let Some(agent) = state.agent_for_workstream(workstream_name) {
        let status = AgentStatus::try_from(agent.status).unwrap_or(AgentStatus::Unspecified);
        return match status {
            AgentStatus::Working => ("WORK", Color::Yellow),
            AgentStatus::Waiting => ("WAIT", Color::Blue),
            AgentStatus::Error => ("FAIL", Color::Red),
            AgentStatus::Terminated => {
                // Terminated without all milestones → done or failed
                ("DONE", Color::Green)
            }
            AgentStatus::Idle => ("IDLE", Color::DarkGray),
            _ => ("PEND", Color::DarkGray),
        };
    }

    ("PEND", Color::DarkGray)
}

fn task_status_color(status: TaskStatus) -> Color {
    match status {
        TaskStatus::Planning => Color::Magenta,
        TaskStatus::Reviewing => Color::Yellow,
        TaskStatus::InProgress => Color::Cyan,
        TaskStatus::Completed => Color::Green,
        TaskStatus::Failed => Color::Red,
        TaskStatus::Blocked => Color::Red,
        _ => Color::DarkGray,
    }
}

fn task_status_label(status: TaskStatus) -> &'static str {
    match status {
        TaskStatus::Unspecified => "?",
        TaskStatus::Pending => "PENDING",
        TaskStatus::Planning => "PLANNING",
        TaskStatus::Reviewing => "REVIEWING",
        TaskStatus::InProgress => "IN PROGRESS",
        TaskStatus::Blocked => "BLOCKED",
        TaskStatus::Completed => "COMPLETED",
        TaskStatus::Failed => "FAILED",
    }
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}…", &s[..max.saturating_sub(1)])
    }
}

/// Move the selected workstream index up/down.
pub fn move_selection(state: &mut AppState, delta: i32) {
    let task_workstream_count = state
        .active_plan_task()
        .and_then(|t| t.plan.as_ref())
        .map(|p| p.workstreams.len())
        .unwrap_or(0);

    if task_workstream_count == 0 {
        return;
    }

    if let TabKind::Plan { selected_index, .. } = &mut state.tabs[state.active_tab].kind {
        let new = (*selected_index as i32 + delta)
            .rem_euclid(task_workstream_count as i32) as usize;
        *selected_index = new;
    }
}

/// Get the agent_id for the currently selected workstream, if any.
pub fn selected_workstream_agent(state: &AppState) -> Option<(String, String)> {
    let selected_index = match &state.tabs[state.active_tab].kind {
        TabKind::Plan { selected_index, .. } => *selected_index,
        _ => return None,
    };

    let task = state.active_plan_task()?;
    let plan = task.plan.as_ref()?;
    let ws = plan.workstreams.get(selected_index)?;
    let agent = state.agent_for_workstream(&ws.name)?;
    let agent_name = agent.config.as_ref().map(|c| c.name.clone()).unwrap_or_else(|| "Agent".into());
    Some((agent.id.clone(), agent_name))
}
