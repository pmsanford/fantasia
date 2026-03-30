use ratatui::{
    layout::{Constraint, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph, Wrap},
    Frame,
};

use crate::app::{state::MessageRole, AppState};

pub fn render(f: &mut Frame, area: Rect, state: &AppState) {
    // Split area: 1 line for tabs, rest for chat
    let chunks = Layout::vertical([
        Constraint::Length(1),  // tab bar
        Constraint::Fill(1),   // chat content
    ])
    .split(area);

    render_tab_bar(f, chunks[0], state);
    render_chat(f, chunks[1], state);
}

fn render_tab_bar(f: &mut Frame, area: Rect, state: &AppState) {
    let mut spans: Vec<Span<'static>> = Vec::new();
    spans.push(Span::raw(" "));
    for (i, tab) in state.tabs.iter().enumerate() {
        if i == state.active_tab {
            spans.push(Span::styled(
                format!(" {} ", tab.name),
                Style::default()
                    .fg(Color::Black)
                    .bg(Color::White)
                    .add_modifier(Modifier::BOLD),
            ));
        } else {
            spans.push(Span::styled(
                format!(" {} ", tab.name),
                Style::default().fg(Color::DarkGray),
            ));
        }
        spans.push(Span::raw(" "));
    }
    spans.push(Span::styled(
        "(Tab/Shift+Tab to switch)",
        Style::default().fg(Color::DarkGray),
    ));
    f.render_widget(Line::from(spans), area);
}

fn render_chat(f: &mut Frame, area: Rect, state: &AppState) {
    let inner_width = area.width.saturating_sub(2) as usize;
    let active_filter = &state.tabs[state.active_tab].filter;

    let mut lines: Vec<Line<'static>> = Vec::new();

    for msg in &state.messages {
        if active_filter.matches(&msg.role) {
            render_message(&mut lines, &msg.role, &msg.content, inner_width);
        }
    }

    // In-progress partial message
    if let Some(partial) = &state.partial_message {
        let role = MessageRole::Agent(partial.agent_name.clone());
        if active_filter.matches(&role) {
            let cursor = if state.blink_state { "█" } else { " " };
            let content = format!("{}{}", partial.content, cursor);
            render_message(&mut lines, &role, &content, inner_width);
        }
    } else if state.submitting {
        // Show thinking indicator while waiting for first response (always on Mickey tab)
        let mickey_role = MessageRole::Agent("Mickey".into());
        if active_filter.matches(&mickey_role) {
            let dots = match (state.last_blink.elapsed().as_millis() / 500) % 3 {
                0 => ".",
                1 => "..",
                _ => "...",
            };
            lines.push(Line::from(vec![
                Span::styled(
                    "Mickey",
                    Style::default()
                        .fg(Color::Cyan)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(
                    format!(": thinking{}", dots),
                    Style::default()
                        .fg(Color::DarkGray)
                        .add_modifier(Modifier::ITALIC),
                ),
            ]));
            lines.push(Line::raw(""));
        }
    }

    let visible = area.height.saturating_sub(2) as usize;

    let scratch = Paragraph::new(lines.clone())
        .wrap(Wrap { trim: false });
    let big_height = (lines.len() as u16 * 4).max(visible as u16).max(100);
    let scratch_area = Rect::new(0, 0, area.width.saturating_sub(2), big_height);
    let total_lines = {
        use ratatui::buffer::Buffer;
        use ratatui::widgets::Widget;
        let mut buf = Buffer::empty(scratch_area);
        scratch.render(scratch_area, &mut buf);
        let mut last_row = 0usize;
        for y in 0..big_height {
            for x in 0..scratch_area.width {
                let cell = &buf[(x, y)];
                if cell.symbol() != " " {
                    last_row = y as usize + 1;
                }
            }
        }
        last_row
    };

    let max_scroll = total_lines.saturating_sub(visible);
    let scroll = max_scroll.saturating_sub(state.scroll_offset()) as u16;

    let paragraph = Paragraph::new(lines)
        .block(Block::default().borders(Borders::ALL).title(" Chat "))
        .wrap(Wrap { trim: false })
        .scroll((scroll, 0));
    f.render_widget(paragraph, area);
}

fn agent_color(name: &str) -> Color {
    match name {
        "Mickey" => Color::Cyan,
        "Yen Sid" => Color::Magenta,
        "Chernabog" => Color::Red,
        "Broomstick" => Color::Green,
        "Imagineer" => Color::Yellow,
        "Jacchus" => Color::Blue,
        _ => Color::White,
    }
}

fn render_message(
    lines: &mut Vec<Line<'static>>,
    role: &MessageRole,
    content: &str,
    _width: usize,
) {
    match role {
        MessageRole::User => {
            let mut content_lines = content.lines();
            let first = content_lines.next().unwrap_or("").to_owned();
            lines.push(Line::from(vec![
                Span::styled(
                    "You",
                    Style::default()
                        .fg(Color::White)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::raw(": "),
                Span::styled(first, Style::default().fg(Color::White)),
            ]));
            for rest in content_lines {
                lines.push(Line::from(vec![
                    Span::raw("     "),
                    Span::styled(rest.to_owned(), Style::default().fg(Color::White)),
                ]));
            }
        }

        MessageRole::Agent(name) => {
            let color = agent_color(name);
            let indent = " ".repeat(name.len() + 2);
            let mut content_lines = content.lines();
            let first = content_lines.next().unwrap_or("").to_owned();
            lines.push(Line::from(vec![
                Span::styled(
                    name.clone(),
                    Style::default().fg(color).add_modifier(Modifier::BOLD),
                ),
                Span::raw(": "),
                Span::styled(first, Style::default().fg(color)),
            ]));
            for rest in content_lines {
                lines.push(Line::from(vec![
                    Span::raw(indent.clone()),
                    Span::styled(rest.to_owned(), Style::default().fg(color)),
                ]));
            }
        }

        MessageRole::System => {
            lines.push(Line::from(vec![
                Span::raw("  · "),
                Span::styled(content.to_owned(), Style::default().fg(Color::DarkGray)),
            ]));
        }
    }

    // Blank line between messages
    lines.push(Line::raw(""));
}
