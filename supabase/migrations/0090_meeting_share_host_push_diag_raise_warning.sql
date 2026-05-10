-- 웹 게스트 참여 FCM이 안 오고 Edge 로그도 없을 때:
-- 1) Vault 미설정·호스트 id 공백이면 http_post 자체가 호출되지 않음 → Edge 로그 없음.
-- 2) pg_net 은 트랜잭션 커밋 후에 HTTP 가 나감.
-- 3) 게이트웨이 401 등으로 Edge 런타임 전에 막히면 Edge 로그 없음.
--
-- 아래 WARNING 은 Supabase Dashboard → Database → Postgres Logs(또는 Logs 필터)에서
-- `meeting_share_host_push` 로 검색하면 확인할 수 있습니다.
--
-- HTTP 결과 행(버전에 따라 컬럼명이 다를 수 있음):
--   select * from net._http_response order by id desc limit 30;

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
set search_path = public, net, vault
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
  v_req_id bigint;
  v_url_host text;
begin
  raise warning
    using message = format(
      'meeting_share_host_push: enter event=%s meeting_tail=%s host_len=%s guest_tail=%s',
      p_event,
      right(p_meeting_id::text, 8),
      char_length(v_host),
      left(coalesce(nullif(trim(p_guest_user_id), ''), ''), 12)
    );

  if v_host = '' then
    raise warning 'meeting_share_host_push: skip reason=empty_host_after_normalize';
    return;
  end if;

  if to_regclass('vault.decrypted_secrets') is null then
    raise warning 'meeting_share_host_push: skip reason=vault_decrypted_secrets_missing';
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
    raise warning
      using message = format(
        'meeting_share_host_push: skip reason=missing_vault_secret url_len=%s auth_len=%s',
        char_length(coalesce(trim(v_url), '')),
        char_length(coalesce(trim(v_auth), ''))
      );
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

  v_url_host := split_part(trim(v_url), '/', 3);

  v_req_id := net.http_post(
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

  raise warning
    using message = format(
      'meeting_share_host_push: net_http_post_queued request_id=%s url_host=%s apikey_len=%s (http runs after commit)',
      v_req_id,
      coalesce(nullif(v_url_host, ''), '(parse_url_failed)'),
      char_length(v_apikey)
    );
end;
$$;

revoke all on function private.meeting_share_notify_host_web_guest_fcm(text, uuid, text, text, text, text) from public;

notify pgrst, 'reload schema';
