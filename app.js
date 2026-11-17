import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY, VAPID_PUBLIC_KEY } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

const $ = (s) => document.querySelector(s);
const app = $('#app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (iso) => new Date(iso).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('de-DE') : '');
const ageOf = (d) => {
  if (!d) return '';
  const b = new Date(d), n = new Date();
  let a = n.getFullYear() - b.getFullYear();
  if (n < new Date(n.getFullYear(), b.getMonth(), b.getDate())) a--;
  return a;
};
const ok = (r) => { if (r.error) throw r.error; return r.data; };

const DAY = { tue: 'Dienstag', fri: 'Freitag' };
const inGroup = (k, g) => (g === 'tue' ? k.tue : k.fri);
const STATUS = { waiting: 'Wartet', invited: 'Eingeladen', accepted: 'Zugesagt', declined: 'Abgesagt', no_reply: 'Keine Rückmeldung' };

const PERMS = {
  sessions_manage: 'Trainings anlegen/ändern/absagen',
  registrations_view: 'Sehen, wer kommt (inkl. Warteliste & Telefon)',
  registrations_manage: 'Kinder ein-/austragen',
  attendance_manage: 'Anwesenheit abhaken',
  kids_view: 'Angemeldete Kinder ansehen (nur lesen)',
  kids_manage: 'Kinder verwalten + Einladungslink',
  waitlist_view: 'Interessenten-Warteliste sehen',
  waitlist_manage: 'Interessenten-Warteliste bearbeiten',
  messages_send: 'Nachrichten senden',
  users_manage: 'Nutzer & Rollen verwalten',
};
const can = (p) => !!S.perms[p];

const S = {
  view: 'boot', tab: 'termine', user: null, perms: {}, roleName: '', users: [], roles: [],
  code: null, overview: [], overviewError: '',
  login: { step: 'email', email: '', kid: null },
  myKids: [], allKids: [], guardCount: {},
  sessions: [], counts: {}, regs: [], messages: [],
  open: null, detail: {}, dayFilter: 'all',
  waitlist: [], wlFilter: 'waiting', wlQuery: '', importPreview: null,
  inviteCode: '',
};

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2800);
}
async function run(fn) { try { await fn(); } catch (e) { console.error(e); toast(e.message || 'Fehler'); } }

/* ---------- App installieren (Hinweis ganz oben) ---------- */
let deferredPrompt = null;
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /android/i.test(navigator.userAgent);
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; renderInstall(); });
window.addEventListener('appinstalled', () => { deferredPrompt = null; renderInstall(); });
function renderInstall() {
  const el = $('#install');
  if (standalone() || Date.now() < (+localStorage.getItem('tc_install_dismiss') || 0) || !(deferredPrompt || isIOS || isAndroid)) { el.innerHTML = ''; return; }
  let inner;
  if (deferredPrompt) {
    inner = '<p style="margin:6px 0">Mit einem Tipp aufs Handy holen, dann ist sie immer sofort da.</p><button class="btn" data-i="install">Jetzt als App installieren</button>';
  } else if (isIOS) {
    inner = `<ol><li>Öffne diesen Link in <b>Safari</b> (falls du ihn aus WhatsApp geöffnet hast: unten rechts auf das Kompass-Symbol tippen)</li>
      <li>Tippe unten auf das <b>Teilen-Symbol</b> <span class="ico">⬆</span> (Quadrat mit Pfeil)</li>
      <li>Wähle <b>„Zum Home-Bildschirm“</b> und dann <b>„Hinzufügen“</b></li></ol>`;
  } else {
    inner = `<ol><li>Tippe oben rechts auf die <b>drei Punkte ⋮</b></li><li>Wähle <b>„App installieren“</b> oder <b>„Zum Startbildschirm hinzufügen“</b></li></ol>`;
  }
  el.innerHTML = `<div class="inst"><b>📲 Als App aufs Handy holen</b>${inner}<button class="link" data-i="later">Später</button></div>`;
}
$('#install').addEventListener('click', async (e) => {
  const a = e.target.closest('[data-i]')?.dataset.i;
  if (a === 'install' && deferredPrompt) { deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; renderInstall(); }
  if (a === 'later') { localStorage.setItem('tc_install_dismiss', Date.now() + 7 * 864e5); renderInstall(); }
});

/* ---------- Start ---------- */
async function init() {
  const p = new URLSearchParams(location.search);
  if (p.get('c')) { localStorage.setItem('tc_code', p.get('c')); history.replaceState(null, '', location.pathname); }
  S.code = localStorage.getItem('tc_code');
  const { data: { session } } = await sb.auth.getSession();
  if (session) { S.user = session.user; await afterLogin(); }
  else if (S.code) { await loadOverview(); S.view = 'pick'; }
  else S.view = 'login';
  render(); renderInstall();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
}

async function loadOverview() {
  const { data, error } = await sb.rpc('kids_overview', { p_code: S.code });
  S.overview = data || [];
  S.overviewError = error ? error.message : (S.overview.length ? '' : 'Der Link ist ungültig oder abgelaufen, oder es sind noch keine Kinder angelegt.');
}

async function afterLogin() {
  const pend = localStorage.getItem('tc_pending');
  if (pend && S.code) {
    const { error } = await sb.rpc('claim_kid', { p_kid: pend, p_code: S.code });
    if (!error) localStorage.removeItem('tc_pending'); else toast(error.message);
  }
  const prof = await sb.from('profiles').select('roles(name, perms)').eq('id', S.user.id).maybeSingle();
  S.perms = prof.data?.roles?.perms || {};
  S.roleName = prof.data?.roles?.name || '';
  await loadAll();
  S.view = 'main';
  if (!can('registrations_view') && !S.myKids.length) S.tab = 'profil';
}

async function loadAll() {
  const since = new Date(Date.now() - 3 * 3600e3).toISOString();
  const [ses, cnt, regs, msgs, gd] = await Promise.all([
    sb.from('sessions').select('*').gte('starts_at', since).order('starts_at'),
    sb.rpc('session_counts'), sb.rpc('my_registrations'),
    sb.from('messages').select('*').order('created_at', { ascending: false }).limit(30),
    sb.from('guardians').select('user_id, kid_id, kids(id,name,phone,tue,fri)'),
  ]);
  S.sessions = ok(ses);
  S.counts = Object.fromEntries(ok(cnt).map((c) => [c.session_id, c]));
  S.regs = ok(regs);
  S.messages = ok(msgs);
  const g = ok(gd);
  S.myKids = g.filter((x) => x.user_id === S.user.id && x.kids).map((x) => x.kids);
  S.guardCount = {};
  g.forEach((x) => { S.guardCount[x.kid_id] = (S.guardCount[x.kid_id] || 0) + 1; });
  const none = Promise.resolve({ data: [] });
  const [k, w, c, u, r] = await Promise.all([
    can('kids_manage') || can('registrations_view') ? sb.from('kids').select('*').order('name') : can('kids_view') ? sb.rpc('kids_list') : none,
    can('waitlist_view') ? sb.from('waitlist').select('*').order('created_at') : none,
    can('kids_manage') ? sb.from('settings').select('value').eq('key', 'invite_code').maybeSingle() : Promise.resolve({ data: null }),
    can('users_manage') ? sb.from('profiles').select('id, email, role_id').order('email') : none,
    sb.from('roles').select('*').order('name'),
  ]);
  S.allKids = ok(k); S.waitlist = ok(w); S.inviteCode = c.data?.value || '';
  S.users = ok(u); S.roles = ok(r);
}

async function refreshSessions() {
  await loadAll();
  if (S.open && can('registrations_view')) await loadDetail(S.open);
  render();
}

async function loadDetail(id) {
  S.detail[id] = ok(await sb.from('registrations').select('*, kids(name,phone)').eq('session_id', id).order('status'));
}

/* ---------- Views ---------- */
function render() {
  app.innerHTML = S.view === 'boot' ? '<p class="center muted">Lädt…</p>'
    : S.view === 'pick' ? viewPick()
    : S.view === 'login' ? viewLogin()
    : viewMain();
}

function viewPick() {
  const kids = S.overview.map((k) => `<button class="kidbtn" data-a="pickKid" data-id="${esc(k.id)}" data-name="${esc(k.name)}">${esc(k.name)}</button>`).join('');
  return `<div class="card"><h1>🤸 Trampolin Training</h1>
    <h2>Wer ist dein Kind?</h2>
    ${S.overviewError ? `<p class="err">${esc(S.overviewError)}</p>` : `<div class="kidlist">${kids}</div>`}
    <p class="muted small">Du kannst später weitere Kinder hinzufügen.</p>
    <button class="link" data-a="toLogin">Ich habe schon ein Konto</button></div>`;
}

function viewLogin() {
  const L = S.login;
  const who = L.kid ? `<p>Du meldest dich für <b>${esc(L.kid.name)}</b> an.</p>` : '';
  const form = L.step === 'email'
    ? `<form data-f="email"><label>E-Mail-Adresse<input name="email" type="email" required autocomplete="email" value="${esc(L.email)}"></label>
       <button class="btn big">Code per Mail senden</button></form>`
    : `<form data-f="code"><p>Wir haben einen Code an <b>${esc(L.email)}</b> gesendet.</p>
       <label>Code aus der Mail<input name="token" inputmode="numeric" autocomplete="one-time-code" maxlength="10" required></label>
       <button class="btn big">Anmelden</button>
       <button type="button" class="link" data-a="toEmail">Andere Mailadresse</button></form>`;
  return `<div class="card"><h1>🤸 Trampolin Training</h1>${who}${form}
    ${S.code && L.step === 'email' && !L.kid ? '<button class="link" data-a="backPick">Zurück zur Kinder-Auswahl</button>' : ''}
    <p class="muted small">Du bleibst danach auf diesem Gerät angemeldet.</p></div>`;
}

function viewMain() {
  const tabs = [
    ['termine', '📅', 'Termine', true],
    ['neu', '➕', 'Neu', can('sessions_manage')],
    ['interessenten', '⏳', 'Warteliste', can('waitlist_view')],
    ['kinder', '🤸', 'Kinder', can('kids_manage') || can('kids_view')],
    ['nutzer', '🔑', 'Nutzer', can('users_manage')],
    ['news', '💬', 'News', true],
    ['profil', '👤', 'Profil', true],
  ].filter((t) => t[3]);
  if (!tabs.some((t) => t[0] === S.tab)) S.tab = 'termine';
  const body = { termine: can('registrations_view') ? viewTermineTrainer : viewTermineParent, neu: viewNew, interessenten: viewWaitlist, kinder: viewKids, nutzer: viewUsers, news: viewNews, profil: viewProfile }[S.tab]();
  return `<main>${body}</main><nav>${tabs.map(([k, i, l]) => `<button class="${S.tab === k ? 'on' : ''}" data-a="tab" data-t="${k}"><span>${i}</span>${l}</button>`).join('')}</nav>`;
}

function sessionHead(s) {
  const c = S.counts[s.id] || { going: 0 };
  return `<div class="shead"><div><b>${esc(s.title)}</b> <span class="badge gray">${DAY[s.grp]}</span>${s.cancelled ? ' <span class="badge red">Abgesagt</span>' : ''}<br>
    <span class="muted">${fmt(s.starts_at)}${s.location ? ' · ' + esc(s.location) : ''}</span>${s.note ? `<br><span class="small">${esc(s.note)}</span>` : ''}</div>
    <div class="cnt"><b>${c.going}</b><br><span class="small muted">zugesagt</span></div></div>`;
}

function viewTermineParent() {
  const mine = S.sessions.filter((s) => S.myKids.some((k) => inGroup(k, s.grp)));
  if (S.myKids.length && S.myKids.every((k) => !k.tue && !k.fri)) return '<p class="muted center">Die Trainingstage deines Kindes (Dienstag/Freitag) sind noch nicht eingetragen. Bitte kurz bei den Trainern melden.</p>';
  if (!mine.length) return '<p class="muted center">Noch keine Termine.</p>';
  return mine.map((s) => {
    const rows = S.myKids.filter((k) => inGroup(k, s.grp)).map((k) => {
      const r = S.regs.find((x) => x.session_id === s.id && x.kid_id === k.id);
      const st = r?.status;
      const badge = st === 'going' ? '<span class="badge green">Dabei</span>'
        : st === 'declined' ? '<span class="badge red">Abgesagt</span>' : '<span class="badge gray">Keine Antwort</span>';
      const btns = s.cancelled ? '' : `<div class="btns">
        <button class="btn ${st === 'going' ? 'on' : ''}" data-a="answer" data-s="${s.id}" data-k="${k.id}" data-v="yes">Zusagen</button>
        <button class="btn ghost ${st === 'declined' ? 'on' : ''}" data-a="answer" data-s="${s.id}" data-k="${k.id}" data-v="no">Absagen</button></div>`;
      return `<div class="kidrow"><div><b>${esc(k.name)}</b> ${badge}</div>${btns}</div>`;
    }).join('') || '<p class="muted small">Noch kein Kind verknüpft (Profil → Kind hinzufügen).</p>';
    return `<div class="card">${sessionHead(s)}${rows}</div>`;
  }).join('');
}

function viewTermineTrainer() {
  const chips = [['all', 'Alle'], ['tue', 'Dienstag'], ['fri', 'Freitag']].map(([k, l]) => `<button class="chip ${S.dayFilter === k ? 'on' : ''}" data-a="dayFilter" data-v="${k}">${l}</button>`).join('');
  const list = S.sessions.filter((s) => S.dayFilter === 'all' || s.grp === S.dayFilter);
  if (!list.length) return `<div class="chips">${chips}</div><p class="muted center">Keine Termine.${can('sessions_manage') ? ' Lege unter „Neu“ welche an.' : ''}</p>`;
  return `<div class="chips">${chips}</div>` + list.map((s) => {
    const open = S.open === s.id;
    return `<div class="card"><div data-a="toggle" data-s="${s.id}" class="click">${sessionHead(s)}</div>${open ? detailTrainer(s) : ''}</div>`;
  }).join('');
}

function detailTrainer(s) {
  const regs = S.detail[s.id];
  if (!regs) return '<p class="muted">Lädt…</p>';
  const by = (st) => regs.filter((r) => r.status === st);
  const answered = new Set(regs.map((r) => r.kid_id));
  const none = S.allKids.filter((k) => k.active && inGroup(k, s.grp) && !answered.has(k.id));
  const rm = (r) => (can('registrations_manage') ? `<button class="x" data-a="answer" data-s="${s.id}" data-k="${r.kid_id}" data-v="none" title="Entfernen">✕</button>` : '');
  const going = by('going').map((r) => `<label class="line"><input type="checkbox" data-a="attend" data-r="${r.id}" ${r.attended ? 'checked' : ''} ${can('attendance_manage') ? '' : 'disabled'}> ${esc(r.kids?.name)}
    ${r.kids?.phone ? `<a href="tel:${esc(r.kids.phone)}">📞</a>` : ''}${rm(r)}</label>`).join('') || '<p class="muted small">Niemand</p>';
  const dec = by('declined').map((r) => `<span class="chip">${esc(r.kids?.name)}</span>`).join('') || '<span class="muted small">–</span>';
  const nores = none.map((k) => (can('registrations_manage')
    ? `<span class="chip" data-a="answer" data-s="${s.id}" data-k="${k.id}" data-v="yes" title="Eintragen">${esc(k.name)} ＋</span>`
    : `<span class="chip">${esc(k.name)}</span>`)).join('') || '<span class="muted small">–</span>';
  const manage = can('sessions_manage') ? `
    <div class="btns"><button class="btn ghost small" data-a="cancelSession" data-s="${s.id}" data-v="${!s.cancelled}">${s.cancelled ? 'Wieder aktivieren' : 'Training absagen'}</button>
    <button class="btn ghost small danger" data-a="deleteSession" data-s="${s.id}">Löschen</button></div>` : '';
  return `<div class="detail">
    <h3>Dabei (${by('going').length})${can('attendance_manage') ? ' – Anwesenheit abhaken' : ''}</h3>${going}
    <h3>Abgesagt</h3><div>${dec}</div>
    <h3>Keine Antwort${can('registrations_manage') ? ' (antippen = eintragen)' : ''}</h3><div>${nores}</div>${manage}</div>`;
}

function viewNew() {
  return `<div class="card"><h2>Neues Training</h2><form data-f="newSession">
    <label>Titel<input name="title" value="Trampolin Training" required></label>
    <label>Gruppe<select name="grp"><option value="tue">Dienstag</option><option value="fri">Freitag</option></select></label>
    <label>Beginn<input name="starts" type="datetime-local" required></label>
    <label>Ort<input name="location"></label>
    <label>Hinweis<input name="note"></label>
    <label>Wöchentlich wiederholen (Anzahl Termine insgesamt)<input name="repeat" type="number" min="1" max="52" value="1"></label>
    <button class="btn big">Anlegen</button></form></div>`;
}

function wlFiltered() {
  const q = S.wlQuery.trim().toLowerCase();
  return S.waitlist.filter((w) => w.status === S.wlFilter &&
    (!q || `${w.first_name} ${w.last_name} ${w.email} ${w.phone}`.toLowerCase().includes(q)));
}
function wlList() {
  const list = wlFiltered();
  if (!list.length) return '<p class="muted center">Keine Einträge.</p>';
  return list.map((w, i) => `<div class="card wl">
    <div class="shead"><div><b>${i + 1}. ${esc(w.first_name)} ${esc(w.last_name)}</b>
      ${w.birthdate ? `<span class="muted"> · ${ageOf(w.birthdate)} J.</span>` : ''}<br>
      <span class="small muted">angefragt: ${esc(w.requested || '–')}${w.requested_again ? ' · erneut: ' + esc(w.requested_again) : ''}${w.contacted_at ? ' · angeschrieben: ' + fmtDate(w.contacted_at) : ''}</span></div>
      <div>${w.tue ? '<span class="badge gray">Di</span>' : ''}${w.fri ? '<span class="badge gray">Fr</span>' : ''}${w.trial ? '<span class="badge green">Schnuppern</span>' : ''}</div></div>
    <div class="small">${w.email ? `<a href="mailto:${esc(w.email)}">✉️ ${esc(w.email)}</a><br>` : ''}${w.phone ? `<a href="tel:${esc(w.phone)}">📞 ${esc(w.phone)}</a>` : ''}</div>
    ${w.note ? `<p class="note">${esc(w.note)}</p>` : ''}
    ${can('waitlist_manage') ? `<div class="btns"><select data-a="wlStatus" data-id="${w.id}">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${w.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <button class="btn small ghost" data-a="wlNote" data-id="${w.id}">Notiz</button>
      ${can('kids_manage') ? `<button class="btn small" data-a="wlAccept" data-id="${w.id}">→ Teilnehmer</button>` : ''}</div>` : ''}</div>`).join('');
}
function viewWaitlist() {
  const counts = Object.fromEntries(Object.keys(STATUS).map((k) => [k, S.waitlist.filter((w) => w.status === k).length]));
  const chips = Object.entries(STATUS).map(([k, v]) => `<button class="chip ${S.wlFilter === k ? 'on' : ''}" data-a="wlFilter" data-v="${k}">${v} (${counts[k]})</button>`).join('');
  const prev = S.importPreview ? `<div class="card"><b>${S.importPreview.length} Einträge gefunden.</b>
    <p class="small muted">Wird nur in deine Datenbank geschrieben. Bitte nur einmal importieren, sonst entstehen Doppelte.</p>
    <div class="btns"><button class="btn" data-a="importGo">Jetzt importieren</button><button class="btn ghost" data-a="importCancel">Abbrechen</button></div></div>` : '';
  return `<h2>Interessenten-Warteliste</h2><div class="chips">${chips}</div>
    <input id="wlq" class="search" placeholder="Suchen (Name, Mail, Telefon)" value="${esc(S.wlQuery)}">
    ${prev}<div id="wl-list">${wlList()}</div>
    ${!can('waitlist_manage') ? '' : `<details class="card"><summary>Neuer Interessent</summary><form data-f="newWl">
      <label>Vorname<input name="first_name" required></label><label>Nachname<input name="last_name"></label>
      <label>Geburtsdatum<input name="birthdate" type="date"></label><label>E-Mail<input name="email" type="email"></label>
      <label>Telefon<input name="phone" type="tel"></label><label>Angefragt am<input name="requested" placeholder="z. B. Mai'25"></label>
      <label>Notiz<input name="note"></label><button class="btn">Hinzufügen</button></form></details>
    <details class="card"><summary>Aus Excel importieren</summary>
      <p class="small muted">Deine Datei „Warteliste.xlsx“ mit den Blättern Warteliste, Zusagen, Absagen, keine Rückmeldung. Die Datei wird nur im Browser gelesen.</p>
      <input type="file" accept=".xlsx" id="xl"></details>`}`;
}

function viewUsers() {
  const roleOpts = (cur) => S.roles.map((r) => `<option value="${r.id}" ${r.id === cur ? 'selected' : ''}>${esc(r.name)}</option>`).join('');
  const users = S.users.map((u) => `<div class="kidrow"><div><b class="break">${esc(u.email)}</b>${u.id === S.user.id ? ' <span class="badge gray">du</span>' : ''}</div>
    <select data-a="setRole" data-u="${u.id}" ${u.id === S.user.id ? 'disabled' : ''}>${roleOpts(u.role_id)}</select></div>`).join('') || '<p class="muted">Noch niemand.</p>';
  const roles = S.roles.map((r) => `<details class="card"><summary><b>${esc(r.name)}</b>${r.is_system ? ' <span class="badge gray">fest</span>' : ''}</summary>
    ${Object.entries(PERMS).map(([k, l]) => `<label class="line"><input type="checkbox" data-a="togglePerm" data-id="${r.id}" data-p="${k}" ${r.perms?.[k] ? 'checked' : ''} ${r.is_system ? 'disabled' : ''}> ${esc(l)}</label>`).join('')}
    ${r.is_system ? '' : `<button class="link" data-a="delRole" data-id="${r.id}">Rolle löschen</button>`}</details>`).join('');
  return `<h2>Nutzer & Rollen</h2><div class="card">${users}</div>
    <h2>Rollen und ihre Rechte</h2>${roles}
    <div class="card"><form data-f="newRole"><label>Neue Rolle<input name="name" placeholder="z. B. Übungsleiter" required></label><button class="btn">Rolle anlegen</button></form>
    <p class="small muted">Die festen Rollen (Admin, Trainer, Eltern) lassen sich nicht ändern. Neue Rollen starten ohne Rechte.</p></div>`;
}

function viewKids() {
  const mg = can('kids_manage');
  const act = S.allKids.filter((k) => k.active);
  const tue = act.filter((k) => k.tue).length, fri = act.filter((k) => k.fri).length, both = act.filter((k) => k.tue && k.fri).length;
  const days = (k) => `${k.tue ? '<span class="badge green">Di</span>' : ''}${k.fri ? '<span class="badge green">Fr</span>' : ''}${!k.tue && !k.fri ? '<span class="badge orange">Tag fehlt</span>' : ''}`;
  const rows = S.allKids.map((k) => `<div class="kidrow"><div><b>${esc(k.name)}</b> ${days(k)} ${k.active ? '' : '<span class="badge gray">inaktiv</span>'}${mg ? `<br>
    <span class="small muted">👤 ${S.guardCount[k.id] || 0} verknüpft${k.phone ? ' · ' : ''}${k.phone ? `<a href="tel:${esc(k.phone)}">📞 ${esc(k.phone)}</a>` : ''}</span>` : ''}</div>
    ${mg ? `<div class="btns"><button class="chip ${k.tue ? 'on' : ''}" data-a="kidDay" data-id="${k.id}" data-d="tue">Di</button><button class="chip ${k.fri ? 'on' : ''}" data-a="kidDay" data-id="${k.id}" data-d="fri">Fr</button>
    <button class="btn small ghost" data-a="kidPhone" data-id="${k.id}">Telefon</button>
    <button class="btn small ghost" data-a="kidActive" data-id="${k.id}" data-v="${!k.active}">${k.active ? 'Deaktivieren' : 'Aktivieren'}</button></div>` : ''}</div>`).join('');
  const link = mg ? `<div class="card"><h2>Einladungslink für Eltern</h2><p class="small break">${esc(`${location.origin}${location.pathname}?c=${S.inviteCode}`)}</p>
    <div class="btns"><button class="btn" data-a="copyLink">Link kopieren</button><button class="btn ghost" data-a="rotate">Neuen Code erzeugen</button></div>
    <p class="small muted">Wer den Link hat, sieht die Vornamen der Kinder. Nur in der Gruppe teilen.</p></div>` : '';
  const form = mg ? `<form data-f="newKid"><label>Name (z. B. „Mia K.“)<input name="name" required></label><label>Telefon (Notfall)<input name="phone" type="tel"></label>
    <label class="line"><input type="checkbox" name="tue"> Dienstag</label><label class="line"><input type="checkbox" name="fri"> Freitag</label><button class="btn">Kind anlegen</button></form>` : '';
  return `${link}<div class="card"><h2>Angemeldete Kinder: ${act.length}</h2>
    <p class="small muted">Dienstag ${tue} · Freitag ${fri} · beide Tage ${both}</p>${rows || '<p class="muted">Noch keine.</p>'}${form}</div>`;
}

function viewNews() {
  const form = can('messages_send') ? `<div class="card"><form data-f="newMsg"><label>Titel<input name="title" required></label>
    <label>Text<textarea name="body" rows="3"></textarea></label><button class="btn">Senden</button></form></div>` : '';
  const list = S.messages.map((m) => `<div class="card"><b>${esc(m.title)}</b><br><span class="small muted">${fmt(m.created_at)}</span>
    <p>${esc(m.body).replace(/\n/g, '<br>')}</p>${can('messages_send') ? `<button class="link" data-a="delMsg" data-id="${m.id}">Löschen</button>` : ''}</div>`).join('') || '<p class="muted center">Keine Nachrichten.</p>';
  return form + list;
}

function viewProfile() {
  const kids = S.myKids.map((k) => `<div class="kidrow"><b>${esc(k.name)}</b><button class="link" data-a="unlink" data-k="${k.id}">Entfernen</button></div>`).join('') || '<p class="muted">Noch kein Kind verknüpft.</p>';
  return `<div class="card"><h2>Meine Kinder</h2>${kids}
    <button class="btn" data-a="addKid">Kind hinzufügen</button></div>
    <div class="card"><h2>Benachrichtigungen</h2><button class="btn" data-a="push">Auf diesem Gerät aktivieren</button>
    <p class="small muted">iPhone: App zuerst über „Teilen → Zum Home-Bildschirm“ installieren.</p></div>
    <div class="card"><p class="small muted">Angemeldet als ${esc(S.user.email)} · Rolle: ${esc(S.roleName)}</p><button class="btn ghost" data-a="logout">Abmelden</button></div>`;
}

/* ---------- Aktionen ---------- */
const A = {
  pickKid(d) { S.login = { step: 'email', email: '', kid: { id: d.id, name: d.name } }; S.view = 'login'; render(); },
  toLogin() { S.login = { step: 'email', email: '', kid: null }; S.view = 'login'; render(); },
  toEmail() { S.login.step = 'email'; render(); },
  backPick() { S.view = 'pick'; render(); },
  tab(d) { S.tab = d.t; render(); },
  async answer(d) {
    const r = ok(await sb.rpc('set_response', { p_session: d.s, p_kid: d.k, p_answer: d.v }));
    toast(r === 'going' ? 'Zugesagt ✔' : r === 'declined' ? 'Abgesagt' : 'Aktualisiert');
    await refreshSessions();
  },
  async toggle(d) { S.open = S.open === d.s ? null : d.s; if (S.open) await loadDetail(S.open); render(); },
  async attend(d, el) { ok(await sb.from('registrations').update({ attended: el.checked }).eq('id', d.r)); },
  async cancelSession(d) { ok(await sb.from('sessions').update({ cancelled: d.v === 'true' }).eq('id', d.s)); await refreshSessions(); },
  async deleteSession(d) { if (!confirm('Termin samt Anmeldungen löschen?')) return; ok(await sb.from('sessions').delete().eq('id', d.s)); S.open = null; await refreshSessions(); },
  async kidDay(d) {
    const k = S.allKids.find((x) => x.id === d.id);
    ok(await sb.from('kids').update({ [d.d]: !k[d.d] }).eq('id', d.id)); await loadAll(); render();
  },
  dayFilter(d) { S.dayFilter = d.v; render(); },
  async kidActive(d) { ok(await sb.from('kids').update({ active: d.v === 'true' }).eq('id', d.id)); await loadAll(); render(); },
  async kidPhone(d) {
    const k = S.allKids.find((x) => x.id === d.id);
    const v = prompt('Telefonnummer', k?.phone || ''); if (v === null) return;
    ok(await sb.from('kids').update({ phone: v.trim() || null }).eq('id', d.id)); await loadAll(); render();
  },
  async copyLink() { await navigator.clipboard.writeText(`${location.origin}${location.pathname}?c=${S.inviteCode}`); toast('Link kopiert'); },
  async rotate() {
    if (!confirm('Alter Link wird ungültig. Fortfahren?')) return;
    S.inviteCode = ok(await sb.rpc('rotate_invite_code')); render(); toast('Neuer Code erzeugt');
  },
  async delMsg(d) { ok(await sb.from('messages').delete().eq('id', d.id)); await loadAll(); render(); },
  async unlink(d) { if (!confirm('Kind von deinem Konto entfernen?')) return; ok(await sb.from('guardians').delete().eq('user_id', S.user.id).eq('kid_id', d.k)); await loadAll(); render(); },
  async addKid() {
    if (!S.code) return toast('Bitte den Einladungslink aus der Gruppe erneut öffnen.');
    await loadOverview();
    const mine = new Set(S.myKids.map((k) => k.id));
    S.overview = S.overview.filter((k) => !mine.has(k.id));
    S.view = 'pick'; render();
  },
  async logout() { await sb.auth.signOut(); location.reload(); },
  async push() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return toast('Dieses Gerät unterstützt keine Push-Nachrichten.');
    if (!VAPID_PUBLIC_KEY) return toast('Push ist noch nicht eingerichtet.');
    if ((await Notification.requestPermission()) !== 'granted') return toast('Nicht erlaubt');
    const reg = await navigator.serviceWorker.ready;
    const key = Uint8Array.from(atob(VAPID_PUBLIC_KEY.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    const j = sub.toJSON();
    ok(await sb.from('push_subscriptions').upsert({ user_id: S.user.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }, { onConflict: 'endpoint' }));
    toast('Benachrichtigungen aktiv ✔');
  },
  async setRole(d, el) { ok(await sb.rpc('set_user_role', { p_user: d.u, p_role: el.value })); await loadAll(); render(); toast('Rolle geändert'); },
  async togglePerm(d, el) {
    const r = S.roles.find((x) => x.id === d.id);
    ok(await sb.from('roles').update({ perms: { ...r.perms, [d.p]: el.checked } }).eq('id', d.id));
    await loadAll(); render();
  },
  async delRole(d) {
    if (!confirm('Rolle löschen? (Nur möglich, wenn niemand sie hat.)')) return;
    ok(await sb.from('roles').delete().eq('id', d.id)); await loadAll(); render();
  },
  wlFilter(d) { S.wlFilter = d.v; render(); },
  async wlStatus(d, el) { ok(await sb.from('waitlist').update({ status: el.value }).eq('id', d.id)); await loadAll(); render(); },
  async wlNote(d) {
    const w = S.waitlist.find((x) => x.id === d.id);
    const v = prompt('Notiz', w?.note || ''); if (v === null) return;
    ok(await sb.from('waitlist').update({ note: v.trim() || null }).eq('id', d.id)); await loadAll(); render();
  },
  async wlAccept(d) {
    const w = S.waitlist.find((x) => x.id === d.id);
    const name = `${w.first_name}${w.last_name ? ' ' + w.last_name.trim()[0] + '.' : ''}`;
    if (!confirm(`„${name}“ als Teilnehmer anlegen?`)) return;
    ok(await sb.from('kids').insert({ name, phone: w.phone, tue: !!w.tue, fri: !!w.fri }));
    ok(await sb.from('waitlist').update({ status: 'accepted' }).eq('id', d.id));
    await loadAll(); render(); toast('Als Teilnehmer angelegt');
  },
  importCancel() { S.importPreview = null; render(); },
  async importGo() {
    const rows = S.importPreview;
    for (let i = 0; i < rows.length; i += 100) ok(await sb.from('waitlist').insert(rows.slice(i, i + 100)));
    S.importPreview = null; await loadAll(); render(); toast(`${rows.length} Einträge importiert`);
  },
};

const F = {
  async email(f) {
    const email = f.email.trim();
    if (S.login.kid) localStorage.setItem('tc_pending', S.login.kid.id);
    ok(await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } }));
    S.login.email = email; S.login.step = 'code'; render();
  },
  async code(f) {
    const { data, error } = await sb.auth.verifyOtp({ email: S.login.email, token: f.token.trim(), type: 'email' });
    if (error) throw error;
    S.user = data.user; await afterLogin(); render();
  },
  async newSession(f) {
    const n = Math.max(1, +f.repeat || 1), start = new Date(f.starts);
    const rows = Array.from({ length: n }, (_, i) => ({
      title: f.title, grp: f.grp, location: f.location || null, note: f.note || null,
      starts_at: new Date(start.getTime() + i * 7 * 864e5).toISOString(),
    }));
    // Zeitumstellung: Uhrzeit pro Woche lokal beibehalten
    rows.forEach((r, i) => { const d = new Date(start); d.setDate(d.getDate() + 7 * i); r.starts_at = d.toISOString(); });
    ok(await sb.from('sessions').insert(rows));
    S.tab = 'termine'; await refreshSessions(); toast(`${n} Termin(e) angelegt`);
  },
  async newRole(f) { ok(await sb.from('roles').insert({ name: f.name.trim(), perms: {} })); await loadAll(); render(); toast('Rolle angelegt – Rechte darunter setzen'); },
  async newKid(f) { ok(await sb.from('kids').insert({ name: f.name.trim(), phone: f.phone || null, tue: f.tue === 'on', fri: f.fri === 'on' })); await loadAll(); render(); },
  async newMsg(f) {
    ok(await sb.from('messages').insert({ title: f.title, body: f.body, author: S.user.id }));
    sb.functions.invoke('send-push', { body: { title: f.title, body: f.body } }).catch(() => {});
    await loadAll(); render(); toast('Gesendet');
  },
  async newWl(f) {
    const row = { first_name: f.first_name.trim(), last_name: f.last_name?.trim() || null, birthdate: f.birthdate || null,
      email: f.email || null, phone: f.phone || null, requested: f.requested || null, note: f.note || null };
    ok(await sb.from('waitlist').insert(row)); await loadAll(); render(); toast('Hinzugefügt');
  },
};

app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-a]');
  if (!el || el.tagName === 'SELECT' || el.type === 'checkbox') return;
  const fn = A[el.dataset.a]; if (fn) run(() => fn(el.dataset, el));
});
app.addEventListener('change', (e) => {
  const el = e.target;
  if (el.id === 'xl' && el.files[0]) return run(() => readExcel(el.files[0]));
  if (el.dataset?.a && (el.tagName === 'SELECT' || el.type === 'checkbox')) run(() => A[el.dataset.a](el.dataset, el));
});
app.addEventListener('input', (e) => {
  if (e.target.id === 'wlq') { S.wlQuery = e.target.value; $('#wl-list').innerHTML = wlList(); }
});
app.addEventListener('submit', (e) => {
  e.preventDefault();
  const fn = F[e.target.dataset.f];
  if (fn) run(() => fn(Object.fromEntries(new FormData(e.target)), e.target));
});

/* ---------- Excel-Import (läuft nur im Browser) ---------- */
async function readExcel(file) {
  const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs');
  const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
  const clean = (v) => (typeof v === 'string' ? v.replace(/ /g, ' ').trim() : v);
  const str = (v) => { v = clean(v); return v === null || v === undefined || v === '' ? null : String(v); };
  const date = (v) => (v instanceof Date && !isNaN(v) ? new Date(v.getTime() + 12 * 3600e3).toISOString().slice(0, 10) : null); // +12h gegen Zeitzonen-Versatz
  const isPhone = (v) => /^[\d\s/+()-]{7,}$/.test(String(v)) && !/^\d{1,2}\.\d{1,2}\.\d{2,4}$/.test(String(v));
  const out = [];
  const sheets = [['Warteliste', 'waiting'], ['Zusagen', 'accepted'], ['Absagen', 'declined'], ['keine Rückmeldung', 'no_reply']];
  for (const [name, status] of sheets) {
    const ws = wb.Sheets[name]; if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    for (const r of rows) {
      const last = str(r[1]), first = str(r[2]);
      if (!last && !first) continue;
      if (/^(nachname|name)$/i.test(last || '') || /^name des kindes$/i.test(first || '')) continue;
      const row = { last_name: last, first_name: first || '–', birthdate: date(r[3]), status };
      if (name === 'Warteliste') {
        Object.assign(row, { email: str(r[5]), phone: str(r[6]), requested: str(r[7]), requested_again: str(r[8]),
          contacted_at: date(r[9]), tue: r[10] === true, fri: r[11] === true, trial: r[12] === true, trial_on: date(r[13]), note: str(r[14]) });
      } else {
        const cells = r.slice(3).map(clean).filter((v) => v !== null && v !== '');
        row.email = str(cells.find((v) => typeof v === 'string' && v.includes('@')));
        row.phone = str(cells.find((v) => (typeof v === 'string' || typeof v === 'number') && !(typeof v === 'string' && v.includes('@')) && isPhone(v)));
        const texts = cells.filter((v) => typeof v === 'string' && !v.includes('@') && !isPhone(v) && v.length > 6 && !/^=/.test(v) && !/^(Oct|Jan|Feb|Nov|Dec)'/i.test(v));
        row.note = texts.length ? texts.join(' · ') : null;
        row.requested = str(typeof r[7] === 'string' ? r[7] : null);
      }
      out.push(row);
    }
  }
  if (!out.length) throw new Error('Keine passenden Blätter gefunden.');
  S.importPreview = out; render();
}

init();
