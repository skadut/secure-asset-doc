use crate::{crypto::{self, Secret}, time};
use serde::{Deserialize, Serialize};
use std::{fs::{self, OpenOptions}, io::Write, path::PathBuf, sync::{Arc, Condvar, Mutex}, time::Duration};
use zeroize::{Zeroize, Zeroizing};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Dek {
    pub dek_id: String,
    pub purpose: String,
    pub kek_id: String,
    pub kek_version: u32,
    pub created: String,
    pub iv: String,
    pub ct: String,
}

#[derive(Serialize, Deserialize, Default)]
pub struct StoreFile { pub v: u32, pub deks: Vec<Dek> }

pub struct Store {
    path: PathBuf,
    data: Mutex<StoreFile>,
}

impl Store {
    pub fn open(path: String) -> Result<Self, &'static str> {
        let path = PathBuf::from(path);
        let data = match fs::read(&path) {
            Ok(bytes) => {
                let data: StoreFile = serde_json::from_slice(&bytes).map_err(|_| "internal")?;
                if data.v != 1 { return Err("internal"); }
                data
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => StoreFile { v: 1, deks: Vec::new() },
            Err(_) => return Err("internal"),
        };
        Ok(Self { path, data: Mutex::new(data) })
    }

    fn persist(&self, s: &StoreFile) -> Result<(), &'static str> {
        if let Some(parent) = self.path.parent().filter(|p| !p.as_os_str().is_empty()) {
            fs::create_dir_all(parent).map_err(|_| "internal")?;
        }
        let temp = self.path.with_extension(format!("tmp-{}", std::process::id()));
        let bytes = serde_json::to_vec(s).map_err(|_| "internal")?;
        let mut opts = OpenOptions::new();
        opts.create(true).truncate(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let mut file = opts.open(&temp).map_err(|_| "internal")?;
        file.write_all(&bytes).map_err(|_| "internal")?;
        file.sync_all().map_err(|_| "internal")?;
        drop(file);
        fs::rename(&temp, &self.path).map_err(|_| "internal")?;
        #[cfg(unix)]
        {
            if let Some(parent) = self.path.parent().filter(|p| !p.as_os_str().is_empty()) {
                fs::File::open(parent).and_then(|f| f.sync_all()).map_err(|_| "internal")?;
            }
        }
        Ok(())
    }

    pub fn active(&self, purpose: &str, kek_id: &str, kek_version: u32, year: i64) -> Option<Dek> {
        self.data.lock().unwrap_or_else(|e|e.into_inner()).deks.iter().rev().find(|d| {
            d.purpose == purpose && d.kek_id == kek_id && d.kek_version == kek_version && d.created.get(..4).and_then(|x|x.parse::<i64>().ok()) == Some(year)
        }).cloned()
    }

    pub fn get(&self, id: &str) -> Option<Dek> { self.data.lock().unwrap_or_else(|e|e.into_inner()).deks.iter().find(|d|d.dek_id==id).cloned() }

    /// Creates and persists a new DEK. Returns the record and its plaintext key.
    pub fn add(&self, purpose: &str, kek_id: &str, kek_version: u32, kek: &[u8]) -> Result<(Dek, Secret), &'static str> {
        let iv = crypto::random::<12>()?;
        let dek_id = format!("d{}", crypto::hex(&crypto::random::<8>()?));
        let mut raw = crypto::random::<32>()?;
        let key = Secret::from_slice(&raw);
        raw.zeroize();
        let aad = crypto::dek_aad(&dek_id, purpose, kek_id, kek_version);
        let ct = crypto::gcm_seal(kek, &iv, &aad, key.bytes())?;
        let d = Dek { dek_id, purpose: purpose.into(), kek_id: kek_id.into(), kek_version, created: time::now_rfc3339(), iv: crypto::b64(&iv), ct: crypto::b64(&ct) };
        let mut s = self.data.lock().unwrap_or_else(|e|e.into_inner());
        let mut next = StoreFile { v: 1, deks: s.deks.clone() };
        next.deks.push(d.clone());
        self.persist(&next)?;
        *s = next;
        Ok((d, key))
    }

    pub fn unwrap(&self, d: &Dek, kek: &[u8]) -> Result<Zeroizing<Vec<u8>>, &'static str> {
        let iv: [u8; 12] = crypto::unb64(&d.iv).ok_or("bad_cipher")?.try_into().map_err(|_| "bad_cipher")?;
        let ct = crypto::unb64(&d.ct).ok_or("bad_cipher")?;
        let aad = crypto::dek_aad(&d.dek_id, &d.purpose, &d.kek_id, d.kek_version);
        crypto::gcm_open(kek, &iv, &aad, &ct)
    }
}

pub struct CachedKey { pub secret: Secret, loaded: (Duration, Duration), life: Duration }
struct CacheState { keys: std::collections::HashMap<String, Arc<CachedKey>>, loading: std::collections::HashSet<String>, expired: Vec<String> }
pub struct Cache { state: Mutex<CacheState>, ready: Condvar, clock: Arc<dyn time::Clock>, jitter: Arc<dyn time::Jitter>, ttl: Duration }

struct LoadingGuard<'a> { cache: &'a Cache, id: &'a str }
impl Drop for LoadingGuard<'_> {
    fn drop(&mut self) {
        let mut state = self.cache.state.lock().unwrap_or_else(|e|e.into_inner());
        state.loading.remove(self.id);
        self.cache.ready.notify_all();
    }
}

impl Cache {
    pub fn new(clock: Arc<dyn time::Clock>, jitter: Arc<dyn time::Jitter>, ttl: Duration) -> Self {
        Self { state: Mutex::new(CacheState { keys: Default::default(), loading: Default::default(), expired: Default::default() }), ready: Condvar::new(), clock, jitter, ttl: ttl.min(Duration::from_secs(300)) }
    }

    /// Expired when either boot-time or realtime elapsed reaches life. Negative elapsed (realtime went backwards) counts as expired.
    fn dead(&self, k: &CachedKey) -> bool {
        match (self.clock.now().checked_sub(k.loaded.0), self.clock.realtime().checked_sub(k.loaded.1)) {
            (Some(b), Some(r)) => b >= k.life || r >= k.life,
            _ => true,
        }
    }

    pub fn get_or_load<F>(&self, id: &str, load: F) -> Result<Arc<CachedKey>, &'static str> where F: FnOnce() -> Result<Zeroizing<Vec<u8>>, &'static str> {
        let mut state = self.state.lock().unwrap_or_else(|e|e.into_inner());
        loop {
            if let Some(k) = state.keys.get(id) {
                if !self.dead(k) { return Ok(k.clone()); }
                state.keys.remove(id);
                state.expired.push(id.to_owned());
            }
            if state.loading.insert(id.to_owned()) { break; }
            state = self.ready.wait(state).unwrap_or_else(|e|e.into_inner());
        }
        drop(state);
        // Key is inserted before the guard clears `loading`, so no second load can start in between.
        let guard = LoadingGuard { cache: self, id };
        let out = match load() {
            Ok(bytes) => {
                let life = self.ttl.saturating_sub(self.jitter.offset());
                let key = Arc::new(CachedKey { secret: Secret::from_slice(&bytes), loaded: (self.clock.now(), self.clock.realtime()), life });
                self.state.lock().unwrap_or_else(|e|e.into_inner()).keys.insert(id.to_owned(), key.clone());
                Ok(key)
            }
            Err(e) => Err(e),
        };
        drop(guard);
        out
    }

    pub fn sweep(&self) -> Vec<String> {
        let mut state = self.state.lock().unwrap_or_else(|e|e.into_inner());
        let mut expired = std::mem::take(&mut state.expired);
        let stale: Vec<String> = state.keys.iter().filter(|(_,k)| self.dead(k)).map(|(id,_)|id.clone()).collect();
        for id in &stale { state.keys.remove(id); }
        expired.extend(stale);
        expired
    }

    /// Time left for one cached key. Same rule as `dead`.
    pub fn left(&self, k: &CachedKey) -> Duration {
        match (self.clock.now().checked_sub(k.loaded.0), self.clock.realtime().checked_sub(k.loaded.1)) {
            (Some(b), Some(r)) => k.life.saturating_sub(b.max(r)),
            _ => Duration::ZERO,
        }
    }

    /// Time left before each cached DEK is evicted and zeroized. Same expiry rule as `dead`.
    pub fn remaining(&self) -> Vec<(String, Duration)> {
        let state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        state.keys.iter().map(|(id, k)| (id.clone(), self.left(k))).collect()
    }

    pub fn clear(&self) -> Vec<String> {
        let mut state = self.state.lock().unwrap_or_else(|e|e.into_inner());
        let mut ids = std::mem::take(&mut state.expired);
        ids.extend(state.keys.keys().cloned());
        state.keys.clear();
        ids
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    struct Fake(AtomicU64);
    impl time::Clock for Fake { fn now(&self)->Duration { Duration::from_secs(self.0.load(Ordering::SeqCst)) } fn realtime(&self)->Duration { Duration::from_secs(self.0.load(Ordering::SeqCst)) } }
    struct Zero;
    impl time::Jitter for Zero { fn offset(&self)->Duration { Duration::ZERO } }
    fn bytes(v: Vec<u8>) -> Zeroizing<Vec<u8>> { Zeroizing::new(v) }

    #[test]
    fn cache_deadline_is_hard_and_jitter_injected() {
        let c = Arc::new(Fake(AtomicU64::new(1)));
        let cache = Cache::new(c.clone(), Arc::new(Zero), Duration::from_secs(5));
        let loads = std::sync::atomic::AtomicUsize::new(0);
        let first = cache.get_or_load("d1", || { loads.fetch_add(1,Ordering::SeqCst); Ok(bytes(vec![1;32])) }).unwrap();
        c.0.store(4,Ordering::SeqCst);
        assert!(Arc::ptr_eq(&first,&cache.get_or_load("d1",||panic!()).unwrap()));
        c.0.store(6,Ordering::SeqCst);
        assert_eq!(cache.get_or_load("d1",|| {loads.fetch_add(1,Ordering::SeqCst);Ok(bytes(vec![2;32]))}).unwrap().secret.bytes(), &[2;32]);
        assert_eq!(loads.load(Ordering::SeqCst),2);
    }

    #[test]
    fn remaining_counts_down_to_zero() {
        let c = Arc::new(Fake(AtomicU64::new(100)));
        let cache = Cache::new(c.clone(), Arc::new(Zero), Duration::from_secs(30));
        cache.get_or_load("d1", || Ok(bytes(vec![1; 32]))).unwrap();
        c.0.store(110, Ordering::SeqCst);
        assert_eq!(cache.remaining(), vec![("d1".to_string(), Duration::from_secs(20))]);
        c.0.store(130, Ordering::SeqCst);
        assert_eq!(cache.remaining()[0].1, Duration::ZERO);
    }

    #[test]
    fn panic_clears_loading_flag_and_allows_retry() {
        let cache = Cache::new(Arc::new(Fake(AtomicU64::new(1))), Arc::new(Zero), Duration::from_secs(5));
        assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = cache.get_or_load("d1", || -> Result<Zeroizing<Vec<u8>>, &'static str> { panic!("load panic") });
        })).is_err());
        assert!(!cache.state.lock().unwrap().loading.contains("d1"));
        assert_eq!(cache.get_or_load("d1", || Ok(bytes(vec![3; 32]))).unwrap().secret.bytes(), &[3; 32]);
    }

    struct Split(AtomicU64, AtomicU64);
    impl time::Clock for Split { fn now(&self)->Duration { Duration::from_secs(self.0.load(Ordering::SeqCst)) } fn realtime(&self)->Duration { Duration::from_secs(self.1.load(Ordering::SeqCst)) } }

    #[test]
    fn realtime_only_advance_expires_key() {
        let c = Arc::new(Split(AtomicU64::new(1), AtomicU64::new(1000)));
        let cache = Cache::new(c.clone(), Arc::new(Zero), Duration::from_secs(60));
        let first = cache.get_or_load("d1", || Ok(bytes(vec![1; 32]))).unwrap();
        c.1.store(1030, Ordering::SeqCst);
        assert!(Arc::ptr_eq(&first, &cache.get_or_load("d1", || panic!()).unwrap()));
        c.1.store(1060, Ordering::SeqCst);
        assert_eq!(cache.get_or_load("d1", || Ok(bytes(vec![2; 32]))).unwrap().secret.bytes(), &[2; 32]);
        c.1.store(500, Ordering::SeqCst);
        assert_eq!(cache.get_or_load("d1", || Ok(bytes(vec![3; 32]))).unwrap().secret.bytes(), &[3; 32]);
    }

    #[test]
    fn open_fails_closed_without_rewriting_bad_files() {
        let path = std::env::temp_dir().join(format!("keyd-store-{}-{}.json", std::process::id(), crypto::hex(&crypto::random::<8>().unwrap())));
        assert_eq!(Store::open(path.to_string_lossy().into_owned()).unwrap().data.lock().unwrap().deks.len(), 0);
        fs::write(&path, b"garbage").unwrap();
        let garbage = fs::read(&path).unwrap();
        assert!(Store::open(path.to_string_lossy().into_owned()).is_err());
        assert_eq!(fs::read(&path).unwrap(), garbage);
        fs::write(&path, br#"{"v":2,"deks":[]}"#).unwrap();
        let v2 = fs::read(&path).unwrap();
        assert!(Store::open(path.to_string_lossy().into_owned()).is_err());
        assert_eq!(fs::read(&path).unwrap(), v2);
        let _ = fs::remove_file(path);
    }
}
