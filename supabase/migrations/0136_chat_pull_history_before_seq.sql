-- 과거 메시지 페이지( seq 기준 ). Supabase 채팅 백필용.

create or replace function public.chat_pull_history_before_seq(
  p_me text,
  p_room_kind text,
  p_room_id text,
  p_before_seq bigint,
  p_limit int default 50
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
  v_lim int := greatest(1, least(coalesce(p_limit, 50), 200));
  v_before bigint := coalesce(p_before_seq, 0);
begin
  if v_me is null or v_rid is null or v_before <= 0 then
    return jsonb_build_object('rows', '[]'::jsonb, 'min_seq', null, 'has_more', false, 'error', 'invalid_args');
  end if;
  if v_kind not in ('meeting', 'social_dm') then
    return jsonb_build_object('rows', '[]'::jsonb, 'min_seq', null, 'has_more', false, 'error', 'invalid_room_kind');
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
    with page as (
      select m.id, m.room_kind, m.room_id, m.seq, m.sender_app_user_id, m.kind, m.body_text, m.image_url,
             m.image_album_batch_id, m.reply_to, m.link_preview, m.client_mutation_id, m.created_at, m.updated_at, m.deleted_at
      from public.chat_messages m
      where m.room_kind = v_kind
        and m.room_id = v_canonical
        and m.seq < v_before
      order by m.seq desc
      limit v_lim + 1
    ),
    numbered as (
      select *, row_number() over (order by seq desc) as rn from page
    ),
    capped as (
      select * from numbered where rn <= v_lim
    ),
    mn as (
      select min(seq) as min_seq from capped
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
            ) order by c.seq desc
          )
          from capped c
        ),
        '[]'::jsonb
      ),
      'min_seq', (select min_seq from mn),
      'has_more', (select count(*) > v_lim from numbered),
      'canonical_room_id', v_canonical
    )
  );
end;
$$;

revoke all on function public.chat_pull_history_before_seq(text, text, text, bigint, int) from public;
grant execute on function public.chat_pull_history_before_seq(text, text, text, bigint, int) to anon, authenticated;

notify pgrst, 'reload schema';
