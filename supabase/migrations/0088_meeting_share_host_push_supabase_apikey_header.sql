-- pg_net → Edge `fcm-push-send` 호출 시 Supabase 게이트웨이는 `apikey` 헤더를 요구하는 경우가 많습니다.
-- (`meeting-created-area-notify` 가 fetch 시 Authorization + apikey 를 모두 보냄.)
-- Vault `meeting_share_host_push_authorization` 값이 `Bearer <JWT>` 이든 `<JWT>` 단독이든
-- Authorization 은 `Bearer <키>` 로, apikey 는 Bearer 없는 키 문자열로 맞춥니다.

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
  v_auth_trim text;
  v_auth_header text;
  v_apikey text;
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

  v_auth_trim := btrim(v_auth);
  v_apikey := btrim(regexp_replace(v_auth_trim, '^Bearer[[:space:]]+', '', 'i'));
  if coalesce(v_apikey, '') = '' then
    v_apikey := v_auth_trim;
  end if;
  v_auth_header := 'Bearer ' || v_apikey;

  if p_event = 'join_requested' then
    v_title := '참가 신청이 왔어요';
    v_body := '「' || v_mt || '」에 ' || v_who || '님이 참가를 신청했습니다. 눌러서 확인해 주세요.';
    v_action := 'participant_join_requested';
  elsif p_event = 'left' then
    v_title := '참여자가 나갔어요';
    v_body := '「' || v_mt || '」에서 ' || v_who || '님이 나갔습니다.';
    v_action := 'participant_left';
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

revoke all on function private.meeting_share_notify_host_web_guest_fcm(text, uuid, text, text, text, text) from public;

notify pgrst, 'reload schema';
