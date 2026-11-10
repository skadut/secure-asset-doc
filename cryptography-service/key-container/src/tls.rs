use crate::crypto::{self, Res, Secret};
use aws_lc_rs::rsa::OaepPrivateDecryptingKey;
use rustls::{pki_types::{CertificateDer, PrivateKeyDer, ServerName}, ClientConfig, ClientConnection, RootCertStore, StreamOwned};
use serde::{Deserialize, Serialize};
use std::{fs, io::{Read, Write}, net::{TcpStream, ToSocketAddrs}, sync::Arc, time::Duration};

const TIMEOUT: Duration = Duration::from_secs(5);
const SERVER_NAME: &str = "host.docker.internal";

pub struct Endpoint { pub addr: String, pub ca: String, pub cert: String, pub key: String }

#[derive(Serialize)]
struct KekRequest<'a> { kek_id: &'a str, version: u32, nonce: String }

#[derive(Deserialize)]
struct KekResponse { kek_id: String, version: u32, wrapped_kek: String }

fn client_config(ep: &Endpoint) -> Res<Arc<ClientConfig>> {
    let mut roots = RootCertStore::empty();
    for c in rustls_pemfile::certs(&mut std::io::BufReader::new(fs::File::open(&ep.ca).map_err(|_| "unavailable")?)) {
        roots.add(c.map_err(|_| "unavailable")?).map_err(|_| "unavailable")?;
    }
    let certs: Vec<CertificateDer<'static>> = rustls_pemfile::certs(&mut std::io::BufReader::new(fs::File::open(&ep.cert).map_err(|_| "unavailable")?))
        .collect::<Result<_, _>>().map_err(|_| "unavailable")?;
    let key: PrivateKeyDer<'static> = rustls_pemfile::private_key(&mut std::io::BufReader::new(fs::File::open(&ep.key).map_err(|_| "unavailable")?))
        .map_err(|_| "unavailable")?.ok_or("unavailable")?;
    let cfg = ClientConfig::builder_with_provider(Arc::new(rustls::crypto::aws_lc_rs::default_provider()))
        .with_protocol_versions(&[&rustls::version::TLS13]).map_err(|_| "unavailable")?
        .with_root_certificates(roots)
        .with_client_auth_cert(certs, key).map_err(|_| "unavailable")?;
    Ok(Arc::new(cfg))
}

fn connect(ep: &Endpoint) -> Res<StreamOwned<ClientConnection, TcpStream>> {
    let addr = ep.addr.to_socket_addrs().map_err(|_| "unavailable")?.next().ok_or("unavailable")?;
    let sock = TcpStream::connect_timeout(&addr, TIMEOUT).map_err(|_| "unavailable")?;
    sock.set_read_timeout(Some(TIMEOUT)).and_then(|_| sock.set_write_timeout(Some(TIMEOUT))).map_err(|_| "unavailable")?;
    let name = ServerName::try_from(SERVER_NAME).map_err(|_| "unavailable")?;
    let conn = ClientConnection::new(client_config(ep)?, name).map_err(|_| "unavailable")?;
    Ok(StreamOwned::new(conn, sock))
}

/// Status must be 200. Rejects Transfer-Encoding. Requires Content-Length <= 64 KiB.
fn content_length(head: &[u8]) -> Res<usize> {
    let head = std::str::from_utf8(head).map_err(|_| "unavailable")?;
    if !head.lines().next().map_or(false, |s| s.starts_with("HTTP/1.1 200 ")) || head.lines().skip(1).any(|l| l.to_ascii_lowercase().starts_with("transfer-encoding:")) { return Err("unavailable"); }
    let mut lengths = head.lines().skip(1).filter(|l| l.to_ascii_lowercase().starts_with("content-length:"));
    let len = lengths.next().and_then(|l| l.to_ascii_lowercase().strip_prefix("content-length:").and_then(|v| v.trim().parse::<usize>().ok())).filter(|n| *n <= 65536).ok_or("unavailable")?;
    if lengths.next().is_some() { return Err("unavailable"); }
    Ok(len)
}
fn read_response<R: Read>(r: &mut R) -> Res<Vec<u8>> {
    const HEADER_MAX: usize = 16 * 1024;
    let mut header = Vec::new();
    while header.len() < HEADER_MAX {
        let mut byte = [0u8; 1];
        r.read_exact(&mut byte).map_err(|_| "unavailable")?;
        header.push(byte[0]);
        if header.ends_with(b"\r\n\r\n") { break; }
    }
    if !header.ends_with(b"\r\n\r\n") { return Err("unavailable"); }
    let split = header.len() - 4;
    let len = content_length(&header[..split])?;
    let mut body = Vec::with_capacity(len);
    r.take(len as u64).read_to_end(&mut body).map_err(|_| "unavailable")?;
    if body.len() != len { return Err("unavailable"); }
    Ok(body)
}

/// Fetches and unwraps the KEK. Errors are short codes for audit and wire mapping.
pub fn fetch_kek(ep: &Endpoint, rsa: &OaepPrivateDecryptingKey, request_id: &str, kek_id: &str, version: u32) -> Res<Secret> {
    let nonce = crypto::random::<32>()?;
    let body = serde_json::to_vec(&KekRequest { kek_id, version, nonce: crypto::b64(&nonce) }).map_err(|_| "internal")?;
    let mut tls = connect(ep)?;
    let head = format!(
        "POST /v1/kek/wrapped HTTP/1.1\r\nHost: {SERVER_NAME}\r\nContent-Type: application/json\r\nX-Request-ID: {request_id}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    tls.write_all(head.as_bytes()).and_then(|_| tls.write_all(&body)).map_err(|_| "unavailable")?;
    let body = read_response(&mut tls)?;
    let resp: KekResponse = serde_json::from_slice(&body).map_err(|_| "unavailable")?;
    if resp.kek_id != kek_id || resp.version != version { return Err("bad_delivery"); }
    let wrapped = crypto::unb64(&resp.wrapped_kek).ok_or("bad_delivery")?;
    crypto::unwrap_kek(rsa, &wrapped, &nonce, kek_id, version)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_transfer_encoding_and_caps_content_length() {
        let rd = |s: &[u8]| read_response(&mut std::io::Cursor::new(s.to_vec()));
        assert!(rd(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nContent-Length: 0\r\n\r\n").is_err());
        assert!(rd(b"HTTP/1.1 200 OK\r\nContent-Length: 65537\r\n\r\n").is_err());
        assert!(rd(b"HTTP/1.1 2000 OK\r\nContent-Length: 2\r\n\r\nab").is_err());
        assert!(rd(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nContent-Length: 2\r\n\r\nab").is_err());
        assert_eq!(rd(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nabc").unwrap(), b"ab");
    }
}
