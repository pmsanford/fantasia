use anyhow::Context;
use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use prost::Message;

use super::transport;

/// Perform a Connect-protocol unary RPC over HTTP/1.1.
///
/// `method_path` must be the full path, e.g. `/fantasia.v1.OrchestratorService/Submit`.
pub async fn unary<Req, Resp>(
    socket_path: &str,
    method_path: &str,
    request: &Req,
) -> anyhow::Result<Resp>
where
    Req: Message,
    Resp: Message + Default,
{
    let body_bytes = request.encode_to_vec();

    let req = hyper::Request::builder()
        .method("POST")
        .uri(method_path)
        .header("host", "localhost")
        .header("content-type", "application/proto")
        .header("connect-protocol-version", "1")
        .body(Full::new(Bytes::from(body_bytes)))
        .context("building request")?;

    let resp = transport::send_request(socket_path, req)
        .await
        .context("sending request")?;

    let status = resp.status();
    let body = resp
        .into_body()
        .collect()
        .await
        .context("reading response body")?
        .to_bytes();

    if !status.is_success() {
        anyhow::bail!(
            "RPC {} returned HTTP {}: {}",
            method_path,
            status,
            String::from_utf8_lossy(&body)
        );
    }

    let decoded = Resp::decode(body).context("decoding response proto")?;
    Ok(decoded)
}
