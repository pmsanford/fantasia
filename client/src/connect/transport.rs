use std::path::Path;

use bytes::Bytes;
use http_body_util::Full;
use hyper::body::Incoming;
use hyper::client::conn::http1;
use hyper_util::rt::TokioIo;
use tokio::net::UnixStream;

/// Open a fresh HTTP/1.1 connection to the Unix socket and send a request.
/// Returns the response (with a streaming body for streaming RPCs).
pub async fn send_request(
    socket_path: impl AsRef<Path>,
    req: hyper::Request<Full<Bytes>>,
) -> anyhow::Result<hyper::Response<Incoming>> {
    let stream = UnixStream::connect(socket_path.as_ref()).await?;
    let io = TokioIo::new(stream);

    let (mut sender, conn) = http1::handshake(io).await?;

    // Drive the connection in a background task.
    // For streaming responses we keep it alive until the body is consumed.
    tokio::spawn(async move {
        if let Err(_e) = conn.await {
            // Connection closed — normal for streaming responses
        }
    });

    let resp = sender.send_request(req).await?;
    Ok(resp)
}
