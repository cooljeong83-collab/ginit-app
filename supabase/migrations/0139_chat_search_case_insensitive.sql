-- 모임/소셜 채팅 검색: Firestore 경로와 동일하게 부분 문자열 비교를 대소문자 무시로 맞춤.

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
          strpos(lower(coalesce(m.body_text, '')), lower(v_needle)) > 0
          or strpos(lower(coalesce(m.image_url, '')), lower(v_needle)) > 0
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
