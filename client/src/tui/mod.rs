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
use crate::app::state::TabKind;
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

    // Determine active tab kind for context-sensitive bindings
    let tab_kind = state.tabs[state.active_tab].kind.clone();

    match key.code {
        // Quit
        KeyCode::Char('c') if ctrl => return Some(AppAction::Quit),

        // Escape: close AgentDetail tab or clear input
        KeyCode::Esc => {
            if matches!(tab_kind, TabKind::AgentDetail { .. }) {
                state.close_active_tab();
            } else {
                state.input_buffer.clear();
                state.cursor_position = 0;
            }
        }

        // Delete to beginning of line
        KeyCode::Char('u') if ctrl => {
            state.input_buffer.drain(..state.cursor_position);
            state.cursor_position = 0;
        }

        // Context-sensitive Up/Down
        KeyCode::Up => {
            match tab_kind {
                TabKind::Plan { .. } => {
                    widgets::plan::move_selection(state, -1);
                }
                _ => {
                    let v = state.scroll_offset_mut();
                    *v = v.saturating_add(1);
                }
            }
        }
        KeyCode::Down => {
            match tab_kind {
                TabKind::Plan { .. } => {
                    widgets::plan::move_selection(state, 1);
                }
                _ => {
                    let v = state.scroll_offset_mut();
                    *v = v.saturating_sub(1);
                }
            }
        }

        // Left/Right: switch AgentDetail sub-tabs
        KeyCode::Left if matches!(tab_kind, TabKind::AgentDetail { .. }) => {
            if let TabKind::AgentDetail { sub_tab, scroll_offset, .. } =
                &mut state.tabs[state.active_tab].kind
            {
                *sub_tab = sub_tab.prev();
                *scroll_offset = 0;
            }
        }
        KeyCode::Right if matches!(tab_kind, TabKind::AgentDetail { .. }) => {
            if let TabKind::AgentDetail { sub_tab, scroll_offset, .. } =
                &mut state.tabs[state.active_tab].kind
            {
                *sub_tab = sub_tab.next();
                *scroll_offset = 0;
            }
        }

        // Enter on Plan tab: open agent detail for selected workstream
        KeyCode::Enter if !shift && !alt && matches!(tab_kind, TabKind::Plan { .. }) => {
            if let Some((agent_id, agent_name)) = widgets::plan::selected_workstream_agent(state) {
                state.open_agent_detail(agent_id, agent_name);
            }
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

        // Number keys 1-6: jump to named agent detail
        KeyCode::Char(c @ '1'..='6') if !ctrl && state.input_buffer.is_empty() => {
            let names = ["Mickey", "Yen Sid", "Chernabog", "Broomstick", "Imagineer", "Jacchus"];
            let idx = (c as usize) - ('1' as usize);
            let target_name = names[idx];
            // Find a running agent with this role name
            if let Some(agent) = state.agents.iter().find(|a| {
                a.config.as_ref().map(|c| c.name.as_str() == target_name).unwrap_or(false)
                    || {
                        use crate::proto::AgentRole;
                        AgentRole::try_from(a.config.as_ref().map(|c| c.role).unwrap_or(0))
                            .ok()
                            .map(|r| r.as_str() == target_name)
                            .unwrap_or(false)
                    }
            }) {
                let id = agent.id.clone();
                let name = agent.config.as_ref().map(|c| c.name.clone()).unwrap_or_else(|| target_name.into());
                state.open_agent_detail(id, name);
            }
        }

        // Text input (not on plan tab unless input buffer is active)
        KeyCode::Char(c) if !ctrl => {
            state.insert_char(c);
        }

        // Editing
        KeyCode::Backspace => state.delete_before_cursor(),
        KeyCode::Left => state.move_cursor_left(),
        KeyCode::Right => state.move_cursor_right(),
        KeyCode::Home => state.cursor_position = 0,
        KeyCode::End => state.cursor_position = state.input_buffer.len(),

        // Tab switching
        KeyCode::Tab if !shift => state.next_tab(),
        KeyCode::BackTab => state.prev_tab(),

        // Scrolling
        KeyCode::PageUp => *state.scroll_offset_mut() = state.scroll_offset().saturating_add(10),
        KeyCode::PageDown => {
            let v = state.scroll_offset_mut();
            *v = v.saturating_sub(10);
        }

        _ => {}
    }

    None
}

fn handle_mouse(mouse: MouseEvent, state: &mut AppState) {
    match mouse.kind {
        MouseEventKind::ScrollUp => {
            let v = state.scroll_offset_mut();
            *v = v.saturating_add(3);
        }
        MouseEventKind::ScrollDown => {
            let v = state.scroll_offset_mut();
            *v = v.saturating_sub(3);
        }
        _ => {}
    }
}
