import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY, VAPID_PUBLIC_KEY } from './config.js';
import { initMail } from './mail.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

const $ = (s) => document.querySelector(s);
const app = $('#app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (iso) => new Date(iso).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('de-DE') : '');
const dkey = (d) => new Date(d).toLocaleDateString('sv-SE'); // YYYY-MM-DD in lokaler Zeit
const tm = (iso) => new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
const mondayOf = (d) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const MON = { jan: 1, feb: 2, mär: 3, mar: 3, apr: 4, mai: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, nov: 11, dez: 12 };
const parseReq = (t) => {
  if (!t) return null; t = String(t).trim();
  let m = t.match(/^(\d{1,2})\/(\d{4})$/); if (m) return `${m[2]}-${m[1].padStart(2, '0')}-01`;
  m = t.match(/^([A-Za-zäöüÄÖÜ]+)'(\d{2})$/); if (m && MON[m[1].slice(0, 3).toLowerCase()]) return `20${m[2]}-${String(MON[m[1].slice(0, 3).toLowerCase()]).padStart(2, '0')}-01`;
  return null;
};
const ageOf = (d) => {
  if (!d) return '';
  const b = new Date(d), n = new Date();
  let a = n.getFullYear() - b.getFullYear();
  if (n < new Date(n.getFullYear(), b.getMonth(), b.getDate())) a--;
  return a;
};
const ok = (r) => { if (r.error) throw r.error; return r.data; };

// Weihnachtsferien Baden-Württemberg (Quelle: Kultusministerium BW); in diesem Zeitraum findet kein Training statt
const XMAS = [['2026-12-23', '2027-01-09'], ['2027-12-23', '2028-01-08'], ['2028-12-23', '2029-01-05'], ['2029-12-22', '2030-01-05']];
const inXmas = (ds) => XMAS.some(([a, b]) => ds >= a && ds <= b);
const IC = {
  cal: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  users: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3 20c0-3.6 2.7-6 6-6s6 2.4 6 6"/><path d="M16 5.5a3 3 0 010 6M17.5 14.3c2 .6 3.5 2.4 3.5 5.7"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.2 2"/>',
  chat: '<path d="M4 5.5h16v10H9.5L5 19.5v-4H4z"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  user: '<circle cx="12" cy="8.5" r="3.6"/><path d="M4.5 20c0-4 3.4-6.2 7.5-6.2s7.5 2.2 7.5 6.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  key: '<circle cx="8" cy="12" r="3.5"/><path d="M11.5 12H21M17 12v3M20 12v2.5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  phone: '<path d="M6.5 4h3l1.5 4-2 1.3a10 10 0 005.7 5.7L16 13l4 1.5v3a2 2 0 01-2 2A14 14 0 014.5 6a2 2 0 012-2z"/>',
  mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M4 7l8 6 8-6"/>',
  cake: '<path d="M4 20h16v-7H4zM4 15.5c2 1.5 4 1.5 6 0s4-1.5 6 0 2.5 1 4 0M12 13V9M12 6.5v.01"/>',
  share: '<path d="M12 15V4M8 8l4-4 4 4M6 11H5v9h14v-9h-1"/>',
  phoneapp: '<rect x="7" y="3" width="10" height="18" rx="2.2"/><path d="M11 18h2"/>',
};
const ic = (n, c = '') => `<svg class="ic ${c}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${IC[n]}</svg>`;
const DAY = { tue: 'Dienstag', fri: 'Freitag', all: 'Alle Gruppen' };
const inGroup = (k, g) => (g === 'all' ? k.tue || k.fri : g === 'tue' ? k.tue : k.fri);
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
  mailbox: 'Postfach (Mails lesen, beantworten, senden)',
  users_manage: 'Nutzer & Rollen verwalten',
};
const can = (p) => !!S.perms[p];

const S = {
  view: 'boot', tab: 'termine', user: null, perms: {}, roleName: '', users: [], roles: [],
  code: null, overview: [], overviewError: '', parentEmail: localStorage.getItem('tc_email') || '', guardEmails: {},
  login: { step: 'email', email: '', kid: null },
  myKids: [], allKids: [], guardCount: {},
  sessions: [], counts: {}, regs: [], messages: [],
  open: null, detail: {}, guests: {}, dayFilter: 'all',
  waitlist: [], wlFilter: 'waiting', wlQuery: '', importPreview: null,
  inviteCode: '', invites: [], invite: null, lastInvite: null,
  activity: {}, openKid: null, kidFilter: 'all', kidView: 'list',
  termView: 'list', showPast: false, calMode: 'month', calMonth: { y: new Date().getFullYear(), m: new Date().getMonth() }, calWeek: mondayOf(new Date()), calDay: dkey(new Date()),
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
if (standalone()) localStorage.setItem('tc_installed', '1');
if (navigator.getInstalledRelatedApps) navigator.getInstalledRelatedApps().then((a) => { if (a.length) { localStorage.setItem('tc_installed', '1'); renderInstall(); } }).catch(() => {});
function renderInstall() {
  const el = $('#install');
  if (standalone() || localStorage.getItem('tc_installed') || Date.now() < (+localStorage.getItem('tc_install_dismiss') || 0) || !(deferredPrompt || isIOS || isAndroid)) { el.innerHTML = ''; return; }
  let inner;
  if (deferredPrompt) {
    inner = '<p style="margin:6px 0">Mit einem Tipp aufs Handy holen, dann ist sie immer sofort da.</p><button class="btn" data-i="install">Jetzt als App installieren</button>';
  } else if (isIOS) {
    inner = `<ol><li>Öffne diesen Link in <b>Safari</b> (falls du ihn aus WhatsApp geöffnet hast: unten rechts auf das Kompass-Symbol tippen)</li>
      <li>Tippe unten auf das <b>Teilen-Symbol</b> <span class="ico">${ic('share')}</span> (Quadrat mit Pfeil)</li>
      <li>Wähle <b>„Zum Home-Bildschirm“</b> und dann <b>„Hinzufügen“</b></li></ol>`;
  } else {
    inner = `<ol><li>Tippe oben rechts auf die <b>drei Punkte ⋮</b></li><li>Wähle <b>„App installieren“</b> oder <b>„Zum Startbildschirm hinzufügen“</b></li></ol>`;
  }
  el.innerHTML = `<div class="inst"><b>Als App aufs Handy holen</b>${inner}<p class="small" style="margin:6px 0;color:#ccc">Schon installiert? Dann öffne die App über das Symbol auf deinem Startbildschirm, nicht über den Link.</p>
    <button class="link" data-i="have">Habe ich schon</button> <button class="link" data-i="later">Später</button></div>`;
}
$('#install').addEventListener('click', async (e) => {
  const a = e.target.closest('[data-i]')?.dataset.i;
  if (a === 'install' && deferredPrompt) { deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; renderInstall(); }
  if (a === 'have') { localStorage.setItem('tc_installed', '1'); renderInstall(); }
  if (a === 'later') { localStorage.setItem('tc_install_dismiss', Date.now() + 7 * 864e5); renderInstall(); }
});

/* ---------- Start ---------- */
async function init() {
  const p = new URLSearchParams(location.search);
  if (p.get('w')) { S.view = 'waitform'; render(); if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {}); return; }
  if (p.get('c')) localStorage.setItem('tc_code', p.get('c'));
  S.code = p.get('c') || localStorage.getItem('tc_code');
  if (p.get('go')) { try { S.pendingGo = JSON.parse(p.get('go')); } catch { /* egal */ } history.replaceState(null, '', location.pathname + (p.get('c') ? `?c=${p.get('c')}` : '')); }
  const { data: { session } } = await sb.auth.getSession();
  if (session) { S.user = session.user; await afterLogin(); }
  else if (S.code) { await loadOverview(); S.view = 'pick'; }
  else S.view = 'login';
  if (p.get('i')) { S.invite = p.get('i'); S.view = 'invite'; }
  render(); renderInstall();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
}

async function loadOverview() {
  const { data, error } = await sb.rpc('kids_overview', { p_code: S.code });
  S.overview = data || [];
  S.overviewError = error ? error.message : (S.overview.length ? '' : 'Der Link ist ungültig oder abgelaufen, oder es ist kein freies Kind mehr übrig. Bitte melde dich bei den Trainern.');
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
  MAIL.start();
  if (S.pendingGo) { const g = S.pendingGo; S.pendingGo = null; setTimeout(() => run(() => openGo(g)), 0); }
  if (!can('registrations_view') && !S.myKids.length) S.tab = 'profil';
}

async function loadAll() {
  const since = new Date(Date.now() - 100 * 864e5).toISOString();
  const [ses, cnt, regs, msgs, gd] = await Promise.all([
    sb.from('sessions').select('*').gte('starts_at', since).order('starts_at'),
    sb.rpc('session_counts'), sb.rpc('my_registrations'),
    sb.from('messages').select('*').order('created_at', { ascending: false }).limit(30),
    sb.from('guardians').select('user_id, kid_id, email, kids(id,name,phone,tue,fri,birthdate,allow_second)'),
  ]);
  S.sessions = ok(ses);
  S.counts = Object.fromEntries(ok(cnt).map((c) => [c.session_id, c]));
  S.regs = ok(regs);
  S.messages = ok(msgs);
  const g = ok(gd);
  S.myKids = g.filter((x) => x.user_id === S.user.id && x.kids).map((x) => x.kids);
  S.guardCount = {};
  S.guardEmails = {}; S.guardMine = {};
  g.forEach((x) => { S.guardCount[x.kid_id] = (S.guardCount[x.kid_id] || 0) + 1; if (x.email) (S.guardEmails[x.kid_id] ||= []).push(x.email); if (x.user_id === S.user.id && x.email) S.guardMine[x.kid_id] = x.email; });
  const none = Promise.resolve({ data: [] });
  const [k, w, c, u, r, inv] = await Promise.all([
    can('kids_manage') || can('registrations_view') ? sb.from('kids').select('*').order('name') : can('kids_view') ? sb.rpc('kids_list') : none,
    can('waitlist_view') ? sb.from('waitlist').select('*').order('created_at') : none,
    can('kids_manage') ? sb.from('settings').select('value').eq('key', 'invite_code').maybeSingle() : Promise.resolve({ data: null }),
    can('users_manage') ? sb.from('profiles').select('id, email, display_name, role_id').order('email') : none,
    sb.from('roles').select('*').order('name'),
    can('users_manage') ? sb.from('staff_invites').select('*').is('used_at', null).gt('expires_at', new Date().toISOString()).order('expires_at') : none,
  ]);
  S.mailLog = {};
  S.wlInv = {};
  if (can('registrations_view') && can('waitlist_view')) {
    const gq = await sb.from('session_guests').select('waitlist_id, confirmed, sessions(starts_at)').not('waitlist_id', 'is', null);
    (gq.data || []).forEach((x) => { if (x.sessions && (new Date(x.sessions.starts_at) > new Date())) { const a = (S.wlInv[x.waitlist_id] ||= []); if (!a.includes(x.sessions.starts_at)) a.push(x.sessions.starts_at); } });
    Object.values(S.wlInv).forEach((a) => a.sort());
    const ml = await sb.from('mail_log').select('waitlist_id, subject, sent_at').order('sent_at', { ascending: false });
    (ml.data || []).forEach((m) => { (S.mailLog[m.waitlist_id] ||= []).push(m); });
  }
  S.allKids = ok(k); S.waitlist = ok(w); S.inviteCode = c.data?.value || '';
  S.users = ok(u); S.roles = ok(r); S.invites = ok(inv);
  await loadActivity();
}

// Aktivität: Anteil der letzten (bis zu 8) vergangenen Trainings der Gruppe des Kindes, auf die geantwortet wurde
async function loadActivity() {
  // Teilnahme = bei wie vielen der letzten Trainings (mit abgehakter Anwesenheit) das Kind da war.
  // Solange zu wenige Trainings abgehakt sind, wird nichts angezeigt.
  S.activity = {};
  if (!can('registrations_view')) return;
  const since = new Date(Date.now() - 120 * 864e5).toISOString();
  const ses = ok(await sb.from('sessions').select('id,grp').eq('cancelled', false).lt('starts_at', new Date().toISOString()).gte('starts_at', since).order('starts_at', { ascending: false }));
  if (!ses.length) return;
  const regs = ok(await sb.from('registrations').select('kid_id,session_id,attended').in('session_id', ses.map((x) => x.id)));
  const checked = new Set(regs.filter((r) => r.attended).map((r) => r.session_id)); // Trainings, bei denen Anwesenheit erfasst wurde
  const was = new Set(regs.filter((r) => r.attended).map((r) => `${r.kid_id}|${r.session_id}`));
  for (const k of S.allKids) {
    const mine = ses.filter((x) => inGroup(k, x.grp) && checked.has(x.id)).slice(0, 8);
    if (mine.length < 3) continue;
    S.activity[k.id] = { n: mine.filter((x) => was.has(`${k.id}|${x.id}`)).length, m: mine.length };
  }
}

async function refreshSessions() {
  await loadAll();
  if (S.open && can('registrations_view')) await loadDetail(S.open);
  render();
}

async function loadDetail(id) {
  S.detail[id] = ok(await sb.from('registrations').select('*, kids(name,phone)').eq('session_id', id).order('status'));
  S.guests[id] = ok(await sb.from('session_guests').select('*').eq('session_id', id).order('created_at'));
}

function askModal(title, text, buttons) {
  return new Promise((resolve) => {
    const el = document.createElement('div'); el.className = 'modal';
    el.innerHTML = `<div class="box"><h2>${esc(title)}</h2><p>${esc(text)}</p>${buttons.map(([v, l, c], i) => `<button class="${c === 'link' ? 'link' : 'btn big ' + (c === 'primary' ? '' : 'ghost')}" data-i="${i}">${esc(l)}</button>`).join('')}</div>`;
    el.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { el.remove(); resolve(buttons[+b.dataset.i][0]); } else if (e.target === el) { el.remove(); resolve(''); } });
    document.body.appendChild(el);
  });
}

async function inviteFlow(w) {
  const nm = [w.first_name, w.last_name].filter(Boolean).join(' ');
  const ids = await pickSessions(nm);
  if (!ids) return false;
  if (can('registrations_manage')) await sb.from('session_guests').delete().eq('waitlist_id', w.id).eq('confirmed', false);
  if (can('registrations_manage')) ok(await sb.from('session_guests').insert(ids.map((id) => ({ session_id: id, name: nm, waitlist_id: w.id }))));
  const first = S.sessions.filter((x) => ids.includes(x.id)).map((x) => x.starts_at).sort()[0];
  ok(await sb.from('waitlist').update({ status: 'invited', trial: true, trial_on: first ? dkey(first) : null }).eq('id', w.id));
  toast('Eingeladen und bei beiden Terminen eingetragen');
  return true;
}

function pickSessions(name) {
  const list = S.sessions.filter((x) => !x.cancelled && new Date(x.starts_at) > new Date()).slice(0, 16);
  return new Promise((resolve) => {
    const el = document.createElement('div'); el.className = 'modal';
    el.innerHTML = `<div class="box left"><h2>Einladung für ${esc(name)}</h2><p>Zu welchen beiden Terminen wird das Kind eingeladen?</p>
      <div class="picklist">${list.map((x) => `<label class="line"><input type="checkbox" value="${x.id}"> ${esc(fmt(x.starts_at))} Uhr · ${esc(DAY[x.grp])}</label>`).join('') || '<p class="muted">Keine kommenden Termine.</p>'}</div>
      <button class="btn big" data-ok disabled>Einladen</button><button class="link" data-no>Abbrechen</button></div>`;
    const okb = el.querySelector('[data-ok]');
    el.addEventListener('change', (e) => {
      const on = [...el.querySelectorAll('input:checked')];
      if (on.length > 2) { e.target.checked = false; toast('Maximal zwei Termine'); return; }
      okb.disabled = on.length === 0; okb.textContent = on.length === 2 ? 'Zu 2 Terminen einladen' : on.length === 1 ? 'Zu 1 Termin einladen' : 'Einladen';
    });
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-ok]')) { const ids = [...el.querySelectorAll('input:checked')].map((i) => i.value); el.remove(); resolve(ids); }
      else if (e.target.closest('[data-no]') || e.target === el) { el.remove(); resolve(null); }
    });
    document.body.appendChild(el);
  });
}

/* ---------- Views ---------- */
/* Klick auf eine Push-Nachricht: passende Mail oder passenden Termin öffnen */
async function openGo(go) {
  if (!go) return;
  if (S.view !== 'main') { S.pendingGo = go; return; }
  if (go.go === 'mail' && can('mailbox')) {
    S.tab = 'postfach'; S.mail.open = null; S.mail.thread = []; render();
    if (go.k) await A.mailOpen({ k: go.k });
  } else if (go.go === 'session') {
    S.tab = 'termine'; S.termView = 'list'; S.open = go.id;
    if (!S.sessions.some((x) => x.id === go.id)) await refreshSessions();
    if (can('registrations_view')) await loadDetail(go.id);
    render();
    setTimeout(() => document.querySelector(`[data-s="${go.id}"]`)?.scrollIntoView({ block: 'center' }), 50);
  }
}
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.go) run(() => openGo(e.data.go)); });

/* Zurück-Taste des Handys: geht in der App einen Schritt zurück statt sie zu schließen */
let navKey = null, navApplying = false;
const navSnap = () => ({ tab: S.tab, open: S.open, openKid: S.openKid, wlOpen: S.wlOpen, mail: S.mail.open || null });
function navCheck() {
  if (S.view !== 'main') return;
  const snap = navSnap(), key = JSON.stringify(snap);
  if (navKey === null) history.replaceState(snap, '');
  else if (key !== navKey && !navApplying) history.pushState(snap, '');
  navKey = key;
}
function render() {
  renderMain();
  if (S.view === 'main') { MAIL.afterRender(); navCheck(); }
}
window.addEventListener('popstate', (e) => {
  if (S.view !== 'main') return;
  const st = e.state || { tab: 'termine', open: null, openKid: null, wlOpen: null, mail: null };
  navApplying = true;
  S.tab = st.tab || 'termine'; S.open = st.open || null; S.openKid = st.openKid || null; S.wlOpen = st.wlOpen || null;
  if (!st.mail && S.mail.open) { S.mail.open = null; S.mail.thread = []; }
  navKey = JSON.stringify({ tab: S.tab, open: S.open, openKid: S.openKid, wlOpen: S.wlOpen, mail: st.mail || null });
  Promise.resolve(st.mail ? A.mailOpen({ k: st.mail }) : null).then(() => { if (S.open) return loadDetail(S.open); }).catch(() => {}).finally(() => { render(); navApplying = false; });
});
function renderMain() {
  app.innerHTML = S.view === 'boot' ? '<p class="center muted">Lädt…</p>'
    : S.view === 'waitform' ? viewWaitForm()
    : S.view === 'invite' ? viewInvite()
    : S.view === 'pick' ? viewPick()
    : S.view === 'login' ? viewLogin()
    : viewMain();
}

function viewMore() {
  const row = (t, i, l) => `<button class="mrow-btn" data-a="tab" data-t="${t}"><span>${i}</span>${l}<em>›</em></button>`;
  return `<div class="list">${can('sessions_manage') ? row('neu', ic('plus'), 'Trainings anlegen') : ''}${can('users_manage') ? row('nutzer', ic('key'), 'Team & Rollen') : ''}${row('profil', ic('user'), 'Mein Profil')}</div>`;
}

function viewWaitForm() {
  if (S.waitDone) return `<div class="card"><h1>Vielen Dank!</h1><p>Wir haben Ihre Anfrage erhalten und Ihr Kind auf die Warteliste gesetzt. Sobald ein Platz frei wird oder ein Schnuppertraining möglich ist, melden wir uns bei Ihnen.</p><p class="muted small">Mit sportlichen Grüßen,<br>das Trampolin-Team des TV Hemsbach</p></div>`;
  return `<div class="card"><h1>Warteliste Trampolin</h1>
    <p>Aktuell können wir leider keine neuen Kinder aufnehmen. Über dieses Formular setzen wir Ihr Kind auf die Warteliste. Das Training findet dienstags und freitags jeweils von 17:30 bis 20:00 Uhr statt.</p>
    <p class="small muted" style="margin:4px 0 0"><span class="req">*</span> Alle Felder sind Pflichtfelder.</p>
    <form data-f="submitWait">
      <label>Vorname des Kindes <span class="req">*</span><input name="first" required minlength="2" maxlength="60" autocomplete="off"></label>
      <label>Nachname des Kindes <span class="req">*</span><input name="last" required minlength="2" maxlength="60" autocomplete="off"></label>
      <label>Geburtsdatum des Kindes <span class="req">*</span><input name="birth" type="date" required></label>
      <label>Telefonnummer (mobil) <span class="req">*</span><input name="phone" type="tel" required minlength="6" autocomplete="tel"></label>
      <label>E-Mail-Adresse <span class="req">*</span><input name="email" type="email" required autocomplete="email"></label>
      <label>Gewünschter Trainingstag <span class="req">*</span><select name="day" required><option value="" disabled selected>Bitte wählen</option><option value="tue">Dienstag</option><option value="fri">Freitag</option><option value="both">Dienstag oder Freitag</option></select></label>
      <input name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">
      <label class="line"><input type="checkbox" name="ok" required> Ich bin damit einverstanden, dass meine Angaben für die Verwaltung der Warteliste und die Kontaktaufnahme gespeichert werden. <span class="req">*</span></label>
      <button class="btn big">Auf die Warteliste setzen</button></form>
    <p class="muted small">Die Angaben werden nur vom Trainerteam des TV Hemsbach gesehen und nur für die Warteliste verwendet.</p></div>`;
}

function viewInvite() {
  return `<div class="card"><h1>Willkommen</h1><h2>Einladung ins Team</h2>
    <p>Du wurdest eingeladen, bei den Trainern mitzumachen.</p>
    <p class="muted small">Tipp: Steht oben „Als App installieren“, mach das zuerst und tippe danach hier auf den Knopf.</p>
    <button class="btn big" data-a="acceptInvite">Einladung annehmen</button></div>`;
}

function viewPick() {
  const hasMail = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(S.parentEmail || '');
  if (!hasMail) {
    return `<div class="card"><h1>Willkommen</h1>
    <h2>Deine E-Mail-Adresse</h2>
    <p>Bitte trage zuerst deine E-Mail-Adresse ein. Das Trainerteam nutzt sie, um dich zu erreichen. Danach wählst du dein Kind.</p>
    <form data-f="parentEmail"><label>E-Mail-Adresse <span class="req">*</span><input name="email" type="email" required autocomplete="email" value="${esc(S.parentEmail || '')}"></label>
    <button class="btn big">Weiter</button></form>
    <button class="link" data-a="toLogin">Anmeldung mit E-Mail (Admin)</button></div>`;
  }
  const kids = S.overview.map((k) => `<button class="kidbtn" data-a="pickKid" data-id="${esc(k.id)}" data-name="${esc(k.name)}">${esc(k.name)}</button>`).join('');
  return `<div class="card"><h1>Willkommen</h1>
    <h2>Wer ist dein Kind?</h2>
    <p class="small muted">E-Mail: ${esc(S.parentEmail)} · <button class="link" data-a="changeParentMail">ändern</button></p>
    ${S.overviewError ? `<p class="err">${esc(S.overviewError)}</p>` : `<div class="kidlist">${kids}</div>`}
    <p class="muted small">Dein Kind fehlt? Dann hat es vielleicht schon ein anderes Elternteil gewählt. Bitte melde dich bei den Trainern, sie können es freigeben. Jedes Kind kann nur einmal gewählt werden.</p>
    <p class="muted small">Tipp: Steht oben „Als App installieren“, mach das zuerst. Weitere Kinder kannst du später hinzufügen.</p>
    <button class="link" data-a="toLogin">Anmeldung mit E-Mail (Admin)</button></div>`;
}

function viewLogin() {
  const L = S.login;
  const who = '<p>Anmeldung mit E-Mail-Code (für den Admin).</p>';
  const form = L.step === 'email'
    ? `<form data-f="email"><label>E-Mail-Adresse<input name="email" type="email" required autocomplete="email" value="${esc(L.email)}"></label>
       <button class="btn big">Code per Mail senden</button></form>`
    : `<form data-f="code"><p>Wir haben einen Code an <b>${esc(L.email)}</b> gesendet.</p>
       <label>Code aus der Mail<input name="token" inputmode="numeric" autocomplete="one-time-code" maxlength="10" required></label>
       <button class="btn big">Anmelden</button>
       <button type="button" class="link" data-a="toEmail">Andere Mailadresse</button></form>`;
  return `<div class="card"><h1>Willkommen</h1>${who}${form}
    ${S.code && L.step === 'email' ? '<button class="link" data-a="backPick">Zurück zur Kinder-Auswahl</button>' : ''}
    <p class="muted small">Du bleibst danach auf diesem Gerät angemeldet.</p></div>`;
}

function viewMain() {
  const more = can('sessions_manage') || can('users_manage');
  const tabs = [
    ['termine', ic('cal'), 'Termine', true],
    ['kinder', ic('users'), 'Mitglieder', can('kids_manage') || can('kids_view')],
    ['interessenten', ic('clock'), 'Warteliste', can('waitlist_view')],
    ['postfach', ic('mail'), 'Postfach', can('mailbox')],
    ['news', ic('chat'), 'News', true],
    ['mehr', ic('menu'), 'Mehr', more],
    ['profil', ic('user'), 'Profil', !more],
  ].filter((t) => t[3]);
  const sub = more ? ['neu', 'nutzer', 'profil'] : [];
  if (!tabs.some((t) => t[0] === S.tab) && !sub.includes(S.tab)) S.tab = 'termine';
  const active = (k) => S.tab === k || (k === 'mehr' && sub.includes(S.tab));
  const back = sub.includes(S.tab) ? '<button class="link" data-a="tab" data-t="mehr">‹ Zurück</button>' : '';
  const body = back + { termine: viewTermine, neu: viewNew, interessenten: viewWaitlist, kinder: viewKids, nutzer: viewUsers, postfach: MAIL.view, news: viewNews, profil: viewProfile, mehr: viewMore }[S.tab]();
  return `<main>${body}</main><nav>${tabs.map(([k, i, l]) => `<button class="${active(k) ? 'on' : ''}" data-a="tab" data-t="${k}"><span>${i}${k === 'postfach' ? `<i class="bdg" id="mail-bdg" ${S.mail.unread ? '' : 'hidden'}>${S.mail.unread}</i>` : ''}</span>${l}</button>`).join('')}</nav>`;
}

function sessionHead(s) {
  const c = S.counts[s.id] || { going: 0 };
  const d = new Date(s.starts_at);
  const wd = d.toLocaleDateString('de-DE', { weekday: 'short' }).replace('.', '');
  return `<div class="srow ${s.grp}${s.cancelled ? ' x' : ''}"><div class="sdate"><small>${wd}</small><b>${d.getDate()}.${d.getMonth() + 1}.</b></div>
    <div class="sinfo"><div><b>${esc(s.title)}</b>${s.cancelled ? ' <span class="badge red">Abgesagt</span>' : ''}</div>
    <div class="muted small">${tm(s.starts_at)}${s.ends_at ? '–' + tm(s.ends_at) : ''}${s.grp === 'all' ? ' · Alle Gruppen' : ''}${s.location ? ' · ' + esc(s.location) : ''}${s.note ? ' · ' + esc(s.note) : ''}</div></div>
    ${can('registrations_view') ? `<div class="scount"><b>${c.going}</b><small>dabei</small></div>` : ''}</div>`;
}

const upcoming = (list) => list.filter((s) => new Date(s.starts_at) >= new Date(Date.now() - 3 * 3600e3));
function visibleSessions() {
  if (can('registrations_view')) return S.sessions;
  return S.sessions.filter((s) => S.myKids.some((k) => inGroup(k, s.grp)));
}

function sessionCardParent(s) {
  const rows = S.myKids.filter((k) => inGroup(k, s.grp)).map((k) => {
    const r = S.regs.find((x) => x.session_id === s.id && x.kid_id === k.id);
    const st = r?.status || 'going';
    const badge = st === 'going' ? '<span class="badge green">Dabei</span>'
      : '<span class="badge red">Abgesagt</span>';
    const btns = s.cancelled ? '' : `<div class="btns">
      <button class="btn ${st === 'going' ? 'on' : ''}" data-a="answer" data-s="${s.id}" data-k="${k.id}" data-v="yes">Zusagen</button>
      <button class="btn ghost ${st === 'declined' ? 'on' : ''}" data-a="answer" data-s="${s.id}" data-k="${k.id}" data-v="no">Absagen</button></div>`;
    return `<div class="kidrow"><div><b>${esc(k.name)}</b> ${badge}</div>${btns}</div>`;
  }).join('');
  return `<div class="scard">${sessionHead(s)}${rows}</div>`;
}
function sessionCardTrainer(s) {
  return `<div class="scard"><div data-a="toggle" data-s="${s.id}" class="click">${sessionHead(s)}</div>${S.open === s.id ? detailTrainer(s) : ''}</div>`;
}
const sessionCard = (s) => (can('registrations_view') ? sessionCardTrainer(s) : sessionCardParent(s));

function parentHint() {
  if (can('registrations_view')) return '';
  if (!S.myKids.length) return '<p class="muted center">Noch kein Kind verknüpft (Profil → Kind hinzufügen).</p>';
  if (S.myKids.every((k) => !k.tue && !k.fri)) return '<p class="muted center">Die Trainingstage deines Kindes (Dienstag/Freitag) sind noch nicht eingetragen. Bitte kurz bei den Trainern melden.</p>';
  return '';
}

function viewTermineList() {
  const hint = parentHint(); if (hint) return hint;
  const tr = can('registrations_view');
  const chips = tr ? `<div class="chips">${[['all', 'Alle'], ['tue', 'Dienstag'], ['fri', 'Freitag']].map(([k, l]) => `<button class="chip ${S.dayFilter === k ? 'on' : ''}" data-a="dayFilter" data-v="${k}">${l}</button>`).join('')}</div>` : '';
  const past = S.showPast;
  const vis = visibleSessions().filter((s) => !tr || S.dayFilter === 'all' || s.grp === S.dayFilter || s.grp === 'all');
  const up = upcoming(vis);
  const list = past ? vis.filter((s) => !up.includes(s)).reverse() : up;
  const pastBtn = `<div class="btns"><button class="link" data-a="showPast">${past ? '‹ Zurück zu kommenden Terminen' : 'Vergangene Termine anzeigen'}</button></div>`;
  if (!list.length) return `${chips}<p class="muted center">Keine Termine.</p>${pastBtn}`;
  if (false) return `${chips}<p class="muted center">Keine Termine.${can('sessions_manage') ? ' Lege unter „Neu“ welche an.' : ''}</p>`;
  return chips + (past ? '<h3>Vergangene Termine</h3>' : '') + `<div class="list">${list.map(sessionCard).join('')}</div>` + pastBtn;
}

const bdaysOn = (d) => S.allKids.filter((k) => k.active && k.birthdate && new Date(k.birthdate).getMonth() === d.getMonth() && new Date(k.birthdate).getDate() === d.getDate());
const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

function viewCalendar() {
  const hint = parentHint(); if (hint) return hint;
  const by = {};
  visibleSessions().forEach((s) => { (by[dkey(s.starts_at)] ||= []).push(s); });
  const today = dkey(new Date());
  const month = S.calMode === 'month';
  const MN = new Date(S.calMonth.y, S.calMonth.m, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  const wk0 = S.calWeek, wk6 = new Date(wk0.getFullYear(), wk0.getMonth(), wk0.getDate() + 6);
  const title = month ? MN : `${wk0.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} – ${wk6.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;
  const head = `<div class="calhead"><div><button class="circ" data-a="calNav" data-d="-1">‹</button><button class="circ" data-a="calNav" data-d="1">›</button></div>
    <b>${esc(title)}</b><div class="seg"><button class="${month ? 'on' : ''}" data-a="calMode" data-v="month">Monat</button><button class="${month ? '' : 'on'}" data-a="calMode" data-v="week">Woche</button></div></div>`;
  let grid;
  if (month) {
    const { y, m } = S.calMonth;
    const first = new Date(y, m, 1), off = (first.getDay() + 6) % 7, total = Math.ceil((off + new Date(y, m + 1, 0).getDate()) / 7) * 7;
    const cells = Array.from({ length: total }, (_, i) => new Date(y, m, 1 - off + i)).map((d) => {
      const k = dkey(d);
      const chips = (by[k] || []).map((s) => `<div class="cs ${s.grp}${s.cancelled ? ' x' : ''}">${esc(s.title)}</div>`).join('');
      const bd = bdaysOn(d).map((x) => `<div class="bd">${ic('cake')} ${esc(x.name.split(' ')[0])}</div>`).join('');
      return `<div class="cd ${d.getMonth() !== m ? 'oth' : ''} ${k === today ? 'today' : ''} ${k === S.calDay ? 'sel' : ''}" data-a="calDay" data-k="${k}"><span class="dn">${d.getDate()}</span>${chips}${bd}</div>`;
    }).join('');
    grid = `<div class="cal">${WD.map((w) => `<div class="cw">${w}</div>`).join('')}${cells}</div>`;
  } else {
    grid = Array.from({ length: 7 }, (_, i) => new Date(wk0.getFullYear(), wk0.getMonth(), wk0.getDate() + i)).map((d) => {
      const k = dkey(d);
      const ss = (by[k] || []).map((s) => `<div class="cs wide ${s.grp}${s.cancelled ? ' x' : ''}">${tm(s.starts_at)}${s.ends_at ? '–' + tm(s.ends_at) : ''} ${esc(s.title)} · ${DAY[s.grp]}${s.cancelled ? ' (abgesagt)' : ''}</div>`).join('');
      const bd = bdaysOn(d).map((x) => `<div class="bd">${ic('cake')} ${esc(x.name)}</div>`).join('');
      return `<div class="wrow ${k === today ? 'today' : ''} ${k === S.calDay ? 'sel' : ''}" data-a="calDay" data-k="${k}"><b>${WD[(d.getDay() + 6) % 7]} ${d.getDate()}.${d.getMonth() + 1}.</b><div>${ss || '<span class="muted small">–</span>'}${bd}</div></div>`;
    }).join('');
  }
  const day = S.calDay ? (by[S.calDay] || []) : [];
  const dd = S.calDay ? new Date(S.calDay + 'T12:00') : null;
  const panel = dd ? `<h3>${dd.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long' })}</h3>${day.map(sessionCard).join('') || '<p class="muted small">Kein Training an diesem Tag.</p>'}` : '';
  return head + grid + panel;
}

function viewTermine() {
  const seg = `<div class="chips"><button class="chip ${S.termView === 'cal' ? 'on' : ''}" data-a="termView" data-v="cal">Kalender</button><button class="chip ${S.termView === 'list' ? 'on' : ''}" data-a="termView" data-v="list">Liste</button></div>`;
  return seg + (S.termView === 'cal' ? viewCalendar() : viewTermineList());
}

function detailTrainer(s) {
  const regs = S.detail[s.id];
  if (!regs) return '<p class="muted small" style="padding:0 14px 12px">Lädt…</p>';
  const mg = can('registrations_manage'), att = can('attendance_manage') && new Date(s.starts_at) <= new Date();
  const kids = S.allKids.filter((k) => k.active && inGroup(k, s.grp));
  const reg = (k) => regs.find((r) => r.kid_id === k.id);
  const out = kids.filter((k) => reg(k)?.status === 'declined'), inn = kids.filter((k) => reg(k)?.status !== 'declined');
  const btn = (k, v, on, ic) => `<button class="rb ${on ? (v === 'yes' ? 'yes' : 'no') : ''}" ${mg ? `data-a="answer" data-s="${s.id}" data-k="${k.id}" data-v="${v}"` : 'disabled'}>${ic}</button>`;
  const row = (k, going) => `<div class="prow">${avatar()}<span class="pn">${esc(k.name)}</span>
    ${going && att ? `<label class="att"><input type="checkbox" data-a="attend" data-s="${s.id}" data-k="${k.id}" ${reg(k)?.attended ? 'checked' : ''}> da</label>` : ''}
    ${btn(k, 'yes', going, ic('check'))}${btn(k, 'no', !going, ic('x'))}</div>`;
  const manage = can('sessions_manage') ? `<div class="btns"><button class="link" data-a="setGrp" data-s="${s.id}" data-v="${s.grp === 'all' ? (new Date(s.starts_at).getDay() === 5 ? 'fri' : 'tue') : 'all'}">${s.grp === 'all' ? 'Nur ' + (new Date(s.starts_at).getDay() === 5 ? 'Freitag' : 'Dienstag') : 'Für beide Gruppen öffnen'}</button><button class="link" data-a="cancelSession" data-s="${s.id}" data-v="${!s.cancelled}">${s.cancelled ? 'Wieder aktivieren' : 'Training absagen'}</button><button class="link danger" data-a="deleteSession" data-s="${s.id}">Löschen</button></div>` : '';
  const gl = (S.guests[s.id] || []).filter((g) => g.confirmed !== false), offers = (S.guests[s.id] || []).filter((g) => g.confirmed === false);
  const wl = (S.waitlist || []).filter((w) => ['waiting', 'invited'].includes(w.status));
  const guestBox = `<div class="sh"><span>Schnupperkinder</span><b>${gl.length}</b></div>
    ${gl.map((g) => `<div class="prow">${avatar()}<span class="pn">${esc(g.name)}</span>${att ? `<label class="att"><input type="checkbox" data-a="guestAttend" data-g="${g.id}" ${g.attended ? 'checked' : ''}> da</label>` : ''}${mg ? `<button class="link danger" data-a="delGuest" data-s="${s.id}" data-g="${g.id}">Löschen</button>` : ''}</div>`).join('')}
    ${offers.length ? `<div class="sh"><span>Eingeladen, Antwort offen</span><b>${offers.length}</b></div>${offers.map((g) => `<div class="prow">${avatar()}<span class="pn">${esc(g.name)}</span>${mg ? `<button class="btn small" data-a="confirmGuest" data-s="${s.id}" data-g="${g.id}">Kommt zu diesem Termin</button><button class="x" data-a="delGuest" data-s="${s.id}" data-g="${g.id}" title="Entfernen">${ic('x')}</button>` : ''}</div>`).join('')}` : ''}
    ${mg ? `<form data-f="newGuest" class="inline"><input type="hidden" name="s" value="${s.id}"><label>Name<input name="name" list="wl-${s.id}" placeholder="Name oder aus Warteliste wählen" required autocomplete="off"></label>
      <datalist id="wl-${s.id}">${wl.map((w) => `<option value="${esc([w.first_name, w.last_name].filter(Boolean).join(' '))}">`).join('')}</datalist><button class="btn">+</button></form>` : ''}`;
  return `<div class="sdetail">
    <div class="sh"><span>Zugesagt</span><b>${inn.length}</b></div>${inn.map((k) => row(k, true)).join('') || '<p class="muted small">Niemand</p>'}
    <div class="sh"><span>Abgesagt</span><b>${out.length}</b></div>${out.map((k) => row(k, false)).join('') || '<p class="muted small">Niemand</p>'}${guestBox}${manage}</div>`;
}

function viewNew() {
  const today = dkey(new Date());
  return `<div class="card"><h2>Trainings anlegen</h2><p class="small muted">Legt alle Dienstage und/oder Freitage im Zeitraum an, standardmäßig 17:30–20:00 Uhr. Ausfälle (Ferien, Feiertage) danach einzeln absagen oder löschen. Schon vorhandene Tage werden übersprungen.</p>
    <form data-f="newSeries"><label class="line"><input type="checkbox" name="tue" checked> Dienstag</label><label class="line"><input type="checkbox" name="fri" checked> Freitag</label>
    <label>Von<input name="from" type="date" value="${today}" required></label><label>Bis<input name="to" type="date" required></label>
    <label>Beginn<input name="start" type="time" value="17:30" required></label><label>Ende<input name="end" type="time" value="20:00" required></label>
    <label>Ort<input name="location"></label>
    <label class="line"><input type="checkbox" name="skipXmas" checked> Baden-Württembergische Weihnachtsferien auslassen (23.12.–09.01.)</label>
    <button class="btn big">Anlegen</button></form></div>
    <details class="card"><summary>Einzelner Termin (anderer Tag, Zusatztraining)</summary><form data-f="newSession">
    <label>Titel<input name="title" value="Training" required></label>
    <label>Gruppe<select name="grp"><option value="tue">Dienstag</option><option value="fri">Freitag</option><option value="all">Beide Gruppen</option></select></label>
    <label>Datum<input name="date" type="date" required></label>
    <label>Beginn<input name="start" type="time" value="17:30" required></label><label>Ende<input name="end" type="time" value="20:00" required></label>
    <label>Ort<input name="location"></label><label>Hinweis<input name="note"></label><button class="btn big">Anlegen</button></form></details>`;
}

function wlFiltered() {
  const q = S.wlQuery.trim().toLowerCase();
  // älteste Anfrage zuerst (Warteschlange); ohne Datum ans Ende
  return S.waitlist.filter((w) => w.status === S.wlFilter &&
    (!q || `${w.first_name} ${w.last_name} ${w.email} ${w.phone}`.toLowerCase().includes(q)))
    .sort((a, b) => (a.requested_on || '9999').localeCompare(b.requested_on || '9999') || String(a.created_at).localeCompare(String(b.created_at)));
}
const waNumber = (p) => { let d = String(p || '').replace(/[^\d+]/g, ''); if (d.startsWith('+')) return d.slice(1); if (d.startsWith('00')) return d.slice(2); if (d.startsWith('0')) return '49' + d.slice(1); return d.length >= 10 ? d : '49' + d; };
function cancelText(ses) {
  const when = new Date(ses.starts_at).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' });
  return `Liebe Eltern,

leider muss das Schnuppertraining am ${when} um ${tm(ses.starts_at)} Uhr ausfallen. Wir geben euch Bescheid, sobald es einen Ersatztermin gibt.

Entschuldigt bitte die Umstände.

Mit sportlichen Grüßen,

Jarina Adams
Trampolin Trainer
BA. Sportwissenschaften
TV Hemsbach`;
}
function showCancelNotices(ses, guests) {
  const rows = guests.map((g) => {
    const w = (S.waitlist || []).find((x) => x.id === g.waitlist_id);
    const btns = w ? `${w.phone ? `<a class="btn small" target="_blank" rel="noopener" href="https://wa.me/${waNumber(w.phone)}?text=${encodeURIComponent(cancelText(ses))}">WhatsApp</a>` : ''}${w.email ? `<button class="btn small ghost" data-mail="${w.id}">Mail senden</button>` : ''}${!w.phone && !w.email ? '<span class="muted small">keine Kontaktdaten</span>' : ''}` : '<span class="muted small">kein Kontakt hinterlegt</span>';
    return `<div class="prow"><span class="pn">${esc(g.name)}</span>${btns}</div>`;
  }).join('');
  const el = document.createElement('div'); el.className = 'modal';
  el.innerHTML = `<div class="box left"><h2>Schnupperkinder informieren</h2><p>Diese Eltern bekommen keine Push-Nachricht. Bitte sag ihnen selbst ab:</p><div class="picklist">${rows}</div><button class="btn big" data-no>Fertig</button></div>`;
  el.addEventListener('click', (e) => {
    const m = e.target.closest('[data-mail]');
    if (m) { A.mailCompose({ id: m.dataset.mail, k: 'cancel', ses }); return; }
    if (e.target.closest('[data-no]') || e.target === el) el.remove();
  });
  document.body.appendChild(el);
}

function inviteText(w, kind) {
  const inv = S.wlInv?.[w.id] || [];
  const fmtD = (x) => new Date(x).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' });
  const fmtS = (x) => new Date(x).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
  const wds = new Set(inv.map((x) => new Date(x).getDay()));
  const days = wds.size ? [...wds].map((d) => (d === 2 ? 'dienstags' : 'freitags')) : [w.tue && 'dienstags', w.fri && 'freitags'].filter(Boolean);
  const day = (days.length ? [...new Set(days)] : ['freitags']).join(' und ');
  const sign = `Mit sportlichen Grüßen,

Jarina Adams
Trampolin Trainer
BA. Sportwissenschaften
TV Hemsbach`;
  const hall = `Das Training findet in der BiZ-Halle des Gymnasiums/Carl-Engler-Realschule statt. Wir treffen uns vor der Halle auf dem Parkplatz und betreten die Halle nur gemeinsam.

Zum Training werden Socken/Schläppchen, Sportkleidung (elastische Hose ohne Bänder oder Reißverschlüsse), (bei langen Haaren) ein Haargummi und eine Trinkflasche benötigt.`;
  if (kind === 'trial') {
    const first = inv.length > 1 ? `Die ersten beiden Schnuppertrainings sind am ${inv.map(fmtS).join(' und am ')} möglich.` : inv.length ? `Ein erstes Schnuppertraining ist am ${fmtS(inv[0])} möglich.` : 'Ein erstes Schnuppertraining ist nach Absprache möglich.';
    const intro = `wir freuen uns, euch ${inv.length === 1 ? 'einen Termin' : 'zwei Termine'} zum Schnuppern beim TV Hemsbach Trampolin anbieten zu können.`;
    return `Liebe Eltern,

${intro}

${first}

${hall}

Dies ist noch keine feste Zusage für einen Platz sondern vorerst nur ein erstes Kennenlernen.

Da wir die Kinder bei den ersten beiden Trainingseinheiten zum schnuppern noch nicht einschätzen können, werden in diesen beiden Tagen nur erste Grundlagen beigebracht und Saltos sind nicht erlaubt.

Bitte gebt uns eine kurze Rückmeldung, ob Interesse besteht.

${sign}`;
  }
  const first = inv.length > 1 ? `Die ersten beiden Schnuppertrainings sind am ${inv.map(fmtD).join(' und am ')} möglich.` : inv.length ? `Ein erstes Schnuppertraining ist am ${fmtD(inv[0])} möglich.` : 'Ein erstes Schnuppertraining ist nach Absprache möglich.';
  return `Liebe Eltern,

wir freuen uns, euch in unserem Training ${day} von 17:30-20 Uhr einen Platz anbieten zu können.

${hall}

${first}

Bitte gebt uns eine kurze Rückmeldung, ob Interesse besteht.

${sign}`;
}
function wlList() {
  const list = wlFiltered();
  if (!list.length) return '<p class="muted center">Keine Einträge.</p>';
  const tag = (w) => `${w.tue ? '<span class="tag tue">Dienstag</span>' : ''}${w.fri ? '<span class="tag fri">Freitag</span>' : ''}`;
  return `<div class="list">${list.map((w) => {
    const open = S.wlOpen === w.id;
    const head = `<div class="mmain click" data-a="wlOpen" data-id="${w.id}" style="padding:12px 14px"><div class="minfo"><b>${esc([w.first_name, w.last_name].filter(Boolean).join(' '))}</b>${w.birthdate ? `<span class="muted"> · ${ageOf(w.birthdate)} J.</span>` : ''}${w.trial ? ' <span class="badge green">Schnuppern</span>' : ''}</div><div>${tag(w)}</div><span class="chev">${open ? '‹' : '›'}</span></div>`;
    const det = !open ? '' : `<div class="sdetail"><p class="small muted" style="margin:8px 0">angefragt: ${esc(w.requested || (w.requested_on ? fmtDate(w.requested_on) : '–'))}${w.requested_again ? ' · erneut: ' + esc(w.requested_again) : ''}${w.contacted_at ? ' · angeschrieben: ' + fmtDate(w.contacted_at) : ''}${w.birthdate ? ' · geboren: ' + fmtDate(w.birthdate) : ''}</p>
      ${S.mailLog?.[w.id]?.length ? `<p class="small muted">Zuletzt gemailt: ${esc(fmtDate(S.mailLog[w.id][0].sent_at))} (${esc(S.mailLog[w.id][0].subject)})</p>` : ''}
      ${can('registrations_manage') && S.wlInv?.[w.id]?.length ? `<button class="link danger" data-a="withdrawInvite" data-id="${w.id}">Einladung zurücknehmen</button>` : ''}
      ${S.wlInv?.[w.id]?.length ? `<p class="small"><b>Eingeladen zu:</b> ${S.wlInv[w.id].map((x) => esc(fmt(x))).join(' und ')} Uhr</p>` : ''}
      <div class="small">${w.email ? `<a href="mailto:${esc(w.email)}">${ic('mail')} ${esc(w.email)}</a><br>` : ''}${w.phone ? `<a href="tel:${esc(w.phone)}">${ic('phone')} ${esc(w.phone)}</a>` : ''}</div>
      ${can('waitlist_manage') && (w.email || w.phone) ? `<div class="small muted" style="margin-top:8px">Einladung zum Schnuppern</div><div class="btns">${w.phone ? `<a class="btn small" target="_blank" rel="noopener" href="https://wa.me/${waNumber(w.phone)}?text=${encodeURIComponent(inviteText(w, 'trial'))}">WhatsApp</a>` : ''}${w.email ? `<button class="btn small ghost" data-a="mailCompose" data-id="${w.id}" data-k="trial">Mail senden</button>` : ''}</div>${w.trial_done ? `<div class="small muted" style="margin-top:8px">Platzangebot</div><div class="btns">${w.phone ? `<a class="btn small" target="_blank" rel="noopener" href="https://wa.me/${waNumber(w.phone)}?text=${encodeURIComponent(inviteText(w, 'offer'))}">WhatsApp</a>` : ''}${w.email ? `<button class="btn small ghost" data-a="mailCompose" data-id="${w.id}" data-k="offer">Mail senden</button>` : ''}</div>` : '<p class="small muted" style="margin-top:8px">Platzangebot erst möglich, wenn das Kind beim Schnuppern war.</p>'}` : ''}
      ${can('waitlist_manage') ? `<label class="line"><input type="checkbox" data-a="trialDone" data-id="${w.id}" ${w.trial_done ? 'checked' : ''}> War beim Schnuppern da</label>` : ''}
      ${can('waitlist_manage') ? `<label>Notiz<textarea rows="4" data-a="wlNote" data-id="${w.id}" placeholder="Hier tippen, wird automatisch gespeichert">${esc(w.note || '')}</textarea></label>` : (w.note ? `<p class="note">${esc(w.note)}</p>` : '')}
      ${can('waitlist_manage') ? `<div class="btns"><select data-a="wlStatus" data-id="${w.id}">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${w.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        ${can('kids_manage') ? `<button class="btn small" data-a="wlAccept" data-id="${w.id}">Als Teilnehmer anlegen</button>` : ''}</div>` : ''}</div>`;
    return `<div class="scard">${head}${det}</div>`;
  }).join('')}</div>`;
}
function viewWaitlist() {
  const counts = Object.fromEntries(Object.keys(STATUS).map((k) => [k, S.waitlist.filter((w) => w.status === k).length]));
  const chips = Object.entries(STATUS).map(([k, v]) => `<button class="chip ${S.wlFilter === k ? 'on' : ''}" data-a="wlFilter" data-v="${k}">${v} (${counts[k]})</button>`).join('');
  const prev = S.importPreview ? `<div class="card"><b>${S.importPreview.length} Einträge gefunden.</b>
    <p class="small muted">Wird nur in deine Datenbank geschrieben. Bitte nur einmal importieren, sonst entstehen Doppelte.</p>
    <div class="btns"><button class="btn" data-a="importGo">Jetzt importieren</button><button class="btn ghost" data-a="importCancel">Abbrechen</button></div></div>` : '';
  const wlink = `${location.origin}${location.pathname}?w=1`;
  return `<h2>Interessenten-Warteliste</h2>
    ${can('waitlist_manage') ? `<div class="card"><b>Anmeldelink für Eltern</b><p class="small muted" style="margin:4px 0">Eltern tragen ihr Kind selbst ein, ohne Anmeldung. In Mails als Hyperlink-Text einfügen (Mail-Vorlage „Warteliste: Link zur Anmeldung“).</p><div class="btns"><button class="btn small" data-a="copyText" data-t="${esc(wlink)}">Link kopieren</button><a class="btn small ghost" href="${esc(wlink)}" target="_blank" rel="noopener">Ansehen</a></div></div>` : ''}
    <div class="chips">${chips}</div>
    <input id="wlq" class="search" placeholder="Suchen (Name, Mail, Telefon)" value="${esc(S.wlQuery)}">
    ${prev}<div id="wl-list">${wlList()}</div>
    ${!can('waitlist_manage') ? '' : `<details class="card"><summary>Neuer Interessent</summary><form data-f="newWl">
      <label>Vorname<input name="first_name" required></label><label>Nachname<input name="last_name"></label>
      <label>Geburtsdatum<input name="birthdate" type="date"></label><label>E-Mail<input name="email" type="email"></label>
      <label>Telefon<input name="phone" type="tel"></label><label>Angefragt (Monat)<input name="requested_on" type="month" required></label>
      <label>Notiz<input name="note"></label><button class="btn">Hinzufügen</button></form></details>
    <details class="card"><summary>Aus Excel importieren</summary>
      <p class="small muted">Deine Datei „Warteliste.xlsx“ mit den Blättern Warteliste, Zusagen, Absagen, keine Rückmeldung. Die Datei wird nur im Browser gelesen.</p>
      <input type="file" accept=".xlsx" id="xl"></details>`}`;
}

function viewUsers() {
  const roleOpts = (cur) => S.roles.map((r) => `<option value="${r.id}" ${r.id === cur ? 'selected' : ''}>${esc(r.name)}</option>`).join('');
  const named = S.users.filter((u) => u.email || u.display_name);
  const users = named.map((u) => `<div class="kidrow"><div><b class="break">${esc(u.display_name || u.email)}</b>${u.display_name && u.email ? `<br><span class="small muted">${esc(u.email)}</span>` : ''}${u.id === S.user.id ? ' <span class="badge gray">du</span>' : ''}</div>
    <select data-a="setRole" data-u="${u.id}" ${u.id === S.user.id ? 'disabled' : ''}>${roleOpts(u.role_id)}</select></div>`).join('') || '<p class="muted">Noch niemand.</p>';
  const anon = S.users.length - named.length;
  const inviteRoles = S.roles.filter((r) => !['Admin', 'Eltern'].includes(r.name));
  const last = S.lastInvite ? `<div class="note"><b>Einladung für ${esc(S.lastInvite.label)}</b><p class="small break">${esc(S.lastInvite.link)}</p>
    <div class="btns"><a class="btn" target="_blank" rel="noopener" href="${esc(`https://wa.me/?text=${encodeURIComponent(`Hallo ${S.lastInvite.label}! Hier ist dein Zugang zur Trampolin-App vom TV Hemsbach. Link öffnen und auf „Einladung annehmen“ tippen (7 Tage gültig, nur für dich):\n${S.lastInvite.link}`)}`)}">Per WhatsApp senden</a>
    <button class="btn ghost" data-a="copyText" data-t="${esc(S.lastInvite.link)}">Link kopieren</button></div></div>` : '';
  const open = S.invites.map((i) => `<div class="line">${esc(i.label)} · ${esc(S.roles.find((r) => r.id === i.role_id)?.name || '')} <span class="small muted">bis ${fmtDate(i.expires_at)}</span><button class="x" data-a="delInvite" data-id="${i.id}" title="Zurückziehen">${ic('x')}</button></div>`).join('');
  const roles = S.roles.map((r) => `<details class="card"><summary><b>${esc(r.name)}</b>${r.is_system ? ' <span class="badge gray">fest</span>' : ''}</summary>
    ${Object.entries(PERMS).map(([k, l]) => `<label class="line"><input type="checkbox" data-a="togglePerm" data-id="${r.id}" data-p="${k}" ${r.perms?.[k] ? 'checked' : ''} ${r.is_system ? 'disabled' : ''}> ${esc(l)}</label>`).join('')}
    ${r.is_system ? '' : `<button class="link" data-a="delRole" data-id="${r.id}">Rolle löschen</button>`}</details>`).join('');
  return `<h2>Team einladen</h2><div class="card"><form data-f="newInvite">
    <label>Name<input name="label" placeholder="z. B. Anna (Trainerin)" required></label>
    <label>Rolle<select name="role">${inviteRoles.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select></label>
    <button class="btn">Einladungslink erzeugen</button></form>${last}
    ${open ? `<h3>Offene Einladungen</h3>${open}` : ''}
    <p class="small muted">Der Link gilt 7 Tage und nur für eine Person. Er gibt die gewählte Rolle, deshalb nicht weiterleiten.</p></div>
    <h2>Team & Rollen</h2><div class="card">${users}<p class="small muted">Dazu ${anon} Eltern-Geräte (über den Einladungslink, ohne Mail). Handy verloren? Rolle auf „Eltern“ stellen und neu einladen.</p></div>
    <h2>Rollen und ihre Rechte</h2>${roles}
    <div class="card"><form data-f="newRole"><label>Neue Rolle<input name="name" placeholder="z. B. Übungsleiter" required></label><button class="btn">Rolle anlegen</button></form>
    <p class="small muted">Die festen Rollen (Admin, Trainer, Eltern) lassen sich nicht ändern. Neue Rollen starten ohne Rechte.</p></div>`;
}

const phones = (k) => String(k.phone || '').split(/[;\n]+/).map((x) => x.trim()).filter(Boolean);
const phoneLinks = (k) => phones(k).map((p) => `<a href="tel:${esc(p.replace(/\(.*?\)/g, '').replace(/[^\d+]/g, ''))}">${esc(p)}</a>`).join('<br>') || '–';
const avatar = () => '<span class="avatar"><svg viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="4.3" fill="#fff"/><path d="M3.3 24c0-5.6 4-8.6 8.7-8.6s8.7 3 8.7 8.6z" fill="#fff"/></svg></span>';
function kidTags(k) {
  return `${k.tue ? '<span class="tag tue">Dienstag</span>' : ''}${k.fri ? '<span class="tag fri">Freitag</span>' : ''}${!k.active ? '<span class="tag off">Inaktiv</span>' : ''}`;
}
function viewKids() {
  const mg = can('kids_manage');
  const all = S.allKids;
  const act = all.filter((k) => k.active);
  const f = S.kidFilter;
  const list = all.filter((k) => f === 'all' ? k.active : f === 'off' ? !k.active : k.active && k[f]);
  const chips = [['all', `Alle (${act.length})`], ['tue', `Dienstag (${act.filter((k) => k.tue).length})`], ['fri', `Freitag (${act.filter((k) => k.fri).length})`], ['off', `Inaktiv (${all.length - act.length})`]]
    .map(([k, l]) => `<button class="chip ${f === k ? 'on' : ''}" data-a="kidFilter" data-v="${k}">${l}</button>`).join('');
  const canPhone = mg || can('registrations_view');
  const toggle = canPhone ? `<button class="chip ${S.kidView === 'phones' ? 'on' : ''}" data-a="kidView" data-v="${S.kidView === 'phones' ? 'list' : 'phones'}">Telefonliste</button>` : '';
  if (S.kidView === 'phones' && canPhone) {
    const tbl = list.map((k) => `<tr><td><b>${esc(k.name)}</b> ${kidTags(k)}</td><td>${phoneLinks(k)}</td></tr>`).join('');
    return `<div class="card"><h2>Telefonliste</h2><div class="chips">${chips}${toggle}</div>
      <table class="tbl"><thead><tr><th>Name</th><th>Telefon</th></tr></thead><tbody>${tbl || '<tr><td colspan="2" class="muted">Keine Einträge.</td></tr>'}</tbody></table></div>`;
  }
  const rows = list.map((k) => {
    const g = S.guardCount[k.id] || 0;
    const sub = [mg ? (g ? `<span>${ic('check')} Eltern verknüpft${g > 1 ? ` (${g})` : ''}</span>` : `<span class="warn">${ic('x')} Keine Eltern verknüpft</span>`) : '',
      k.allow_second ? '<span>Zweites Elternteil erlaubt</span>' : '',
      S.activity[k.id] ? `<span>Zuletzt ${S.activity[k.id].n} von ${S.activity[k.id].m} Trainings da</span>` : '',
      !k.tue && !k.fri ? '<span class="warn">Trainingstag fehlt</span>' : ''].filter(Boolean).join(' ');
    const open = mg && S.openKid === k.id;
    return `<div class="mrow"><div class="mmain ${mg ? 'click' : ''}" ${mg ? `data-a="openKid" data-id="${k.id}"` : ''}>${avatar(k.name)}
      <div class="minfo"><div><b>${esc(k.name)}</b> ${kidTags(k)}</div><div class="msub">${sub}</div></div>${mg ? '<span class="chev">›</span>' : ''}</div>
      ${open ? `<div class="mdetail"><div class="btns"><button class="chip ${k.tue ? 'on' : ''}" data-a="kidDay" data-id="${k.id}" data-d="tue">Dienstag</button><button class="chip ${k.fri ? 'on' : ''}" data-a="kidDay" data-id="${k.id}" data-d="fri">Freitag</button></div>
        <p class="small">${k.phone ? `${ic('phone')} ${phoneLinks(k)}` : '<span class="muted">Keine Telefonnummer</span>'}<br>${k.birthdate ? `${ic('cake')} ${fmtDate(k.birthdate)} (${ageOf(k.birthdate)} Jahre)` : '<span class="muted">Kein Geburtstag eingetragen</span>'}</p>
        <div class="btns"><button class="btn small ghost" data-a="kidPhone" data-id="${k.id}">Telefon ändern</button>
        <button class="btn small ghost" data-a="kidBirthday" data-id="${k.id}">Geburtstag</button>
        <button class="btn small ghost" data-a="kidActive" data-id="${k.id}" data-v="${!k.active}">${k.active ? 'Inaktiv setzen' : 'Wieder aktivieren'}</button></div>
        <p class="small">${S.guardEmails[k.id]?.length ? `${ic('mail')} ${S.guardEmails[k.id].map((m) => `<a href="mailto:${esc(m)}">${esc(m)}</a>`).join(', ')}` : '<span class="muted">Keine Eltern-E-Mail</span>'}</p>
        <div class="btns"><button class="btn small ghost" data-a="kidSecond" data-id="${k.id}" data-v="${!k.allow_second}">${k.allow_second ? 'Zweites Elternteil: zurücknehmen' : 'Zweites Elternteil erlauben'}</button>
        ${S.guardCount[k.id] ? `<button class="btn small ghost" data-a="kidRelease" data-id="${k.id}">Verknüpfung freigeben</button>` : ''}</div>
        ${k.allow_second ? '<p class="small warn">Ein weiteres Elternteil kann dieses Kind jetzt einmal über den Einladungslink wählen.</p>' : ''}</div>` : ''}</div>`;
  }).join('') || '<p class="muted">Keine Einträge.</p>';
  const staff = can('users_manage') ? S.users.filter((u) => (u.email || u.display_name) && S.roles.find((r) => r.id === u.role_id)?.name !== 'Eltern') : [];
  const rtag = (n) => `<span class="tag ${n === 'Trainer' ? 'tr' : n === 'Geschäftsstelle' ? 'gs' : 'off'}">${esc(n)}</span>`;
  const team = staff.length ? `<div class="card"><h2>Team</h2>${staff.map((u) => `<div class="mrow"><div class="mmain">${avatar(u.display_name || u.email)}<div class="minfo"><div><b>${esc(u.display_name || u.email)}</b> ${rtag(S.roles.find((r) => r.id === u.role_id)?.name || '')}</div></div></div></div>`).join('')}</div>` : '';
  const link = mg ? `<div class="card"><h2>Einladungslink für Eltern</h2><p class="small break">${esc(`${location.origin}${location.pathname}?c=${S.inviteCode}`)}</p>
    <div class="btns"><a class="btn" target="_blank" rel="noopener" href="${esc(`https://wa.me/?text=${encodeURIComponent(`Hallo! Hier ist die Trampolin-App vom TV Hemsbach. Link öffnen und dein Kind antippen, mehr ist nicht nötig:\n${location.origin}${location.pathname}?c=${S.inviteCode}`)}`)}">Per WhatsApp teilen</a>
    <button class="btn ghost" data-a="copyLink">Link kopieren</button><button class="btn ghost" data-a="rotate">Neuen Code erzeugen</button></div>
    <p class="small muted">Wer den Link hat, sieht die Vornamen der Kinder. Nur in der Gruppe teilen.</p></div>` : '';
  const form = mg ? `<details class="card"><summary>Neues Kind anlegen</summary><form data-f="newKid"><label>Name (z. B. „Mia K.“)<input name="name" required></label><label>Telefon (mehrere mit ; trennen)<input name="phone"></label><label>Geburtstag<input name="birthdate" type="date"></label>
    <label class="line"><input type="checkbox" name="tue"> Dienstag</label><label class="line"><input type="checkbox" name="fri"> Freitag</label><button class="btn">Kind anlegen</button></form></details>` : '';
  return `${link}${team}<div class="card"><h2>Kinder</h2><div class="chips">${chips}${toggle}</div>${rows}</div>${form}`;
}

function viewNews() {
  const form = can('messages_send') ? `<div class="card"><form data-f="newMsg"><label>Titel<input name="title" required></label>
    <label>Text<textarea name="body" rows="3"></textarea></label><button class="btn">Senden</button></form></div>` : '';
  const list = S.messages.map((m) => `<div class="card"><b>${esc(m.title)}</b><br><span class="small muted">${fmt(m.created_at)}</span>
    <p>${esc(m.body).replace(/\n/g, '<br>')}</p>${can('messages_send') ? `<button class="link" data-a="delMsg" data-id="${m.id}">Löschen</button>` : ''}</div>`).join('') || '<p class="muted center">Keine Nachrichten.</p>';
  return form + list;
}

function viewProfile() {
  const kids = S.myKids.map((k) => {
    const mine = S.guardMine?.[k.id] || '';
    return `<form class="kidedit" data-f="myKid"><input type="hidden" name="id" value="${esc(k.id)}">
      <b>${esc(k.name)}</b>
      <label>Telefon (mehrere mit ; trennen)<input name="phone" value="${esc(k.phone || '')}" autocomplete="tel"></label>
      <label>Geburtstag<input name="birth" type="date" value="${esc(k.birthdate || '')}"></label>
      <label>E-Mail <span class="req">*</span><input name="email" type="email" required value="${esc(mine || S.parentEmail || '')}" autocomplete="email"></label>
      <button class="btn small">Speichern</button></form>`;
  }).join('') || '<p class="muted">Noch kein Kind verknüpft.</p>';
  return `<div class="card"><h2>Meine Kinder</h2><p class="small muted">Hier kannst du die Daten pflegen, die die Trainer von deinem Kind haben. Name und Trainingstag ändern die Trainer. Falsches Kind gewählt? Bitte bei den Trainern melden.</p>${kids}
    <button class="btn" data-a="addKid">Kind hinzufügen</button></div>
    <div class="card"><h2>Benachrichtigungen</h2><button class="btn" data-a="push">Auf diesem Gerät aktivieren</button>
    <p class="small muted">iPhone: App zuerst über „Teilen → Zum Home-Bildschirm“ installieren.</p></div>
    <div class="card"><p class="small muted">${S.user.email ? `Angemeldet als ${esc(S.user.email)}` : 'Du bist auf diesem Handy angemeldet.'} · Rolle: ${esc(S.roleName)}<br>${S.user.email ? '' : S.roleName === 'Eltern' ? 'Bei einem neuen Handy: Einladungslink aus der WhatsApp-Gruppe erneut öffnen. Dein Kind muss dann zuerst von den Trainern freigegeben werden.' : 'Bei einem neuen Handy: neue Einladung vom Admin anfordern.'}</p><button class="btn ghost" data-a="logout">Abmelden</button></div>`;
}

/* ---------- Aktionen ---------- */
const MAIL = initMail({ sb, S, esc, toast, can, render: () => render(), askModal, $, inviteText, onNav: () => navCheck() });

const A = {
  ...MAIL.actions,
  async acceptInvite() {
    if (!S.user) {
      const { data, error } = await sb.auth.signInAnonymously();
      if (error) throw new Error('Anmeldung nicht möglich: ' + error.message);
      S.user = data.user;
    }
    const role = ok(await sb.rpc('redeem_staff_invite', { p_token: S.invite }));
    history.replaceState(null, '', location.pathname + (S.code ? `?c=${S.code}` : ''));
    S.invite = null; await afterLogin(); S.tab = 'termine'; render(); toast(`Willkommen im Team (${role})`);
  },
  async delInvite(d) { ok(await sb.from('staff_invites').delete().eq('id', d.id)); await loadAll(); render(); },
  changeParentMail() { S.parentEmail = ''; render(); },
  async pickKid(d) {
    if (!confirm(`„${d.name}“ wählen?\n\nEin Kind kann nur einmal gewählt werden. Falls du dich vertippst, können nur die Trainer das wieder freigeben.`)) return;
    if (!S.user) {
      const { data, error } = await sb.auth.signInAnonymously();
      if (error) throw new Error('Anmeldung nicht möglich: ' + error.message);
      S.user = data.user;
    }
    ok(await sb.rpc('claim_kid', { p_kid: d.id, p_code: S.code, p_email: S.parentEmail }));
    await afterLogin(); S.tab = 'termine'; render(); toast(`${d.name} ist verknüpft`);
  },
  toLogin() { S.login = { step: 'email', email: '', kid: null }; S.view = 'login'; render(); },
  toEmail() { S.login.step = 'email'; render(); },
  backPick() { S.view = 'pick'; render(); },
  tab(d) { S.tab = d.t; render(); },
  async answer(d) {
    const r = ok(await sb.rpc('set_response', { p_session: d.s, p_kid: d.k, p_answer: d.v }));
    toast(r === 'going' ? 'Dabei' : r === 'declined' ? 'Abgesagt' : 'Aktualisiert');
    if (r === 'declined' && !can('registrations_manage')) sb.functions.invoke('notify-absence', { body: { session_id: d.s, kid_id: d.k } }).catch(() => {});
    await refreshSessions();
  },
  async toggle(d) { S.open = S.open === d.s ? null : d.s; if (S.open) await loadDetail(S.open); render(); },
  async attend(d, el) { ok(await sb.rpc('set_attended', { p_session: d.s, p_kid: d.k, p_attended: el.checked })); },
  async setGrp(d) { ok(await sb.from('sessions').update({ grp: d.v }).eq('id', d.s)); toast('Gespeichert'); await refreshSessions(); },
  async guestAttend(d, el) { ok(await sb.rpc('set_guest_attended', { p_guest: d.g, p_attended: el.checked })); toast(el.checked ? 'Als anwesend vermerkt' : 'Vermerk entfernt'); await loadAll(); },
  async trialDone(d, el) { ok(await sb.from('waitlist').update({ trial_done: el.checked }).eq('id', d.id)); await loadAll(); render(); },
  async confirmGuest(d) { ok(await sb.rpc('confirm_guest', { p_guest: d.g })); toast('Schnupperkind eingetragen'); await loadDetail(d.s); await refreshSessions(); },
  async withdrawInvite(d) {
    if (!confirm('Einladung zurücknehmen? Das Kind wird bei allen Schnupperterminen ausgetragen.')) return;
    ok(await sb.from('session_guests').delete().eq('waitlist_id', d.id));
    ok(await sb.from('waitlist').update({ status: 'waiting', trial: false, trial_on: null }).eq('id', d.id));
    toast('Einladung zurückgenommen'); await loadAll(); render();
  },
  async delGuest(d) { ok(await sb.from('session_guests').delete().eq('id', d.g)); await loadDetail(d.s); await refreshSessions(); },
  async cancelSession(d) {
    const cancel = d.v === 'true';
    const ses = S.sessions.find((x) => x.id === d.s);
    let push = false;
    if (cancel) {
      const gst = (S.guests[d.s] || []);
      const warn = gst.length ? `Achtung: Für diesen Termin ${gst.length === 1 ? 'ist 1 Schnupperkind' : `sind ${gst.length} Schnupperkinder`} angemeldet (${gst.map((g) => g.name).join(', ')}). Die Eltern bekommen keine Push-Nachricht, bitte gib ihnen selbst Bescheid. ` : '';
      const choice = await askModal(gst.length ? 'Schnupperkinder angemeldet!' : 'Training absagen?', warn + 'Möchtest du allen Kindern dieses Trainings eine Push-Benachrichtigung schicken?', [['push', 'Absagen und Push senden', 'primary'], ['only', 'Nur absagen', ''], ['', 'Zurück', 'link']]);
      if (!choice) return;
      push = choice === 'push';
    }
    ok(await sb.from('sessions').update({ cancelled: cancel }).eq('id', d.s));
    if (push && ses) {
      const when = `${new Date(ses.starts_at).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' })}, ${tm(ses.starts_at)} Uhr`;
      const title = 'Training abgesagt', body = `Das Training am ${when} fällt aus.`;
      await sb.from('messages').insert({ title, body, author: S.user.id });
      const r = await sb.functions.invoke('send-push', { body: { title, body, session_id: ses.id } });
      toast(r.error ? 'Abgesagt, Push konnte nicht gesendet werden' : `Abgesagt, Push an ${r.data?.sent ?? 0} Geräte gesendet`);
    } else toast(cancel ? 'Training abgesagt' : 'Training wieder aktiv');
    const gl = (S.guests[d.s] || []);
    await refreshSessions();
    if (cancel && ses && gl.length) showCancelNotices(ses, gl);
  },
  async deleteSession(d) { const gst = (S.guests[d.s] || []); if (!confirm(gst.length ? `Achtung: Für diesen Termin ${gst.length === 1 ? 'ist 1 Schnupperkind' : `sind ${gst.length} Schnupperkinder`} angemeldet (${gst.map((g) => g.name).join(', ')}). Termin trotzdem samt Anmeldungen löschen?` : 'Termin samt Anmeldungen löschen?')) return; ok(await sb.from('sessions').delete().eq('id', d.s)); S.open = null; await refreshSessions(); },
  async kidDay(d) {
    const k = S.allKids.find((x) => x.id === d.id);
    ok(await sb.from('kids').update({ [d.d]: !k[d.d] }).eq('id', d.id)); await loadAll(); render();
  },
  dayFilter(d) { S.dayFilter = d.v; render(); },
  kidFilter(d) { S.kidFilter = d.v; render(); },
  kidView(d) { S.kidView = d.v; render(); },
  showPast() { S.showPast = !S.showPast; S.open = null; render(); },
  termView(d) { S.termView = d.v; render(); },
  calMode(d) { S.calMode = d.v; render(); },
  calDay(d) { S.calDay = d.k; S.open = null; render(); },
  calNav(d) {
    const n = +d.d;
    if (S.calMode === 'month') { const x = new Date(S.calMonth.y, S.calMonth.m + n, 1); S.calMonth = { y: x.getFullYear(), m: x.getMonth() }; }
    else S.calWeek = new Date(S.calWeek.getFullYear(), S.calWeek.getMonth(), S.calWeek.getDate() + 7 * n);
    render();
  },
  async kidBirthday(d) {
    const k = S.allKids.find((x) => x.id === d.id);
    const cur = k?.birthdate ? new Date(k.birthdate).toLocaleDateString('de-DE') : '';
    const v = prompt('Geburtstag (TT.MM.JJJJ)', cur); if (v === null) return;
    const m = v.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (v.trim() && !m) throw new Error('Bitte so eingeben: 24.03.2015');
    ok(await sb.from('kids').update({ birthdate: m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null }).eq('id', d.id));
    await loadAll(); render();
  },
  openKid(d) { S.openKid = S.openKid === d.id ? null : d.id; render(); },
  async kidActive(d) { ok(await sb.from('kids').update({ active: d.v === 'true' }).eq('id', d.id)); await loadAll(); render(); },
  async kidPhone(d) {
    const k = S.allKids.find((x) => x.id === d.id);
    const v = prompt('Telefonnummern (mehrere mit ; trennen, z. B. 0176 123 (Mama); 0151 456 (Papa))', k?.phone || ''); if (v === null) return;
    ok(await sb.from('kids').update({ phone: v.trim() || null }).eq('id', d.id)); await loadAll(); render();
  },
  async kidSecond(d) {
    ok(await sb.from('kids').update({ allow_second: d.v === 'true' }).eq('id', d.id)); await loadAll(); render();
    toast(d.v === 'true' ? 'Zweites Elternteil kann das Kind jetzt wählen' : 'Zurückgenommen');
  },
  async kidRelease(d) {
    const k = S.allKids.find((x) => x.id === d.id);
    if (!confirm(`Alle Eltern-Verknüpfungen von „${k?.name}“ lösen?\n\nDas Kind kann danach wieder über den Einladungslink gewählt werden. Die bisherigen Eltern sehen es nicht mehr, bis sie es erneut wählen.`)) return;
    ok(await sb.from('guardians').delete().eq('kid_id', d.id)); await loadAll(); render(); toast('Verknüpfung freigegeben');
  },
  async copyText(d) { await navigator.clipboard.writeText(d.t); toast('Link kopiert'); },
  async copyLink() { await navigator.clipboard.writeText(`${location.origin}${location.pathname}?c=${S.inviteCode}`); toast('Link kopiert'); },
  async rotate() {
    if (!confirm('Alter Link wird ungültig. Fortfahren?')) return;
    S.inviteCode = ok(await sb.rpc('rotate_invite_code')); render(); toast('Neuer Code erzeugt');
  },
  async delMsg(d) { ok(await sb.from('messages').delete().eq('id', d.id)); await loadAll(); render(); },
  async addKid() {
    if (!S.code) return toast('Bitte den Einladungslink aus der Gruppe erneut öffnen.');
    await loadOverview();
    const mine = new Set(S.myKids.map((k) => k.id));
    S.overview = S.overview.filter((k) => !mine.has(k.id));
    S.view = 'pick'; render();
  },
  async logout() {
    if (!S.user.email && !confirm('Wirklich abmelden? Danach brauchst du den Einladungslink erneut' + (S.roleName === 'Eltern' ? '.' : ' (neue Einladung vom Admin).'))) return;
    await sb.auth.signOut(); location.reload();
  },
  async push() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return toast('Dieses Gerät unterstützt keine Push-Nachrichten.');
    if (!VAPID_PUBLIC_KEY) return toast('Push ist noch nicht eingerichtet.');
    if ((await Notification.requestPermission()) !== 'granted') return toast('Nicht erlaubt');
    const reg = await navigator.serviceWorker.ready;
    const key = Uint8Array.from(atob(VAPID_PUBLIC_KEY.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    const j = sub.toJSON();
    ok(await sb.from('push_subscriptions').upsert({ user_id: S.user.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }, { onConflict: 'endpoint' }));
    toast('Benachrichtigungen aktiv');
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
  wlOpen(d) { S.wlOpen = S.wlOpen === d.id ? null : d.id; render(); },
  async wlStatus(d, el) {
    const w = S.waitlist.find((x) => x.id === d.id);
    if (el.value === 'invited' && w?.status !== 'invited') {
      if (!(await inviteFlow(w))) { render(); return; }
    } else ok(await sb.from('waitlist').update({ status: el.value }).eq('id', d.id));
    await loadAll(); render();
  },

  async mailCompose(d) {
    let w = S.waitlist.find((x) => x.id === d.id); if (!w?.email) return;
    if (d.k === 'trial' && !(S.wlInv?.[w.id]?.length)) {
      // Schnupper-Mail nur mit festgelegten Terminen: erst Termine wählen, dabei wird der Status auf "Eingeladen" gesetzt
      if (!(await inviteFlow(w))) return;
      await loadAll(); w = S.waitlist.find((x) => x.id === d.id);
    }
    const subject = d.k === 'cancel' ? 'Schnuppertraining abgesagt Trampolin TV Hemsbach' : d.k === 'trial' ? 'Schnuppertraining Trampolin TV Hemsbach' : 'Trainingsplatz Trampolin TV Hemsbach';
    const bodyText = d.k === 'cancel' ? cancelText(d.ses) : inviteText(w, d.k);
    const el = document.createElement('div'); el.className = 'modal';
    el.innerHTML = `<div class="box left"><h2>Mail an ${esc(w.email)}</h2><label>Betreff<input id="mc-s" value="${esc(subject)}"></label>
      <label>Text<textarea id="mc-b" rows="12">${esc(bodyText)}</textarea></label>
      <button class="btn big" data-ok>Jetzt senden</button><button class="link" data-no>Abbrechen</button></div>`;
    el.addEventListener('click', async (e) => {
      if (e.target.closest('[data-no]') || e.target === el) return el.remove();
      if (!e.target.closest('[data-ok]')) return;
      const btn = el.querySelector('[data-ok]'); btn.disabled = true; btn.textContent = 'Sende…';
      const r = await sb.functions.invoke('mail', { body: { op: 'send', waitlist_id: w.id, to: [w.email], subject: el.querySelector('#mc-s').value, text: el.querySelector('#mc-b').value } });
      let msg = r.error ? 'Senden fehlgeschlagen' : (r.data?.error || '');
      if (r.error) { try { msg = (await r.error.context.json()).error || msg; } catch { /* ignore */ } }
      if (msg) { btn.disabled = false; btn.textContent = 'Jetzt senden'; return toast(msg); }
      el.remove(); toast('Mail gesendet'); await loadAll(); render();
    });
    document.body.appendChild(el);
  },
  async wlNote(d, el) {
    const v = el.value.trim() || null;
    ok(await sb.from('waitlist').update({ note: v }).eq('id', d.id));
    const w = S.waitlist.find((x) => x.id === d.id); if (w) w.note = v;
    toast('Notiz gespeichert');
  },

  async wlAccept(d) {
    const w = S.waitlist.find((x) => x.id === d.id);
    const name = `${w.first_name}${w.last_name ? ' ' + w.last_name.trim()[0] + '.' : ''}`;
    if (!confirm(`„${name}“ als Teilnehmer anlegen?`)) return;
    ok(await sb.from('kids').insert({ name, phone: w.phone, birthdate: w.birthdate, tue: !!w.tue, fri: !!w.fri }));
    ok(await sb.from('waitlist').update({ status: 'accepted' }).eq('id', d.id));
    await loadAll(); render(); toast('Als Teilnehmer angelegt');
  },
  importCancel() { S.importPreview = null; render(); },
  async importGo() {
    const rows = S.importPreview;
    for (let i = 0; i < rows.length; i += 100) ok(await sb.from('waitlist').insert(rows.slice(i, i + 100).map((r) => ({ ...r, requested_on: parseReq(r.requested) }))));
    S.importPreview = null; await loadAll(); render(); toast(`${rows.length} Einträge importiert`);
  },
};

const F = {
  async parentEmail(f) {
    const e = f.email.trim().toLowerCase();
    if (!/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(e)) throw new Error('Bitte eine gültige E-Mail-Adresse eingeben.');
    S.parentEmail = e; localStorage.setItem('tc_email', e); render();
  },
  async myKid(f) {
    ok(await sb.rpc('update_my_kid', { p_kid: f.id, p_phone: f.phone || '', p_birthdate: f.birth || null, p_email: f.email }));
    await loadAll(); render(); toast('Gespeichert');
  },
  async submitWait(f, form) {
    if (f.website) { S.waitDone = true; return render(); } // Spam-Falle
    const btn = form.querySelector('button.btn'); btn.disabled = true;
    const r = await sb.rpc('submit_waitlist', { p_first: f.first, p_last: f.last || '', p_birth: f.birth, p_phone: f.phone, p_email: f.email, p_day: f.day });
    if (r.error) { btn.disabled = false; throw new Error(r.error.message); }
    S.waitDone = true; render(); window.scrollTo(0, 0);
  },
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
  async newGuest(f) {
    const name = f.name.trim(); if (!name) return;
    const w = (S.waitlist || []).find((x) => [x.first_name, x.last_name].filter(Boolean).join(' ').toLowerCase() === name.toLowerCase());
    ok(await sb.from('session_guests').insert({ session_id: f.s, name, waitlist_id: w?.id || null }));
    if (w && can('waitlist_manage')) {
      const ses = S.sessions.find((x) => x.id === f.s);
      await sb.from('waitlist').update({ trial: true, trial_on: ses ? dkey(ses.starts_at) : null }).eq('id', w.id);
    }
    toast('Schnupperkind eingetragen'); await loadDetail(f.s); await refreshSessions();
  },
  async newSeries(f) {
    if (!f.tue && !f.fri) throw new Error('Bitte Dienstag und/oder Freitag wählen.');
    const have = new Set(S.sessions.map((x) => `${x.grp}|${dkey(x.starts_at)}`));
    const rows = [], end = new Date(f.to + 'T00:00'); let skipped = 0;
    for (let d = new Date(f.from + 'T00:00'); d <= end; d.setDate(d.getDate() + 1)) {
      const grp = d.getDay() === 2 && f.tue ? 'tue' : d.getDay() === 5 && f.fri ? 'fri' : null;
      const ds = dkey(d);
      if (!grp || have.has(`${grp}|${ds}`)) continue;
      if (f.skipXmas && inXmas(ds)) { skipped++; continue; }
      rows.push({ title: 'Training', grp, location: f.location || null,
        starts_at: new Date(`${ds}T${f.start}`).toISOString(), ends_at: new Date(`${ds}T${f.end}`).toISOString() });
    }
    if (!rows.length) throw new Error('Keine neuen Termine im Zeitraum.');
    if (rows.length > 120) throw new Error('Bitte höchstens etwa ein halbes Jahr auf einmal anlegen.');
    ok(await sb.from('sessions').insert(rows));
    S.tab = 'termine'; await refreshSessions(); toast(`${rows.length} Trainings angelegt${skipped ? `, ${skipped} in den Weihnachtsferien ausgelassen` : ''}`);
  },
  async newSession(f) {
    ok(await sb.from('sessions').insert({ title: f.title, grp: f.grp, location: f.location || null, note: f.note || null,
      starts_at: new Date(`${f.date}T${f.start}`).toISOString(), ends_at: new Date(`${f.date}T${f.end}`).toISOString() }));
    S.tab = 'termine'; await refreshSessions(); toast('Termin angelegt');
  },
  async newInvite(f) {
    const token = ok(await sb.rpc('create_staff_invite', { p_role: f.role, p_label: f.label }));
    S.lastInvite = { label: f.label.trim(), link: `${location.origin}${location.pathname}?i=${token}` };
    await loadAll(); render();
  },
  async newRole(f) { ok(await sb.from('roles').insert({ name: f.name.trim(), perms: {} })); await loadAll(); render(); toast('Rolle angelegt – Rechte darunter setzen'); },
  async newKid(f) { ok(await sb.from('kids').insert({ name: f.name.trim(), phone: f.phone || null, birthdate: f.birthdate || null, tue: f.tue === 'on', fri: f.fri === 'on' })); await loadAll(); render(); },
  async newMsg(f) {
    ok(await sb.from('messages').insert({ title: f.title, body: f.body, author: S.user.id }));
    sb.functions.invoke('send-push', { body: { title: f.title, body: f.body } }).catch(() => {});
    await loadAll(); render(); toast('Gesendet');
  },
  async newWl(f) {
    const row = { first_name: f.first_name.trim(), last_name: f.last_name?.trim() || null, birthdate: f.birthdate || null,
      email: f.email || null, phone: f.phone || null, requested: f.requested_on ? new Date(f.requested_on + '-01').toLocaleDateString('de-DE', { month: 'long', year: '2-digit' }).replace(' ', "'") : null, requested_on: f.requested_on ? f.requested_on + '-01' : null, note: f.note || null };
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
  if (el.dataset?.a && (el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.type === 'checkbox')) run(() => A[el.dataset.a](el.dataset, el));
});
app.addEventListener('input', (e) => {
  if (e.target.id === 'mailq') return MAIL.search(e.target.value);
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
