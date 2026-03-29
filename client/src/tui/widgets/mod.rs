mod chat;
mod input;
mod status_bar;

use ratatui::{
    layout::{Constraint, Layout},
    Frame,
};

use crate::app::AppState;

pub fn render(f: &mut Frame, state: &mut AppState) {
    let area = f.area();
    let input_height = state.input_height(area.width);
    let chunks = Layout::vertical([
        Constraint::Length(2),             // status bar
        Constraint::Fill(1),              // chat
        Constraint::Length(input_height),  // input (grows with content)
    ])
    .split(area);

    status_bar::render(f, chunks[0], state);
    chat::render(f, chunks[1], state);
    input::render(f, chunks[2], state);
}
