-- pg_net `net.http_post` 시그니처: (url, body, params, headers, timeout)
-- 0083에서 named 인자만으로 호출 시 일부 pg_net 버전에서 body/headers 매핑이 어긋나
-- Edge `fcm-push-send`가 title/toUserIds 없는 본문을 받아 400으로 실패할 수 있음.
-- 위치 인자로 url → JSON body → params → headers 순서를 고정합니다.

create or replace function private.meeting_share_notify_host_web_guest_fcm(
  p_host text,
  p_meeting_id uuid,
  p_meeting_title text,
  p_guest_label text,
  p_event text,
  p_guest_user_id text
)
returns void
language plpgsql
security definer
set search_path = public, net
as $$
declare
  v_host text := public.ginit_normalize_app_user_id(coalesce(p_host, ''));
  v_url text;
  v_auth text;
  v_title text;
  v_body text;
  v_action text;
  v_mt text := coalesce(nullif(trim(p_meeting_title), ''), '모임');
  v_who text := coalesce(nullif(trim(p_guest_label), ''), '게스트');
  v_payload jsonb;
begin
  if v_host = '' then
    return;
  end if;

  if to_regclass('vault.decrypted_secrets') is null then
    raise notice 'meeting_share_host_push skipped: vault.decrypted_secrets not found';
    return;
  end if;

  select ds.decrypted_secret
  into v_url
  from vault.decrypted_secrets ds
  where ds.name = 'meeting_share_host_push_url'
  limit 1;

  select ds.decrypted_secret
  into v_auth
  from vault.decrypted_secrets ds
  where ds.name = 'meeting_share_host_push_authorization'
  limit 1;

  if coalesce(trim(v_url), '') = '' or coalesce(trim(v_auth), '') = '' then
    raise notice 'meeting_share_host_push skipped: set vault secrets meeting_share_host_push_url and meeting_share_host_push_authorization';
    return;
  end if;

  if p_event = 'join_requested' then
    v_title := '참가 신청이 왔어요';
    v_body := '「' || v_mt || '」에 ' || v_who || '님이 참가를 신청했습니다. 눌러서 확인해 주세요.';
    v_action := 'participant_join_requested';
  else
    v_title := '참여자가 들어왔어요';
    v_body := '「' || v_mt || '」에 ' || v_who || '님이 참여했습니다.';
    v_action := 'participant_joined';
  end if;

  v_payload := jsonb_build_object(
    'toUserIds', jsonb_build_array(v_host),
    'title', v_title,
    'body', v_body,
    'data', jsonb_build_object(
      'meetingId', p_meeting_id::text,
      'action', v_action,
      'participantId', p_guest_user_id,
      'url', 'ginitapp://meeting/' || p_meeting_id::text
    )
  );

  perform net.http_post(
    trim(v_url),
    v_payload,
    '{}'::jsonb,
    jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', trim(v_auth)
    )
  );
end;
$$;

revoke all on function private.meeting_share_notify_host_web_guest_fcm(text, uuid, text, text, text, text) from public;
