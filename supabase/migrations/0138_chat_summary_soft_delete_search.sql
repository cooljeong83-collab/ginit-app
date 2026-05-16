-- 모임/소셜 요약 스냅샷, 전체 읽음, 소프트 삭제, 본문 검색 (Supabase 채팅 전용).

-- ─── 모임: 내 기준 요약(미읽음 수 + 최근 메시지 메타) ───────────────────────────
create or replace function public.chat_meeting_summary_for_me(p_me text, p_meeting_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := nullif(trim(coalesce(p_me, '')), '');
  v_rid text := nullif(trim(coalesce(p_meeting_id, '')), '');
  v_mid uuid;
  v_canonical text;
  v_lr bigint := 0;
  v_unread int := 0;
  v_lm_id text;
  v_lm_preview text;
  v_lm_sender text;
  v_lm_at timestamptz;
begin
  if v_me is null or v_rid is null then
    return jsonb_build_object('error', 'invalid_args');
  end if;

  v_mid := public._chat_resolve_meeting_uuid(v_rid);
  perform public._chat_assert_meeting_member(v_mid, v_me);
  v_canonical := v_mid::text;

  select coalesce(cr.last_read_seq, 0) into v_lr
  from public.chat_read_pointers cr
  where cr.room_kind = 'meeting' and cr.room_id = v_canonical and lower(trim(cr.reader_app_user_id)) = lower(v_me)
  limit 1;

  select count(*)::int into v_unread
  from public.chat_messages m
  where m.room_kind = 'meeting' and m.room_id = v_canonical and m.deleted_at is null and m.seq > v_lr;

  select
    m.id::text,
    case
      when m.kind = 'image' then coalesce(nullif(trim(m.body_text), ''), '사진')
      when m.kind = 'system' then coalesce(nullif(trim(m.body_text), ''), '')
      else coalesce(nullif(trim(m.body_text), ''), '')
    end,
    m.sender_app_user_id,
    m.created_at
  into v_lm_id, v_lm_preview, v_lm_sender, v_lm_at
  from public.chat_messages m
  where m.room_kind = 'meeting' and m.room_id = v_canonical and m.deleted_at is null
  order by m.seq desc
  limit 1;

  return jsonb_build_object(
    'unread_count', v_unread,
    'last_message_id', v_lm_id,
    'last_message_preview', left(coalesce(v_lm_preview, ''), 500),
    'last_sender_id', v_lm_sender,
    'last_message_at', v_lm_at,
    'updated_at', now(),
    'canonical_room_id', v_canonical
  );
end;
$$;

revoke all on function public.chat_meeting_summary_for_me(text, text) from public;
grant execute on function public.chat_meeting_summary_for_me(text, text) to anon, authenticated;

-- ─── 소셜 DM: 방 스냅샷(참가자 + 내 미읽음 + 최근 메시지) ─────────────────────────
create or replace function public.chat_social_room_snapshot_for_me(p_me text, p_room_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := nullif(trim(coalesce(p_me, '')), '');
  v_rid text := nullif(trim(coalesce(p_room_id, '')), '');
  v_lr bigint := 0;
  v_unread int := 0;
  v_read_msg_id text;
  v_lm_id text;
  v_lm_preview text;
  v_lm_sender text;
  v_lm_at timestamptz;
  v_part text[];
  v_room_updated timestamptz;
  v_room_last timestamptz;
begin
  if v_me is null or v_rid is null then
    return jsonb_build_object('error', 'invalid_args');
  end if;

  perform public._chat_assert_social_member(v_rid, v_me);

  select c.participant_ids, c.updated_at, c.last_message_at
  into v_part, v_room_updated, v_room_last
  from public.chat_rooms c
  where c.id = v_rid and c.is_group = false
  limit 1;

  select coalesce(cr.last_read_seq, 0) into v_lr
  from public.chat_read_pointers cr
  where cr.room_kind = 'social_dm' and cr.room_id = v_rid and lower(trim(cr.reader_app_user_id)) = lower(v_me)
  limit 1;

  select count(*)::int into v_unread
  from public.chat_messages m
  where m.room_kind = 'social_dm' and m.room_id = v_rid and m.deleted_at is null and m.seq > v_lr;

  select m.id::text into v_read_msg_id
  from public.chat_messages m
  where m.room_kind = 'social_dm' and m.room_id = v_rid and m.deleted_at is null and m.seq <= v_lr
  order by m.seq desc
  limit 1;

  select
    m.id::text,
    case
      when m.kind = 'image' then coalesce(nullif(trim(m.body_text), ''), '사진')
      when m.kind = 'system' then coalesce(nullif(trim(m.body_text), ''), '')
      else coalesce(nullif(trim(m.body_text), ''), '')
    end,
    m.sender_app_user_id,
    m.created_at
  into v_lm_id, v_lm_preview, v_lm_sender, v_lm_at
  from public.chat_messages m
  where m.room_kind = 'social_dm' and m.room_id = v_rid and m.deleted_at is null
  order by m.seq desc
  limit 1;

  return jsonb_build_object(
    'participant_ids', coalesce(to_jsonb(v_part), '[]'::jsonb),
    'unread_count', v_unread,
    'read_last_message_id', v_read_msg_id,
    'last_message_id', v_lm_id,
    'last_message_preview', left(coalesce(v_lm_preview, ''), 500),
    'last_sender_id', v_lm_sender,
    'last_message_at', v_lm_at,
    'updated_at', coalesce(v_room_updated, now()),
    'room_last_message_at', v_room_last
  );
end;
$$;

revoke all on function public.chat_social_room_snapshot_for_me(text, text) from public;
grant execute on function public.chat_social_room_snapshot_for_me(text, text) to anon, authenticated;

-- ─── 최신 seq까지 읽음 처리(탭 배지 클리어 등) ───────────────────────────────────
create or replace function public.chat_mark_read_caught_up(
  p_me text,
  p_room_kind text,
  p_room_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text := lower(trim(coalesce(p_room_kind, '')));
  v_rid text := nullif(trim(coalesce(p_room_id, '')), '');
  v_me text := nullif(trim(coalesce(p_me, '')), '');
  v_mid uuid;
  v_canonical text;
  v_max bigint := 0;
begin
  if v_me is null or v_rid is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_args');
  end if;
  if v_kind not in ('meeting', 'social_dm') then
    return jsonb_build_object('ok', false, 'error', 'invalid_room_kind');
  end if;

  if v_kind = 'meeting' then
    v_mid := public._chat_resolve_meeting_uuid(v_rid);
    perform public._chat_assert_meeting_member(v_mid, v_me);
    v_canonical := v_mid::text;
  else
    perform public._chat_assert_social_member(v_rid, v_me);
    v_canonical := v_rid;
  end if;

  select coalesce(max(m.seq), 0) into v_max
  from public.chat_messages m
  where m.room_kind = v_kind and m.room_id = v_canonical and m.deleted_at is null;

  insert into public.chat_read_pointers (room_kind, room_id, reader_app_user_id, last_read_seq, updated_at)
  values (v_kind, v_canonical, v_me, v_max, now())
  on conflict (room_kind, room_id, reader_app_user_id)
  do update set
    last_read_seq = greatest(public.chat_read_pointers.last_read_seq, excluded.last_read_seq),
    updated_at = now();

  return jsonb_build_object('ok', true, 'last_read_seq', v_max);
end;
$$;

revoke all on function public.chat_mark_read_caught_up(text, text, text) from public;
grant execute on function public.chat_mark_read_caught_up(text, text, text) to anon, authenticated;

-- ─── 메시지 소프트 삭제(본인 전송분만) ───────────────────────────────────────────
create or replace function public.chat_soft_delete_message(
  p_me text,
  p_room_kind text,
  p_room_id text,
  p_message_id uuid,
  p_mode text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text := lower(trim(coalesce(p_room_kind, '')));
  v_rid text := nullif(trim(coalesce(p_room_id, '')), '');
  v_me text := nullif(trim(coalesce(p_me, '')), '');
  v_mid uuid;
  v_canonical text;
  v_mode text := lower(trim(coalesce(p_mode, 'text')));
  v_body text;
begin
  if v_me is null or v_rid is null or p_message_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_args');
  end if;
  if v_kind not in ('meeting', 'social_dm') then
    return jsonb_build_object('ok', false, 'error', 'invalid_room_kind');
  end if;

  if v_kind = 'meeting' then
    v_mid := public._chat_resolve_meeting_uuid(v_rid);
    perform public._chat_assert_meeting_member(v_mid, v_me);
    v_canonical := v_mid::text;
  else
    perform public._chat_assert_social_member(v_rid, v_me);
    v_canonical := v_rid;
  end if;

  if v_mode = 'image' then
    v_body := '사진이 삭제되었습니다.';
  else
    v_body := '메시지가 삭제되었습니다.';
  end if;

  update public.chat_messages m
  set
    kind = 'system',
    body_text = v_body,
    image_url = null,
    image_album_batch_id = null,
    reply_to = null,
    link_preview = null,
    deleted_at = coalesce(m.deleted_at, now()),
    updated_at = now()
  where m.id = p_message_id
    and m.room_kind = v_kind
    and m.room_id = v_canonical
    and lower(trim(m.sender_app_user_id)) = lower(v_me);

  if not FOUND then
    return jsonb_build_object('ok', false, 'error', 'not_found_or_forbidden');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.chat_soft_delete_message(text, text, text, uuid, text) from public;
grant execute on function public.chat_soft_delete_message(text, text, text, uuid, text) to anon, authenticated;

-- ─── 본문 검색(최근 seq부터 스캔 상한) ───────────────────────────────────────────
create or replace function public.chat_search_messages_for_me(
  p_me text,
  p_room_kind text,
  p_room_id text,
  p_needle text,
  p_max_scan int default 2500,
  p_match_limit int default 80
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text := lower(trim(coalesce(p_room_kind, '')));
  v_rid text := nullif(trim(coalesce(p_room_id, '')), '');
  v_me text := nullif(trim(coalesce(p_me, '')), '');
  v_mid uuid;
  v_canonical text;
  v_needle text := nullif(trim(coalesce(p_needle, '')), '');
  v_scan int := greatest(50, least(coalesce(p_max_scan, 2500), 8000));
  v_lim int := greatest(1, least(coalesce(p_match_limit, 80), 200));
begin
  if v_me is null or v_rid is null or v_needle is null then
    return jsonb_build_object('rows', '[]'::jsonb, 'error', 'invalid_args');
  end if;
  if v_kind not in ('meeting', 'social_dm') then
    return jsonb_build_object('rows', '[]'::jsonb, 'error', 'invalid_room_kind');
  end if;

  if v_kind = 'meeting' then
    v_mid := public._chat_resolve_meeting_uuid(v_rid);
    perform public._chat_assert_meeting_member(v_mid, v_me);
    v_canonical := v_mid::text;
  else
    perform public._chat_assert_social_member(v_rid, v_me);
    v_canonical := v_rid;
  end if;

  return (
    with scanned as (
      select m.id, m.room_kind, m.room_id, m.seq, m.sender_app_user_id, m.kind, m.body_text, m.image_url,
             m.image_album_batch_id, m.reply_to, m.link_preview, m.client_mutation_id, m.created_at, m.updated_at, m.deleted_at
      from public.chat_messages m
      where m.room_kind = v_kind
        and m.room_id = v_canonical
        and m.deleted_at is null
        and (
          strpos(coalesce(m.body_text, ''), v_needle) > 0
          or strpos(coalesce(m.image_url, ''), v_needle) > 0
        )
      order by m.seq desc
      limit v_scan
    ),
    picked as (
      select * from scanned order by seq asc limit v_lim
    )
    select jsonb_build_object(
      'rows',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', c.id,
              'room_kind', c.room_kind,
              'room_id', c.room_id,
              'seq', c.seq,
              'sender_app_user_id', c.sender_app_user_id,
              'kind', c.kind,
              'body_text', c.body_text,
              'image_url', c.image_url,
              'image_album_batch_id', c.image_album_batch_id,
              'reply_to', c.reply_to,
              'link_preview', c.link_preview,
              'client_mutation_id', c.client_mutation_id,
              'created_at', c.created_at,
              'updated_at', c.updated_at,
              'deleted_at', c.deleted_at
            ) order by c.seq asc
          )
          from picked c
        ),
        '[]'::jsonb
      )
    )
  );
end;
$$;

revoke all on function public.chat_search_messages_for_me(text, text, text, text, int, int) from public;
grant execute on function public.chat_search_messages_for_me(text, text, text, text, int, int) to anon, authenticated;

notify pgrst, 'reload schema';
