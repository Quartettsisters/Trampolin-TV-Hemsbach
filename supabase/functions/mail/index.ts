// Edge Function "mail": spiegelt das Vereinspostfach (IMAP) in die App und sendet Mails (SMTP).
// Aufruf: per Cron (x-cron-token) oder durch angemeldete Nutzer mit Recht "mailbox".
// Secrets: SMTP_PASS (Pflicht), SMTP_USER (Standard trampolin@tv-hemsbach.de).
// ops: sync | flags | move | delete | attachment | send
import { createClient } from 'npm:@supabase/supabase-js@2';
import PostalMime from 'npm:postal-mime@2.4.3';
import nodemailer from 'npm:nodemailer@6.9.16';
import MailComposer from 'npm:nodemailer@6.9.16/lib/mail-composer/index.js';
import webpush from 'npm:web-push@3.6.7';
import { encodeBase64, decodeBase64 } from 'jsr:@std/encoding@1/base64';
import { Imap, parseList, q } from './imap.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-token',
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const HOST = 'secure.emailsrvr.com';
const USER = Deno.env.get('SMTP_USER') ?? 'trampolin@tv-hemsbach.de';
const PASS = Deno.env.get('SMTP_PASS') ?? '';
const KEYS = ['inbox', 'sent', 'archive', 'trash', 'spam'];
const MAX_FULL = 3 * 1024 * 1024; // größere Mails: nur Kopfzeilen
const PER_RUN = 14; // neue Mails pro Aufruf (CPU-Limit der Edge Functions)

type Roles = Record<string, string>;
function folderRoles(list: { name: string; display: string }[]): Roles {
  const f: Roles = { inbox: 'INBOX' };
  for (const x of list) {
    if (x.name === 'INBOX') continue;
    const n = x.display.toLowerCase();
    if (/sent|gesendet/.test(n)) f.sent = x.name;
    else if (/trash|deleted|papierkorb|gelöscht/.test(n)) f.trash = x.name;
    else if (/spam|junk/.test(n)) f.spam = x.name;
    else if (/draft|entw/.test(n)) f.drafts = x.name;
    else if (/archiv/.test(n)) f.archive = x.name;
  }
  return f;
}
async function connect() {
  if (!PASS) throw new Error('SMTP_PASS fehlt');
  const c = await Imap.open(HOST, 993, USER, PASS);
  const roles = folderRoles(parseList((await c.cmd('LIST "" "*"')).items));
  return { c, roles };
}
const ids = (s: string) => [...s.matchAll(/UID (\d+)/g)].map((m) => +m[1]);

const normSubject = (s: string) => (s || '').replace(/^\s*((re|aw|fwd?|wg|antw)(\[\d+\])?\s*:\s*)+/i, '').trim().toLowerCase();
const flat = (a: any[] = []) => a.flatMap((x) => (x.group ? x.group : [x])).filter((x) => x?.address).map((x) => ({ name: x.name || '', address: String(x.address).toLowerCase() }));
function htmlToText(h: string) {
  return h.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function parseMail(raw: Uint8Array, key: string, big: boolean) {
  const em = await PostalMime.parse(raw);
  let html: string | null = em.html || null;
  const atts: any[] = [];
  (em.attachments || []).forEach((a: any, i: number) => {
    const size = a.content?.byteLength ?? 0;
    const cid = a.contentId ? String(a.contentId).replace(/^<|>$/g, '') : '';
    let inline = false;
    if (html && cid && String(a.mimeType).startsWith('image/') && size < 250000) {
      html = html!.split('cid:' + cid).join(`data:${a.mimeType};base64,${encodeBase64(new Uint8Array(a.content))}`);
      inline = true;
    }
    atts.push({ i, name: a.filename || 'Anhang', type: a.mimeType, size, inline });
  });
  if (html && html.length > 600000) html = null;
  let text = em.text || (em.html ? htmlToText(em.html) : '');
  if (text.length > 200000) text = text.slice(0, 200000);
  const from = flat(em.from ? [em.from] : [])[0];
  const to = flat(em.to), cc = flat(em.cc);
  const outbound = key === 'sent';
  const counter = outbound ? (to[0]?.address ?? '') : (from?.address ?? '');
  const subject = em.subject || '';
  return {
    message_id: em.messageId || null, in_reply_to: em.inReplyTo || null,
    from_name: from?.name || '', from_addr: from?.address || '', to_addrs: to, cc_addrs: cc, subject,
    sent_at: em.date ? new Date(em.date).toISOString() : null,
    snippet: text.replace(/\s+/g, ' ').trim().slice(0, 160),
    body_text: big ? 'Diese Mail ist sehr groß und wird hier nur mit Kopfzeilen angezeigt. Den vollständigen Inhalt findest du im Jimdo-Webmail.' : text,
    body_html: html, attachments: atts, big,
    thread_key: (normSubject(subject) || em.messageId || '') + '|' + counter,
  };
}

async function syncFolder(c: Imap, key: string, name: string, admin: any, budget: { left: number }, fresh: any[]) {
  const sel = await c.cmd(`SELECT ${q(name)}`);
  if (!sel.ok) return { key, error: sel.status };
  const uv = +(sel.items.map((i) => i.line.match(/UIDVALIDITY (\d+)/)?.[1]).find(Boolean) ?? 0);
  const exists = +(sel.items.map((i) => i.line.match(/^\* (\d+) EXISTS/)?.[1]).find(Boolean) ?? 0);
  const { data: st } = await admin.from('mail_state').select('uidvalidity').eq('folder', key).maybeSingle();
  if (st && Number(st.uidvalidity) !== uv) await admin.from('mail_messages').delete().eq('folder', key);
  await admin.from('mail_state').upsert({ folder: key, uidvalidity: uv, synced_at: new Date().toISOString() });

  const server = new Map<number, { seen: boolean; flagged: boolean; answered: boolean; size: number }>();
  if (exists > 0) {
    const fl = await c.cmd('UID FETCH 1:* (FLAGS RFC822.SIZE)');
    for (const it of fl.items) {
      const u = it.line.match(/UID (\d+)/)?.[1]; if (!u) continue;
      const f = it.line.match(/FLAGS \(([^)]*)\)/)?.[1] ?? '';
      server.set(+u, { seen: /\\Seen/i.test(f), flagged: /\\Flagged/i.test(f), answered: /\\Answered/i.test(f), size: +(it.line.match(/RFC822\.SIZE (\d+)/)?.[1] ?? 0) });
    }
  }
  const { data: rows } = await admin.from('mail_messages').select('uid, seen, flagged, answered').eq('folder', key).limit(5000);
  const have = new Map<number, any>((rows ?? []).map((r: any) => [Number(r.uid), r]));
  const gone = [...have.keys()].filter((u) => !server.has(u));
  for (let i = 0; i < gone.length; i += 100) await admin.from('mail_messages').delete().eq('folder', key).in('uid', gone.slice(i, i + 100));
  for (const [u, s] of server) {
    const r = have.get(u);
    if (r && (r.seen !== s.seen || r.flagged !== s.flagged || r.answered !== s.answered)) {
      await admin.from('mail_messages').update({ seen: s.seen, flagged: s.flagged, answered: s.answered }).eq('folder', key).eq('uid', u);
    }
  }
  const initial = have.size === 0;
  let todo = [...server.keys()].filter((u) => !have.has(u)).sort((a, b) => b - a);
  if (key === 'trash' || key === 'spam') todo = todo.slice(0, 40);
  const total = todo.length;
  todo = todo.slice(0, Math.max(0, Math.min(budget.left, PER_RUN)));
  budget.left -= todo.length;

  // in Gruppen holen (nach Größe)
  const groups: number[][] = [];
  let cur: number[] = [], sum = 0;
  for (const u of todo) {
    const sz = server.get(u)!.size;
    if (sz > MAX_FULL) { groups.push([u]); continue; }
    if (cur.length && (sum + sz > 4e6 || cur.length >= 6)) { groups.push(cur); cur = []; sum = 0; }
    cur.push(u); sum += sz;
  }
  if (cur.length) groups.push(cur);
  let imported = 0;
  for (const g of groups) {
    const big = g.length === 1 && server.get(g[0])!.size > MAX_FULL;
    const r = await c.cmd(`UID FETCH ${g.join(',')} (UID FLAGS INTERNALDATE ${big ? 'BODY.PEEK[HEADER]' : 'BODY.PEEK[]'})`);
    for (const it of r.items) {
      const u = +(it.line.match(/UID (\d+)/)?.[1] ?? 0); const raw = it.lits[0];
      if (!u || !raw) continue;
      try {
        const m = await parseMail(raw, key, big);
        if (!m.sent_at) { const d = Date.parse(it.line.match(/INTERNALDATE "([^"]+)"/)?.[1] ?? ''); m.sent_at = isNaN(d) ? new Date().toISOString() : new Date(d).toISOString(); }
        const s = server.get(u)!;
        const row = { folder: key, uid: u, ...m, seen: s.seen, flagged: s.flagged, answered: s.answered };
        const { error } = await admin.from('mail_messages').upsert(row, { onConflict: 'folder,uid' });
        if (error) console.error('upsert', error.message); else { imported++; if (!initial && key === 'inbox' && !s.seen && Date.parse(m.sent_at!) > Date.now() - 6 * 3600e3) fresh.push(m); }
      } catch (e) { console.error('parse', u, String(e)); }
    }
  }
  return { key, total: server.size, imported, pending: total - todo.length };
}

async function pushNew(admin: any, fresh: any[], exceptUser: string | null) {
  if (!fresh.length) return;
  const { data: vk } = await admin.from('push_keys').select('*').eq('id', 1).maybeSingle();
  if (!vk) return;
  const { data: profs } = await admin.from('profiles').select('id, roles(perms)');
  const staff = (profs ?? []).filter((p: any) => p.roles?.perms?.mailbox && p.id !== exceptUser).map((p: any) => p.id);
  if (!staff.length) return;
  const { data: subs } = await admin.from('push_subscriptions').select('*').in('user_id', staff);
  webpush.setVapidDetails(vk.subject, vk.pub, vk.priv);
  const one = fresh.length === 1;
  const payload = JSON.stringify({
    title: one ? 'Neue Mail' : `${fresh.length} neue Mails`,
    body: one ? `${fresh[0].from_name || fresh[0].from_addr}: ${fresh[0].subject || '(ohne Betreff)'}` : fresh.slice(0, 3).map((m) => m.from_name || m.from_addr).join(', '),
  });
  await Promise.all((subs ?? []).map(async (s: any) => {
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload); }
    catch (e) { if (e.statusCode === 404 || e.statusCode === 410) await admin.from('push_subscriptions').delete().eq('id', s.id); }
  }));
}

async function opSync(admin: any, userId: string | null) {
  const { c, roles } = await connect();
  try {
    const budget = { left: PER_RUN };
    const fresh: any[] = [];
    const res = [];
    for (const k of KEYS) if (roles[k]) res.push(await syncFolder(c, k, roles[k], admin, budget, fresh));
    await pushNew(admin, fresh, userId);
    const pending = res.reduce((a: number, r: any) => a + (r.pending ?? 0), 0);
    return { ok: true, pending, folders: res };
  } finally { await c.logout(); }
}

async function loadRows(admin: any, idList: string[]) {
  const { data } = await admin.from('mail_messages').select('id, folder, uid').in('id', idList.slice(0, 200));
  return (data ?? []) as { id: string; folder: string; uid: number }[];
}
const byFolder = (rows: { folder: string; uid: number }[]) => {
  const m = new Map<string, number[]>();
  rows.forEach((r) => { m.set(r.folder, [...(m.get(r.folder) ?? []), Number(r.uid)]); });
  return m;
};

async function opFlags(admin: any, b: any) {
  const rows = await loadRows(admin, b.ids ?? []);
  const { c, roles } = await connect();
  try {
    const patch: any = {};
    const add: string[] = [], rem: string[] = [];
    if (typeof b.seen === 'boolean') { (b.seen ? add : rem).push('\\Seen'); patch.seen = b.seen; }
    if (typeof b.flagged === 'boolean') { (b.flagged ? add : rem).push('\\Flagged'); patch.flagged = b.flagged; }
    for (const [k, uids] of byFolder(rows)) {
      if (!roles[k]) continue;
      await c.cmd(`SELECT ${q(roles[k])}`);
      if (add.length) await c.cmd(`UID STORE ${uids.join(',')} +FLAGS.SILENT (${add.join(' ')})`);
      if (rem.length) await c.cmd(`UID STORE ${uids.join(',')} -FLAGS.SILENT (${rem.join(' ')})`);
    }
    if (Object.keys(patch).length) await admin.from('mail_messages').update(patch).in('id', rows.map((r) => r.id));
  } finally { await c.logout(); }
  return { ok: true };
}

async function opMove(admin: any, b: any, permanent = false) {
  const rows = await loadRows(admin, b.ids ?? []);
  const { c, roles } = await connect();
  try {
    let to = b.to as string;
    if (permanent) to = '';
    if (to === 'archive' && !roles.archive) { roles.archive = 'INBOX.Archive'; await c.cmd(`CREATE ${q(roles.archive)}`); await c.cmd(`SUBSCRIBE ${q(roles.archive)}`); }
    for (const [k, uids] of byFolder(rows)) {
      if (!roles[k]) continue;
      await c.cmd(`SELECT ${q(roles[k])}`);
      if (permanent || (k === 'trash' && to === 'trash')) {
        await c.cmd(`UID STORE ${uids.join(',')} +FLAGS.SILENT (\\Deleted)`);
        await c.cmd(`UID EXPUNGE ${uids.join(',')}`);
      } else if (to && roles[to] && roles[to] !== roles[k]) {
        const r = await c.cmd(`UID MOVE ${uids.join(',')} ${q(roles[to])}`);
        if (!r.ok) { await c.cmd(`UID COPY ${uids.join(',')} ${q(roles[to])}`); await c.cmd(`UID STORE ${uids.join(',')} +FLAGS.SILENT (\\Deleted)`); await c.cmd(`UID EXPUNGE ${uids.join(',')}`); }
      }
    }
    await admin.from('mail_messages').delete().in('id', rows.map((r) => r.id));
  } finally { await c.logout(); }
  return { ok: true };
}

async function opAttachment(admin: any, b: any) {
  const [row] = await loadRows(admin, [b.id]);
  if (!row) return { error: 'Mail nicht gefunden' };
  const { c, roles } = await connect();
  try {
    await c.cmd(`SELECT ${q(roles[row.folder])}`);
    const r = await c.cmd(`UID FETCH ${row.uid} (BODY.PEEK[])`);
    const raw = r.items.find((i) => i.lits[0])?.lits[0];
    if (!raw) return { error: 'Mail nicht mehr vorhanden' };
    const em = await PostalMime.parse(raw);
    const a: any = (em.attachments || [])[b.index];
    if (!a) return { error: 'Anhang nicht gefunden' };
    return { name: a.filename || 'Anhang', type: a.mimeType, b64: encodeBase64(new Uint8Array(a.content)) };
  } finally { await c.logout(); }
}

const okAddr = (s: string) => /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(s);
async function opSend(admin: any, b: any, userId: string) {
  let to: string[] = (b.to ?? []).map((x: string) => String(x).trim()).filter(Boolean);
  if (!to.length && b.waitlist_id) {
    const { data: w } = await admin.from('waitlist').select('email').eq('id', b.waitlist_id).maybeSingle();
    if (w?.email) to = [w.email];
  }
  const cc: string[] = (b.cc ?? []).map((x: string) => String(x).trim()).filter(Boolean);
  if (!to.length || [...to, ...cc].some((x) => !okAddr(x)) || to.length + cc.length > 20) return { error: 'Empfänger ungültig' };
  if (!b.subject?.trim() || !b.text?.trim()) return { error: 'Betreff und Text fehlen' };
  const attachments = (b.attachments ?? []).slice(0, 10).map((a: any) => ({ filename: String(a.name), contentType: a.type || undefined, content: decodeBase64(a.b64) }));
  if (attachments.reduce((s: number, a: any) => s + a.content.length, 0) > 8e6) return { error: 'Anhänge sind zu groß (max. 8 MB)' };
  let inReplyTo: string | undefined;
  let orig: any = null;
  if (b.reply_to_id) {
    const { data } = await admin.from('mail_messages').select('id, folder, uid, message_id').eq('id', b.reply_to_id).maybeSingle();
    orig = data; inReplyTo = data?.message_id || undefined;
  }
  const mail: any = { from: `"Trampolin TV Hemsbach" <${USER}>`, to, cc, replyTo: USER, subject: b.subject.trim(), text: b.text, html: typeof b.html === 'string' && b.html ? b.html : undefined, attachments, inReplyTo, references: inReplyTo };
  const raw: Uint8Array = await new MailComposer(mail).compile().build();
  const port = 465;
  const transport = nodemailer.createTransport({ host: HOST, port, secure: true, auth: { user: USER, pass: PASS } });
  try {
    await transport.sendMail({ envelope: { from: USER, to: [...to, ...cc] }, raw });
  } catch (e) { return { error: 'Senden fehlgeschlagen: ' + (e as Error).message }; }
  // Kopie in "Gesendet" und ggf. "Beantwortet"-Markierung
  try {
    const { c, roles } = await connect();
    try {
      if (roles.sent) await c.cmd(`APPEND ${q(roles.sent)} (\\Seen)`, raw);
      if (orig && roles[orig.folder]) { await c.cmd(`SELECT ${q(roles[orig.folder])}`); await c.cmd(`UID STORE ${orig.uid} +FLAGS.SILENT (\\Answered)`); await admin.from('mail_messages').update({ answered: true }).eq('id', orig.id); }
    } finally { await c.logout(); }
  } catch (e) { console.error('append', String(e)); }
  if (b.waitlist_id) await admin.from('mail_log').insert({ waitlist_id: b.waitlist_id, to_addr: to.join(', '), subject: b.subject.trim(), body: b.text, sent_by: userId });
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const url = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let body: any = {};
  try { body = await req.json(); } catch (_) { /* leer */ }
  try {
    const cronTok = req.headers.get('x-cron-token');
    if (cronTok) {
      const { data: vk } = await admin.from('push_keys').select('cron_token').eq('id', 1).maybeSingle();
      if (!vk || cronTok !== vk.cron_token || body.op !== 'sync') return json({ error: 'Forbidden' }, 403);
      return json(await opSync(admin, null));
    }
    const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: 'Nicht angemeldet' }, 401);
    const { data: prof } = await admin.from('profiles').select('roles(perms)').eq('id', user.id).maybeSingle();
    const perms = prof?.roles?.perms ?? {};
    const allowed = body.op === 'send' ? (perms.mailbox || perms.waitlist_manage) : perms.mailbox;
    if (!allowed) return json({ error: 'Keine Berechtigung' }, 403);
    switch (body.op) {
      case 'sync': return json(await opSync(admin, user.id));
      case 'flags': return json(await opFlags(admin, body));
      case 'move': return json(await opMove(admin, body));
      case 'delete': return json(await opMove(admin, body, true));
      case 'attachment': return json(await opAttachment(admin, body));
      case 'send': return json(await opSend(admin, body, user.id));
      default: return json({ error: 'Unbekannte Aktion' }, 400);
    }
  } catch (e) { return json({ error: String((e as Error).message ?? e) }, 500); }
});
