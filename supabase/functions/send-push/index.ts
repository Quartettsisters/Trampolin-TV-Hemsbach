// Edge Function: schickt eine Push-Nachricht an alle angemeldeten Geräte.
// Erlaubt nur Nutzern mit dem Recht "messages_send".
// Secrets: VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT (z. B. mailto:du@example.de)
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

  const { title, body } = await req.json();
  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT')!, Deno.env.get('VAPID_PUBLIC')!, Deno.env.get('VAPID_PRIVATE')!);
  const { data: subs } = await admin.from('push_subscriptions').select('*');
  let sent = 0;
  await Promise.all((subs ?? []).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ title, body }));
      sent++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) await admin.from('push_subscriptions').delete().eq('id', s.id);
    }
  }));
  return new Response(JSON.stringify({ sent }), { headers: { ...cors, 'Content-Type': 'application/json' } });
});
