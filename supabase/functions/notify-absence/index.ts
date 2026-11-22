// Edge Function: Eltern sagen ein Kind ab -> Push an alle Trainer (Rollen mit "registrations_view").
// Prüft, dass der Aufrufer Elternteil des Kindes ist und die Absage wirklich gespeichert ist.
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const url = Deno.env.get('SUPABASE_URL')!;
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const { session_id, kid_id } = await req.json();
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: g } = await admin.from('guardians').select('kid_id').eq('user_id', user.id).eq('kid_id', kid_id).maybeSingle();
  if (!g) return json({ sent: 0 });
  const { data: reg } = await admin.from('registrations').select('status').eq('session_id', session_id).eq('kid_id', kid_id).maybeSingle();
  if (reg?.status !== 'declined') return json({ sent: 0 });

  const { data: kid } = await admin.from('kids').select('name').eq('id', kid_id).maybeSingle();
  const { data: ses } = await admin.from('sessions').select('starts_at').eq('id', session_id).maybeSingle();
  if (!kid || !ses) return json({ sent: 0 });

  const { data: profs } = await admin.from('profiles').select('id, roles(perms)');
  const staff = (profs ?? []).filter((p: any) => p.roles?.perms?.registrations_view).map((p: any) => p.id);
  if (!staff.length) return json({ sent: 0 });

  const { data: vk } = await admin.from('push_keys').select('*').eq('id', 1).maybeSingle();
  if (!vk) return json({ error: 'Push nicht eingerichtet' }, 500);
  webpush.setVapidDetails(vk.subject, vk.pub, vk.priv);
  const when = new Date(ses.starts_at).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: 'Europe/Berlin' });
  const { data: cnt } = await admin.rpc('session_counts');
  const left = (cnt ?? []).find((c: any) => c.session_id === session_id)?.going;
  const rest = left == null ? '' : left === 1 ? ' Es bleibt 1 Kind.' : ` Es bleiben ${left} Kinder.`;
  const payload = JSON.stringify({ title: 'Absage', body: `${kid.name} hat für ${when} abgesagt.${rest}`, data: { go: 'session', id: session_id } });

  const { data: subs } = await admin.from('push_subscriptions').select('*').in('user_id', staff);
  let sent = 0;
  await Promise.all((subs ?? []).map(async (s: any) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { urgency: 'high', TTL: 3600 });
      sent++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) await admin.from('push_subscriptions').delete().eq('id', s.id);
    }
  }));
  return json({ sent });
});
