# Trampolin Training – Vereins-App (PWA)

Termine mit Zu-/Absage (jedes angemeldete Kind hat einen festen Platz), Anwesenheit, Nachrichten/Push,
Interessenten-Warteliste mit Excel-Import und frei vergebbare Rollen.

**Datenschutz:** GitHub enthält nur den Programmcode. Alle Personendaten liegen in Supabase.
Keine Excel-/CSV-Dateien und keine echten Namen ins Repository legen (`.gitignore` blockt `*.xlsx`/`*.csv`).

## Einrichtung

1. **Supabase-Projekt** anlegen, Region **Frankfurt (EU)**. Im Dashboard den Auftragsverarbeitungsvertrag (DPA) abschließen.
2. **SQL-Editor** → Inhalt von `supabase/schema.sql` einfügen und ausführen.
3. **Authentication → Sign In / Providers → „Allow anonymous sign-ins“ einschalten.** Eltern melden sich damit über den Einladungslink an, ganz ohne Mail.
   Nur für Trainer/Geschäftsstelle (Anmeldung per Mail-Code): **Authentication → Email Templates → Magic Link / OTP** (braucht eigenen SMTP-Versand): im Mailtext `{{ .Token }}` verwenden (der 6-stellige Code), z. B.
   „Dein Anmeldecode: {{ .Token }}“. Die App meldet per Code an, damit es auch in Mail-Apps ohne Browserwechsel klappt.
   Unter Authentication → Providers → Email „Confirm email“ aktiv lassen.
4. `config.js`: `SUPABASE_URL` und `SUPABASE_ANON_KEY` (Project Settings → API) eintragen.
5. Repo auf GitHub, **Settings → Pages → Branch main / root** aktivieren. Die Adresse ist die App-URL.
6. Supabase → Authentication → URL Configuration: die GitHub-Pages-Adresse als Site URL eintragen.
7. App öffnen, mit der eigenen Mail anmelden, dann im SQL-Editor dich zum Admin machen:
   ```sql
   update public.profiles set role_id = (select id from public.roles where name = 'Admin')
   where email = 'deine@mail.de';
   ```
   Danach alles Weitere in der App: Tab **Nutzer** (Rollen zuweisen, eigene Rollen mit Rechten anlegen).
8. Tab **Kinder**: Kinder anlegen, **Einladungslink** kopieren und in der Elterngruppe teilen.
9. Tab **Warteliste** → „Aus Excel importieren“.

## Trainer & Geschäftsstelle einladen
Admin: Tab **Nutzer → Team einladen**: Name + Rolle wählen, Link per WhatsApp senden. Der Link gilt 7 Tage, ist nur einmal einlösbar und gibt die gewählte Rolle (nie Admin). Mail ist nicht nötig; nur der Admin meldet sich per Mail-Code an.

## Rollen
Rechte: Trainings verwalten · sehen wer kommt · Kinder ein-/austragen · Anwesenheit · Kinder verwalten · Warteliste sehen/bearbeiten ·
Nachrichten senden · Nutzer & Rollen. Mitgeliefert: **Admin**, **Trainer**, **Geschäftsstelle** (sieht nur, welche Kinder angemeldet sind, ohne Telefonnummern), **Eltern**.
Neue Nutzer starten immer als **Eltern**.

## Dienstag / Freitag
Jedes Kind hat die Markierungen **Di** und/oder **Fr** (beides möglich). Jedes Training gehört zu einer Gruppe. Eltern sehen und beantworten nur die Trainings der Tage ihrer Kinder.

## Push-Nachrichten (optional)
```
npx web-push generate-vapid-keys
supabase secrets set VAPID_PUBLIC=... VAPID_PRIVATE=... VAPID_SUBJECT=mailto:du@example.de
supabase functions deploy send-push
```
Den öffentlichen Schlüssel in `config.js` bei `VAPID_PUBLIC_KEY` eintragen.
iPhones: App erst über „Teilen → Zum Home-Bildschirm“ installieren, dann Push im Profil aktivieren.

## Noch offen
- Jimdo-Postfach (Posteingang/Versand) – braucht IMAP/SMTP-Zugangsdaten und eine Edge Function.
- PNG-Icons für ältere iPhones.
