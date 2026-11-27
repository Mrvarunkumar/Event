/* EVENT PASS - public site: event info, registration, QR pass */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
let EVENT = null, PASS = null, refreshing = false;
const KEY = 'eventpass:pass';

function toast(msg, type = '') {
  const t = document.createElement('div'); t.className = 'toast ' + type; t.textContent = msg;
  $('#toasts').append(t); setTimeout(() => t.remove(), 4500);
}
async function api(url, opts = {}) {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || 'Request failed'), { data, status: r.status });
  return data;
}
const fmtDate = (d, short) => new Date(d + 'T00:00').toLocaleDateString('en-IN', short ? { day: 'numeric', month: 'short', year: 'numeric' } : { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fmtTime = (t) => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };

/* ---- event details ---- */
function fillEvent() {
  const e = { ...EVENT, dateFmt: fmtDate(EVENT.date), dateShort: fmtDate(EVENT.date, true), timeFmt: fmtTime(EVENT.time) };
  $$('[data-ev]').forEach(el => { el.textContent = e[el.dataset.ev] ?? ''; });
  document.title = `${EVENT.name} | EVENT PASS`;
}
function tick() {
  const diff = new Date(`${EVENT.date}T${EVENT.time}`) - Date.now();
  const v = Math.max(0, diff), p = (n) => String(n).padStart(2, '0');
  $('#cd-d').textContent = p(Math.floor(v / 864e5)); $('#cd-h').textContent = p(Math.floor(v / 36e5) % 24);
  $('#cd-m').textContent = p(Math.floor(v / 6e4) % 60); $('#cd-s').textContent = p(Math.floor(v / 1e3) % 60);
}
/* Load (or reload) event details; retry automatically if the server was down. */
async function refreshEvent() {
  if (refreshing) return;
  refreshing = true;
  try {
    const { event, branches } = await api('/api/event');
    if (!event || !event.name) throw new Error('Invalid event data');
    const changed = !EVENT || JSON.stringify(event) !== JSON.stringify(EVENT);
    EVENT = event;
    if (changed) { fillEvent(); tick(); }
    if (Array.isArray(branches) && $('#branch').options.length === 1)
      branches.forEach(b => $('#branch').append(new Option(b, b)));
    $('#api-error').classList.add('hidden');
  } catch (err) {
    const box = $('#api-error');
    if (box) {
      const wrongHost = location.protocol === 'file:' || err?.status === 404 || err?.message === 'Invalid event data';
      box.textContent = wrongHost
        ? 'Open this page from the app server (http://localhost:3000 or your deployed URL), not as a plain file.'
        : 'Cannot reach the event server yet. Retrying automatically…';
      box.classList.remove('hidden');
    }
    /* keep the values rendered by the server if the API is unavailable */
  } finally { refreshing = false; }
}

/* ---- validation (mirrors the server) ---- */
const rules = {
  name: v => /^[A-Za-z][A-Za-z .'-]{1,79}$/.test(v) || 'Enter your full name (letters only).',
  usn: v => !v || /^[A-Za-z0-9]{5,20}$/.test(v) || 'USN should be 5-20 letters/digits.',
  branch: v => !!v || 'Select your department.',
  phone: v => /^(?:\+91|91|0)?[6-9]\d{9}$/.test(v.replace(/[\s-]/g, '')) || 'Enter a valid 10-digit Indian mobile number.',
  email: v => /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(v) || 'Enter a valid email address.'
};
function setErr(name, msg) {
  const f = $('#' + name).closest('.field'); f.classList.toggle('invalid', !!msg);
  $('.err', f).textContent = msg || ''; $('#' + name).setAttribute('aria-invalid', !!msg);
}
const check = (n) => { const r = rules[n]($('#' + n).value.trim()); setErr(n, r === true ? '' : r); return r === true; };

/* ---- QR drawing ---- */
function drawQR(canvas, text) {
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  const n = q.getModuleCount(), total = n + 8, cell = canvas.width / total, c = canvas.getContext('2d');
  c.fillStyle = '#fff'; c.fillRect(0, 0, canvas.width, canvas.height); c.fillStyle = '#000';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.isDark(y, x)) c.fillRect(Math.round((x + 4) * cell), Math.round((y + 4) * cell), Math.ceil(cell), Math.ceil(cell));
}
function showPass(p) {
  PASS = p; fillEvent();
  $('#p-name').textContent = p.name; $('#p-id').textContent = p.id; $('#p-branch').textContent = p.branch;
  drawQR($('#qr'), p.token);
  $('#pass-section').classList.remove('hidden');
}

/* ---- downloads ---- */
const file = (name) => `${name}-${PASS.id}`;
$('#dl-png').onclick = () => {
  const a = document.createElement('a'); a.href = $('#qr').toDataURL('image/png'); a.download = file('qr') + '.png'; a.click();
};
$('#print').onclick = () => window.print();
$('#dl-pdf').onclick = () => {
  const { jsPDF } = window.jspdf, d = new jsPDF({ unit: 'mm', format: 'a5' }), W = 148;
  d.setFillColor(124, 58, 237); d.rect(0, 0, W, 46, 'F');
  d.setTextColor(255); d.setFont('helvetica', 'bold'); d.setFontSize(10); d.text('ENTRY PASS', 14, 16);
  d.setFontSize(22); d.text(d.splitTextToSize(EVENT.name, W - 28), 14, 28);
  d.setTextColor(46, 16, 101); d.setFontSize(20); d.text(d.splitTextToSize(PASS.name, W - 28), 14, 62);
  const row = (l, v, x, y) => { d.setFontSize(8); d.setTextColor(71, 85, 105); d.setFont('helvetica', 'bold'); d.text(l.toUpperCase(), x, y); d.setFontSize(11); d.setTextColor(46, 16, 101); d.text(String(v), x, y + 5.5); };
  row('Registration ID', PASS.id, 14, 76); row('Branch', PASS.branch, 80, 76);
  row('Date', fmtDate(EVENT.date, true), 14, 92); row('Time', fmtTime(EVENT.time), 80, 92);
  d.setFontSize(8); d.setTextColor(71, 85, 105); d.text('VENUE', 14, 108); d.setFontSize(11); d.setTextColor(46, 16, 101); d.text(d.splitTextToSize(EVENT.venue, W - 28), 14, 113.5);
  d.setDrawColor(221, 214, 254); d.setLineDashPattern([2, 2], 0); d.roundedRect(24, 124, 100, 62, 4, 4);
  d.addImage($('#qr').toDataURL('image/png'), 'PNG', 54, 128, 54, 54);
  d.setFillColor(254, 243, 199); d.roundedRect(14, 192, 42, 8, 4, 4, 'F');
  d.setTextColor(180, 83, 9); d.setFont('helvetica', 'bold'); d.setFontSize(9); d.text('REGISTERED', 35, 197.2, { align: 'center' });
  d.setTextColor(71, 85, 105); d.setFont('helvetica', 'normal'); d.setFontSize(8); d.text('Show this QR at the entrance. Valid for one entry.', W - 14, 197.2, { align: 'right' });
  d.save(file('entry-pass') + '.pdf');
};

/* ---- init & submit ---- */
(async function init() {
  $('#yr').textContent = new Date().getFullYear();
  await refreshEvent();                       // keeps retrying if the server starts late
  setInterval(tick, 1000);
  setInterval(refreshEvent, 15000);
  window.addEventListener('focus', refreshEvent);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshEvent(); });
  try { const saved = JSON.parse(localStorage.getItem(KEY)); if (saved?.token && EVENT) showPass(saved); } catch {}
})();

Object.keys(rules).forEach(n => { $('#' + n).addEventListener('blur', () => check(n)); $('#' + n).addEventListener('input', () => $('#' + n).closest('.field').classList.contains('invalid') && check(n)); });

$('#reg-form').addEventListener('submit', async (ev) => {
  ev.preventDefault(); $('#form-error').classList.add('hidden');
  const bad = Object.keys(rules).filter(n => !check(n));
  if (bad.length) { $('#' + bad[0]).focus(); return; }
  const btn = $('#submit-btn'); btn.disabled = true; btn.textContent = 'Registering…';
  try {
    const body = Object.fromEntries(Object.keys(rules).map(n => [n, $('#' + n).value.trim()]));
    const { registration } = await api('/api/register', { method: 'POST', body: JSON.stringify(body) });
    try { localStorage.setItem(KEY, JSON.stringify(registration)); } catch {}
    showPass(registration); $('#reg-form').reset();
    toast('Registration successful! Your pass is ready.', 'ok');
    $('#pass-section').scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    const errs = err.data?.errors;
    if (errs) Object.entries(errs).forEach(([k, m]) => $('#' + k) && setErr(k, m));
    else { $('#form-error').textContent = err.message; $('#form-error').classList.remove('hidden'); }
    toast(errs ? 'Please fix the highlighted fields.' : err.message, 'bad');
  } finally { btn.disabled = false; btn.textContent = 'Register & Generate Pass'; }
});
