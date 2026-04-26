-- `friends` Realtime: postgres_changes는 행에 대한 SELECT 권한이 있어야 이벤트가 전달됩니다.
-- RPC(security definer)만 쓰던 테이블에, 로그인 사용자 본인이 참가한 행만 읽을 수 있는 정책을 추가합니다.

drop policy if exists friends_select_party on public.friends;
create policy friends_select_party on public.friends
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.auth_user_id = auth.uid()
      and (
        trim(coalesce(p.app_user_id, '')) = trim(requester_app_user_id)
        or trim(coalesce(p.app_user_id, '')) = trim(addressee_app_user_id)
      )
  )
);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'friends'
  ) then
    execute 'alter publication supabase_realtime add table public.friends';
  end if;
end $$;
