-- 0133: chat_rooms — 참여자 본인만 SELECT 허용(Realtime postgres_changes 수신 범위를 RLS로 한정)
-- 기존 `chat_rooms_block_direct`(for all / using false)는 직접 SELECT·Realtime 이벤트를 전부 차단했습니다.
-- DM 행은 RPC(security definer)로만 쓰되, 클라이언트 Realtime은 "내가 participant_ids 에 포함된 행"만 수신합니다.

drop policy if exists chat_rooms_block_direct on public.chat_rooms;

create policy chat_rooms_select_participant on public.chat_rooms
for select
to authenticated
using (
  is_group = false
  and participant_ids @> array[
    (
      select nullif(trim(coalesce(p.app_user_id, '')), '')
      from public.profiles p
      where p.auth_user_id = auth.uid()
      limit 1
    )
  ]::text[]
);

create policy chat_rooms_block_insert on public.chat_rooms
for insert
to anon, authenticated
with check (false);

create policy chat_rooms_block_update on public.chat_rooms
for update
to anon, authenticated
using (false);

create policy chat_rooms_block_delete on public.chat_rooms
for delete
to anon, authenticated
using (false);

notify pgrst, 'reload schema';
