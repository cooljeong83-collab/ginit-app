-- Lightweight social chat room list sync summaries.
-- The app renders persisted chat room cache first, then compares these summaries before refetching list pages.

create or replace function public.chat_rooms_list_change_summaries(p_me text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  with me as (
    select nullif(trim(coalesce(p_me, '')), '') as uid
  ),
  cand0 as (
    select
      c.id,
      c.participant_ids,
      coalesce(c.last_message_at, c.updated_at) as changed_at
    from public.chat_rooms c, me
    where me.uid is not null
      and c.is_group = false
      and c.participant_ids @> array[me.uid]::text[]
  ),
  cand_peers as (
    select
      c.id,
      c.changed_at,
      coalesce(
        (
          select p
          from unnest(c.participant_ids) as p
          where lower(trim(p)) <> lower(trim((select uid from me)))
          limit 1
        ),
        ''
      ) as peer
    from cand0 c
  ),
  cand as (
    select cp.*
    from cand_peers cp, me m
    where m.uid is not null
      and cp.peer <> ''
      and not exists (
        select 1
        from public.user_blocks ub
        where lower(trim(ub.blocker_app_user_id)) = lower(trim(m.uid))
          and lower(trim(ub.blocked_app_user_id)) = lower(trim(cp.peer))
      )
  )
  select jsonb_build_object(
    'rooms',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'roomId', c.id,
            'peerAppUserId', c.peer,
            'changedAt', c.changed_at
          )
          order by c.changed_at desc nulls last, c.id desc
        )
        from cand c
      ),
      '[]'::jsonb
    )
  );
$$;

revoke all on function public.chat_rooms_list_change_summaries(text) from public;
grant execute on function public.chat_rooms_list_change_summaries(text) to anon, authenticated;

notify pgrst, 'reload schema';
