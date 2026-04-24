-- Hybrid bridge: ranking column, integration outbox, public meeting read for feed migration,
-- Realtime publication for meetings, trigger on schedule confirmation.

-- 1) profiles.ranking_points (UserProfile.rankingPoints 와 정합)
alter table public.profiles
  add column if not exists ranking_points int not null default 0;

-- 2) Outbox — Edge Function / 워커가 소비해 Firestore 등 외부 시스템에 반영
create table if not exists public.integration_outbox (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text
);

create index if not exists integration_outbox_pending_idx
  on public.integration_outbox (created_at asc)
  where processed_at is null;

alter table public.integration_outbox enable row level security;
-- 정책 없음: anon/authenticated 일반 접근 차단. service_role / 테이블 소유자만 처리.

-- 3) 공개 모임 — 피드 마이그레이션용 anon 읽기 (운영 정책에 맞게 조정·삭제 가능)
drop policy if exists meetings_select_public_anon on public.meetings;
create policy meetings_select_public_anon on public.meetings
for select
to anon, authenticated
using (is_public = true);

-- 4) Realtime — 클라이언트 postgres_changes 구독용
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'meetings'
  ) then
    execute 'alter publication supabase_realtime add table public.meetings';
  end if;
end $$;

-- 5) 모임 일정 확정 시 Firestore 채팅 시스템 메시지용 outbox 적재
create or replace function public.enqueue_meeting_schedule_confirmed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and coalesce(old.schedule_confirmed, false) = false
     and coalesce(new.schedule_confirmed, false) = true
     and new.legacy_firestore_id is not null
     and length(trim(new.legacy_firestore_id)) > 0
  then
    insert into public.integration_outbox (kind, payload)
    values (
      'firestore_chat_system_place_confirmed',
      jsonb_build_object(
        'legacy_firestore_meeting_id', trim(new.legacy_firestore_id),
        'place_name', new.place_name,
        'schedule_date', new.schedule_date,
        'schedule_time', new.schedule_time
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_meetings_schedule_confirmed_outbox on public.meetings;
create trigger trg_meetings_schedule_confirmed_outbox
after update on public.meetings
for each row
execute function public.enqueue_meeting_schedule_confirmed();

