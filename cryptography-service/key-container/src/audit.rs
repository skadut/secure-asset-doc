use crate::{crypto, time};
use serde::Serialize;
use std::{fs::{self, OpenOptions}, io::{BufRead, BufReader, Write}, path::Path, sync::Mutex};

#[derive(Serialize)]
struct Record<'a> {
    time: &'a str,
    request_id: &'a str,
    service: &'static str,
    identity: &'a str,
    key_id: &'a str,
    key_version: u32,
    action: &'a str,
    result: &'a str,
    prev_hash: &'a str,
    hash: &'a str,
}

fn sanitize(s: &str) -> String { s.replace(['|', '\n', '\r'], "_") }

fn canonical(fields: &[&str]) -> String { fields.iter().map(|s| sanitize(s)).collect::<Vec<_>>().join("|") }

pub struct Audit {
    prev: Mutex<String>,
    path: String,
}

impl Audit {
    pub fn new(path: String) -> Result<Self, &'static str> {
        let file = match fs::File::open(&path) { Ok(f) => Some(f), Err(e) if e.kind() == std::io::ErrorKind::NotFound => None, Err(_) => return Err("audit read") };
        let mut prev = "0".repeat(64);
        if let Some(file) = file {
            for line in BufReader::new(file).lines() {
                let line = line.map_err(|_| "audit read")?;
                let v: serde_json::Value = serde_json::from_str(&line).map_err(|_| "audit corrupt")?;
                let fields = ["time", "request_id", "service", "identity", "key_id"]
                    .map(|k| v.get(k).and_then(|x| x.as_str()).ok_or("audit corrupt"));
                let fields = fields.into_iter().collect::<Result<Vec<_>, _>>()?;
                let version = v.get("key_version").and_then(|x| x.as_u64()).ok_or("audit corrupt")?.to_string();
                let action = v.get("action").and_then(|x| x.as_str()).ok_or("audit corrupt")?;
                let result = v.get("result").and_then(|x| x.as_str()).ok_or("audit corrupt")?;
                let stored_prev = v.get("prev_hash").and_then(|x| x.as_str()).ok_or("audit corrupt")?;
                let hash = v.get("hash").and_then(|x| x.as_str()).ok_or("audit corrupt")?;
                if stored_prev != prev || hash.len() != 64 || !hash.bytes().all(|c| c.is_ascii_hexdigit()) { return Err("audit corrupt"); }
                let canonical = canonical(&[fields[0], fields[1], fields[2], fields[3], fields[4], &version, action, result]);
                let expected = crypto::sha256_hex(format!("{prev}|{canonical}").as_bytes());
                if hash != expected { return Err("audit corrupt"); }
                prev = hash.to_owned();
            }
        }
        Ok(Self { prev: Mutex::new(prev), path })
    }

    /// Appends one record. The chain head advances only after the line is written and fsynced.
    pub fn log(&self, request_id: &str, identity: &str, key_id: &str, key_version: u32, action: &str, result: &str) -> Result<(), &'static str> {
        let mut prev = self.prev.lock().unwrap_or_else(|e| e.into_inner());
        let time = time::now_rfc3339();
        let ver = key_version.to_string();
        let clean = [&time, request_id, "key-container", identity, key_id, &ver, action, result]
            .map(|s| sanitize(s));
        let hash = crypto::sha256_hex(format!("{prev}|{}", canonical(&clean.iter().map(String::as_str).collect::<Vec<_>>())).as_bytes());
        let rec = Record { time: &clean[0], request_id: &clean[1], service: "key-container", identity: &clean[3], key_id: &clean[4], key_version, action: &clean[6], result: &clean[7], prev_hash: &prev, hash: &hash };
        let line = serde_json::to_string(&rec).map_err(|_| "audit")?;
        let _ = writeln!(std::io::stdout().lock(), "{line}");
        if let Some(parent) = Path::new(&self.path).parent() { let _ = fs::create_dir_all(parent); }
        let mut opts = OpenOptions::new();
        opts.create(true).append(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let mut f = opts.open(&self.path).map_err(|_| "audit")?;
        writeln!(f, "{line}").and_then(|_| f.sync_all()).map_err(|_| "audit")?;
        *prev = hash;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audit_hash_known() {
        let prev = "0".repeat(64);
        let canonical = format!("{prev}|2026-11-03T00:00:00.000000000Z|req-00000001|key-container|uid:65532|kek-01|1|kek.delivery|ok");
        let hash = crypto::sha256_hex(canonical.as_bytes());
        assert_eq!(hash, "9385cf1293d2c311bea47f0c430e525b335d236242b9c336b977c15a99c290b1");
    }

    #[test]
    fn audit_writes_sanitized_fields_with_recomputable_hash() {
        assert_eq!(sanitize("a|b\nc\rd"), "a_b_c_d");
        let path = std::env::temp_dir().join(format!("keyd-audit-{}-{}.jsonl", std::process::id(), crypto::hex(&crypto::random::<8>().unwrap())));
        let audit = Audit { prev: Mutex::new("0".repeat(64)), path: path.to_string_lossy().into_owned() };
        audit.log("req|1\n", "uid\r1", "kek|1", 2, "act\naction", "ok\r").unwrap();
        let line = fs::read_to_string(&path).unwrap();
        let value: serde_json::Value = serde_json::from_str(line.trim()).unwrap();
        let fields = ["time", "request_id", "service", "identity", "key_id", "key_version", "action", "result"]
            .map(|key| value[key].as_str().map(str::to_owned).unwrap_or_else(|| value[key].to_string()));
        assert!(fields.iter().all(|s| !s.contains(['|', '\n', '\r'])));
        let canonical = canonical(&fields.iter().map(String::as_str).collect::<Vec<_>>());
        let expected = crypto::sha256_hex(format!("{}|{canonical}", value["prev_hash"].as_str().unwrap()).as_bytes());
        assert_eq!(value["hash"].as_str().unwrap(), expected);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn corrupt_last_line_refuses_load() {
        let path = std::env::temp_dir().join(format!("keyd-audit-bad-{}-{}.jsonl", std::process::id(), crypto::hex(&crypto::random::<8>().unwrap())));
        fs::write(&path, "{\"hash\":\"zz\"}\nnot json\n").unwrap();
        assert!(Audit::new(path.to_string_lossy().into_owned()).is_err());
        let _ = fs::remove_file(path);
    }
}
