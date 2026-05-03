// ─── Supabase credentials ─────────────────────────────────────────────────────
// Supabase ダッシュボード → Settings → API で確認した値に書き換えてください
const SUPABASE_URL      = 'https://hfakewetksvpqrfssmcz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhmYWtld2V0a3N2cHFyZnNzbWN6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3Nzk0ODgsImV4cCI6MjA5MjM1NTQ4OH0.OnhildP_H3N2V5hOTz5YkL0g-j0a-rpbaIkdjo2PuUY';
// ─────────────────────────────────────────────────────────────────────────────

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
