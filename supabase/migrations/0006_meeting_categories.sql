-- Firestore `categories` 이관 대상: 공개 모임 메타(표시·필터)용 카테고리 마스터
-- 앱 필드: id(문서 id), label, emoji, order → sort_order

create table if not exists public.meeting_categories (
  id text primary key,
  label text not null,
  emoji text not null default '📌',
  sort_order int not null default 999,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_meeting_categories_touch on public.meeting_categories;
create trigger trg_meeting_categories_touch
before update on public.meeting_categories
for each row execute function public.touch_updated_at();

create index if not exists meeting_categories_sort_idx on public.meeting_categories (sort_order asc, label asc);

alter table public.meeting_categories enable row level security;

-- Firestore 규칙과 동일하게 읽기 공개(anon). 쓰기는 서비스 롤·대시보드에서.
drop policy if exists meeting_categories_select_public on public.meeting_categories;
create policy meeting_categories_select_public on public.meeting_categories
for select
to anon, authenticated
using (true);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'meeting_categories'
  ) then
    execute 'alter publication supabase_realtime add table public.meeting_categories';
  end if;
end $$;
