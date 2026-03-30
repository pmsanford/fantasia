mod agent_detail;
mod chat;
mod input;
pub mod plan;
mod status_bar;

use ratatui::{
    layout::{Constraint, Layout},
    Frame,
};

use crate::app::{state::TabKind, AppState};

pub fn render(f: &mut Frame, state: &mut AppState) {
    let area = f.area();
    let input_height = state.input_height(area.width);
    let chunks = Layout::vertical([
        Constraint::Length(2),             // status bar
        Constraint::Fill(1),              // main content
        Constraint::Length(input_height),  // input
    ])
    .split(area);

    status_bar::render(f, chunks[0], state);

    match &state.tabs[state.active_tab].kind {
        TabKind::Chat { .. } => chat::render(f, chunks[1], state),
        TabKind::Plan { .. } => plan::render(f, chunks[1], state),
        TabKind::AgentDetail { .. } => agent_detail::render(f, chunks[1], state),
    }

    input::render(f, chunks[2], state);
}
