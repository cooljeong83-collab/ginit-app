-- Admin chat monitor: room list (social + meeting), message pages, in-room search

create or replace function public.admin_list_chat_rooms(p_limit int default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_lim int := greatest(1, least(coalesce(p_limit, 50), 100));
begin
  perform public.assert_current_user_admin();

  return coalesce((
    with social as (
      select
        'social_dm'::text as room_kind,
        cr.id as room_id,
        cr.is_group,
        cr.participant_ids,
        coalesce(cr.last_message_at, cr.updated_at) as last_activity,
        coalesce((
          select count(*)::int
          from public.chat_messages m
          where m.room_kind = 'social_dm'
            and m.room_id = cr.id
            and m.deleted_at is null
        ), 0) as message_count,
        (
          select left(coalesce(nullif(trim(m.body_text), ''), '[미디어]'), 120)
          from public.chat_messages m
          where m.room_kind = 'social_dm'
            and m.room_id = cr.id
            and m.deleted_at is null
          order by m.seq desc
          limit 1
        ) as last_preview
      from public.chat_rooms cr
    ),
    meeting as (
      select
        'meeting'::text as room_kind,
        m.room_id,
        true as is_group,
        null::text[] as participant_ids,
        max(m.created_at) as last_activity,
        count(*)::int as message_count,
        (
          select left(coalesce(nullif(trim(m2.body_text), ''), '[미디어]'), 120)
          from public.chat_messages m2
          where m2.room_kind = 'meeting'
            and m2.room_id = m.room_id
            and m2.deleted_at is null
          order by m2.seq desc
          limit 1
        ) as last_preview
      from public.chat_messages m
      where m.room_kind = 'meeting'
        and m.deleted_at is null
      group by m.room_id
    ),
    unified as (
      select * from social
      union all
      select * from meeting
    ),
    enriched as (
      select
        u.room_kind,
        u.room_id,
        u.is_group,
        u.participant_ids,
        u.last_activity,
        u.message_count,
        u.last_preview,
        case
          when u.room_kind = 'meeting' then coalesce((
            select left(coalesce(nullif(trim(mt.title), ''), '모임'), 80)
            from public.meetings mt
            where mt.id::text = u.room_id
               or mt.legacy_firestore_id = u.room_id
            limit 1
          ), '모임 채팅')
          when u.is_group then '그룹 DM'
          else coalesce((
            select string_agg(p, ' · ' order by p)
            from unnest(u.participant_ids) p
            limit 2
          ), '1:1 DM')
        end as title
      from unified u
    )
    select jsonb_agg(
      jsonb_build_object(
        'room_kind', e.room_kind,
        'room_id', e.room_id,
        'id', e.room_id,
        'is_group', e.is_group,
        'participant_ids', coalesce(e.participant_ids, '{}'::text[]),
        'title', e.title,
        'last_preview', e.last_preview,
        'message_count', e.message_count,
        'updated_at', e.last_activity
      )
      order by e.last_activity desc nulls last
    )
    from (
      select * from enriched
      order by last_activity desc nulls last
      limit v_lim
    ) e
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_list_chat_messages(
  p_room_kind text,
  p_room_id text,
  p_limit int default 10,
  p_before_seq bigint default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_kind text := lower(trim(coalesce(p_room_kind, '')));
  v_rid text := nullif(trim(coalesce(p_room_id, '')), '');
  v_lim int := greatest(1, least(coalesce(p_limit, 10), 50));
  v_before bigint := nullif(p_before_seq, 0);
  v_canonical text;
  v_mid uuid;
begin
  perform public.assert_current_user_admin();

  if v_rid is null then
    return jsonb_build_object('rows', '[]'::jsonb, 'min_seq', null, 'max_seq', null, 'has_more', false);
  end if;
  if v_kind not in ('meeting', 'social_dm') then
    raise exception 'invalid_room_kind';
  end if;

  if v_kind = 'meeting' then
    v_mid := public._chat_resolve_meeting_uuid(v_rid);
    v_canonical := coalesce(v_mid::text, v_rid);
  else
    v_canonical := v_rid;
  end if;

  if v_before is null then
    return (
      with page as (
        select m.*
        from public.chat_messages m
        where m.room_kind = v_kind
          and m.room_id = v_canonical
        order by m.seq desc
        limit v_lim + 1
      ),
      numbered as (
        select *, row_number() over (order by seq desc) as rn from page
      ),
      capped as (
        select * from numbered where rn <= v_lim
      )
      select jsonb_build_object(
        'rows', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', c.id,
              'seq', c.seq,
              'sender_app_user_id', c.sender_app_user_id,
              'kind', c.kind,
              'body_text', c.body_text,
              'image_url', c.image_url,
              'created_at', c.created_at,
              'deleted_at', c.deleted_at
            ) order by c.seq desc
          ) from capped c
        ), '[]'::jsonb),
        'min_seq', (select min(seq) from capped),
        'max_seq', (select max(seq) from capped),
        'has_more', (select count(*) > v_lim from numbered),
        'canonical_room_id', v_canonical
      )
    );
  end if;

  return (
    with page as (
      select m.*
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
    )
    select jsonb_build_object(
      'rows', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', c.id,
            'seq', c.seq,
            'sender_app_user_id', c.sender_app_user_id,
            'kind', c.kind,
            'body_text', c.body_text,
            'image_url', c.image_url,
            'created_at', c.created_at,
            'deleted_at', c.deleted_at
          ) order by c.seq desc
        ) from capped c
      ), '[]'::jsonb),
      'min_seq', (select min(seq) from capped),
      'max_seq', (select max(seq) from capped),
      'has_more', (select count(*) > v_lim from numbered),
      'canonical_room_id', v_canonical
    )
  );
end;
$$;

create or replace function public.admin_search_chat_messages(
  p_room_kind text,
  p_room_id text,
  p_needle text,
  p_limit int default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_kind text := lower(trim(coalesce(p_room_kind, '')));
  v_rid text := nullif(trim(coalesce(p_room_id, '')), '');
  v_needle text := nullif(trim(coalesce(p_needle, '')), '');
  v_lim int := greatest(1, least(coalesce(p_limit, 50), 100));
  v_canonical text;
  v_mid uuid;
begin
  perform public.assert_current_user_admin();

  if v_rid is null or v_needle is null then
    return jsonb_build_object('rows', '[]'::jsonb, 'match_count', 0);
  end if;
  if v_kind not in ('meeting', 'social_dm') then
    raise exception 'invalid_room_kind';
  end if;

  if v_kind = 'meeting' then
    v_mid := public._chat_resolve_meeting_uuid(v_rid);
    v_canonical := coalesce(v_mid::text, v_rid);
  else
    v_canonical := v_rid;
  end if;

  return (
    with matched as (
      select m.*
      from public.chat_messages m
      where m.room_kind = v_kind
        and m.room_id = v_canonical
        and m.deleted_at is null
        and (
          strpos(lower(coalesce(m.body_text, '')), lower(v_needle)) > 0
          or strpos(lower(coalesce(m.image_url, '')), lower(v_needle)) > 0
          or strpos(lower(coalesce(m.sender_app_user_id, '')), lower(v_needle)) > 0
        )
      order by m.seq desc
      limit v_lim
    )
    select jsonb_build_object(
      'rows', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', c.id,
            'seq', c.seq,
            'sender_app_user_id', c.sender_app_user_id,
            'kind', c.kind,
            'body_text', c.body_text,
            'image_url', c.image_url,
            'created_at', c.created_at,
            'deleted_at', c.deleted_at
          ) order by c.seq desc
        ) from matched c
      ), '[]'::jsonb),
      'match_count', (select count(*)::int from matched)
    )
  );
end;
$$;

revoke all on function public.admin_list_chat_messages(text, text, int, bigint) from public;
grant execute on function public.admin_list_chat_messages(text, text, int, bigint) to authenticated;

revoke all on function public.admin_search_chat_messages(text, text, text, int) from public;
grant execute on function public.admin_search_chat_messages(text, text, text, int) to authenticated;

notify pgrst, 'reload schema';
