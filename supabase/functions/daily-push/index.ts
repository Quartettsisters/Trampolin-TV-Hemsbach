// Edge Function (per pg_cron aufgerufen): um 16 Uhr (Europa/Berlin) Push an die Trainer
// mit der Zahl der gemeldeten Kinder für das heutige Training. Geschützt über x-cron-token.
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: vk } = await admin.from('push_keys').select('*').eq('id', 1).maybeSingle();
  if (!vk || req.headers.get('x-cron-token') !== vk.cron_token) return new Response('Forbidden', { status: 403 });

  const now = new Date();
  const berlin = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).formatToParts(now);
  const p = Object.fromEntries(berlin.map((x) => [x.type, x.value]));
  const url = new URL(req.url);
  if (p.hour !== '16' && url.searchParams.get('force') !== '1') return new Response(JSON.stringify({ skipped: 'nicht 16 Uhr' }));
  const today = `${p.year}-${p.month}-${p.day}`;

  const { data: all } = await admin.from('sessions').select('id, starts_at, grp, cancelled').eq('cancelled', false)
    .gte('starts_at', new Date(now.getTime() - 36 * 3600e3).toISOString()).lte('starts_at', new Date(now.getTime() + 36 * 3600e3).toISOString());
  const todays = (all ?? []).filter((s: any) => new Date(s.starts_at).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' }) === today);
  if (!todays.length) return new Response(JSON.stringify({ sessions: 0 }));

  const { data: cnt } = await admin.rpc('session_counts');
  const { data: profs } = await admin.from('profiles').select('id, roles(perms)');
  const staff = (profs ?? []).filter((x: any) => x.roles?.perms?.registrations_view).map((x: any) => x.id);
  const { data: subs } = await admin.from('push_subscriptions').select('*').in('user_id', staff);
  webpush.setVapidDetails(vk.subject, vk.pub, vk.priv);

  let sent = 0;
  for (const s of todays) {
    const n = (cnt ?? []).find((c: any) => c.session_id === s.id)?.going ?? 0;
    const time = new Date(s.starts_at).toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' });
    const payload = JSON.stringify({ title: 'Training heute', body: `Heute ${time} Uhr: ${n} ${n === 1 ? 'Kind' : 'Kinder'} gemeldet.`, data: { go: 'session', id: s.id } });
    await Promise.all((subs ?? []).map(async (sub: any) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
        sent++;
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) await admin.from('push_subscriptions').delete().eq('id', sub.id);
      }
    }));
  }
  return new Response(JSON.stringify({ sessions: todays.length, sent }));
});
