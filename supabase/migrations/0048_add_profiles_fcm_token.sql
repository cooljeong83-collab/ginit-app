-- Add FCM token column for Android push notifications.
-- Static profile data is stored in Supabase only.

alter table public.profiles
  add column if not exists fcm_token text;

-- PostgREST schema cache refresh
notify pgrst, 'reload schema';

