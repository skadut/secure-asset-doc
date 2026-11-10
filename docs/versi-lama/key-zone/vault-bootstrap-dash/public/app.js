// Key Zone dashboard. ES module. DOM text via textContent only. Token: sessionStorage only.
const $ = (id) => document.getElementById(id);
const PHRASE = 'I have recorded all 5 shares';
const TOKEN_KEY = 'kz.token';
const OVERDUE = 'Cryptoperiod exceeded — run rekey';
const state = { token: null, status: null, filter: 'ALL', shares: null, revealed: false, nonce: null, inflight: false, gating: false, timers: [], certsAt: 0, certsBusy: false, certOpen: null, certsList: [], histOpen: new Set(), session: 0 };

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const badge = (node, text, tone) => { node.textContent = text; node.dataset.tone = tone; };
// ponytail: strips "(sealed)"-style suffix only. Upgrade: full NIST label table.
const toneOf = (s) => {
  const k = String(s).toLowerCase().replace(/\s*\(.*\)/, '').trim().replace(/[\s_]+/g, '-');
  if (k === 'active') return 'ok';
  if (k === 'suspended') return 'warn';
  if (k === 'deactivated') return 'off';
  if (['compromised', 'destroyed', 'destroyed-compromised'].includes(k)) return 'bad';
  if (k === 'pre-activation') return 'info';
  return 'off';
};
const utc = (iso) => { const d = new Date(iso); return iso && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 19).replace('T', ' ') + ' UTC' : '-'; };
const when = (iso) => {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const t = new Date();
  const diff = Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate())) / 86400000);
  return d.toISOString().slice(0, 10) + (diff === 0 ? ' (today)' : diff < 0 ? ` (${-diff} d ago)` : ` (in ${diff} d)`);
};
const days = (n) => `${n} ${n === 1 ? 'day' : 'days'}`;
const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const numOr = (n, unit = '') => (isNum(n) ? `${n}${unit}` : '-');
const failMsg = (e) => e.message || 'Request failed.';
const say = (msg) => { $('ceremony-live').textContent = msg; };
const setText = (node, t) => { if (node.textContent !== t) node.textContent = t; };
const storeGet = () => { try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; } };
const storeSet = (v) => { try { if (v === null) sessionStorage.removeItem(TOKEN_KEY); else sessionStorage.setItem(TOKEN_KEY, v); } catch { /* storage blocked: memory only */ } };

async function api(path, body) {
  let res;
  try {
    res = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + state.token, ...(body && { 'Content-Type': 'application/json' }) },
      body: body && JSON.stringify(body),
      cache: 'no-store',
    });
  } catch (e) { throw e instanceof TypeError ? new Error('Cannot reach the Key Zone server.') : e; }
  if (res.status === 401) {
    signOut(state.gating ? 'Token rejected.' : 'Session expired or token rejected. Enter the token again.');
    throw Object.assign(new Error('auth'), { auth: true });
  }
  if (!res.ok) throw Object.assign(new Error((await res.json().catch(() => null))?.error || 'HTTP ' + res.status), { status: res.status });
  return res.status === 204 ? null : res.json();
}

function busy(form, on) {
  const panel = form.closest('.ceremony-panel') || form;
  form.setAttribute('aria-busy', String(on));
  for (const c of panel.querySelectorAll('button, input')) c.disabled = on;
  if (!on) $('btn-destroy').disabled = $('destroy-phrase').value !== PHRASE;
}
async function loadStatus(pre) {
  state.inflight = true;
  try {
    const s = pre ?? (await api('/api/status'));
    state.status = s;
    $('updated').textContent = 'Updated ' + new Date().toISOString().slice(11, 19) + ' UTC';
    renderHeader(s); renderVerdict(s, null); renderCluster(s.nodes, s.threshold); renderKeys(s);
    showPanel(pickPanel(s));
  } catch (e) {
    if (e.auth) return;
    $('updated').textContent = 'Stale: ' + $('updated').textContent.replace(/^Stale: /, '');
    renderVerdict(null, e);
  } finally { state.inflight = false; }
}
function renderHeader(s) {
  const safe = s.mode === 'safe';
  badge($('mode-badge'), safe ? 'SAFE' : 'UNSAFE', safe ? 'ok' : 'warn');
  $('mode-note').textContent = safe ? 'Shamir manual unseal: 3 of 5 custodians enter shares after every restart.' : 'Auto-unseal from shares stored on this host. Use for development only.';
}

function renderVerdict(s, err) {
  let tone = 'ok', word = 'Usable', text, detail = '';
  const reach = s ? s.nodes.filter((n) => n.reachable) : [];
  if (err) { tone = 'bad'; word = 'Not ready'; text = 'Status unavailable. Retrying every 5 s.'; detail = err.message; }
  else if (!reach.length) { tone = 'bad'; word = 'Not ready'; text = 'No node reachable.'; }
  else if (!s.initialized) { tone = 'info'; word = 'Not ready'; text = 'Not initialized. Run the initialization ceremony.'; }
  else if (reach.some((n) => n.sealed)) {
    const max = Math.max(0, ...reach.filter((n) => n.sealed).map((n) => n.progress ?? 0));
    tone = 'warn'; word = 'Sealed';
    text = `Sealed. Unseal progress ${max}/${s.threshold}.` + (s.mode === 'unsafe' ? ' Auto-unseal running.' : '');
  } else if (s.rekey.started) { tone = 'warn'; text = `Usable. Rekey in progress: ${s.rekey.progress} of ${s.rekey.required} shares.`; }
  else if (s.msk.overdue) { tone = 'bad'; text = 'Usable. ' + OVERDUE; }
  else text = `Usable. All ${reach.length} nodes unsealed.`;
  badge($('verdict-badge'), word, tone);
  if ($('verdict-text').textContent !== text) $('verdict-text').textContent = text;
  $('verdict-detail').textContent = detail;
}
function renderCluster(nodes, threshold) {
  $('cluster-state').textContent = nodes.length ? '' : 'No nodes reported.';
  const pill = ([t, tone]) => { const td = el('td'); badge(td.appendChild(el('span', 'badge')), t, tone); return td; };
  $('cluster-body').replaceChildren(...nodes.map((n) => {
    const seal = !n.reachable ? ['Unknown', 'off'] : n.sealed ? ['Sealed', 'warn'] : ['Unsealed', 'ok'];
    const tr = el('tr');
    tr.append(el('td', '', n.id), pill(n.reachable ? ['Reachable', 'ok'] : ['Unreachable', 'bad']), pill(seal),
      el('td', 'num', n.reachable && n.sealed ? `${n.progress}/${threshold}` : '-'), el('td', 'mono', String(n.version ?? '-')));
    return tr;
  }));
}

function renderKeys({ msk, kek, dek }) {
  const left = (node, n, none = '-') => { node.dataset.tone = isNum(n) && n < 0 ? 'bad' : ''; node.textContent = !isNum(n) ? none : n >= 0 ? `${n} d left` : `Overdue, ${-n} d past`; };
  badge($('key-msk-state'), msk.state, toneOf(msk.state));
  $('key-msk-age').textContent = isNum(msk.ageDays) ? `${msk.ageDays} d of ${msk.cryptoperiodDays} d` : 'Unknown';
  $('key-msk-age').dataset.tone = msk.overdue ? 'bad' : '';
  $('key-msk-created').textContent = msk.createdAt == null ? 'Not recorded (initialized before event log)' : when(msk.createdAt);
  $('key-msk-rekey').textContent = when(msk.lastRekeyAt);
  $('key-msk-period').textContent = numOr(msk.cryptoperiodDays, ' d');
  $('key-msk-expires').textContent = msk.expiresAt == null ? 'Unknown until first rekey' : when(msk.expiresAt);
  left($('key-msk-days'), msk.daysLeft, 'Unknown until first rekey');
  $('key-msk-warn').textContent = msk.overdue ? OVERDUE : '';
  $('key-msk-warn').hidden = !msk.overdue;
  $('key-kek-name').textContent = kek.name;
  badge($('key-kek-state'), kek.state, toneOf(kek.state));
  $('key-kek-version').textContent = kek.latestVersion === null ? '-' : 'v' + kek.latestVersion;
  $('key-kek-age').textContent = numOr(kek.ageDays, ' d');
  $('key-kek-created').textContent = when(kek.createdAt);
  $('key-kek-rotated').textContent = when(kek.lastRotateAt);
  $('key-kek-period').textContent = numOr(kek.cryptoperiodDays, ' d');
  $('key-kek-expires').textContent = when(kek.nextRotateAt);
  left($('key-kek-days'), kek.daysLeft);
  $('key-kek-auto').textContent = kek.autoRotate ? (typeof kek.autoRotate === 'string' ? 'Every ' + kek.autoRotate : 'On') : 'Off';
  badge($('key-dek-state'), dek.state, toneOf(dek.state.split(' ')[0]));
  $('key-dek-ttl').textContent = dek.ttl;
  const stats = dek.stats ?? {};
  $('key-dek-generated').textContent = numOr(stats.generated24h);
  $('key-dek-unwrapped').textContent = numOr(stats.unwrapped24h);
  $('key-dek-total').textContent = numOr(stats.total);
  $('key-dek-last').textContent = when(stats.lastAt);
}

const CERT_STATUS = { valid: ['Valid', 'ok'], expiring: ['Expiring', 'warn'], expired: ['Expired', 'bad'], 'not-yet-valid': ['Not yet valid', 'info'], unavailable: ['Unavailable', 'off'] };
const certStatus = (s) => {
  if (s == null || s === '') return ['-', 'off'];
  return Object.hasOwn(CERT_STATUS, s) ? CERT_STATUS[s] : [String(s), 'off'];
};
const yesNo = (v) => (v === true ? 'Yes' : v === false ? 'No' : '-');
const joinOr = (a) => (Array.isArray(a) && a.length ? a.join(', ') : '-');
const fact = (k, v, cls) => { const div = el('div'); div.append(el('dt', '', k), el('dd', cls, v)); return div; };
const day = (iso) => (typeof iso === 'string' && !Number.isNaN(new Date(iso).getTime()) ? new Date(iso).toISOString().slice(0, 10) : '-');
const shortFp = (fp) => { if (typeof fp !== 'string' || !fp) return '-'; const g = fp.split(':'); return g.length > 8 ? `${g.slice(0, 4).join(':')}…${g.slice(-4).join(':')}` : fp; };
const EVENT_LABEL = { issued: 'Issued', 'private-key-destroyed': 'Private key destroyed', replaced: 'Replaced', expired: 'Expired' };

function renderCerts(list) {
  state.certsList = list;
  const unknown = [...new Set(list.map((c) => c.status).filter((s) => s != null && s !== '' && !Object.hasOwn(CERT_STATUS, s)))];
  const byStatus = [...Object.keys(CERT_STATUS), ...unknown].flatMap((k) => { const n = list.filter((c) => c.status === k).length; return n ? [`${certStatus(k)[0]} ${n}`] : []; });
  const live = list.filter((c) => isNum(c.daysLeft) && c.status !== 'unavailable');
  const soon = live.reduce((a, b) => (a === null || b.daysLeft < a.daysLeft ? b : a), null);
  const parts = [`${list.length} ${list.length === 1 ? 'certificate' : 'certificates'}`];
  if (byStatus.length) parts.push(byStatus.join(', '));
  if (soon) { const cn = soon.cn ?? soon.id ?? '-', n = soon.daysLeft; parts.push(n >= 0 ? `${cn} expires in ${days(n)}` : `${cn} expired ${days(-n)} ago`); }
  $('certs-summary').textContent = parts.join('. ') + '.';
  $('certs-table').parentElement.hidden = !list.length;
  const rows = list.map((c, i) => {
    const ck = String(c.id ?? i);
    const btn = el('button', 'btn-ghost', c.cn ?? c.id ?? '-'); btn.type = 'button'; btn.dataset.key = ck;
    btn.setAttribute('aria-expanded', String(state.certOpen === ck)); btn.setAttribute('aria-controls', 'cert-detail');
    btn.addEventListener('click', () => { state.certOpen = state.certOpen === ck ? null : ck; renderCerts(state.certsList); });
    const cnCell = el('td'); cnCell.appendChild(btn);
    const [label, tone] = certStatus(c.status);
    const st = el('td'); badge(st.appendChild(el('span', 'badge')), label, tone);
    if (c.status === 'unavailable' && c.error) st.append(el('div', 'muted', String(c.error)));
    const na = typeof c.notAfter === 'string' && !Number.isNaN(new Date(c.notAfter).getTime()) ? c.notAfter.slice(0, 10) : '-';
    const rel = !isNum(c.daysLeft) ? '-' : c.daysLeft >= 0 ? days(c.daysLeft) : `expired ${days(-c.daysLeft)} ago`;
    const ex = el('td'); ex.append(el('div', 'mono', na), el('div', 'muted', rel));
    const pk = c.publicKey;
    const key = pk == null ? '-' : pk.curve ? `${pk.type ?? '-'} ${pk.curve}` : pk.bits ? `${pk.type ?? '-'} ${pk.bits}` : String(pk.type ?? '-');
    const ps = c.privateKey?.state;
    const pkc = el('td');
    if (ps == null) pkc.textContent = '-';
    else { const mismatch = c.privateKey.matchesCert === false; badge(pkc.appendChild(el('span', 'badge')), String(ps) + (mismatch && String(ps).startsWith('Active') ? ' (mismatch)' : ''), mismatch ? 'bad' : 'off'); }
    const tr = el('tr');
    tr.append(cnCell, el('td', '', c.role ?? '-'), st, ex, el('td', '', key), pkc);
    return tr;
  });
  const sel = list.find((c, i) => String(c.id ?? i) === state.certOpen);
  if (!sel) state.certOpen = null;
  $('cert-detail').hidden = !sel;
  $('cert-detail-title').textContent = sel ? String(sel.cn ?? sel.id ?? '-') : '';
  $('cert-detail-facts').replaceChildren(...(sel ? [
    fact('Subject DN', sel.subjectDN ?? '-'),
    fact('Issuer DN', sel.issuerDN ?? '-'),
    fact('Serial', sel.serial ?? '-', 'mono'),
    fact('Valid from', utc(sel.notBefore)),
    fact('Valid to', utc(sel.notAfter)),
    fact('Lifetime', numOr(sel.lifetimeDays, ' d')),
    fact('SAN', joinOr(sel.san)),
    fact('Extended key usage', joinOr(sel.extKeyUsage)),
    fact('CA', yesNo(sel.isCA)),
    fact('SHA-256 fingerprint', sel.fingerprint256 ?? '-', 'mono'),
    fact('Source', sel.source ?? '-'),
    fact('Matches cert', sel.privateKey?.matchesCert === undefined ? 'n/a' : yesNo(sel.privateKey.matchesCert)),
    ...(sel.error ? [fact('Error', String(sel.error))] : []),
  ] : []));
  const focusKey = $('certs-body').contains(document.activeElement) ? document.activeElement.dataset.key : null;
  $('certs-body').replaceChildren(...rows);
  if (focusKey != null) $('certs-body').querySelector(`button[data-key="${CSS.escape(focusKey)}"]`)?.focus();
}

function renderHistory(h) {
  const events = Array.isArray(h?.events) ? h.events : [];
  const inv = Array.isArray(h?.inventory) ? h.inventory : [];
  if (!events.length && !inv.length) {
    setText($('hist-state'), 'No certificate events recorded yet.');
    $('hist-content').hidden = true;
    $('hist-inv-body').replaceChildren(); $('hist-timeline').replaceChildren();
    return;
  }
  setText($('hist-state'), '');
  $('hist-content').hidden = false;
  const notBeforeOf = (fp) => {
    const issued = events.find((e) => e.event === 'issued' && e.fingerprint256 === fp && e.notBefore);
    const any = issued ?? events.find((e) => e.fingerprint256 === fp && e.notBefore);
    return any?.notBefore ?? null;
  };
  const focusFp = $('hist-inv-body').contains(document.activeElement) ? document.activeElement.closest('details')?.dataset.fp : null;
  $('hist-inv-body').replaceChildren(...inv.map((item) => {
    const { fingerprint256: fp, state: st, privateKeyState: pks } = item;
    const tr = el('tr');
    if (st === 'Replaced' || st === 'Expired') tr.dataset.retired = 'true';
    const stc = el('td'); badge(stc.appendChild(el('span', 'badge')), st ?? '-', st === 'Current' ? 'ok' : 'off');
    const pkc = el('td');
    if (pks == null) pkc.textContent = '-';
    else badge(pkc.appendChild(el('span', 'badge')), String(pks), 'off');
    const fpc = el('td');
    if (typeof fp === 'string' && fp) {
      const d = el('details', 'fp'); d.dataset.fp = fp;
      const sm = el('summary', 'mono', shortFp(fp)); sm.title = fp;
      d.append(sm, el('span', 'mono fp-full', fp));
      d.open = state.histOpen.has(fp);
      d.addEventListener('toggle', () => { if (d.open) state.histOpen.add(fp); else state.histOpen.delete(fp); });
      fpc.appendChild(d);
    } else fpc.textContent = '-';
    tr.append(el('td', '', item.cn ?? item.id ?? '-'), el('td', '', item.role ?? '-'), stc, pkc,
      el('td', 'mono', `${day(notBeforeOf(fp))} → ${day(item.notAfter)}`), fpc);
    return tr;
  }));
  if (focusFp) $('hist-inv-body').querySelector(`details[data-fp="${CSS.escape(focusFp)}"] > summary`)?.focus();
  $('hist-timeline').replaceChildren(...events.map((e) => {
    const li = el('li', 'tl-item');
    const t = el('time', 'mono', utc(e.at)); if (typeof e.at === 'string') t.dateTime = e.at;
    li.append(t, el('strong', '', EVENT_LABEL[e.event] ?? String(e.event ?? '-')), el('span', '', e.cn ?? e.id ?? '-'));
    if (e.inferred === true) { const b = el('span', 'badge'); badge(b, 'estimated', 'info'); li.append(b); }
    if (e.event === 'replaced' && e.replacedBy) li.append(el('span', 'muted', 'replaced by '), el('span', 'mono', shortFp(e.replacedBy)));
    if (e.note) li.append(el('p', 'muted tl-note', String(e.note)));
    return li;
  }));
}
async function loadCerts() {
  if (state.certsBusy) return;
  state.certsBusy = true;
  const s = state.session;
  if (!$('certs-body').rows.length && !$('certs-state').textContent) $('certs-state').textContent = 'Loading certificates...';
  if ($('hist-content').hidden && !$('hist-state').textContent) $('hist-state').textContent = 'Loading certificate history...';
  const settle = (p) => p.then((value) => ({ ok: true, value }), (reason) => ({ ok: false, reason }));
  try {
    // Sequential on purpose: /api/certs appends new history events server-side; reading history after it avoids a one-cycle lag.
    const cr = await settle(api('/api/certs'));
    if (s !== state.session || !state.token) return;
    if (cr.ok) { const list = cr.value?.certs ?? []; renderCerts(list); setText($('certs-state'), list.length ? '' : 'No certificates reported.'); }
    else if (cr.reason?.auth) return;
    else { const stale = $('certs-body').rows.length > 0; setText($('certs-state'), `Could not load certificates: ${failMsg(cr.reason)}. Retrying in about 60 s.` + (stale ? ' Showing last loaded rows, may be stale.' : '')); }
    const hr = await settle(api('/api/certs/history'));
    if (s !== state.session || !state.token) return;
    if (hr.ok) renderHistory(hr.value);
    else if (!hr.reason?.auth) { const stale = !$('hist-content').hidden; setText($('hist-state'), `Could not load certificate history: ${failMsg(hr.reason)}. Retrying in about 60 s.` + (stale ? ' Showing last loaded history, may be stale.' : '')); }
  } finally {
    if (s === state.session) { state.certsBusy = false; state.certsAt = Date.now(); }
  }
}

function pickPanel(s) {
  if (!s.nodes.some((n) => n.reachable)) return 'p-none';
  if (!s.initialized) return 'p-init';
  if (s.nodes.some((n) => n.reachable && n.sealed)) return 'p-unseal';
  if (s.rekey.started) return 'p-rekey';
  if (s.mode === 'safe' && s.sharesOnDisk) return 'p-reveal';
  if (s.mode === 'unsafe' && !s.sharesOnDisk) return 'p-store';
  return 'p-rekey';
}

function showPanel(id) {
  if (state.shares !== null) return; // share lock: keep one-time display visible
  for (const p of document.querySelectorAll('.ceremony-panel')) p.hidden = p.id !== id;
  $('unseal-auto').hidden = state.status?.mode !== 'unsafe';
  $('f-destroy').hidden = !state.revealed;
  if (state.status) renderRekey(state.status);
}

const on = (node, ev, fn) => node.addEventListener(ev, async (e) => { try { await fn(e); } catch (err) { if (!err.auth) say(failMsg(err)); } });
const wrap = (form, errId, fn, share = false) => async (e) => {
  e.preventDefault(); $(errId).textContent = ''; busy(form, true);
  try { await fn(); } catch (err) { if (!err.auth) $(errId).textContent = share && err.status === 400 ? 'Share rejected: ' + err.message : failMsg(err); }
  finally { busy(form, false); }
};

function showShares(list, title) {
  state.shares = list.slice(); list.fill('');
  $('share-title').textContent = title;
  for (const p of document.querySelectorAll('.ceremony-panel')) p.hidden = true;
  $('share-reveal').hidden = false;
  $('share-list').replaceChildren(...state.shares.map((v, i) => { const li = el('li', 'slip'); li.append(el('span', 'slip-num', `Custodian ${i + 1}`), el('code', 'slip-value', v)); return li; }));
  $('share-ack').checked = false; $('share-done').disabled = true; $('share-title').focus();
}
function clearShares(reload = true) {
  $('share-list').replaceChildren();
  if (state.shares) state.shares.fill('');
  state.shares = null; $('share-reveal').hidden = true; $('share-ack').checked = false;
  if (reload) loadStatus();
}
on($('share-ack'), 'change', () => { $('share-done').disabled = !$('share-ack').checked; });
on($('share-done'), 'click', () => { clearShares(); $('ceremony-title').focus(); });

function renderConfigure(list = []) {
  $('configure').hidden = !list.length;
  $('configure-list').replaceChildren(...list.map((line) => {
    const m = /^(PASS|FAIL):\s*(.*)$/.exec(String(line)); const li = el('li'); const b = el('span', 'badge');
    badge(b, m ? m[1] : '-', m ? (m[1] === 'PASS' ? 'ok' : 'bad') : 'off');
    li.append(b, ' ', m ? m[2] : String(line)); return li;
  }));
}
function renderRekey(s) {
  const started = s.rekey.started, safe = s.mode === 'safe';
  $('rekey-state').textContent = started ? `Rekey in progress: ${s.rekey.progress} of ${s.rekey.required} shares entered.` : 'Generates a new share set (5 shares, threshold 3). Old shares stop working when it completes.';
  $('btn-rekey-start').hidden = started; $('f-rekey').hidden = !started; $('btn-rekey-cancel').hidden = !started;
  $('rekey-share-field').hidden = !safe; $('rekey-share').required = safe;
  $('btn-rekey-submit').textContent = safe ? 'Submit rekey share' : 'Complete rekey with stored shares';
  state.nonce = s.rekey.nonce ?? state.nonce;
}

$('f-init').addEventListener('submit', wrap($('f-init'), 'init-error', async () => {
  if (!$('init-confirm').checked) throw new Error('Tick the confirmation first.');
  try {
    const res = await api('/api/init', {});
    renderConfigure(res.configure);
    if (res.shares) { showShares(res.shares, 'Initial unseal shares'); res.shares = null; }
    else say('Initialized. Shares stored on disk for auto-unseal.');
    await loadStatus();
  } catch (err) {
    if (err.status !== 409) throw err;
    say('Already initialized.'); await loadStatus();
  }
}));
$('f-unseal').addEventListener('submit', wrap($('f-unseal'), 'unseal-error', async () => {
  try {
    const res = await api('/api/unseal', { share: $('unseal-share').value });
    renderCluster(res.nodes, state.status?.threshold ?? 3);
    say(`Share accepted. ${res.nodes.filter((n) => n.reachable && !n.sealed).length} of ${res.nodes.length} nodes unsealed.`);
    await loadStatus();
  } finally { $('unseal-share').value = ''; }
}, true));
$('btn-reveal').addEventListener('click', wrap($('btn-reveal'), 'reveal-error', async () => {
  const res = await api('/api/shares/reveal', {});
  showShares(res.shares, 'Shares from disk, shown once'); res.shares = null; state.revealed = true;
}));
on($('destroy-phrase'), 'input', () => { $('btn-destroy').disabled = $('destroy-phrase').value !== PHRASE; });
$('f-destroy').addEventListener('submit', wrap($('f-destroy'), 'destroy-error', async () => {
  try {
    await api('/api/shares/destroy', { confirm: $('destroy-phrase').value });
    say('Stored shares destroyed. Unseal is now manual only.'); state.revealed = false; await loadStatus();
  } finally { $('destroy-phrase').value = ''; }
}));
$('f-store').addEventListener('submit', wrap($('f-store'), 'store-error', async () => {
  const inputs = [...document.querySelectorAll('#f-store .share-input')]; let shares = [];
  try {
    shares = inputs.map((i) => i.value).filter(Boolean);
    if (shares.length < 3) throw new Error('Enter at least 3 shares.');
    await api('/api/shares/store', { shares });
    say('Shares stored. Nodes will auto-unseal on restart.'); await loadStatus();
  } finally { shares.fill(''); for (const i of inputs) i.value = ''; }
}));
$('btn-rekey-start').addEventListener('click', wrap($('btn-rekey-start'), 'rekey-error', async () => {
  state.nonce = (await api('/api/rekey/start', {})).nonce; await loadStatus();
}));
$('f-rekey').addEventListener('submit', wrap($('f-rekey'), 'rekey-error', async () => {
  try {
    const body = state.status?.mode === 'safe' ? { nonce: state.nonce, share: $('rekey-share').value } : { nonce: state.nonce };
    const res = await api('/api/rekey/update', body);
    if (res.complete && res.shares) { showShares(res.shares, 'New unseal shares after rekey'); res.shares = null; }
    else if (res.complete) say('Rekey complete. New shares stored on disk.');
    else say(`Share accepted: ${res.progress} of ${res.required}.`);
    await loadStatus();
  } finally { $('rekey-share').value = ''; }
}, true));
$('btn-rekey-cancel').addEventListener('click', wrap($('btn-rekey-cancel'), 'rekey-error', async () => {
  await api('/api/rekey/cancel', {}); say('Rekey cancelled.'); await loadStatus();
}));

async function loadEvents(fresh = false) {
  if (fresh) $('events-state').textContent = 'Loading events…';
  try {
    const list = await api(`/api/events?limit=200&type=${encodeURIComponent(state.filter)}`);
    const cell = (v) => el('td', '', v == null || v === '' ? '-' : String(v));
    $('events-body').replaceChildren(...list.map((e) => {
      const r = { ok: ['OK', 'ok'], fail: ['Fail', 'bad'], denied: ['Denied', 'warn'] }[e.result];
      const res = el('td'); if (r) badge(res.appendChild(el('span', 'badge')), r[0], r[1]); else res.textContent = '-';
      const ns = el('td'); if (e.nistState) badge(ns.appendChild(el('span', 'badge')), e.nistState, toneOf(String(e.nistState).split(/[\s(→;]/)[0])); else ns.textContent = '-';
      const tr = el('tr');
      tr.append(el('td', 'mono', utc(e.at)), cell(e.type), cell(e.op), el('td', 'mono', e.keyId ?? '-'), cell(e.version), cell(e.node), cell(e.actor), res, ns, cell(e.note));
      return tr;
    }));
    $('events-table').parentElement.hidden = !list.length;
    $('events-state').textContent = list.length ? '' : `No ${state.filter === 'ALL' ? '' : state.filter + ' '}key events recorded yet.`;
  } catch (e) { if (!e.auth) $('events-state').textContent = `Could not load events: ${failMsg(e)}. Retrying in 10 s.`; }
}
async function loadPolicy() {
  $('policy-state').textContent = 'Loading policy…';
  try {
    const list = await api('/api/policy');
    $('policy-body').replaceChildren(...list.map((p) => {
      const tr = el('tr');
      for (const k of ['key', 'nistClass', 'purpose', 'cryptoperiod', 'configured', 'custody', 'ref']) tr.append(el('td', '', String(p[k] ?? '-')));
      return tr;
    }));
    $('policy-state').textContent = list.length ? '' : 'No policy entries returned.';
  } catch (e) { if (!e.auth) $('policy-state').textContent = `Could not load policy: ${failMsg(e)}`; }
}
for (const b of document.querySelectorAll('.filter-btn')) on(b, 'click', async () => {
  state.filter = b.dataset.type;
  for (const x of document.querySelectorAll('.filter-btn')) x.setAttribute('aria-pressed', String(x === b));
  await loadEvents(true);
});
// ponytail: 60 s throttle, certs change rarely. Upgrade: server ETag or push.
const tickStatus = () => { if (!document.hidden && !state.inflight && state.token) { loadStatus(); if (Date.now() - state.certsAt >= 60000) loadCerts(); } };
const tickEvents = () => { if (!document.hidden && state.token) loadEvents(); };
function startPolling() { stopPolling(); state.timers = [setInterval(tickStatus, 5000), setInterval(tickEvents, 10000)]; }
function stopPolling() { for (const t of state.timers) clearInterval(t); state.timers = []; }
async function loadAll(s) { await loadStatus(s); if (state.token) { loadEvents(true); loadPolicy(); loadCerts(); } }
function showApp() { $('gate').hidden = true; $('app').hidden = false; $('verdict-text').focus(); }
function signOut(msg = '') {
  stopPolling(); clearShares(false);
  $('certs-body').replaceChildren(); $('certs-summary').textContent = ''; $('certs-state').textContent = ''; $('certs-table').parentElement.hidden = true; state.certsAt = 0; state.certOpen = null; state.certsList = []; state.histOpen = new Set(); state.session++; state.certsBusy = false;
  $('cert-detail').hidden = true; $('cert-detail-facts').replaceChildren(); $('cert-detail-title').textContent = '';
  $('hist-inv-body').replaceChildren(); $('hist-timeline').replaceChildren(); $('hist-state').textContent = ''; $('hist-content').hidden = true;
  storeSet(null); state.token = null; state.status = null; state.revealed = false; state.nonce = null;
  for (const i of $('app').querySelectorAll('input')) { if (i.type === 'checkbox') i.checked = false; else i.value = ''; }
  $('app').hidden = true; $('gate').hidden = false; $('gate-error').textContent = msg; $('gate-token').focus();
}
$('gate-form').addEventListener('submit', async (e) => {
  e.preventDefault(); $('gate-error').textContent = ''; state.gating = true;
  try { state.token = $('gate-token').value;
    const s = await api('/api/status');
    storeSet(state.token); showApp(); startPolling(); state.gating = false; await loadAll(s);
  } catch (err) {
    if (!err.auth) { state.token = null; $('gate-error').textContent = failMsg(err); }
  } finally { state.gating = false; $('gate-token').value = ''; }
});
on($('signout'), 'click', () => signOut(''));
on(window, 'pagehide', () => clearShares(false));
window.addEventListener('beforeunload', (e) => { if (state.shares !== null) e.preventDefault(); });
on(document, 'visibilitychange', () => { if (!document.hidden && state.token) loadStatus(); });
state.token = storeGet();
if (state.token) { showApp(); startPolling(); loadAll(); } else $('gate-token').focus();
