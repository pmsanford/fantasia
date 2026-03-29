pub mod state;
pub mod update;

pub use state::AppState;

use crate::proto::{FantasiaEvent, GetCostResponse, GetStatusResponse};

/// Events flowing from the network task to the TUI task.
pub enum AppEvent {
    FantasiaEvent(FantasiaEvent),
    StatusResponse(GetStatusResponse),
    CostResponse(GetCostResponse),
    NetworkError(String),
    Initialized,
    SubmitDone,
}

/// Actions flowing from the TUI task to the network task.
pub enum AppAction {
    Submit(String),
    Quit,
}
