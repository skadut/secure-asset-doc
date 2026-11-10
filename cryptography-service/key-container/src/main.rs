mod audit;
mod crypto;
#[cfg(test)] mod delivery_vector_test;
#[cfg(all(test, target_os = "linux"))] mod memdump_test;
mod store;
mod time;
mod tls;

use audit::Audit;
use crypto::*;
use std::{fs, io::{BufRead, BufReader, Read, Write}, os::{fd::AsRawFd, unix::{fs::PermissionsExt, net::{UnixListener, UnixStream}}}, path::Path, sync::{atomic::{AtomicBool, AtomicUsize, Ordering}, Arc, Mutex}, thread, time::{Duration, Instant}};
use zeroize::{Zeroize, Zeroizing}; // Cache loaders retain zeroizing buffers until Secret creation.
use store::{Cache, Store};
use tls::Endpoint;

static STOP: AtomicBool = AtomicBool::new(false);
extern "C" fn on_signal(_: libc::c_int) { STOP.store(true, Ordering::Relaxed); }

fn env(name: &str, default: &str) -> String { std::env::var(name).unwrap_or_else(|_| default.into()) }
struct Slot(Arc<AtomicUsize>);
impl Drop for Slot { fn drop(&mut self) { self.0.fetch_sub(1, Ordering::Relaxed); } }
fn audit_failure(a: &Audit, req: &str, peer: &str, d: Option<&store::Dek>, op: &str, err: &str) {
    let _ = a.log(req, peer, d.map_or("", |x| &x.dek_id), d.map_or(0, |x| x.kek_version), op, err);
}

/// One record per successful op: key_id = dek_id, key_version = kek_version. Never plaintext or key bytes.
fn audit_success(a: &Audit, req: &str, peer: &str, d: &store::Dek, op: &str) -> Result<(), &'static str> {
    a.log(req, peer, &d.dek_id, d.kek_version, op, "ok")
}

fn main() {
    unsafe {
        libc::setrlimit(libc::RLIMIT_CORE, &libc::rlimit { rlim_cur: 0, rlim_max: 0 });
        libc::prctl(libc::PR_SET_DUMPABLE, 0, 0, 0, 0);
        libc::signal(libc::SIGTERM, on_signal as libc::sighandler_t);
        libc::signal(libc::SIGINT, on_signal as libc::sighandler_t);
    }
    raise_memlock();
    mlock_self_test();
    let kek_version: u32 = env("KEK_VERSION", "1").parse().unwrap_or_else(|_| { eprintln!("invalid KEK_VERSION: must be a u32"); std::process::exit(1) });
    let ttl = match env("KEYD_DEK_TTL", "300").parse::<u64>() { Ok(t) if (31..=300).contains(&t) => Duration::from_secs(t), _ => { eprintln!("invalid KEYD_DEK_TTL: must be 31..=300 seconds"); std::process::exit(1) } };
    let private = aws_lc_rs::rsa::PrivateDecryptingKey::generate(aws_lc_rs::rsa::KeySize::Rsa3072).expect("RSA-3072 key generation");
    let public = private.public_key();
    let der = aws_lc_rs::encoding::AsDer::<aws_lc_rs::encoding::PublicKeyX509Der>::as_der(&public).expect("SPKI");
    let der = der.as_ref();
    eprintln!("delivery key fingerprint: sha256:{}", sha256_hex(der));
    let encoded = b64(der);
    let pem = format!("-----BEGIN PUBLIC KEY-----\n{}\n-----END PUBLIC KEY-----\n", encoded.as_bytes().chunks(64).map(|b| std::str::from_utf8(b).unwrap()).collect::<Vec<_>>().join("\n"));
    let pubpath = env("KEYD_PUBKEY_FILE", "/run/keyd-pub/delivery.pub.pem");
    atomic_write(&pubpath, pem.as_bytes()).expect("write delivery public key");

    let audit = Arc::new(Audit::new(env("KEYD_AUDIT_FILE", "/var/log/keyd/audit.jsonl")).unwrap_or_else(|e| { eprintln!("audit: {e}"); std::process::exit(1) }));
    let _ = audit.log("", "", "", 0, "container.start", "ok");
    let rsa = Arc::new(aws_lc_rs::rsa::OaepPrivateDecryptingKey::new(private).expect("OAEP"));
    let store = Arc::new(Store::open(env("KEYD_DEK_STORE", "/var/lib/keyd/deks.json")).unwrap_or_else(|e| { eprintln!("store open: {e}"); std::process::exit(1) }));
    let cache = Arc::new(Cache::new(Arc::new(time::BootClock), Arc::new(time::RandomJitter), ttl));
    let ep = Arc::new(Endpoint {
        addr: env("TPM_SERVICE_ADDR", "host.docker.internal:2798"),
        ca: env("TPM_CA_FILE", "/pki/ca.pem"),
        cert: env("TPM_CLIENT_CERT", "/pki/crypto-service.pem"),
        key: env("TPM_CLIENT_KEY", "/pki/crypto-service-key.pem"),
    });
    let janitor_cache = cache.clone();
    let janitor_audit = audit.clone();
    let janitor = thread::spawn(move || {
        while !STOP.load(Ordering::Relaxed) {
            thread::sleep(Duration::from_secs(1));
            for (id, left) in janitor_cache.remaining() {
                if left <= Duration::from_secs(30) {
                    eprintln!("dek.countdown id={id} remaining={}s", ceil_secs(left));
                }
            }
            for id in janitor_cache.sweep() { let _ = janitor_audit.log("", "", &id, 0, "dek.expire", "ok"); let _ = janitor_audit.log("", "", &id, 0, "dek.zeroize", "ok"); }
        }
    });

    let socket = env("KEYD_SOCKET", "/run/keyd/keyd.sock");
    let _ = fs::remove_file(&socket);
    if let Some(p) = Path::new(&socket).parent() { fs::create_dir_all(p).expect("socket directory"); }
    let listener = UnixListener::bind(&socket).expect("socket bind");
    fs::set_permissions(&socket, fs::Permissions::from_mode(0o600)).expect("socket mode");
    listener.set_nonblocking(true).expect("socket nonblocking");
    let count = Arc::new(AtomicUsize::new(0));
    while !STOP.load(Ordering::Relaxed) {
        match listener.accept() {
            Ok((stream, _)) => {
                if count.load(Ordering::Relaxed) >= 16 { let _ = audit.log("", "", "", 0, "conn.reject", "denied"); drop(stream); continue; }
                count.fetch_add(1, Ordering::Relaxed);
                let slot = Slot(count.clone());
                let (a, s, c, r, e) = (audit.clone(), store.clone(), cache.clone(), rsa.clone(), ep.clone());
                thread::spawn(move || { let _slot = slot; serve(stream, a, s, c, r, e, kek_version); });
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => thread::sleep(Duration::from_millis(50)),
            Err(_) => thread::sleep(Duration::from_millis(50)),
        }
    }
    drop(listener);
    let _ = fs::remove_file(&socket);
    for (id, left) in cache.remaining() { eprintln!("dek.countdown id={id} remaining={}s reason=shutdown", ceil_secs(left)); }
    for id in cache.clear() { let _ = audit.log("", "", &id, 0, "dek.zeroize", "ok"); }
    drop(rsa);
    let _ = janitor.join();
    let _ = audit.log("", "", "", 0, "container.stop", "ok");
}

fn ceil_secs(d: Duration) -> u64 { (d.as_millis() as u64 + 999) / 1000 }

fn atomic_write(path: &str, data: &[u8]) -> Result<(), String> {
    let p = Path::new(path);
    if let Some(dir) = p.parent() { fs::create_dir_all(dir).map_err(|_| "public key directory")?; }
    let tmp = p.with_extension(format!("tmp-{}", std::process::id()));
    fs::write(&tmp, data).map_err(|_| "public key temp write")?;
    fs::rename(tmp, p).map_err(|_| "public key rename".to_string())
}

#[derive(serde::Deserialize)]
struct Request { id: String, op: String, plaintext: Option<String>, dek_id: Option<String>, iv: Option<String>, ct: Option<String>, message: Option<String> }
#[derive(serde::Serialize)]
struct Response { id: String, ok: bool, #[serde(skip_serializing_if="Option::is_none")] error: Option<String>, #[serde(skip_serializing_if="Option::is_none")] dek_id: Option<String>, #[serde(skip_serializing_if="Option::is_none")] iv: Option<String>, #[serde(skip_serializing_if="Option::is_none")] ct: Option<String>, #[serde(skip_serializing_if="Option::is_none")] plaintext: Option<String>, #[serde(skip_serializing_if="Option::is_none")] mac: Option<String>, #[serde(skip_serializing_if="Option::is_none")] ttl_ms: Option<u64> }
fn response_error(e: &str) -> Response { Response { id:String::new(),ok:false,error:Some(e.into()),dek_id:None,iv:None,ct:None,plaintext:None,mac:None,ttl_ms:None } }
fn response_ok() -> Response { Response { id:String::new(),ok:true,error:None,dek_id:None,iv:None,ct:None,plaintext:None,mac:None,ttl_ms:None } }
fn valid_id(id:&str)->bool { (8..=64).contains(&id.len()) && id.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'-') }
fn valid_dek_id(id:&str)->bool { let b=id.as_bytes(); b.len()==17 && b[0]==b'd' && b[1..].iter().all(|c|c.is_ascii_digit()||(b'a'..=b'f').contains(c)) }

const MAX_LINE: usize = 14 * 1024 * 1024;

fn serve(mut stream: UnixStream, audit: Arc<Audit>, store: Arc<Store>, cache: Arc<Cache>, rsa: Arc<aws_lc_rs::rsa::OaepPrivateDecryptingKey>, endpoint: Arc<Endpoint>, kek_version: u32) {
    let mut cred: libc::ucred = unsafe { std::mem::zeroed() };
    let mut len = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
    if unsafe { libc::getsockopt(stream.as_raw_fd(),libc::SOL_SOCKET,libc::SO_PEERCRED,&mut cred as *mut _ as *mut _,&mut len) } != 0 { return; }
    let peer = format!("uid:{}", cred.uid);
    if cred.uid != env("KEYD_ALLOWED_UID","65532").parse::<u32>().unwrap_or(65532) { let _ = audit.log("",&peer,"",0,"authz.fail","denied"); return; }
    let mut reader = BufReader::new(match stream.try_clone() { Ok(s)=>s,Err(_)=>return });
    // ponytail: no idle timeout for a connected client; add a read deadline when long-lived idle clients are observed
    loop {
        let mut line = Zeroizing::new(Vec::new());
        match reader.by_ref().take(MAX_LINE as u64 + 1).read_until(b'\n',&mut line) {
            Ok(0)|Err(_)=>break,
            Ok(n)=> {
                let too_long = n > MAX_LINE;
                let (id, mut resp) = match serde_json::from_slice::<Request>(&line) {
                    Ok(q) if !too_long && valid_id(&q.id) => { let id = q.id.clone(); (id, handle(q,&peer,&audit,&store,&cache,&rsa,&endpoint,kek_version)) }
                    _ => (String::new(), response_error("bad_request")),
                };
                resp.id = id;
                // Pre-sized so serde_json never reallocates (a realloc would leave unzeroed plaintext copies).
                let cap = 256 + resp.id.len() + [&resp.error,&resp.dek_id,&resp.iv,&resp.ct,&resp.plaintext,&resp.mac].iter().map(|f| f.as_ref().map_or(0,|x|x.len())).sum::<usize>();
                let mut out = Zeroizing::new(Vec::with_capacity(cap));
                if serde_json::to_writer(&mut *out,&resp).is_err() { out.clear(); out.extend_from_slice(b"{\"id\":\"\",\"ok\":false,\"error\":\"internal\"}"); }
                out.push(b'\n');
                let written = stream.write_all(&out);
                drop(out);
                resp.plaintext.zeroize();
                if written.is_err()||too_long { break; }
            }
        }
    }
}

fn load_dek(d:&store::Dek, rid:&str, peer:&str, audit:&Audit, store:&Store, cache:&Cache, rsa:&aws_lc_rs::rsa::OaepPrivateDecryptingKey, ep:&Endpoint)->Result<Arc<store::CachedKey>,&'static str> {
    cache.get_or_load(&d.dek_id,|| { let kek=fetch_gated(&KEK_FAIL,|| tls::fetch_kek(ep,rsa,rid,&d.kek_id,d.kek_version)).map_err(|e|{let _=audit.log(rid,peer,&d.kek_id,d.kek_version,"kek.delivery",&format!("error:{e}"));"unavailable"})?;audit.log(rid,peer,&d.kek_id,d.kek_version,"kek.delivery","ok").map_err(|_|"unavailable")?;let raw=store.unwrap(d,kek.bytes()).map_err(|e|{let _=audit.log(rid,peer,&d.dek_id,d.kek_version,"dek.unwrap_fail",e);"bad_cipher"})?;drop(kek);eprintln!("kek.zeroize id={} version={} reason=after_unwrap",d.kek_id,d.kek_version);audit.log(rid,peer,&d.dek_id,d.kek_version,"dek.load","ok").map_err(|_|"unavailable")?;Ok(raw) })
}
static CREATE_LOCK: Mutex<()> = Mutex::new(());
static KEK_FAIL: Mutex<Option<Instant>> = Mutex::new(None);
/// Negative cache: after a failed KEK fetch, returns "unavailable" for 2 s without calling fetch.
fn fetch_gated<F: FnOnce() -> Result<Secret, &'static str>>(gate: &Mutex<Option<Instant>>, fetch: F) -> Result<Secret, &'static str> {
    if gate.lock().unwrap_or_else(|e| e.into_inner()).map_or(false, |t| t.elapsed() < Duration::from_secs(2)) { return Err("unavailable"); }
    let r = fetch();
    *gate.lock().unwrap_or_else(|e| e.into_inner()) = if r.is_err() { Some(Instant::now()) } else { None };
    r
}

// ponytail: ceiling per-process counter only, cross-instance DEKs not coordinated, a second keyd instance can exceed 2^32 invocations on the same DEK; upgrade path durable counter in store or shared lock
static USES: Mutex<(String, u64)> = Mutex::new((String::new(), 0));
const ROTATE_AT: u64 = 4_294_967_296 - 1_048_576;
fn needs_rotation(count: u64) -> bool { count >= ROTATE_AT }
fn uses_for(id: &str) -> u64 { let u = USES.lock().unwrap_or_else(|e| e.into_inner()); if u.0 == id { u.1 } else { 0 } }
fn count_use(id: &str) { let mut u = USES.lock().unwrap_or_else(|e| e.into_inner()); if u.0 != id { *u = (id.to_owned(), 0); } u.1 += 1; }

fn create_dek(purpose:&str, kek_id:&str, kek_version:u32, rid:&str, peer:&str, audit:&Audit, store:&Store, cache:&Cache, rsa:&aws_lc_rs::rsa::OaepPrivateDecryptingKey, ep:&Endpoint)->Result<(store::Dek,Arc<store::CachedKey>),&'static str> {
    let kek=fetch_gated(&KEK_FAIL,|| tls::fetch_kek(ep,rsa,rid,kek_id,kek_version)).map_err(|e|{let _=audit.log(rid,peer,kek_id,kek_version,"kek.delivery",&format!("error:{e}"));"unavailable"})?;
    audit.log(rid,peer,kek_id,kek_version,"kek.delivery","ok").map_err(|_|"unavailable")?;
    let (d,key)=store.add(purpose,kek_id,kek_version,kek.bytes()).map_err(|_|"internal")?;drop(kek);eprintln!("kek.zeroize id={} version={} reason=after_unwrap",kek_id,kek_version);
    audit.log(rid,peer,&d.dek_id,d.kek_version,"dek.create","ok").map_err(|_|"unavailable")?;
    let ck=cache.get_or_load(&d.dek_id,||Ok(Zeroizing::new(key.bytes().to_vec()))).map_err(|_|"internal")?;
    Ok((d,ck))
}

/// Double-checked: store lookup without lock; CREATE_LOCK only when a new active DEK is needed.
fn active_key(purpose:&str, rid:&str, peer:&str, audit:&Audit, store:&Store, cache:&Cache, rsa:&aws_lc_rs::rsa::OaepPrivateDecryptingKey, ep:&Endpoint, kek_version:u32)->Result<(store::Dek,Arc<store::CachedKey>), &'static str> {
    let kek_id=env("KEK_ID","kek-01");let year=time::utc_year();
    let fresh=|d:&store::Dek| !(purpose=="data" && needs_rotation(uses_for(&d.dek_id)));
    let d=match store.active(purpose,&kek_id,kek_version,year).filter(fresh) {
        Some(d)=>d,
        None=>{
            let _g=CREATE_LOCK.lock().unwrap_or_else(|e|e.into_inner());
            match store.active(purpose,&kek_id,kek_version,year).filter(fresh) {
                Some(d)=>d,
                None=>return create_dek(purpose,&kek_id,kek_version,rid,peer,audit,store,cache,rsa,ep),
            }
        }
    };
    let ck=load_dek(&d,rid,peer,audit,store,cache,rsa,ep)?;
    Ok((d,ck))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn kek_negative_cache_window_skips_fetch() {
        let gate = Mutex::new(None);
        let calls = std::cell::Cell::new(0);
        assert!(fetch_gated(&gate, || { calls.set(calls.get() + 1); Err("unavailable") }).is_err());
        assert!(fetch_gated(&gate, || { calls.set(calls.get() + 1); Err("unavailable") }).is_err());
        assert_eq!(calls.get(), 1);
    }
    #[test]
    fn ceil_secs_rounds_up() {
        assert_eq!(ceil_secs(Duration::from_millis(0)), 0);
        assert_eq!(ceil_secs(Duration::from_millis(1)), 1);
        assert_eq!(ceil_secs(Duration::from_millis(1000)), 1);
        assert_eq!(ceil_secs(Duration::from_millis(1001)), 2);
        assert_eq!(ceil_secs(Duration::from_millis(29_400)), 30);
    }
    #[test]
    fn rotation_threshold() {
        assert_eq!(ROTATE_AT, 4_293_918_720);
        assert!(!needs_rotation(ROTATE_AT - 1));
        assert!(needs_rotation(ROTATE_AT));
    }
}

fn handle(mut q:Request, peer:&str, audit:&Audit, store:&Store, cache:&Cache, rsa:&aws_lc_rs::rsa::OaepPrivateDecryptingKey, ep:&Endpoint, kek_version:u32)->Response {
    match q.op.as_str() {
        "encrypt"=>{
            let pt=q.plaintext.as_deref().and_then(unb64).map(Zeroizing::new);q.plaintext.zeroize();
            let Some(pt)=pt else{audit_failure(audit,&q.id,peer,None,"op.encrypt","bad_request");return response_error("bad_request")};
            let (d,k)=match active_key("data",&q.id,peer,audit,store,cache,rsa,ep,kek_version){Ok(x)=>x,Err(e)=>{audit_failure(audit,&q.id,peer,None,"op.encrypt",e);return response_error(e)}};
            let Ok(iv)=random::<12>()else{audit_failure(audit,&q.id,peer,Some(&d),"op.encrypt","internal");return response_error("internal")};
            let Ok(ct)=gcm_seal(k.secret.bytes(),&iv,d.dek_id.as_bytes(),&pt)else{audit_failure(audit,&q.id,peer,Some(&d),"op.encrypt","internal");return response_error("internal")};
            count_use(&d.dek_id);
            if audit_success(audit,&q.id,peer,&d,"op.encrypt").is_err(){return response_error("unavailable")}
            let mut r=response_ok();r.dek_id=Some(d.dek_id);r.iv=Some(b64(&iv));r.ct=Some(b64(&ct));r.ttl_ms=Some(cache.left(&k).as_millis() as u64);r
        }
        "decrypt"=>{
            let (Some(id),Some(iv),Some(ct))=(q.dek_id,q.iv,q.ct)else{audit_failure(audit,&q.id,peer,None,"op.decrypt","bad_request");return response_error("bad_request")};
            let (Some(iv),Some(ct))=(unb64(&iv),unb64(&ct))else{audit_failure(audit,&q.id,peer,None,"op.decrypt","bad_request");return response_error("bad_request")};
            let Ok(iv):Result<[u8;12],_>=iv.try_into()else{audit_failure(audit,&q.id,peer,None,"op.decrypt","bad_request");return response_error("bad_request")};
            if !valid_dek_id(&id){audit_failure(audit,&q.id,peer,None,"op.decrypt","bad_request");return response_error("bad_request")}
            let Some(d)=store.get(&id).filter(|d|d.purpose=="data")else{let _=audit.log(&q.id,peer,"",0,"op.decrypt","bad_cipher");return response_error("bad_cipher")};
            let key=match load_dek(&d,&q.id,peer,audit,store,cache,rsa,ep){Ok(k)=>k,Err(e)=>{audit_failure(audit,&q.id,peer,Some(&d),"op.decrypt",e);return response_error(e)}};
            match gcm_open(key.secret.bytes(),&iv,id.as_bytes(),&ct){Ok(pt)=>{if audit_success(audit,&q.id,peer,&d,"op.decrypt").is_err(){return response_error("unavailable")}let enc=Zeroizing::new(b64(&pt));let mut r=response_ok();r.plaintext=Some(enc.as_str().to_owned());r.ttl_ms=Some(cache.left(&key).as_millis() as u64);r},Err(_)=>{audit_failure(audit,&q.id,peer,Some(&d),"op.decrypt","bad_cipher");response_error("bad_cipher")}}
        }
        "hmac"=>{
            let Some(msg)=q.message.as_deref().and_then(unb64).map(Zeroizing::new)else{audit_failure(audit,&q.id,peer,None,"op.hmac","bad_request");return response_error("bad_request")};
            let(d,k)=if let Some(id)=q.dek_id {
                if !valid_dek_id(&id){audit_failure(audit,&q.id,peer,None,"op.hmac","bad_request");return response_error("bad_request")}
                let Some(d)=store.get(&id).filter(|d|d.purpose=="mac")else{let _=audit.log(&q.id,peer,"",0,"op.hmac","bad_cipher");return response_error("bad_cipher")};
                match load_dek(&d,&q.id,peer,audit,store,cache,rsa,ep){Ok(k)=>(d,k),Err(e)=>{audit_failure(audit,&q.id,peer,Some(&d),"op.hmac",e);return response_error(e)}}
            } else {
                match active_key("mac",&q.id,peer,audit,store,cache,rsa,ep,kek_version){Ok(x)=>x,Err(e)=>{audit_failure(audit,&q.id,peer,None,"op.hmac",e);return response_error(e)}}
            };
            if audit_success(audit,&q.id,peer,&d,"op.hmac").is_err(){return response_error("unavailable")}
            let mut r=response_ok();r.dek_id=Some(d.dek_id);r.mac=Some(b64(&hmac_sha256(k.secret.bytes(),&msg)));r.ttl_ms=Some(cache.left(&k).as_millis() as u64);r
        }
        _=>response_error("bad_request"),
    }
}
