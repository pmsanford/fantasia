use ratatui::{
    layout::Rect,
    style::{Color, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph, Wrap},
    Frame,
};

use crate::app::AppState;

pub fn render(f: &mut Frame, area: Rect, state: &AppState) {
    let block = Block::default()
        .borders(Borders::ALL)
        .title(" Message ");

    if state.input_buffer.is_empty() {
        let text = Line::from(Span::styled(
            "Type a message (Enter to send, Shift+Enter for newline, Esc to quit)",
            Style::default().fg(Color::DarkGray),
        ));
        let paragraph = Paragraph::new(text)
            .block(block)
            .wrap(Wrap { trim: false });
        f.render_widget(paragraph, area);
        return;
    }

    // Build lines from the input buffer, inserting cursor highlight
    let buf = &state.input_buffer;
    let pos = state.cursor_position.min(buf.len());
    let before = &buf[..pos];
    let after = &buf[pos..];

    // Split into: text before cursor (may contain newlines),
    // cursor character, text after cursor (may contain newlines)
    let cursor_char = after.chars().next();
    let after_cursor = match cursor_char {
        Some(c) => &after[c.len_utf8()..],
        None => "",
    };

    let cursor_style = Style::default().bg(Color::White).fg(Color::Black);
    let prompt_style = Style::default().fg(Color::Yellow);

    let mut lines: Vec<Line<'static>> = Vec::new();

    // Split "before" into lines
    let before_lines: Vec<&str> = before.split('\n').collect();
    for (i, bl) in before_lines.iter().enumerate() {
        let mut spans = Vec::new();
        if i == 0 {
            spans.push(Span::styled("> ", prompt_style));
        }
        let is_last_before = i == before_lines.len() - 1;
        if is_last_before {
            // This line continues with the cursor
            spans.push(Span::raw(bl.to_string()));
            // Add cursor
            match cursor_char {
                Some('\n') => {
                    spans.push(Span::styled(" ", cursor_style));
                    lines.push(Line::from(spans));
                    // The newline after cursor starts the "after" portion
                    let after_lines: Vec<&str> = after_cursor.split('\n').collect();
                    for al in &after_lines {
                        lines.push(Line::from(Span::raw(al.to_string())));
                    }
                    let paragraph = Paragraph::new(lines)
                        .block(block)
                        .wrap(Wrap { trim: false });
                    f.render_widget(paragraph, area);
                    return;
                }
                Some(c) => {
                    spans.push(Span::styled(c.to_string(), cursor_style));
                    // Rest after cursor char, on same line until newline
                    let after_lines: Vec<&str> = after_cursor.split('\n').collect();
                    if !after_lines.is_empty() {
                        spans.push(Span::raw(after_lines[0].to_string()));
                    }
                    lines.push(Line::from(spans));
                    // Remaining after-cursor lines
                    for al in after_lines.iter().skip(1) {
                        lines.push(Line::from(Span::raw(al.to_string())));
                    }
                }
                None => {
                    // Cursor at end of input
                    spans.push(Span::styled(" ", cursor_style));
                    lines.push(Line::from(spans));
                }
            }
        } else {
            spans.push(Span::raw(bl.to_string()));
            lines.push(Line::from(spans));
        }
    }

    let paragraph = Paragraph::new(lines)
        .block(block)
        .wrap(Wrap { trim: false });
    f.render_widget(paragraph, area);
}
