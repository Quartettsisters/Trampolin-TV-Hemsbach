-- Trampolin-Training App: Schema, Rollen/Rechte, Zugriffsregeln (RLS) und Termin-Anmeldung
-- Im Supabase SQL-Editor einmal komplett ausführen.

-- ---------- Rollen & Rechte ----------
-- Jede Rolle hat eine Liste von Rechten (true/false). Neue Rollen lassen sich in der App anlegen.
--   sessions_manage       Trainings anlegen, ändern, absagen, löschen
--   registrations_view    sehen, wer bei einem Training zu-/abgesagt hat, Kinderliste inkl. Telefon
--   registrations_manage  Kinder für Trainings ein-/austragen
--   attendance_manage     Anwesenheit abhaken
--   kids_view             nur lesen: welche Kinder angemeldet sind (Name + Dienstag/Freitag, ohne Telefon)
--   kids_manage           Kinder anlegen/bearbeiten, Gruppen setzen, Einladungslink sehen
--   waitlist_view         Interessenten-Warteliste sehen
--   waitlist_manage       Interessenten-Warteliste bearbeiten, importieren
--   messages_send         Nachrichten/Push an alle senden
--   users_manage          Nutzer sehen und ihnen Rollen zuweisen, Rollen bearbeiten
create table public.roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  perms jsonb not null default '{}'::jsonb,
  is_system boolean not null default false
);

insert into public.roles (name, is_system, perms) values
 ('Admin', true, '{"sessions_manage":true,"registrations_view":true,"registrations_manage":true,"attendance_manage":true,"kids_manage":true,"waitlist_view":true,"waitlist_manage":true,"messages_send":true,"users_manage":true}'),
 ('Trainer', true, '{"sessions_manage":true,"registrations_view":true,"registrations_manage":true,"attendance_manage":true,"kids_manage":true,"waitlist_view":true,"waitlist_manage":true,"messages_send":true}'),
 ('Geschäftsstelle', false, '{"kids_view":true}'),
 ('Eltern', true, '{}');

-- ---------- Tabellen ----------
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text,
  role_id uuid not null references public.roles
);

create table public.kids (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,                      -- Notfall-Telefonnummer
  tue boolean not null default false,   -- trainiert dienstags
  fri boolean not null default false,   -- trainiert freitags (beides möglich)
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.guardians (
  user_id uuid not null references auth.users on delete cascade,
  kid_id uuid not null references public.kids on delete cascade,
  primary key (user_id, kid_id)
);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'Trampolin Training',
  grp text not null default 'tue' check (grp in ('tue','fri')),   -- Trainingsgruppe: Dienstag oder Freitag
  starts_at timestamptz not null,
  location text,
  note text,
  cancelled boolean not null default false
);

create table public.registrations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions on delete cascade,
  kid_id uuid not null references public.kids on delete cascade,
  status text not null check (status in ('going','declined')),   -- kein Eintrag = noch keine Antwort
  attended boolean,
  unique (session_id, kid_id)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text,
  author uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null
);

create table public.settings (
  key text primary key,
  value text not null
);
insert into public.settings values ('invite_code', substr(md5(random()::text || clock_timestamp()::text), 1, 10));

-- Interessenten-Warteliste (aus der Excel)
create table public.waitlist (
  id uuid primary key default gen_random_uuid(),
  last_name text,
  first_name text not null,
  birthdate date,
  email text,
  phone text,
  requested text,                 -- "angefragt am" (frei, z. B. "April'24")
  requested_again text,
  contacted_at date,              -- angeschrieben
  tue boolean not null default false,
  fri boolean not null default false,
  trial boolean not null default false,   -- Schnuppern
  trial_on date,
  note text,
  status text not null default 'waiting'
    check (status in ('waiting','invited','accepted','declined','no_reply')),
  created_at timestamptz not null default now()
);

-- ---------- Hilfsfunktionen ----------
create function public.has_perm(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (r.perms ->> p)::boolean
                   from profiles pr join roles r on r.id = pr.role_id
                   where pr.id = auth.uid()), false)
$$;

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, role_id)
  values (new.id, new.email, (select id from roles where name = 'Eltern'))
  on conflict do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Rolle eines Nutzers ändern (nicht die eigene, damit man sich nicht aussperrt)
create function public.set_user_role(p_user uuid, p_role uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_perm('users_manage') then raise exception 'Nicht erlaubt'; end if;
  if p_user = auth.uid() then raise exception 'Die eigene Rolle kann nicht geändert werden'; end if;
  update profiles set role_id = p_role where id = p_user;
end $$;

-- Zu-/Absage. p_answer: 'yes' | 'no' | 'none' (Eintrag entfernen). Jedes angemeldete Kind hat immer einen Platz.
create function public.set_response(p_session uuid, p_kid uuid, p_answer text) returns text
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  if not (has_perm('registrations_manage')
          or exists (select 1 from guardians where user_id = auth.uid() and kid_id = p_kid)) then
    raise exception 'Nicht erlaubt';
  end if;
  if p_answer = 'none' and not has_perm('registrations_manage') then raise exception 'Nicht erlaubt'; end if;
  -- Eltern dürfen nur für Trainings der Gruppe ihres Kindes zu-/absagen
  if not has_perm('registrations_manage') and not exists (
      select 1 from kids k join sessions s on s.id = p_session
      where k.id = p_kid and ((s.grp = 'tue' and k.tue) or (s.grp = 'fri' and k.fri))) then
    raise exception 'Dieses Kind trainiert an diesem Tag nicht';
  end if;

  if p_answer = 'yes' then
    insert into registrations (session_id, kid_id, status) values (p_session, p_kid, 'going')
      on conflict (session_id, kid_id) do update set status = 'going';
    return 'going';
  elsif p_answer = 'no' then
    insert into registrations (session_id, kid_id, status) values (p_session, p_kid, 'declined')
      on conflict (session_id, kid_id) do update set status = 'declined', attended = null;
    return 'declined';
  elsif p_answer = 'none' then
    delete from registrations where session_id = p_session and kid_id = p_kid;
    return 'none';
  end if;
  raise exception 'Unbekannte Antwort';
end $$;

-- Anzahl Zusagen pro Termin (ohne Namen) für alle angemeldeten Nutzer
create function public.session_counts() returns table (session_id uuid, going int)
language sql stable security definer set search_path = public as $$
  select session_id, count(*) filter (where status = 'going')::int
  from registrations group by session_id
$$;

-- Eigene Anmeldungen
create function public.my_registrations() returns table (session_id uuid, kid_id uuid, status text)
language sql stable security definer set search_path = public as $$
  select r.session_id, r.kid_id, r.status
  from registrations r
  join guardians g on g.kid_id = r.kid_id and g.user_id = auth.uid()
$$;

-- Angemeldete Kinder, nur lesen (für die Geschäftsstelle): ohne Telefonnummer
create function public.kids_list() returns table (id uuid, name text, tue boolean, fri boolean, active boolean)
language sql stable security definer set search_path = public as $$
  select k.id, k.name, k.tue, k.fri, k.active from kids k
  where has_perm('kids_view') or has_perm('kids_manage')
  order by k.name
$$;

-- Übersicht für den Einladungslink (ohne Login): nur ID + Name, nur mit gültigem Code
create function public.kids_overview(p_code text) returns table (id uuid, name text)
language sql stable security definer set search_path = public as $$
  select k.id, k.name from kids k
  where k.active and p_code = (select value from settings where key = 'invite_code')
  order by k.name
$$;

-- Kind mit dem eigenen Konto verknüpfen (Code nötig)
create function public.claim_kid(p_kid uuid, p_code text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  if p_code is distinct from (select value from settings where key = 'invite_code') then
    raise exception 'Einladungslink ungültig';
  end if;
  insert into guardians (user_id, kid_id) values (auth.uid(), p_kid) on conflict do nothing;
end $$;

-- Neuen Einladungscode erzeugen
create function public.rotate_invite_code() returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not has_perm('kids_manage') then raise exception 'Nicht erlaubt'; end if;
  c := substr(md5(random()::text || clock_timestamp()::text), 1, 10);
  update settings set value = c where key = 'invite_code';
  return c;
end $$;

-- ---------- Zugriffsregeln (RLS) ----------
alter table public.roles enable row level security;
alter table public.profiles enable row level security;
alter table public.kids enable row level security;
alter table public.guardians enable row level security;
alter table public.sessions enable row level security;
alter table public.registrations enable row level security;
alter table public.messages enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.settings enable row level security;
alter table public.waitlist enable row level security;

create policy roles_read on public.roles for select to authenticated using (true);
create policy roles_write on public.roles for all to authenticated
  using (has_perm('users_manage') and not is_system) with check (has_perm('users_manage') and not is_system);

create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or has_perm('users_manage'));
-- Rollen ändern nur über set_user_role()

create policy kids_read on public.kids for select to authenticated
  using (has_perm('kids_manage') or has_perm('registrations_view')
         or exists (select 1 from guardians g where g.kid_id = kids.id and g.user_id = auth.uid()));
create policy kids_write on public.kids for all to authenticated
  using (has_perm('kids_manage')) with check (has_perm('kids_manage'));

create policy guardians_read on public.guardians for select to authenticated
  using (user_id = auth.uid() or has_perm('kids_manage'));
create policy guardians_delete on public.guardians for delete to authenticated
  using (user_id = auth.uid() or has_perm('kids_manage'));

create policy sessions_read on public.sessions for select to authenticated using (true);
create policy sessions_write on public.sessions for all to authenticated
  using (has_perm('sessions_manage')) with check (has_perm('sessions_manage'));

create policy regs_read on public.registrations for select to authenticated
  using (has_perm('registrations_view')
         or exists (select 1 from guardians g where g.kid_id = registrations.kid_id and g.user_id = auth.uid()));
create policy regs_attend on public.registrations for update to authenticated
  using (has_perm('attendance_manage')) with check (has_perm('attendance_manage'));
-- Anmelden/Abmelden läuft ausschließlich über set_response()

create policy messages_read on public.messages for select to authenticated using (true);
create policy messages_write on public.messages for insert to authenticated with check (has_perm('messages_send'));
create policy messages_delete on public.messages for delete to authenticated using (has_perm('messages_send'));

create policy push_own on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy settings_read on public.settings for select to authenticated using (has_perm('kids_manage'));

create policy waitlist_read on public.waitlist for select to authenticated using (has_perm('waitlist_view'));
create policy waitlist_write on public.waitlist for all to authenticated
  using (has_perm('waitlist_manage')) with check (has_perm('waitlist_manage'));

-- ---------- Rechte auf Funktionen ----------
revoke all on function public.set_response, public.claim_kid,
  public.rotate_invite_code, public.session_counts, public.my_registrations,
  public.kids_overview, public.set_user_role, public.kids_list from public, anon;
revoke all on function public.has_perm, public.handle_new_user from public, anon;
revoke all on function public.handle_new_user from authenticated;
grant execute on function public.has_perm to authenticated;
grant execute on function public.kids_overview(text) to anon, authenticated;
grant execute on function public.set_response, public.claim_kid, public.rotate_invite_code,
  public.session_counts, public.my_registrations, public.set_user_role, public.kids_list to authenticated;

-- ---------- Erster Admin ----------
-- Nach dem ersten Login in der App einmal ausführen (eigene Mailadresse einsetzen).
-- Alle weiteren Rollen vergibst du dann in der App unter „Nutzer“.
--   update public.profiles set role_id = (select id from public.roles where name = 'Admin')
--   where email = 'deine@mail.de';

-- ---------- Trainer-/Geschäftsstellen-Einladung per persönlichem Einmal-Link (ohne Mail) ----------
-- Der Admin erzeugt in der App unter "Nutzer" einen Link (7 Tage gültig, einmal einlösbar). Rolle "Admin" ist per Link nicht vergebbar.
alter table public.profiles add column display_name text;

create table public.staff_invites (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  role_id uuid not null references public.roles on delete cascade,
  label text not null,
  created_by uuid references auth.users on delete set null,
  expires_at timestamptz not null default now() + interval '7 days',
  used_at timestamptz,
  used_by uuid references auth.users on delete set null
);
create index staff_invites_role_idx on public.staff_invites (role_id);
create index staff_invites_created_by_idx on public.staff_invites (created_by);
create index staff_invites_used_by_idx on public.staff_invites (used_by);
alter table public.staff_invites enable row level security;
create policy staff_invites_read on public.staff_invites for select to authenticated using (has_perm('users_manage'));
create policy staff_invites_delete on public.staff_invites for delete to authenticated using (has_perm('users_manage'));

create function public.create_staff_invite(p_role uuid, p_label text) returns text
language plpgsql security definer set search_path = public as $$
declare t text; rname text;
begin
  if not has_perm('users_manage') then raise exception 'Nicht erlaubt'; end if;
  select name into rname from roles where id = p_role;
  if rname is null or rname in ('Admin','Eltern') then raise exception 'Diese Rolle kann nicht per Einladung vergeben werden'; end if;
  if coalesce(trim(p_label), '') = '' then raise exception 'Bitte einen Namen angeben'; end if;
  t := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into staff_invites (token, role_id, label, created_by) values (t, p_role, trim(p_label), auth.uid());
  return t;
end $$;

create function public.redeem_staff_invite(p_token text) returns text
language plpgsql security definer set search_path = public as $$
declare inv staff_invites%rowtype; rname text; cur text;
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  select r.name into cur from profiles p join roles r on r.id = p.role_id where p.id = auth.uid();
  if cur = 'Admin' then raise exception 'Admins können keine Einladung annehmen'; end if;
  select * into inv from staff_invites where token = p_token and used_at is null and expires_at > now() for update;
  if not found then raise exception 'Einladung ungültig, abgelaufen oder schon benutzt'; end if;
  update profiles set role_id = inv.role_id, display_name = inv.label where id = auth.uid();
  update staff_invites set used_at = now(), used_by = auth.uid() where id = inv.id;
  select name into rname from roles where id = inv.role_id;
  return rname;
end $$;

revoke all on function public.create_staff_invite, public.redeem_staff_invite from public, anon;
grant execute on function public.create_staff_invite, public.redeem_staff_invite to authenticated;

-- ---------- Endzeit der Trainings, Geburtstag der Kinder ----------
alter table public.sessions add column ends_at timestamptz;
alter table public.kids add column birthdate date;
