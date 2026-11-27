/* EVENT PASS - admin dashboard */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
let people = [], scanner = null, lastToken = '', lastAt = 0;

function toast(msg, type = '') { const t = document.createElement('div'); t.className = 'toast ' + type; t.textContent = msg; $('#toasts').append(t); setTimeout(() => t.remove(), 4000); }
async function api(url, method = 'GET', body) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) { location.href = 'login.html'; throw new Error('Session expired'); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error || 'Request failed'), { data: d });
  return d;
}
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
const fmtDT = (iso) => new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const badge = (s) => el('span', { className: 'badge badge-' + s, textContent: s });
const icon = (n) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('class', 'ic'); s.innerHTML = `<use href="#i-${n}"/>`; return s; };

/* ---- tabs ---- */
const TITLES = { participants: 'Participants', scanner: 'Scan & Verify', event: 'Event Details' };
function showTab(t) {
  $$('.tab[data-tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === t));
  $$('.panel').forEach(p => p.hidden = p.id !== 'panel-' + t);
  $('#page-title').textContent = TITLES[t]; if (t !== 'scanner') stopScan();
}
$$('.tab[data-tab]').forEach(b => b.onclick = () => showTab(b.dataset.tab));
$('#logout').onclick = async () => { await api('/api/admin/logout', 'POST').catch(() => {}); location.href = 'login.html'; };

/* ---- reset all data ---- */
$('#reset-all').onclick = async () => {
  if (!confirm('Delete ALL registrations and restore the default event details?\n\nThis also removes them from Supabase and cannot be undone.')) return;
  if ((prompt('Type RESET to confirm:') || '').trim().toUpperCase() !== 'RESET') return toast('Reset cancelled.');
  try {
    const r = await api('/api/admin/reset', 'POST');
    toast(r.message || 'All data reset.', 'ok');
    people = []; $('#search').value = ''; $('#f-branch').value = ''; $('#f-status').value = '';
    $('#recent').replaceChildren();
    await Promise.all([loadPeople(), loadStats(), loadEvent()]);
  } catch (e) { toast(e.message, 'bad'); }
};

/* ---- stats & table ---- */
async function loadStats() {
  const s = await api('/api/admin/stats');
  ['total', 'verified', 'pending', 'rejected'].forEach(k => $('#s-' + k).textContent = s[k]);
}
async function loadPeople() {
  const d = await api('/api/admin/participants'); people = d.participants;
  if ($('#f-branch').options.length === 1) d.branches.forEach(b => $('#f-branch').append(new Option(b, b)));
  render();
}
function render() {
  const q = $('#search').value.trim().toLowerCase(), b = $('#f-branch').value, st = $('#f-status').value;
  const list = people.filter(p => (!b || p.branch === b) && (!st || p.status === st) &&
    (!q || [p.id, p.name, p.email, p.phone, p.usn].some(v => (v || '').toLowerCase().includes(q))));
  const body = $('#rows'); body.replaceChildren();
  list.forEach(p => {
    const act = (cls, label, ic, fn) => { const x = el('button', { className: 'icon-btn ' + cls, title: label, onclick: fn }); x.setAttribute('aria-label', `${label}: ${p.name}`); x.append(icon(ic)); return x; };
    const a = el('td', { className: 'actions' }, act('', 'View details', 'eye', () => view(p)));
    if (p.status === 'revoked') a.append(act('ok', 'Restore registration', 'undo', () => change(p, 'restore')));
    else {
      a.append(p.status === 'verified' ? act('', 'Mark as not present', 'undo', () => change(p, 'attendance', { present: false })) : act('ok', 'Mark present', 'check', () => change(p, 'attendance', { present: true })));
      a.append(act('bad', 'Revoke registration', 'ban', () => confirm(`Revoke ${p.id} (${p.name})? Their QR will be rejected.`) && change(p, 'revoke')));
    }
    a.append(act('bad', 'Delete registration', 'trash', () => confirm(`Delete ${p.id} (${p.name})?\n\nThis permanently removes all their registered details. This cannot be undone.`) && deleteReg(p)));
    body.append(el('tr', {}, el('td', { textContent: p.id }), el('td', { textContent: p.name }), el('td', { textContent: p.branch }), el('td', { textContent: p.phone }),
      el('td', { textContent: p.email }), el('td', { textContent: fmtDT(p.registeredAt) }), el('td', {}, badge(p.status)), a));
  });
  $('#empty').classList.toggle('hidden', list.length > 0);
}
async function change(p, action, body) {
  try { await api(`/api/admin/participants/${p.id}/${action}`, 'POST', body || {}); toast('Updated ' + p.id, 'ok'); await Promise.all([loadPeople(), loadStats()]); }
  catch (e) { toast(e.message, 'bad'); }
}
async function deleteReg(p) {
  try { await api(`/api/admin/participants/${p.id}`, 'DELETE'); toast(`Deleted ${p.id} (${p.name})`, 'ok'); await Promise.all([loadPeople(), loadStats()]); }
  catch (e) { toast(e.message, 'bad'); }
}
function view(p) {
  const rows = [['Registration ID', p.id], ['Name', p.name], ['USN', p.usn || '—'], ['Branch', p.branch], ['Phone', p.phone], ['Email', p.email], ['Registered', fmtDT(p.registeredAt)], ['Checked in', p.verifiedAt ? fmtDT(p.verifiedAt) : '—'], ['Status', p.status.toUpperCase()]];
  $('#dlg-body').replaceChildren(...rows.flatMap(([k, v]) => [el('dt', { textContent: k }), el('dd', { textContent: v })]));
  $('#dlg').showModal();
}
$('#dlg-close').onclick = () => $('#dlg').close();
['search', 'f-branch', 'f-status'].forEach(id => $('#' + id).addEventListener('input', render));

/* ---- scanner ---- */
const MSG = { valid: ['ok', 'check', 'ACCESS GRANTED'], duplicate: ['warn', 'clock', 'ALREADY CHECKED IN'], revoked: ['bad', 'ban', 'PASS REVOKED'], invalid: ['bad', 'x', 'INVALID QR'] };
async function verify(token) {
  token = token.trim(); if (!token) return;
  try {
    const r = await api('/api/admin/verify', 'POST', { token }), [cls, ic, title] = MSG[r.result], box = $('#result');
    box.className = 'result ' + cls; box.replaceChildren(el('h2', {}, icon(ic), title), el('p', { textContent: r.message }));
    if (r.participant) box.append(el('p', { innerHTML: '' }, el('b', { textContent: r.participant.name }), ` · ${r.participant.id} · ${r.participant.branch}`));
    $('#recent').prepend(el('li', {}, el('span', { textContent: r.participant ? `${r.participant.name} (${r.participant.id})` : 'Unknown QR' }), badge(r.result === 'valid' ? 'verified' : r.result === 'duplicate' ? 'pending' : 'revoked')));
    while ($('#recent').children.length > 8) $('#recent').lastChild.remove();
    navigator.vibrate?.(r.result === 'valid' ? 80 : [120, 60, 120]);
    loadStats(); loadPeople();
  } catch (e) { toast(e.message, 'bad'); }
}
async function startScan() {
  if (typeof Html5Qrcode === 'undefined') return toast('Scanner library failed to load (check internet).', 'bad');
  $('#reader').replaceChildren(); scanner = new Html5Qrcode('reader');
  try {
    await scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 240, height: 240 } }, (text) => {
      if (text === lastToken && Date.now() - lastAt < 4000) return; lastToken = text; lastAt = Date.now(); verify(text);
    }, () => {});
    $('#scan-start').classList.add('hidden'); $('#scan-stop').classList.remove('hidden');
  } catch { toast('Cannot open camera. Allow access, use HTTPS/localhost, or paste the token.', 'bad'); scanner = null; }
}
async function stopScan() {
  if (!scanner) return;
  try { await scanner.stop(); scanner.clear(); } catch {}
  scanner = null; $('#scan-start').classList.remove('hidden'); $('#scan-stop').classList.add('hidden');
}
$('#scan-start').onclick = startScan; $('#scan-stop').onclick = stopScan;
$('#manual').onsubmit = (e) => { e.preventDefault(); verify($('#manual-token').value); $('#manual-token').value = ''; };

/* ---- event settings ---- */
async function loadEvent() {
  const { event } = await (await fetch('/api/event')).json();
  Object.entries(event).forEach(([k, v]) => { const i = $('#e-' + k); if (i) i.value = v; });
}
$('#event-form').onsubmit = async (e) => {
  e.preventDefault();
  try {
    await api('/api/admin/event', 'PUT', Object.fromEntries(new FormData(e.target)));
    await loadEvent();   // reload from the server so the form shows what was really saved
    toast('Event details saved. The public page updates automatically.', 'ok');
  }
  catch (err) { toast(err.data?.errors ? 'Please fill all required fields.' : err.message, 'bad'); }
};

(async () => {
  try { $('#who').textContent = 'Signed in as ' + (await api('/api/admin/me')).user; } catch { return; }
  loadStats(); loadPeople(); loadEvent(); setInterval(loadStats, 20000);
})();
