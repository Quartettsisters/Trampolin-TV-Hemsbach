// Diese Werte stehen in Supabase unter Project Settings → API.
// Der "anon"-Schlüssel ist absichtlich öffentlich; geschützt sind die Daten durch die Zugriffsregeln (RLS) in schema.sql.
// NIEMALS den "service_role"-Schlüssel hier eintragen.
export const SUPABASE_URL = 'https://cslcsigezgxmkqrsryvj.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_yTsYJj_YIHA-yrEUpHLyQw_O2jE-AyA';

// Optional für Push-Nachrichten (öffentlicher VAPID-Schlüssel, siehe README). Leer lassen = kein Push.
export const VAPID_PUBLIC_KEY = 'BJt320vIoRucqEEjcl4-GEPMixDxBp4kN5ht9cuaK-va3P5HM8-SqBrmsmfImNvI2HmeIupMAN_DerQkY-Evf-4';
