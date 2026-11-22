// Edge Function: schickt eine Push-Nachricht an alle angemeldeten Geräte.
// Erlaubt nur Nutzern mit dem Recht "messages_send".
// VAPID-Schlüssel stehen in der Tabelle push_keys (nur per Service-Rolle lesbar).
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const url = Deno.env.get('SUPABASE_URL')!;
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return new Response('Unauthorized', { status: 401, headers: cors });

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: prof } = await admin.from('profiles').select('roles(perms)').eq('id', user.id).maybeSingle();
  if (!prof?.roles?.perms?.messages_send) return new Response('Forbidden', { status: 403, headers: cors });

  const { title, body, session_id } = await req.json();
  const { data: vk } = await admin.from('push_keys').select('*').eq('id', 1).maybeSingle();
  if (!vk) return new Response('Push nicht eingerichtet', { status: 500, headers: cors });
  webpush.setVapidDetails(vk.subject, vk.pub, vk.priv);
  let q = admin.from('push_subscriptions').select('*');
  if (session_id) {
    // nur Eltern der Kinder, die zu diesem Training gehören
    const { data: ses } = await admin.from('sessions').select('grp').eq('id', session_id).maybeSingle();
    if (!ses) return new Response('Not found', { status: 404, headers: cors });
    let kq = admin.from('kids').select('id').eq('active', true);
    if (ses.grp === 'tue') kq = kq.eq('tue', true);
    else if (ses.grp === 'fri') kq = kq.eq('fri', true);
    else kq = kq.or('tue.eq.true,fri.eq.true');
    const { data: kids } = await kq;
    const { data: gs } = await admin.from('guardians').select('user_id').in('kid_id', (kids ?? []).map((k) => k.id));
    q = q.in('user_id', [...new Set((gs ?? []).map((g) => g.user_id))]);
  }
  const { data: subs } = await q;
  let sent = 0;
  await Promise.all((subs ?? []).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ title, body, data: session_id ? { go: 'session', id: session_id } : null }), { urgency: 'high', TTL: 3600 });
      sent++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) await admin.from('push_subscriptions').delete().eq('id', s.id);
    }
  }));
  return new Response(JSON.stringify({ sent }), { headers: { ...cors, 'Content-Type': 'application/json' } });
});
