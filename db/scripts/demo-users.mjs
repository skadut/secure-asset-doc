// Demo account slots: fictional names, deterministic usernames. Pure: no DB, no env.
// Slot order = ranks by sort, then n. DEMO_NAMES consumed in that order.

export const GOLONGAN_COUNT = Object.freeze({
  PATI: 2,
  PAMEN: 2,
  PAMA: 2,
  'Bintara Tinggi': 5,
  Bintara: 5,
  'Tamtama Kepala': 5,
  Tamtama: 5,
});

// 80 fictional Indonesian names. All demo data.
export const DEMO_NAMES = Object.freeze([
  'Hendra Wiratama', 'Ratna Sekarsari', 'Yudi Ananda', 'Maya Kusumawati',
  'Teguh Prasetya', 'Dewi Anggraini', 'Bambang Sulistyo', 'Nurul Hikmah',
  'Rizky Firmansyah', 'Ayu Lestari', 'Fajar Nugraha', 'Mega Puspitasari',
  'Agung Setiadi', 'Lia Marlina', 'Wahyu Hidayat', 'Sri Wahyuni',
  'Dimas Saputra', 'Intan Permatasari', 'Arif Budiman', 'Tika Rahmadani',
  'Surya Pratama', 'Nina Oktaviani', 'Gilang Ramadhan', 'Putri Handayani',
  'Eko Wicaksono', 'Rudi Hermawan', 'Sinta Oktavia', 'Andre Kurniawan',
  'Winda Safitri', 'Ilham Maulana', 'Kusnadi Hartono', 'Ani Widiastuti',
  'Heru Susanto', 'Rina Anggriani', 'Bayu Aditya', 'Doni Setiawan',
  'Yuni Astuti', 'Faisal Akbar', 'Lestari Ningsih', 'Made Wirawan',
  'Martin Simanjuntak', 'Nadia Herlina', 'Hasan Basri', 'Ratih Puspita',
  'Yoga Pradipta', 'Komang Adnyana', 'Wati Susilowati', 'Hafiz Ramadan',
  'Dian Permadi', 'Yusuf Mahendra', 'Agus Rusdiana', 'Melinda Kartika',
  'Iwan Setyawan', 'Ika Purwanti', 'Ridwan Gunadi', 'Bima Pamungkas',
  'Siska Amelia', 'Taufik Hidayatullah', 'Laras Wulandari', 'Wawan Kristanto',
  'Nanda Prasetyo', 'Mawar Pertiwi', 'Arman Hakim', 'Fitria Wahyuni',
  'Joni Iskandar', 'Samsul Bahri', 'Ayu Kartini', 'Reza Fahlevi',
  'Citra Dewantari', 'Agus Triyono', 'Bagus Hartanto', 'Dina Maharani',
  'Yanto Suprapto', 'Linda Tanuwijaya', 'Kevin Halim', 'Ahmad Zaelani',
  'Sari Rejeki', 'Dedi Kurniadi', 'Nurhayati Lubis', 'Rendi Pangestu',
]);

// Units (fictional labels). Slots 0-3 (level-5 commanders) -> HQ_UNIT; slots i>=4 -> ROTATION.
export const HQ_UNIT = 'Markas Komando';
export const ROTATION = Object.freeze([
  'Unit Intelijen', 'Unit Operasi', 'Unit Logistik', 'Unit Komunikasi dan Elektronika',
  'Unit Personel', 'Unit Zeni', 'Unit Kesehatan',
]);
export const UNITS = Object.freeze([HQ_UNIT, ...ROTATION]);

export function unitFor(slotIndex) {
  return slotIndex < 4 ? HQ_UNIT : ROTATION[(slotIndex - 4) % 7];
}

// Unlisted rank codes default to 1 (users.access_level DEFAULT in 008_access_levels.sql).
export const LEVELS = Object.freeze({
  'jenderal-tni': 5,
  'letnan-jenderal-tni': 5,
  'mayor-jenderal-tni': 4,
  'brigadir-jenderal-tni': 4,
  kolonel: 3,
  'letnan-kolonel': 3,
  mayor: 3,
  kapten: 2,
  'letnan-satu': 2,
  'letnan-dua': 2,
  'sersan-mayor': 2,
});

// Security officers: all in Unit Intelijen, all non-level-5. Replaces any older list.
export const SECURITY_OFFICERS = Object.freeze(['teguh.prasetya', 'mega.puspitasari', 'arif.budiman', 'heru.susanto']);
// Super admin: not a rank slot (80-slot counts unchanged). Level 5, never a security officer. Seeded only after 014_super_admin.sql.
export const SUPER_ADMIN = Object.freeze({ username: 'super.admin', name: 'Super Admin', rankCode: 'jenderal-tni', accessLevel: 5, unit: HQ_UNIT });

// First and last token, lowercase ASCII, joined by '.'. Diacritics stripped.
export function usernameFor(fullName) {
  const parts = fullName.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().split(/\s+/);
  return `${parts[0]}.${parts[parts.length - 1]}`;
}

// ranks: [{ code, golongan }] ordered by sort. Returns one slot per account.
// oldUsername = pre-rename rank-code username (`<code>`, `<code>-<n>`), used by --rename.
export function buildSlots(ranks) {
  const slots = [];
  for (const r of ranks) {
    if (!Object.hasOwn(GOLONGAN_COUNT, r.golongan)) throw new Error(`unknown golongan '${r.golongan}' for ${r.code}`);
    for (let n = 1; n <= GOLONGAN_COUNT[r.golongan]; n++) {
      const name = DEMO_NAMES[slots.length];
      if (name === undefined) throw new Error('not enough demo names');
      slots.push({
        rankCode: r.code,
        golongan: r.golongan,
        n,
        name,
        unit: unitFor(slots.length),
        username: usernameFor(name),
        oldUsername: n === 1 ? r.code : `${r.code}-${n}`,
      });
    }
  }
  return slots;
}

// One head per unit: highest access level. Tie -> lowest slot index. Slots follow rank sort, so that is the higher rank.
// Pure. Input: slots from buildSlots. Output: Map(unit -> username). Markas Komando head is level 5 (asserted in check).
export function computeUnitHeads(slots) {
  const best = new Map();
  for (const s of slots) {
    const lvl = Object.hasOwn(LEVELS, s.rankCode) ? LEVELS[s.rankCode] : 1;
    const cur = best.get(s.unit);
    if (cur === undefined || lvl > cur.lvl) best.set(s.unit, { username: s.username, lvl });
  }
  return new Map([...best].map(([unit, h]) => [unit, h.username]));
}
