-- User report submission (additive): RLS lockdown, submit RPC, evidence storage, admin FCM via pg_net

create extension if not exists pg_net;

-- ---------------------------------------------------------------------------
-- user_reports: direct API lockdown (RPC-only access)
-- ---------------------------------------------------------------------------
alter table public.user_reports enable row level security;

revoke all on table public.user_reports from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Storage: user_report_evidence
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'user_report_evidence',
  'user_report_evidence',
  true,
  2097152,
  array['image/jpeg', 'image/jpg']::text[]
)
on conflict (id) do update
set
  public = true,
  file_size_limit = coalesce(excluded.file_size_limit, 2097152),
  allowed_mime_types = coalesce(excluded.allowed_mime_types, array['image/jpeg', 'image/jpg']::text[]);

drop policy if exists user_report_evidence_select_public on storage.objects;
create policy user_report_evidence_select_public
on storage.objects for select
using (bucket_id = 'user_report_evidence');

drop policy if exists user_report_evidence_insert_open on storage.objects;
create policy user_report_evidence_insert_open
on storage.objects for insert
to anon, authenticated
with check (bucket_id = 'user_report_evidence');

drop policy if exists user_report_evidence_delete_open on storage.objects;
create policy user_report_evidence_delete_open
on storage.objects for delete
to anon, authenticated
using (bucket_id = 'user_report_evidence');

-- ---------------------------------------------------------------------------
-- Admin FCM notify (pg_net → admin-fcm-notify Edge)
-- ---------------------------------------------------------------------------
create or replace function private.notify_admins_user_report_submitted(
  p_report_id uuid,
  p_reported_app_user_id text,
  p_reason_code text
)
returns void
language plpgsql
security definer
set search_path = public, net, vault
as $$
declare
  v_url text;
  v_auth text;
  v_auth_trim text;
  v_auth_header text;
  v_apikey text;
  v_nick text;
  v_body text;
  v_payload jsonb;
begin
  if p_report_id is null then
    return;
  end if;

  if to_regclass('vault.decrypted_secrets') is null then
    return;
  end if;

  select ds.decrypted_secret into v_url
  from vault.decrypted_secrets ds
  where ds.name = 'admin_fcm_notify_url'
  limit 1;

  select ds.decrypted_secret into v_auth
  from vault.decrypted_secrets ds
  where ds.name = 'admin_fcm_notify_authorization'
  limit 1;

  if coalesce(trim(v_url), '') = '' or coalesce(trim(v_auth), '') = '' then
    return;
  end if;

  select coalesce(nullif(trim(p.nickname), ''), trim(p_reported_app_user_id))
  into v_nick
  from public.profiles p
  where p.app_user_id = trim(p_reported_app_user_id)
  limit 1;

  v_nick := coalesce(v_nick, trim(p_reported_app_user_id));
  v_body := '신고 대상: ' || v_nick || ' · 사유: ' || coalesce(nullif(trim(p_reason_code), ''), 'other');

  v_auth_trim := btrim(v_auth);
  v_apikey := btrim(regexp_replace(v_auth_trim, '^Bearer[[:space:]]+', '', 'i'));
  if coalesce(v_apikey, '') = '' then
    v_apikey := v_auth_trim;
  end if;
  v_auth_header := 'Bearer ' || v_apikey;

  v_payload := jsonb_build_object(
    'title', '새 사용자 신고',
    'body', v_body,
    'priority', 'urgent',
    'reportId', p_report_id::text,
    'path', '/admin/reports/' || p_report_id::text
  );

  perform net.http_post(
    url := trim(v_url),
    body := v_payload,
    params := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', v_auth_header,
      'apikey', v_apikey
    ),
    timeout_milliseconds := 15000
  );
end;
$$;

revoke all on function private.notify_admins_user_report_submitted(uuid, text, text) from public;

-- ---------------------------------------------------------------------------
-- submit_user_report (authenticated users)
-- ---------------------------------------------------------------------------
create or replace function public.submit_user_report(
  p_reported_app_user_id text,
  p_reason_code text,
  p_description text default null,
  p_evidence jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reporter text;
  v_reported text;
  v_reason text;
  v_desc text;
  v_evidence jsonb;
  v_urls jsonb;
  v_url text;
  v_i int;
  v_id uuid;
  v_allowed text[] := array[
    'harassment', 'spam', 'fake_profile', 'inappropriate', 'scam', 'other'
  ];
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select public.ginit_normalize_app_user_id(p.app_user_id)
  into v_reporter
  from public.profiles p
  where p.auth_user_id = auth.uid()
    and coalesce(p.is_withdrawn, false) = false
  limit 1;

  if coalesce(v_reporter, '') = '' then
    raise exception 'profile_not_found';
  end if;

  v_reported := public.ginit_normalize_app_user_id(coalesce(p_reported_app_user_id, ''));
  if v_reported = '' then
    raise exception 'reported_user_required';
  end if;

  if v_reporter = v_reported then
    raise exception 'cannot_report_self';
  end if;

  if lower(v_reported) = 'ginit_ai' then
    raise exception 'cannot_report_system_user';
  end if;

  v_reason := lower(trim(coalesce(p_reason_code, '')));
  if v_reason = '' or not (v_reason = any (v_allowed)) then
    raise exception 'invalid_reason_code';
  end if;

  v_desc := nullif(left(trim(coalesce(p_description, '')), 2000), '');

  v_evidence := null;
  if p_evidence is not null and jsonb_typeof(p_evidence) = 'object' then
    v_urls := p_evidence->'image_urls';
    if v_urls is not null and jsonb_typeof(v_urls) <> 'array' then
      raise exception 'invalid_evidence';
    end if;
    if v_urls is not null then
      if jsonb_array_length(v_urls) > 5 then
        raise exception 'too_many_images';
      end if;
      for v_i in 0 .. (jsonb_array_length(v_urls) - 1) loop
        v_url := trim(both '"' from (v_urls->>v_i));
        if length(v_url) < 12 or length(v_url) > 2048 then
          raise exception 'invalid_image_url';
        end if;
        if lower(left(v_url, 8)) <> 'https://' then
          raise exception 'invalid_image_url';
        end if;
      end loop;
      v_evidence := jsonb_build_object('image_urls', v_urls);
    end if;
  end if;

  if exists (
    select 1
    from public.user_reports ur
    where ur.reporter_app_user_id = v_reporter
      and ur.reported_app_user_id = v_reported
      and ur.status in ('pending', 'reviewing')
  ) then
    raise exception 'duplicate_report';
  end if;

  insert into public.user_reports (
    reporter_app_user_id,
    reported_app_user_id,
    reason_code,
    description,
    evidence,
    status,
    priority
  )
  values (
    v_reporter,
    v_reported,
    v_reason,
    v_desc,
    v_evidence,
    'pending',
    'normal'
  )
  returning id into v_id;

  perform private.notify_admins_user_report_submitted(v_id, v_reported, v_reason);

  return v_id;
end;
$$;

revoke all on function public.submit_user_report(text, text, text, jsonb) from public;
grant execute on function public.submit_user_report(text, text, text, jsonb) to authenticated;

notify pgrst, 'reload schema';
