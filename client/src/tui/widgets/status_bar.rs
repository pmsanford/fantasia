use ratatui::{
    layout::Rect,
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::Paragraph,
    Frame,
};

use crate::app::AppState;
use crate::proto::{AgentRole, AgentStatus};

pub fn render(f: &mut Frame, area: Rect, state: &AppState) {
    // Line 1: agent status pills
    let mut spans: Vec<Span> = vec![Span::styled(
        " Fantasia ",
        Style::default()
            .fg(Color::Cyan)
            .add_modifier(Modifier::BOLD),
    )];

    if state.agents.is_empty() {
        spans.push(Span::styled(
            if state.orchestrator_running {
                " [connecting…]"
            } else {
                " [not running]"
            },
            Style::default().fg(Color::DarkGray),
        ));
    } else {
        for agent in &state.agents {
            let role_name = AgentRole::try_from(agent.config.as_ref().map(|c| c.role).unwrap_or(0))
                .map(|r| r.as_str())
                .unwrap_or("?");
            let status = AgentStatus::try_from(agent.status).unwrap_or(AgentStatus::Unspecified);
            let color = match status {
                AgentStatus::Idle => Color::Green,
                AgentStatus::Working => Color::Yellow,
                AgentStatus::Waiting => Color::Blue,
                AgentStatus::Error => Color::Red,
                AgentStatus::Terminated => Color::DarkGray,
                AgentStatus::Unspecified => Color::DarkGray,
            };
            spans.push(Span::raw(" "));
            spans.push(Span::styled(
                format!("[{}:{}]", role_name, status.as_str()),
                Style::default().fg(color),
            ));
        }
    }

    let line1 = Line::from(spans);

    // Line 2: task counts + cost + status message
    let task_info = format!(
        " Tasks: {} pending / {} active / {} done / {} failed",
        state.task_counts.pending,
        state.task_counts.active,
        state.task_counts.completed,
        state.task_counts.failed,
    );
    let cost_info = format!("  Cost: ${:.4}", state.total_cost_usd);

    let mut line2_spans = vec![
        Span::styled(task_info, Style::default().fg(Color::DarkGray)),
        Span::styled(cost_info, Style::default().fg(Color::DarkGray)),
    ];

    // Last server update
    let update_text = match &state.last_server_update {
        Some(t) => {
            let secs = t.elapsed().as_secs();
            if secs < 5 {
                "  Updated: just now".to_string()
            } else if secs < 60 {
                format!("  Updated: {}s ago", secs)
            } else {
                format!("  Updated: {}m ago", secs / 60)
            }
        }
        None => "  Updated: never".to_string(),
    };
    line2_spans.push(Span::styled(update_text, Style::default().fg(Color::DarkGray)));

    if let Some((msg, _)) = &state.status_line {
        line2_spans.push(Span::styled(
            format!("  {}", msg),
            Style::default().fg(Color::Red),
        ));
    }

    let line2 = Line::from(line2_spans);

    let paragraph = Paragraph::new(vec![line1, line2]);
    f.render_widget(paragraph, area);
}
