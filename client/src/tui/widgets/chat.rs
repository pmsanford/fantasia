use ratatui::{
    layout::Rect,
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph, Wrap},
    Frame,
};

use crate::app::{state::MessageRole, AppState};

pub fn render(f: &mut Frame, area: Rect, state: &AppState) {
    let inner_width = area.width.saturating_sub(2) as usize;

    let mut lines: Vec<Line<'static>> = Vec::new();

    for msg in &state.messages {
        render_message(&mut lines, &msg.role, &msg.content, inner_width);
    }

    // In-progress partial message
    if let Some(partial) = &state.partial_message {
        let cursor = if state.blink_state { "█" } else { " " };
        let content = format!("{}{}", partial.content, cursor);
        let role = MessageRole::Agent(partial.agent_name.clone());
        render_message(&mut lines, &role, &content, inner_width);
    } else if state.submitting {
        // Show thinking indicator while waiting for first response
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

    let visible = area.height.saturating_sub(2) as usize;

    // Instead of trying to match ratatui's internal wrapping math,
    // render into a throwaway Paragraph to get the exact line count.
    // Paragraph::line_count is private in 0.29, so we render to a buffer.
    let scratch = Paragraph::new(lines.clone())
        .wrap(Wrap { trim: false });
    // Render to an offscreen buffer tall enough to hold everything.
    // Use a generous height; ratatui will lay out all lines.
    let big_height = (lines.len() as u16 * 4).max(visible as u16).max(100);
    let scratch_area = Rect::new(0, 0, area.width.saturating_sub(2), big_height);
    let total_lines = {
        use ratatui::buffer::Buffer;
        use ratatui::widgets::Widget;
        let mut buf = Buffer::empty(scratch_area);
        scratch.render(scratch_area, &mut buf);
        // Find the last non-empty row
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
    let scroll = max_scroll.saturating_sub(state.scroll_offset) as u16;

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
