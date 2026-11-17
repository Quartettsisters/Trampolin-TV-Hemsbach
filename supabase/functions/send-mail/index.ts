// Edge Function: sendet eine Mail an einen Interessenten über das Jimdo-Vereinspostfach (SMTP).
// Erlaubt nur Nutzern mit "waitlist_manage". Empfänger kommt immer aus dem Wartelisten-Eintrag.
// Secrets: SMTP_USER (Mailadresse), SMTP_PASS, optional SMTP_HOST (Standard secure.emailsrvr.com), SMTP_PORT (465)
import { createClient } from 'npm:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6.9.16';

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
  if (!user) return json({ error: 'Nicht angemeldet' }, 401);

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: prof } = await admin.from('profiles').select('roles(perms)').eq('id', user.id).maybeSingle();
  if (!prof?.roles?.perms?.waitlist_manage) return json({ error: 'Keine Berechtigung' }, 403);

  const { waitlist_id, subject, body } = await req.json();
  if (!waitlist_id || !subject?.trim() || !body?.trim()) return json({ error: 'Betreff und Text fehlen' }, 400);
  const { data: w } = await admin.from('waitlist').select('email').eq('id', waitlist_id).maybeSingle();
  if (!w?.email) return json({ error: 'Keine Mailadresse hinterlegt' }, 400);

  const smtpUser = Deno.env.get('SMTP_USER'), smtpPass = Deno.env.get('SMTP_PASS');
  if (!smtpUser || !smtpPass) return json({ error: 'Mailversand noch nicht eingerichtet' }, 500);
  const port = Number(Deno.env.get('SMTP_PORT') ?? 465);
  const transport = nodemailer.createTransport({
    host: Deno.env.get('SMTP_HOST') ?? 'secure.emailsrvr.com', port, secure: port === 465,
    auth: { user: smtpUser, pass: smtpPass },
  });
  try {
    await transport.sendMail({ from: `"Trampolin TV Hemsbach" <${smtpUser}>`, to: w.email, replyTo: smtpUser, subject, text: body });
  } catch (e) {
    return json({ error: 'Senden fehlgeschlagen: ' + (e as Error).message }, 502);
  }
  await admin.from('mail_log').insert({ waitlist_id, to_addr: w.email, subject, body, sent_by: user.id });
  return json({ ok: true });
});
