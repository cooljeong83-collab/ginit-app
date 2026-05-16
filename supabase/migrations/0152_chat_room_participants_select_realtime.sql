-- 클라이언트 Realtime: 본인 `chat_room_participants` 행만 SELECT 허용 (postgres_changes 수신).
-- 기존 `for all using (false)` 정책은 SELECT까지 막아 Realtime이 불가능했음.

drop policy if exists chat_room_participants_block on public.chat_room_participants;
drop policy if exists chat_room_participants_select_own on public.chat_room_participants;
drop policy if exists chat_room_participants_block_insert on public.chat_room_participants;
drop policy if exists chat_room_participants_block_update on public.chat_room_participants;
drop policy if exists chat_room_participants_block_delete on public.chat_room_participants;

create policy chat_room_participants_select_own on public.chat_room_participants
for select to authenticated
using (
  lower(trim(app_user_id)) = lower(trim(coalesce(
    (select nullif(trim(p.app_user_id), '') from public.profiles p where p.auth_user_id = auth.uid() limit 1),
    ''
  )))
);

-- 직접 INSERT/UPDATE/DELETE는 클라이언트에서 금지(기본 거부 + 명시 블록).
create policy chat_room_participants_block_insert on public.chat_room_participants
for insert to authenticated with check (false);

create policy chat_room_participants_block_update on public.chat_room_participants
for update to authenticated using (false) with check (false);

create policy chat_room_participants_block_delete on public.chat_room_participants
for delete to authenticated using (false);

do $$
begin
  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_room_participants'
  ) then
    null;
  else
    execute 'alter publication supabase_realtime add table public.chat_room_participants';
  end if;
end
$$;

notify pgrst, 'reload schema';
