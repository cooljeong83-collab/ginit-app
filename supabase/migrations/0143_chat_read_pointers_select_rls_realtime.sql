-- 참가자가 자신이 속한 방의 읽음 포인터를 SELECT 할 수 있게 해 Realtime(postgres_changes)를 쓸 수 있게 함.
-- INSERT/UPDATE/DELETE는 RPC(security definer)만 사용.

drop policy if exists chat_read_pointers_block on public.chat_read_pointers;

drop policy if exists chat_read_pointers_select_meeting on public.chat_read_pointers;
create policy chat_read_pointers_select_meeting on public.chat_read_pointers
for select to authenticated
using (
  room_kind = 'meeting'
  and exists (
    select 1
    from public.meeting_participants mp
    join public.profiles p on p.id = mp.profile_id
    where mp.meeting_id = room_id::uuid
      and p.auth_user_id = auth.uid()
  )
);

drop policy if exists chat_read_pointers_select_social on public.chat_read_pointers;
create policy chat_read_pointers_select_social on public.chat_read_pointers
for select to authenticated
using (
  room_kind = 'social_dm'
  and exists (
    select 1
    from public.chat_rooms cr
    where cr.id = room_id
      and cr.is_group = false
      and cr.participant_ids @> array[
        (select nullif(trim(p.app_user_id), '') from public.profiles p where p.auth_user_id = auth.uid() limit 1)
      ]::text[]
  )
);

drop policy if exists chat_read_pointers_block_ins on public.chat_read_pointers;
create policy chat_read_pointers_block_ins on public.chat_read_pointers
for insert to anon, authenticated with check (false);

drop policy if exists chat_read_pointers_block_upd on public.chat_read_pointers;
create policy chat_read_pointers_block_upd on public.chat_read_pointers
for update to anon, authenticated using (false) with check (false);

drop policy if exists chat_read_pointers_block_del on public.chat_read_pointers;
create policy chat_read_pointers_block_del on public.chat_read_pointers
for delete to anon, authenticated using (false);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_read_pointers'
  ) then
    execute 'alter publication supabase_realtime add table public.chat_read_pointers';
  end if;
end $$;

notify pgrst, 'reload schema';
