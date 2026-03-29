pub mod widgets;

use std::io::stdout;

use crossterm::{
    event::{
        EnableMouseCapture, DisableMouseCapture, EventStream, KeyCode, KeyEvent, KeyModifiers,
        MouseEvent, MouseEventKind,
    },
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{backend::CrosstermBackend, Terminal};
use tokio::sync::mpsc;
use tokio_stream::StreamExt;

use crate::app::{AppAction, AppEvent, AppState};
use crate::app::update::update;

pub async fn run_tui(
    mut event_rx: mpsc::Receiver<AppEvent>,
    action_tx: mpsc::Sender<AppAction>,
) -> anyhow::Result<()> {
    // Set up terminal
    enable_raw_mode()?;
    let mut stdout = stdout();
    execute!(stdout, EnterAlternateScreen, EnableMouseCapture)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let mut state = AppState::new();
    state.push_message(
        crate::app::state::MessageRole::System,
        "Connecting to Fantasia server…".into(),
    );

    let mut key_events = EventStream::new();
    let mut render_interval = tokio::time::interval(tokio::time::Duration::from_millis(33));

    let result = run_loop(
        &mut terminal,
        &mut state,
        &mut event_rx,
        &action_tx,
        &mut key_events,
        &mut render_interval,
    )
    .await;

    // Restore terminal
    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen, DisableMouseCapture)?;
    terminal.show_cursor()?;

    result
}

async fn run_loop(
    terminal: &mut Terminal<CrosstermBackend<std::io::Stdout>>,
    state: &mut AppState,
    event_rx: &mut mpsc::Receiver<AppEvent>,
    action_tx: &mpsc::Sender<AppAction>,
    key_events: &mut EventStream,
    render_interval: &mut tokio::time::Interval,
) -> anyhow::Result<()> {
    loop {
        tokio::select! {
            // Render tick
            _ = render_interval.tick() => {
                state.tick_status();
                state.tick_blink();
                terminal.draw(|f| widgets::render(f, state))?;
            }

            // Network event
            Some(app_event) = event_rx.recv() => {
                update(state, app_event);
                terminal.draw(|f| widgets::render(f, state))?;
            }

            // Terminal event (key or mouse)
            Some(Ok(event)) = key_events.next() => {
                match event {
                    crossterm::event::Event::Key(key) => {
                        if let Some(action) = handle_key(key, state) {
                            match action {
                                AppAction::Quit => {
                                    let _ = action_tx.send(AppAction::Quit).await;
                                    return Ok(());
                                }
                                other => {
                                    let _ = action_tx.send(other).await;
                                }
                            }
                        }
                        terminal.draw(|f| widgets::render(f, state))?;
                    }
                    crossterm::event::Event::Mouse(mouse) => {
                        handle_mouse(mouse, state);
                        terminal.draw(|f| widgets::render(f, state))?;
                    }
                    _ => {}
                }
            }
        }
    }
}

fn handle_key(key: KeyEvent, state: &mut AppState) -> Option<AppAction> {
    let ctrl = key.modifiers.contains(KeyModifiers::CONTROL);
    let alt = key.modifiers.contains(KeyModifiers::ALT);
    let shift = key.modifiers.contains(KeyModifiers::SHIFT);

    match key.code {
        // Quit
        KeyCode::Char('c') if ctrl => return Some(AppAction::Quit),

        // Clear input
        KeyCode::Esc => {
            state.input_buffer.clear();
            state.cursor_position = 0;
        }

        // Delete to beginning of line
        KeyCode::Char('u') if ctrl => {
            state.input_buffer.drain(..state.cursor_position);
            state.cursor_position = 0;
        }

        // Send message
        KeyCode::Enter if !shift && !alt => {
            let msg = state.take_input();
            if !msg.trim().is_empty() {
                state.push_message(crate::app::state::MessageRole::User, msg.clone());
                state.submitting = true;
                return Some(AppAction::Submit(msg));
            }
        }

        // Newline in input
        KeyCode::Enter if shift || alt => {
            state.insert_char('\n');
        }

        // Text input
        KeyCode::Char(c) if !ctrl => {
            state.insert_char(c);
        }

        // Editing
        KeyCode::Backspace => state.delete_before_cursor(),
        KeyCode::Left => state.move_cursor_left(),
        KeyCode::Right => state.move_cursor_right(),
        KeyCode::Home => state.cursor_position = 0,
        KeyCode::End => state.cursor_position = state.input_buffer.len(),

        // Chat scrolling
        KeyCode::PageUp => state.scroll_offset += 5,
        KeyCode::PageDown => {
            state.scroll_offset = state.scroll_offset.saturating_sub(5);
        }

        _ => {}
    }

    None
}

fn handle_mouse(mouse: MouseEvent, state: &mut AppState) {
    match mouse.kind {
        MouseEventKind::ScrollUp => {
            state.scroll_offset = state.scroll_offset.saturating_add(3);
        }
        MouseEventKind::ScrollDown => {
            state.scroll_offset = state.scroll_offset.saturating_sub(3);
        }
        _ => {}
    }
}
