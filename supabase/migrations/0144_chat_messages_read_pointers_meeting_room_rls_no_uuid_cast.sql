-- Realtime/RLS: `room_id::uuid` 캐스트는 라우트에 레거시 Firestore 문자열이 섞이면 정책 평가 중 오류를 유발할 수 있음.
-- meetings 와 legacy_firestore_id 로 논리 방을 해석해 참가자 매칭만 수행합니다.

drop policy if exists chat_messages_select_meeting on public.chat_messages;
create policy chat_messages_select_meeting on public.chat_messages
for select to authenticated
using (
  room_kind = 'meeting'
  and exists (
    select 1
    from public.meeting_participants mp
    join public.profiles p on p.id = mp.profile_id
    join public.meetings m on m.id = mp.meeting_id
    where p.auth_user_id = auth.uid()
      and (m.id::text = room_id or m.legacy_firestore_id = room_id)
  )
);

drop policy if exists chat_read_pointers_select_meeting on public.chat_read_pointers;
create policy chat_read_pointers_select_meeting on public.chat_read_pointers
for select to authenticated
using (
  room_kind = 'meeting'
  and exists (
    select 1
    from public.meeting_participants mp
    join public.profiles p on p.id = mp.profile_id
    join public.meetings m on m.id = mp.meeting_id
    where p.auth_user_id = auth.uid()
      and (m.id::text = room_id or m.legacy_firestore_id = room_id)
  )
);

notify pgrst, 'reload schema';
