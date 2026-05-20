-- 신고 사유 코드 → 한글 라벨 (FCM·알림 본문)

create or replace function public.user_report_reason_label_ko(p_code text)
returns text
language sql
immutable
set search_path = public
as $$
  select case lower(trim(coalesce(p_code, '')))
    when 'harassment' then '괴롭힘·욕설'
    when 'spam' then '스팸·광고'
    when 'fake_profile' then '허위 프로필'
    when 'inappropriate' then '부적절한 콘텐츠'
    when 'scam' then '사기·금전 요구'
    when 'other' then '기타'
  else '기타'
  end;
$$;

revoke all on function public.user_report_reason_label_ko(text) from public;
grant execute on function public.user_report_reason_label_ko(text) to authenticated;

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
  v_body := '신고 대상: ' || v_nick || ' · 사유: ' || public.user_report_reason_label_ko(p_reason_code);

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

notify pgrst, 'reload schema';
