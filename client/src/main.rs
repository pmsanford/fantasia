mod app;
mod connect;
mod proto;
mod rpc;
mod tui;

use tokio::sync::mpsc;

use app::{AppAction, AppEvent};

const SOCKET_PATH: &str = "/tmp/fantasia.sock";

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let (action_tx, mut action_rx) = mpsc::channel::<AppAction>(64);
    let (event_tx, event_rx) = mpsc::channel::<AppEvent>(256);

    // Network task
    tokio::spawn({
        let event_tx = event_tx.clone();
        async move {
            network_task(&mut action_rx, event_tx).await;
        }
    });

    // TUI runs on the main thread (Terminal is !Send)
    tui::run_tui(event_rx, action_tx).await?;

    Ok(())
}

async fn network_task(
    action_rx: &mut mpsc::Receiver<AppAction>,
    event_tx: mpsc::Sender<AppEvent>,
) {
    // 1. Try to get status; if that fails, try to initialize.
    //    Connect protocol returns FailedPrecondition (HTTP 400) when not
    //    initialized — that still means the server is reachable.
    loop {
        match rpc::orchestrator::get_status(SOCKET_PATH).await {
            Ok(status) => {
                let _ = event_tx.send(AppEvent::StatusResponse(status)).await;
                break;
            }
            Err(_) => {
                // Server is up but orchestrator not initialized — initialize it.
                let config = proto::OrchestratorConfig::default();
                match rpc::orchestrator::initialize(SOCKET_PATH, config).await {
                    Ok(_) => {
                        let _ = event_tx.send(AppEvent::Initialized).await;
                        break;
                    }
                    Err(init_err) => {
                        // Genuine connection failure — server probably not running yet.
                        let _ = event_tx
                            .send(AppEvent::NetworkError(format!(
                                "Server not reachable: {}",
                                init_err
                            )))
                            .await;
                        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
                    }
                }
            }
        }
    }

    // 3. Subscribe to events
    let (ev_tx, mut ev_rx) = mpsc::channel::<proto::FantasiaEvent>(256);
    tokio::spawn(rpc::events::subscribe(SOCKET_PATH.to_string(), ev_tx, true));

    // 4. Periodically refresh cost (every 30s)
    let mut cost_interval = tokio::time::interval(tokio::time::Duration::from_secs(30));
    cost_interval.tick().await; // discard first immediate tick

    loop {
        tokio::select! {
            // Forward fantasia events to TUI
            Some(ev) = ev_rx.recv() => {
                let _ = event_tx.send(AppEvent::FantasiaEvent(ev)).await;
            }

            // Handle actions from TUI
            Some(action) = action_rx.recv() => {
                match action {
                    AppAction::Submit(msg) => {
                        match rpc::orchestrator::submit(SOCKET_PATH, msg).await {
                            Ok(_) => {
                                let _ = event_tx.send(AppEvent::SubmitDone).await;
                            }
                            Err(e) => {
                                let _ = event_tx
                                    .send(AppEvent::NetworkError(format!("Submit failed: {}", e)))
                                    .await;
                            }
                        }
                    }
                    AppAction::Quit => break,
                }
            }

            // Periodic cost update
            _ = cost_interval.tick() => {
                if let Ok(cost_resp) = rpc::orchestrator::get_cost(SOCKET_PATH).await {
                    let _ = event_tx.send(AppEvent::CostResponse(cost_resp)).await;
                }
            }
        }
    }
}
