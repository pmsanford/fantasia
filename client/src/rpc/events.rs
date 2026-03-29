use tokio::sync::mpsc;

use crate::connect::streaming;
use crate::proto::{FantasiaEvent, SubscribeRequest};

const SUBSCRIBE: &str = "/fantasia.v1.EventService/Subscribe";

/// Subscribes to the event stream and forwards events to `tx`.
///
/// Reconnects on error with exponential backoff, tracking the last
/// received sequence number to avoid replaying history on reconnect.
pub async fn subscribe(socket: String, tx: mpsc::Sender<FantasiaEvent>, include_history: bool) {
    let mut after_sequence: Option<u64> = None;
    let mut backoff_ms: u64 = 500;

    loop {
        let req = SubscribeRequest {
            event_types: vec![],
            include_history: include_history && after_sequence.is_none(),
            after_sequence,
        };

        let (inner_tx, mut inner_rx) = mpsc::channel::<anyhow::Result<FantasiaEvent>>(256);

        tokio::spawn({
            let socket = socket.clone();
            async move {
                let _ = streaming::streaming(&socket, SUBSCRIBE, &req, inner_tx).await;
            }
        });

        while let Some(result) = inner_rx.recv().await {
            match result {
                Ok(event) => {
                    after_sequence = Some(event.sequence);
                    if tx.send(event).await.is_err() {
                        return; // main task dropped
                    }
                    backoff_ms = 500;
                }
                Err(_) => break,
            }
        }

        // Reconnect after backoff
        tokio::time::sleep(tokio::time::Duration::from_millis(backoff_ms)).await;
        backoff_ms = (backoff_ms * 2).min(10_000);
    }
}
