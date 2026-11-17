// Postfach: spiegelt das Vereinspostfach (Jimdo/IMAP) in die App. Lesen, Antworten, Weiterleiten, Archiv, Löschen, Suche.
// Die Verbindung zum Postfach läuft über die Edge Function "mail" (Supabase).
const FOLDERS = [['inbox', 'Posteingang'], ['sent', 'Gesendet'], ['archive', 'Archiv'], ['trash', 'Papierkorb'], ['spam', 'Spam']];
const LIST_COLS = 'id, folder, uid, from_name, from_addr, to_addrs, subject, sent_at, snippet, seen, flagged, answered, attachments, thread_key, claimed_by, done';
const OWN = 'trampolin@tv-hemsbach.de';
export const LINK_TOKEN = '[Zur Warteliste anmelden]';

const P = {
  star: '<path d="M12 4l2.5 5.2 5.7.8-4.1 4 1 5.7L12 17l-5.1 2.7 1-5.7-4.1-4 5.7-.8z"/>',
  archive: '<rect x="3.5" y="4.5" width="17" height="4" rx="1"/><path d="M5 8.5V19h14V8.5M10 12.5h4"/>',
  trash: '<path d="M5 7h14M9 7V4.5h6V7M7 7l1 13h8l1-13M10 11v6M14 11v6"/>',
  reply: '<path d="M10 7L4 12l6 5M4 12h9a7 7 0 017 7"/>',
  replyall: '<path d="M8 7L2.5 12 8 17M13 7l-5.5 5 5.5 5M8 12h6a6 6 0 016 6"/>',
  fwd: '<path d="M14 7l6 5-6 5M20 12h-9a7 7 0 00-7 7"/>',
  refresh: '<path d="M20 5v5h-5M4 19v-5h5M19 10a7.5 7.5 0 00-13-2.5M5 14a7.5 7.5 0 0013 2.5"/>',
  clip: '<path d="M18.5 11.5l-6.8 6.8a4 4 0 01-5.7-5.7l7.4-7.4a2.6 2.6 0 013.7 3.7l-7.4 7.4a1.2 1.2 0 01-1.7-1.7l6.5-6.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  spam: '<path d="M12 4l9 16H3zM12 10v4M12 17v.01"/>',
  inbox: '<path d="M4 13l2.5-7h11L20 13v6H4zM4 13h5l1 2h4l1-2h5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  mailopen: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M4 7l8 6 8-6"/>',
};
const ico = (n) => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${P[n]}</svg>`;

export function initMail(ctx) {
  const { sb, S, esc, toast, can, render, askModal, $, inviteText, onNav } = ctx;
  const M = (S.mail = { folder: 'inbox', msgs: [], loaded: false, q: '', filter: 'all', open: null, thread: [], unread: 0, syncing: false, status: '', imgs: {}, expanded: {}, lastSync: 0, names: {}, me: null });

  /* ---------- Hilfen ---------- */
  async function call(body) {
    const r = await sb.functions.invoke('mail', { body });
    if (r.error) { let m = 'Fehler beim Postfach'; try { m = (await r.error.context.json()).error || m; } catch { /* egal */ } throw new Error(m); }
    if (r.data?.error) throw new Error(r.data.error);
    return r.data;
  }
  const wlFor = (addr) => (S.waitlist || []).find((w) => (w.email || '').trim().toLowerCase() === String(addr || '').toLowerCase());
  const nameOf = (a) => a?.name || a?.address || '';
  const fmtShort = (d) => {
    const x = new Date(d), n = new Date();
    if (x.toDateString() === n.toDateString()) return x.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    if (x.getFullYear() === n.getFullYear()) return x.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });
    return x.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
  };
  const fmtLong = (d) => new Date(d).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const size = (b) => (b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB');
  const linkify = (t) => esc(t).replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
  const sender = (m) => (m.folder === 'sent' ? 'An ' + ((m.to_addrs || []).map(nameOf).join(', ') || '–') : m.from_name || m.from_addr || '–');
  const initial = (s) => (String(s).trim()[0] || '?').toUpperCase();

  /* ---------- Laden ---------- */
  async function loadList() {
    let q = sb.from('mail_messages').select(LIST_COLS).order('sent_at', { ascending: false }).limit(300);
    if (M.q) {
      const t = M.q.replace(/[%,()*]/g, ' ').trim();
      q = q.not('folder', 'in', '(trash,spam)').or(`subject.ilike.%${t}%,from_addr.ilike.%${t}%,from_name.ilike.%${t}%,body_text.ilike.%${t}%`);
    } else q = q.eq('folder', M.folder);
    const { data, error } = await q;
    if (error) throw error;
    M.msgs = data || []; M.loaded = true;
    const ids = [...new Set(M.msgs.map((m) => m.claimed_by).filter(Boolean))].filter((i) => !(i in M.names));
    if (ids.length) { const p = await sb.from('profiles').select('id, display_name, email').in('id', ids); (p.data || []).forEach((x) => { M.names[x.id] = x.display_name || (x.email || '').split('@')[0]; }); ids.forEach((i) => { M.names[i] ||= 'Kollege'; }); }
  }
  async function loadUnread() {
    if (!can('mailbox')) return;
    const r = await sb.from('mail_messages').select('id', { count: 'exact', head: true }).eq('folder', 'inbox').eq('seen', false);
    M.unread = r.count || 0;
    const b = $('#mail-bdg'); if (b) { b.textContent = M.unread; b.hidden = !M.unread; }
  }
  async function loadMe() {
    if (M.me !== null) return;
    const p = await sb.from('profiles').select('display_name').eq('id', S.user.id).maybeSingle();
    M.me = p.data?.display_name || '';
  }
  async function sync(rounds = 30) {
    if (M.syncing) return;
    M.syncing = true; M.status = 'Wird aktualisiert…'; paintBar();
    try {
      for (let i = 0; i < rounds; i++) {
        const r = await call({ op: 'sync' });
        if (r.pending > 0) { M.status = `Postfach wird eingerichtet… noch ${r.pending} Mails`; paintBar(); } else break;
        if (i % 3 === 2) { await loadList(); paint(true); }
      }
      M.status = ''; M.lastSync = Date.now();
    } catch (e) { M.status = 'Aktualisieren fehlgeschlagen: ' + e.message; }
    M.syncing = false; paintBar();
    try { await loadList(); await loadUnread(); if (M.open) await openThread(M.open, true); } catch (e) { console.error(e); }
    paint(true);
  }

  /* ---------- Gruppieren ---------- */
  function threads() {
    const map = new Map();
    for (const m of M.msgs) {
      const t = map.get(m.thread_key);
      if (!t) map.set(m.thread_key, { key: m.thread_key, last: m, count: 1, unread: !m.seen && m.folder === 'inbox', flagged: m.flagged, att: (m.attachments || []).some((a) => !a.inline), claimed: m.claimed_by, done: m.done });
      else { t.count++; t.unread ||= !m.seen && m.folder === 'inbox'; t.flagged ||= m.flagged; t.att ||= (m.attachments || []).some((a) => !a.inline); t.claimed ||= m.claimed_by; }
    }
    let l = [...map.values()];
    if (M.filter === 'unread') l = l.filter((t) => t.unread);
    if (M.filter === 'flagged') l = l.filter((t) => t.flagged);
    if (M.filter === 'open') l = l.filter((t) => !t.done);
    if (M.filter === 'mine') l = l.filter((t) => t.claimed === S.user.id);
    return l;
  }

  /* ---------- Ansichten ---------- */
  function bar() {
    const f = ([k, l]) => `<button class="chip${M.folder === k && !M.q ? ' on' : ''}" data-a="mailFolder" data-f="${k}">${l}${k === 'inbox' && M.unread ? ` <b class="cnt2">${M.unread}</b>` : ''}</button>`;
    const flt = [['all', 'Alle'], ['unread', 'Ungelesen'], ['open', 'Offen'], ['flagged', 'Markiert'], ['mine', 'Meine']];
    return `<div class="mbar"><div class="mtop"><div class="msearch">${ico('search')}<input id="mailq" type="search" placeholder="Suchen" value="${esc(M.q)}" autocomplete="off"></div>
      <button class="btn small" data-a="mailNew">${ico('edit')} Neu</button><button class="x" data-a="mailRefresh" title="Aktualisieren">${ico('refresh')}</button></div>
      <div class="chips">${FOLDERS.map(f).join('')}</div>
      <div class="chips sub">${flt.map(([k, l]) => `<button class="chip small${M.filter === k ? ' on' : ''}" data-a="mailFilter" data-f="${k}">${l}</button>`).join('')}</div>
      <div id="mail-status" class="small muted">${esc(M.status)}</div></div>`;
  }
  function paintBar() { const el = $('#mail-status'); if (el) el.textContent = M.status; }

  function listHtml() {
    if (!M.loaded) return '<p class="muted center">Lädt…</p>';
    const l = threads();
    if (!l.length) return `<p class="muted center">${M.q ? 'Nichts gefunden.' : 'Keine Mails.'}</p>`;
    return `<div class="list">${l.map((t) => {
      const m = t.last, w = wlFor(m.folder === 'sent' ? (m.to_addrs?.[0]?.address) : m.from_addr), nm = sender(m);
      return `<button class="mailrow${t.unread ? ' unread' : ''}" data-a="mailOpen" data-k="${esc(t.key)}">
        <span class="av">${esc(initial(m.folder === 'sent' ? (m.to_addrs?.[0]?.name || m.to_addrs?.[0]?.address || '?') : nm))}</span>
        <span class="mi"><span class="l1"><b class="nm">${esc(nm)}</b>${t.count > 1 ? `<span class="muted"> ${t.count}</span>` : ''}<span class="dt">${t.att ? ico('clip') + ' ' : ''}${esc(fmtShort(m.sent_at))}</span></span>
        <span class="l2">${esc(m.subject || '(ohne Betreff)')}</span>
        <span class="l3">${esc(m.snippet)}</span>
        <span class="l4">${w ? `<span class="badge green">Warteliste</span>` : ''}${t.done ? '<span class="badge">Erledigt</span>' : ''}${t.claimed && !t.done ? `<span class="badge">${esc(t.claimed === S.user.id ? 'Ich' : M.names[t.claimed] || 'Kollege')}</span>` : ''}${m.answered ? '<span class="badge">Beantwortet</span>' : ''}${t.flagged ? `<span class="starred">${ico('star')}</span>` : ''}</span></span></button>`;
    }).join('')}</div>`;
  }

  function bodyHtml(m) {
    if (m.body_html) {
      const remote = /<img[^>]+src=["']?https?:/i.test(m.body_html) || /url\(\s*['"]?https?:/i.test(m.body_html);
      const allow = !!M.imgs[m.id];
      const clean = m.body_html.replace(/<meta[^>]*http-equiv=["']?refresh[^>]*>/gi, '');
      const doc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: ${allow ? 'https: http:' : ''}; style-src 'unsafe-inline'"><base target="_blank"><style>html,body{margin:0}body{font:15px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#111;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}a{color:#0b5a47}</style></head><body>${clean}</body></html>`;
      return `${remote && !allow ? `<div class="note small">Externe Bilder sind blockiert (Datenschutz). <button class="link" data-a="mailImgs" data-id="${m.id}">Bilder laden</button></div>` : ''}<iframe class="mbody" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcdoc="${esc(doc)}"></iframe>`;
    }
    return `<div class="mtext">${linkify(m.body_text)}</div>`;
  }

  function msgCard(m, i, total) {
    const open = M.expanded[m.id] ?? i === total - 1;
    const head = `<div class="mh click" data-a="mailToggle" data-id="${m.id}"><span class="av s">${esc(initial(m.folder === 'sent' ? 'W' : m.from_name || m.from_addr))}</span><span class="mhm"><b>${esc(m.folder === 'sent' ? 'Wir (Trampolin)' : m.from_name || m.from_addr)}</b><span class="muted small">${esc(fmtLong(m.sent_at))}</span></span></div>`;
    if (!open) return `<div class="mcard">${head}<div class="small muted ellip">${esc(m.snippet)}</div></div>`;
    const to = (m.to_addrs || []).map((a) => esc(nameOf(a))).join(', '), cc = (m.cc_addrs || []).map((a) => esc(nameOf(a))).join(', ');
    const atts = (m.attachments || []).filter((a) => !a.inline);
    return `<div class="mcard open">${head}
      <div class="small muted">${m.folder !== 'sent' && m.from_name ? esc(m.from_addr) + '<br>' : ''}An: ${to || '–'}${cc ? '<br>Cc: ' + cc : ''}</div>
      <div class="mcont">${bodyHtml(m)}</div>
      ${atts.length ? `<div class="atts">${atts.map((a) => `<button class="chip" data-a="mailAtt" data-id="${m.id}" data-i="${a.i}">${ico('clip')} ${esc(a.name)} <span class="muted">${size(a.size)}</span></button>`).join('')}</div>` : ''}
      <div class="btns"><button class="btn small" data-a="mailReply" data-id="${m.id}">${ico('reply')} Antworten</button>
        ${(m.to_addrs?.length || 0) + (m.cc_addrs?.length || 0) > 1 ? `<button class="btn small ghost" data-a="mailReplyAll" data-id="${m.id}">${ico('replyall')} Allen</button>` : ''}
        <button class="btn small ghost" data-a="mailFwd" data-id="${m.id}">${ico('fwd')} Weiterleiten</button></div></div>`;
  }

  function threadHtml() {
    const t = M.thread; if (!t.length) return '<p class="muted center">Lädt…</p>';
    const last = t[t.length - 1], first = t[0];
    const inbound = [...t].reverse().find((m) => m.folder !== 'sent') || last;
    const w = wlFor(inbound.from_addr);
    const flagged = t.some((m) => m.flagged), done = t.every((m) => m.done), mine = t.some((m) => m.claimed_by === S.user.id);
    const other = t.find((m) => m.claimed_by && m.claimed_by !== S.user.id);
    const inTrash = last.folder === 'trash';
    return `<div class="mthread"><button class="link" data-a="mailBack">${ico('back')} Zurück</button>
      <h2 class="msub2">${esc(first.subject || '(ohne Betreff)')}</h2>
      <div class="mact">
        <button class="chip" data-a="mailStar">${ico('star')} ${flagged ? 'Markierung entfernen' : 'Markieren'}</button>
        ${last.folder === 'inbox' ? `<button class="chip" data-a="mailMove" data-to="archive">${ico('archive')} Archivieren</button>` : ''}
        ${last.folder === 'archive' || last.folder === 'trash' || last.folder === 'spam' ? `<button class="chip" data-a="mailMove" data-to="inbox">${ico('inbox')} In den Posteingang</button>` : ''}
        ${last.folder === 'inbox' ? `<button class="chip" data-a="mailMove" data-to="spam">${ico('spam')} Spam</button>` : ''}
        <button class="chip" data-a="mailUnread">${ico('mailopen')} Als ungelesen</button>
        <button class="chip danger" data-a="mailTrash">${ico('trash')} ${inTrash ? 'Endgültig löschen' : 'Löschen'}</button></div>
      <div class="mact">
        <button class="chip${mine ? ' on' : ''}" data-a="mailClaim">${mine ? 'Ich kümmere mich (aufheben)' : other ? `Übernehmen (${esc(M.names[other.claimed_by] || 'Kollege')} ist dran)` : 'Ich kümmere mich'}</button>
        <button class="chip${done ? ' on' : ''}" data-a="mailDone">${ico('check')} ${done ? 'Erledigt' : 'Als erledigt markieren'}</button>
        ${w ? `<button class="chip" data-a="mailToWl" data-id="${w.id}">Warteliste: ${esc([w.first_name, w.last_name].filter(Boolean).join(' '))}</button>` : ''}</div>
      ${t.map((m, i) => msgCard(m, i, t.length)).join('')}</div>`;
  }

  function body() { return M.open ? threadHtml() : listHtml(); }
  function view() {
    if (!can('mailbox')) return '<p class="muted center">Kein Zugriff auf das Postfach.</p>';
    if (!M.loaded && !M.loading) { M.loading = true; setTimeout(async () => { try { await loadList(); } catch (e) { toast(e.message); } M.loading = false; paint(); sync(); }, 0); }
    else if (!M.syncing && Date.now() - M.lastSync > 45000) setTimeout(() => sync(8), 0);
    return `<div id="mail-bar">${M.open ? '' : bar()}</div><div id="mail-body">${body()}</div>`;
  }
  function paint(onlyIfChanged = false) {
    const b = $('#mail-body'); if (!b) return;
    const sig = JSON.stringify([M.open, M.folder, M.filter, M.loaded, M.msgs.map((m) => [m.id, m.seen, m.flagged, m.done, m.claimed_by, m.answered]), M.thread.map((m) => [m.id, m.seen, m.flagged, m.done]), M.unread, M.expanded, M.imgs]);
    if (onlyIfChanged && sig === M.sig) return; // nichts Neues: nicht neu zeichnen (sonst springt die Ansicht)
    M.sig = sig;
    const y = window.scrollY, bar0 = $('#mail-bar'), searching = document.activeElement?.id === 'mailq';
    b.innerHTML = body();
    if (!searching) bar0.innerHTML = M.open ? '' : bar();
    window.scrollTo(0, y);
    afterRender();
  }
  function afterRender() {
    document.querySelectorAll('iframe.mbody').forEach((f) => {
      const fit = () => { try { f.style.height = f.contentDocument.documentElement.scrollHeight + 'px'; } catch { /* egal */ } };
      f.addEventListener('load', () => { fit(); try { new ResizeObserver(fit).observe(f.contentDocument.body); } catch { /* egal */ } });
    });
  }

  /* ---------- Konversation öffnen ---------- */
  async function openThread(key, keepScroll) {
    let q = sb.from('mail_messages').select('*').eq('thread_key', key).order('sent_at', { ascending: true });
    q = ['trash', 'spam'].includes(M.folder) && !M.q ? q.eq('folder', M.folder) : q.not('folder', 'in', '(trash,spam)');
    const { data, error } = await q; if (error) throw error;
    if (!M.open) M.listY = window.scrollY;
    M.open = key; M.thread = data || [];
    if (!keepScroll) { M.expanded = {}; window.scrollTo(0, 0); }
    paint();
    if (!keepScroll) onNav?.();
    const unseen = M.thread.filter((m) => !m.seen).map((m) => m.id);
    if (unseen.length) {
      M.thread.forEach((m) => { if (!m.seen) m.seen = true; }); M.msgs.forEach((m) => { if (m.thread_key === key) m.seen = true; });
      M.unread = Math.max(0, M.unread - unseen.length); const b = $('#mail-bdg'); if (b) { b.textContent = M.unread; b.hidden = !M.unread; }
      call({ op: 'flags', ids: unseen, seen: true }).catch((e) => console.error(e));
    }
  }
  const ids = () => M.thread.map((m) => m.id);
  async function afterMove() { M.open = null; M.thread = []; await loadList(); paint(); onNav?.(); sync(1); }

  /* ---------- Schreiben ---------- */
  const signature = () => `Mit sportlichen Grüßen,\n${M.me || 'das Trampolin-Team'}\nTrampolin TV Hemsbach`;
  const quote = (m) => `Am ${fmtLong(m.sent_at)} schrieb ${m.from_name ? m.from_name + ' <' + m.from_addr + '>' : m.from_addr}:\n` + String(m.body_text || '').split('\n').map((l) => '> ' + l).join('\n');
  const reSubject = (s, p) => (new RegExp('^\\s*(' + p + ')\\s*:', 'i').test(s || '') ? s : `${p === 'Re|Aw' ? 'Re' : 'Fwd'}: ${s || ''}`);
  const waLink = () => `${location.origin}${location.pathname}?w=1`;

  async function compose(o = {}) {
    await loadMe();
    const el = document.createElement('div'); el.className = 'modal';
    const emails = [...new Set([...(S.waitlist || []).map((w) => w.email), ...M.msgs.map((m) => m.from_addr)].filter((x) => x && x !== OWN))];
    const w = o.wl || null;
    const tpl = [['wl', 'Warteliste: Link zur Anmeldung'], ...(w ? [['trial', 'Einladung zum Schnuppern'], ['offer', 'Platzangebot']] : [])];
    el.innerHTML = `<div class="box left mbox"><div class="mrow2"><h2>${esc(o.title || 'Neue Mail')}</h2><button class="x" data-no>${'×'}</button></div>
      <label>An<input id="mc-to" list="mail-dl" autocomplete="off" value="${esc(o.to || '')}" placeholder="Adresse (mehrere mit Komma)"></label>
      <div id="mc-ccrow" ${o.cc ? '' : 'hidden'}><label>Cc<input id="mc-cc" value="${esc(o.cc || '')}"></label></div>
      <label>Betreff<input id="mc-s" value="${esc(o.subject || '')}"></label>
      <label>Text<textarea id="mc-b" rows="12">${esc(o.body || '\n\n' + signature())}</textarea></label>
      <div id="mc-files" class="atts"></div>
      <div class="btns"><label class="chip">${ico('clip')} Anhang<input type="file" id="mc-f" multiple hidden></label>
        <button class="chip" data-cc ${o.cc ? 'hidden' : ''}>Cc</button>
        <select id="mc-t"><option value="">Vorlage einfügen…</option>${tpl.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></div>
      <datalist id="mail-dl">${emails.map((e) => `<option value="${esc(e)}">`).join('')}</datalist>
      <button class="btn big" data-ok>Senden</button></div>`;
    const files = [];
    const showFiles = () => { el.querySelector('#mc-files').innerHTML = files.map((f, i) => `<span class="chip">${esc(f.name)} <span class="muted">${size(f.size)}</span> <button class="x" data-rm="${i}">×</button></span>`).join(''); };
    el.addEventListener('change', async (e) => {
      if (e.target.id === 'mc-f') {
        for (const f of e.target.files) {
          if (files.reduce((s, x) => s + x.size, 0) + f.size > 7e6) { toast('Anhänge insgesamt maximal 7 MB'); break; }
          const buf = new Uint8Array(await f.arrayBuffer()); let bin = ''; for (let i = 0; i < buf.length; i += 32768) bin += String.fromCharCode(...buf.subarray(i, i + 32768));
          files.push({ name: f.name, type: f.type, size: f.size, b64: btoa(bin) });
        }
        e.target.value = ''; showFiles();
      }
      if (e.target.id === 'mc-t' && e.target.value) {
        const k = e.target.value; e.target.value = '';
        if (k === 'wl') {
          el.querySelector('#mc-b').value = `Liebe Eltern,\n\nvielen Dank für Ihre Nachricht. Aktuell können wir leider keine neuen Kinder aufnehmen und führen eine Warteliste. Das Training findet dienstags und freitags jeweils von 17:30 bis 20:00 Uhr statt.\n\nÜber diesen Link können Sie Ihr Kind direkt auf die Warteliste setzen:\n${LINK_TOKEN}\n\n${signature()}`;
          if (!el.querySelector('#mc-s').value) el.querySelector('#mc-s').value = 'Warteliste Trampolin TV Hemsbach';
        } else if (w) {
          el.querySelector('#mc-b').value = inviteText(w, k);
          el.querySelector('#mc-s').value = k === 'trial' ? 'Schnuppertraining Trampolin TV Hemsbach' : 'Trainingsplatz Trampolin TV Hemsbach';
        }
      }
    });
    el.addEventListener('click', async (e) => {
      if (e.target.closest('[data-no]') || e.target === el) {
        const b = el.querySelector('#mc-b').value.trim();
        if (b && b !== signature().trim() && !o.body && !confirm('Entwurf verwerfen?')) return;
        return el.remove();
      }
      if (e.target.closest('[data-cc]')) { el.querySelector('#mc-ccrow').hidden = false; e.target.closest('[data-cc]').hidden = true; return; }
      const rm = e.target.closest('[data-rm]'); if (rm) { files.splice(+rm.dataset.rm, 1); showFiles(); return; }
      if (!e.target.closest('[data-ok]')) return;
      const list = (s) => s.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
      const to = list(el.querySelector('#mc-to').value), cc = list(el.querySelector('#mc-cc').value);
      let text = el.querySelector('#mc-b').value, html;
      if (!to.length) return toast('Bitte einen Empfänger angeben');
      if (!el.querySelector('#mc-s').value.trim() || !text.trim()) return toast('Betreff und Text fehlen');
      if (text.includes(LINK_TOKEN)) {
        const url = waLink();
        html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5">${esc(text).split(esc(LINK_TOKEN)).join(`<a href="${esc(url)}">Hier zur Warteliste anmelden</a>`).replace(/\n/g, '<br>')}</div>`;
        text = text.split(LINK_TOKEN).join(url);
      }
      const btn = el.querySelector('[data-ok]'); btn.disabled = true; btn.textContent = 'Sende…';
      try {
        await call({ op: 'send', to, cc, subject: el.querySelector('#mc-s').value, text, html, attachments: files.map(({ name, type, b64 }) => ({ name, type, b64 })), reply_to_id: o.replyId || null, waitlist_id: o.waitlistId || null });
      } catch (err) { btn.disabled = false; btn.textContent = 'Senden'; return toast(err.message); }
      el.remove(); toast('Mail gesendet'); M.lastSync = 0; sync(1);
    });
    document.body.appendChild(el);
    const ta = el.querySelector('#mc-b'); ta.focus(); if (!o.body) ta.setSelectionRange(0, 0);
  }

  /* ---------- Aktionen (data-a) ---------- */
  const find = (id) => M.thread.find((m) => m.id === id);
  const actions = {
    async mailFolder(d) { M.folder = d.f; M.q = ''; M.open = null; M.loaded = false; paint(); await loadList(); paint(); },
    mailFilter(d) { M.filter = d.f; paint(); },
    async mailRefresh() { M.lastSync = 0; await sync(); },
    async mailOpen(d) { await openThread(d.k); },
    mailBack() { if (history.state?.mail) { history.back(); return; } M.open = null; M.thread = []; paint(); window.scrollTo(0, M.listY || 0); onNav?.(); },
    mailToggle(d) { const m = find(d.id); const cur = M.expanded[d.id] ?? M.thread.indexOf(m) === M.thread.length - 1; M.expanded[d.id] = !cur; paint(); },
    mailImgs(d) { M.imgs[d.id] = true; paint(); },
    async mailAtt(d, el) {
      el.disabled = true;
      try {
        const r = await call({ op: 'attachment', id: d.id, index: +d.i });
        const bin = atob(r.b64), buf = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([buf], { type: r.type || 'application/octet-stream' })); a.download = r.name; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 20000);
      } finally { el.disabled = false; }
    },
    mailNew() { return compose({}); },
    mailReply(d) {
      const m = find(d.id); const to = m.folder === 'sent' ? (m.to_addrs || []).map((a) => a.address).join(', ') : m.from_addr;
      return compose({ title: 'Antworten', to, subject: reSubject(m.subject, 'Re|Aw'), body: `\n\n${signature()}\n\n\n${quote(m)}`, replyId: m.id, wl: wlFor(m.from_addr), waitlistId: null });
    },
    mailReplyAll(d) {
      const m = find(d.id); const all = (a) => (a || []).map((x) => x.address).filter((x) => x && x !== OWN);
      const to = [m.from_addr, ...all(m.to_addrs)].filter((x, i, a) => x && a.indexOf(x) === i).join(', ');
      return compose({ title: 'Allen antworten', to, cc: all(m.cc_addrs).join(', '), subject: reSubject(m.subject, 'Re|Aw'), body: `\n\n${signature()}\n\n\n${quote(m)}`, replyId: m.id, wl: wlFor(m.from_addr) });
    },
    mailFwd(d) {
      const m = find(d.id);
      return compose({ title: 'Weiterleiten', subject: reSubject(m.subject, 'Fwd|Wg'), body: `\n\n${signature()}\n\n\n---------- Weitergeleitete Nachricht ----------\nVon: ${m.from_name ? m.from_name + ' <' + m.from_addr + '>' : m.from_addr}\nDatum: ${fmtLong(m.sent_at)}\nBetreff: ${m.subject}\n\n${m.body_text}` });
    },
    async mailStar() {
      const v = !M.thread.some((m) => m.flagged); M.thread.forEach((m) => { m.flagged = v; }); M.msgs.forEach((m) => { if (m.thread_key === M.open) m.flagged = v; }); paint();
      await call({ op: 'flags', ids: ids(), flagged: v });
    },
    async mailUnread() { await call({ op: 'flags', ids: [M.thread[M.thread.length - 1].id], seen: false }); M.open = null; await loadList(); await loadUnread(); paint(); toast('Als ungelesen markiert'); },
    async mailMove(d) {
      const label = { archive: 'Archiviert', inbox: 'In den Posteingang verschoben', spam: 'Als Spam markiert' }[d.to];
      await call({ op: 'move', ids: ids(), to: d.to }); toast(label); await afterMove();
    },
    async mailTrash() {
      const inTrash = M.thread[0]?.folder === 'trash';
      if (inTrash) { if ((await askModal('Endgültig löschen?', 'Die Konversation wird dauerhaft gelöscht und kann nicht wiederhergestellt werden.', [['y', 'Endgültig löschen', 'primary'], ['', 'Abbrechen', 'link']])) !== 'y') return; await call({ op: 'delete', ids: ids() }); }
      else await call({ op: 'move', ids: ids(), to: 'trash' });
      toast(inTrash ? 'Gelöscht' : 'In den Papierkorb verschoben'); await afterMove();
    },
    async mailClaim() {
      const mine = M.thread.some((m) => m.claimed_by === S.user.id), v = mine ? null : S.user.id;
      const r = await sb.from('mail_messages').update({ claimed_by: v }).eq('thread_key', M.open); if (r.error) throw r.error;
      M.thread.forEach((m) => { m.claimed_by = v; }); M.msgs.forEach((m) => { if (m.thread_key === M.open) m.claimed_by = v; }); paint();
    },
    async mailDone() {
      const v = !M.thread.every((m) => m.done);
      const r = await sb.from('mail_messages').update({ done: v }).eq('thread_key', M.open); if (r.error) throw r.error;
      M.thread.forEach((m) => { m.done = v; }); M.msgs.forEach((m) => { if (m.thread_key === M.open) m.done = v; }); paint();
    },
    mailToWl(d) { const w = S.waitlist.find((x) => x.id === d.id); S.tab = 'interessenten'; S.wlFilter = w?.status || 'waiting'; S.wlOpen = d.id; S.wlQuery = ''; render(); },
  };

  let timer;
  let sq;
  return {
    view, afterRender, loadUnread, actions, compose, waLink,
    search(v) { clearTimeout(sq); sq = setTimeout(async () => { M.q = v.trim(); M.open = null; try { await loadList(); } catch (e) { toast(e.message); } const l = $('#mail-body'); if (l) l.innerHTML = listHtml(); }, 300); },
    start() {
      if (timer || !can('mailbox')) return; loadUnread();
      timer = setInterval(() => { if (document.hidden || !can('mailbox')) return; if (S.tab === 'postfach') { if (!M.syncing) sync(3); } else loadUnread(); }, 60000);
    },
  };
}
