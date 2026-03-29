use anyhow::Context;
use bytes::{Buf, BufMut, Bytes, BytesMut};
use http_body_util::Full;
use prost::Message;
use tokio::sync::mpsc;

use super::transport;

/// Perform a Connect-protocol server-streaming RPC over HTTP/1.1.
///
/// Decoded messages are sent through `tx`. Returns when the stream ends or on error.
pub async fn streaming<Req, Resp>(
    socket_path: &str,
    method_path: &str,
    request: &Req,
    tx: mpsc::Sender<anyhow::Result<Resp>>,
) -> anyhow::Result<()>
where
    Req: Message,
    Resp: Message + Default,
{
    let proto_bytes = request.encode_to_vec();

    // Wrap request in a 5-byte Connect envelope
    let mut envelope = BytesMut::with_capacity(5 + proto_bytes.len());
    envelope.put_u8(0x00); // flags: data frame
    envelope.put_u32(proto_bytes.len() as u32);
    envelope.put_slice(&proto_bytes);

    let req = hyper::Request::builder()
        .method("POST")
        .uri(method_path)
        .header("host", "localhost")
        .header("content-type", "application/connect+proto")
        .header("connect-protocol-version", "1")
        .body(Full::new(Bytes::from(envelope.freeze())))
        .context("building streaming request")?;

    let resp = transport::send_request(socket_path, req)
        .await
        .context("sending streaming request")?;

    let status = resp.status();
    if !status.is_success() {
        use http_body_util::BodyExt;
        let body = resp
            .into_body()
            .collect()
            .await
            .context("reading error body")?
            .to_bytes();
        anyhow::bail!(
            "Streaming RPC {} returned HTTP {}: {}",
            method_path,
            status,
            String::from_utf8_lossy(&body)
        );
    }

    let mut body = resp.into_body();
    let mut buf = BytesMut::new();

    loop {
        // Parse all complete frames from the buffer
        loop {
            if buf.len() < 5 {
                break;
            }
            let flags = buf[0];
            let msg_len = u32::from_be_bytes([buf[1], buf[2], buf[3], buf[4]]) as usize;

            if buf.len() < 5 + msg_len {
                break;
            }

            buf.advance(5);
            let payload = buf.split_to(msg_len).freeze();

            if flags & 0x02 != 0 {
                // End-stream trailers frame
                return Ok(());
            }

            match Resp::decode(payload) {
                Ok(msg) => {
                    if tx.send(Ok(msg)).await.is_err() {
                        return Ok(()); // receiver dropped
                    }
                }
                Err(e) => {
                    let err = anyhow::anyhow!("decode error: {}", e);
                    let _ = tx.send(Err(anyhow::anyhow!("decode error: {}", e))).await;
                    return Err(err);
                }
            }
        }

        // Read the next chunk from hyper
        use http_body_util::BodyExt;
        match BodyExt::frame(&mut body).await {
            None => return Ok(()),
            Some(Err(e)) => anyhow::bail!("body read error: {}", e),
            Some(Ok(frame)) => {
                if let Ok(data) = frame.into_data() {
                    buf.put(data);
                }
            }
        }
    }
}
