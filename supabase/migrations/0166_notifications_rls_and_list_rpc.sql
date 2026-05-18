-- 새소식(`public.notifications`): RLS app_user_id 정규화 + SECURITY DEFINER 목록/읽음 RPC
-- (직접 SELECT는 profiles.app_user_id 대소문자 불일치·auth 미연동 시 빈 배열이 될 수 있음)

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
for select
using (
  exists (
    select 1
    from public.profiles p
    where public.ginit_normalize_app_user_id(p.app_user_id)
        = public.ginit_normalize_app_user_id(notifications.user_id)
      and p.auth_user_id = auth.uid()
  )
);

drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
for update
using (
  exists (
    select 1
    from public.profiles p
    where public.ginit_normalize_app_user_id(p.app_user_id)
        = public.ginit_normalize_app_user_id(notifications.user_id)
      and p.auth_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where public.ginit_normalize_app_user_id(p.app_user_id)
        = public.ginit_normalize_app_user_id(notifications.user_id)
      and p.auth_user_id = auth.uid()
  )
);

create or replace function public.list_app_notifications(
  p_me text,
  p_limit int default 80
)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  with me as (
    select public.ginit_normalize_app_user_id(coalesce(p_me, '')) as uid
  )
  select coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', n.id,
          'user_id', n.user_id,
          'type', n.type,
          'payload', n.payload,
          'created_at', n.created_at,
          'read_at', n.read_at
        )
        order by n.created_at desc
      )
      from (
        select n.*
        from public.notifications n
        cross join me
        where me.uid <> ''
          and public.ginit_normalize_app_user_id(n.user_id) = me.uid
        order by n.created_at desc
        limit greatest(1, least(coalesce(p_limit, 80), 200))
      ) n
    ),
    '[]'::jsonb
  );
$$;

revoke all on function public.list_app_notifications(text, int) from public;
grant execute on function public.list_app_notifications(text, int) to anon, authenticated;

create or replace function public.mark_app_notification_read(
  p_me text,
  p_notification_id uuid,
  p_type text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := public.ginit_normalize_app_user_id(coalesce(p_me, ''));
  v_type text := nullif(trim(coalesce(p_type, '')), '');
begin
  if v_me = '' or p_notification_id is null then
    return false;
  end if;
  update public.notifications n
  set read_at = coalesce(n.read_at, now())
  where n.id = p_notification_id
    and public.ginit_normalize_app_user_id(n.user_id) = v_me
    and (v_type is null or n.type = v_type);
  return found;
end;
$$;

revoke all on function public.mark_app_notification_read(text, uuid, text) from public;
grant execute on function public.mark_app_notification_read(text, uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
