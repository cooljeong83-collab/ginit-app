-- Edge `meeting-created-area-notify` 가 동일 모임으로 여러 번 호출될 때(웹훅+앱 등) 구독자 이중 알림을 막습니다.

create table if not exists public.meeting_created_area_notify_sent (
  meeting_id uuid primary key references public.meetings (id) on delete cascade,
  sent_at timestamptz not null default now()
);

comment on table public.meeting_created_area_notify_sent is
  '공개 모임 생성 FCM fan-out 가 이미 수행된 모임 ID(중복 Edge 호출 방지).';

alter table public.meeting_created_area_notify_sent enable row level security;

drop policy if exists meeting_created_notify_sent_deny_all on public.meeting_created_area_notify_sent;
create policy meeting_created_notify_sent_deny_all on public.meeting_created_area_notify_sent for all using (false) with check (false);

revoke all on public.meeting_created_area_notify_sent from public;
revoke all on public.meeting_created_area_notify_sent from anon, authenticated;

notify pgrst, 'reload schema';
