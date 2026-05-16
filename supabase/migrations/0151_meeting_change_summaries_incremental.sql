-- Incremental meeting list sync: tiny payload (meeting_id + row_id + md5 fingerprint).
-- Uses meetings.updated_at range scans; bumps parent meeting row when participants change.

-- Partial index: public meetings filtered by updated_at (list_meeting_change_summaries).
create index if not exists meetings_public_updated_at_id_idx
  on public.meetings (updated_at asc, id asc)
  where is_public = true;

-- Host-side incremental scans (list_my_meeting_change_summaries since last_sync).
create index if not exists meetings_created_by_updated_at_idx
  on public.meetings (created_by_profile_id, updated_at asc, id asc);

-- Participant membership changes must advance meetings.updated_at so incremental sync
-- does not miss participant-only updates.
create or replace function public.bump_meeting_parent_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  mid uuid;
begin
  mid := coalesce(new.meeting_id, old.meeting_id);
  if mid is not null then
    update public.meetings
    set updated_at = now()
    where id = mid;
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function public.bump_meeting_parent_updated_at() from public;

drop trigger if exists trg_meeting_participants_bump_parent_updated on public.meeting_participants;
create trigger trg_meeting_participants_bump_parent_updated
after insert or update or delete on public.meeting_participants
for each row execute function public.bump_meeting_parent_updated_at();

-- Public meetings: only rows touched after client watermark.
create or replace function public.list_meeting_change_summaries(
  p_last_sync_at timestamptz,
  p_limit int default 500
)
returns table (
  meeting_id text,
  row_id uuid,
  updated_fp text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(nullif(trim(m.legacy_firestore_id), ''), m.id::text) as meeting_id,
    m.id as row_id,
    md5((floor(extract(epoch from m.updated_at) * 1000))::bigint::text) as updated_fp
  from public.meetings m
  where m.is_public = true
    and p_last_sync_at is not null
    and m.updated_at > p_last_sync_at
  order by m.updated_at asc, m.id asc
  limit greatest(1, least(500, coalesce(p_limit, 500)));
$$;

revoke all on function public.list_meeting_change_summaries(timestamptz, int) from public;
grant execute on function public.list_meeting_change_summaries(timestamptz, int) to anon, authenticated;

-- My meetings: overload with last_sync_at (PostgREST picks by parameter set).
create or replace function public.list_my_meeting_change_summaries(
  p_app_user_id text,
  p_last_sync_at timestamptz,
  p_limit int default 500
)
returns table (
  meeting_id text,
  row_id uuid,
  updated_fp text
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select pr.id as profile_id
    from public.profiles pr
    where public.ginit_normalize_app_user_id(pr.app_user_id) = public.ginit_normalize_app_user_id(p_app_user_id)
    limit 1
  )
  select
    coalesce(nullif(trim(m.legacy_firestore_id), ''), m.id::text) as meeting_id,
    m.id as row_id,
    md5((floor(extract(epoch from m.updated_at) * 1000))::bigint::text) as updated_fp
  from public.meetings m
  where
    p_last_sync_at is not null
    and m.updated_at > p_last_sync_at
    and (
      m.created_by_profile_id = (select profile_id from me)
      or exists (
        select 1
        from public.meeting_participants mp
        where mp.meeting_id = m.id
          and mp.profile_id = (select profile_id from me)
      )
    )
  order by m.updated_at asc, m.id asc
  limit greatest(1, least(500, coalesce(p_limit, 500)));
$$;

revoke all on function public.list_my_meeting_change_summaries(text, timestamptz, int) from public;
grant execute on function public.list_my_meeting_change_summaries(text, timestamptz, int) to anon, authenticated;

notify pgrst, 'reload schema';
