use crate::crypto::random;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub trait Clock: Send + Sync {
    /// Monotonic time since boot, suspend included.
    fn now(&self) -> Duration;
    fn realtime(&self) -> Duration;
}

// ponytail: CLOCK_BOOTTIME counts suspend time, realtime checked alongside it; add CLOCK_MONOTONIC fallback when BOOTTIME is unsupported on target
pub struct BootClock;

impl Clock for BootClock {
    fn now(&self) -> Duration {
        let mut ts = libc::timespec { tv_sec: 0, tv_nsec: 0 };
        unsafe { libc::clock_gettime(libc::CLOCK_BOOTTIME, &mut ts) };
        Duration::new(ts.tv_sec as u64, ts.tv_nsec as u32)
    }
    fn realtime(&self) -> Duration { wall() }
}

pub trait Jitter: Send + Sync {
    fn offset(&self) -> Duration;
}

pub struct RandomJitter;

impl Jitter for RandomJitter {
    fn offset(&self) -> Duration {
        let r = random::<4>().map(u32::from_le_bytes).unwrap_or(0);
        Duration::from_secs(5 + (r % 26) as u64)
    }
}

/// Howard Hinnant's civil_from_days: days since 1970-01-01 to (year, month, day).
fn civil(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

pub fn rfc3339(since_epoch: Duration) -> String {
    let secs = since_epoch.as_secs() as i64;
    let (y, m, d) = civil(secs.div_euclid(86_400));
    let rem = secs.rem_euclid(86_400);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{:09}Z",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60,
        since_epoch.subsec_nanos()
    )
}

fn wall() -> Duration {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default()
}

pub fn now_rfc3339() -> String {
    rfc3339(wall())
}

pub fn utc_year() -> i64 {
    civil(wall().as_secs() as i64 / 86_400).0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rfc3339_known_values() {
        assert_eq!(rfc3339(Duration::ZERO), "1970-01-01T00:00:00.000000000Z");
        assert_eq!(
            rfc3339(Duration::new(1_000_000_000, 5)),
            "2001-09-09T01:46:40.000000005Z"
        );
        assert_eq!(
            rfc3339(Duration::new(1_793_664_000, 0)),
            "2026-11-03T00:00:00.000000000Z"
        );
    }
}
