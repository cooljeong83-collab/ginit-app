-- Hybrid DB init (Supabase as Brain/Ledger, Firestore as Real-time signals)
-- Apply via Supabase SQL editor or CLI migration.

-- Extensions (safe defaults)
create extension if not exists pgcrypto;

-- 1) User profiles (ledger + demographics)
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  -- 기존 앱의 사용자 PK(정규화 이메일 or 전화 PK). 점진 이관을 위해 유지합니다.
  app_user_id text unique,
  -- Supabase Auth를 메인으로 사용할 때 연결되는 uid
  auth_user_id uuid unique references auth.users(id) on delete cascade,

  nickname text not null,
  photo_url text,

  phone text,
  phone_verified_at timestamptz,

  email text,
  display_name text,

  terms_agreed_at timestamptz,

  gender text,
  age_band text,
  birth_year int,
  birth_month int,
  birth_day int,

  -- Ginit metrics
  g_level int not null default 1,
  g_xp bigint not null default 0,
  g_trust int not null default 100,
  g_dna text not null default 'Explorer',
  meeting_count int not null default 0,

  is_withdrawn boolean not null default false,
  withdrawn_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_app_user_id_idx on public.profiles(app_user_id);
create index if not exists profiles_auth_user_id_idx on public.profiles(auth_user_id);

-- Keep updated_at fresh
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_touch on public.profiles;
create trigger trg_profiles_touch
before update on public.profiles
for each row execute function public.touch_updated_at();

-- 2) Meetings (confirmed / queryable data)
create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),

  -- 호환용: Firestore meetingId를 그대로 유지하고 싶으면 외부 키로 쓸 수 있습니다.
  legacy_firestore_id text unique,

  title text not null,
  description text,
  capacity int not null default 0,
  min_participants int,

  category_id text,
  category_label text,
  is_public boolean not null default false,
  image_url text,

  created_by_profile_id uuid references public.profiles(id),

  schedule_confirmed boolean not null default false,
  schedule_date text,
  schedule_time text,
  scheduled_at timestamptz,

  place_name text,
  address text,
  latitude double precision,
  longitude double precision,

  -- 확정 결과를 후보 id로도 보관(동점 처리/집계 결과)
  confirmed_date_chip_id text,
  confirmed_place_chip_id text,
  confirmed_movie_chip_id text,

  extra_data jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists meetings_created_by_idx on public.meetings(created_by_profile_id);
create index if not exists meetings_is_public_idx on public.meetings(is_public);

drop trigger if exists trg_meetings_touch on public.meetings;
create trigger trg_meetings_touch
before update on public.meetings
for each row execute function public.touch_updated_at();

-- 3) Meeting participants (queryable membership)
create table if not exists public.meeting_participants (
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member', -- 'host' | 'member'
  joined_at timestamptz not null default now(),
  primary key (meeting_id, profile_id)
);

create index if not exists meeting_participants_profile_idx on public.meeting_participants(profile_id);

-- 4) XP / points ledger (idempotent events)
create table if not exists public.xp_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null, -- e.g. 'vote_completed'
  meeting_id uuid references public.meetings(id) on delete set null,
  -- 클라이언트/브리지 중복 방지 키
  dedupe_key text,
  xp_delta int not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists xp_events_profile_kind_dedupe_ux
  on public.xp_events(profile_id, kind, dedupe_key)
  where dedupe_key is not null;

create index if not exists xp_events_profile_created_idx on public.xp_events(profile_id, created_at desc);

-- 5) RPC: vote 완료 시 XP 반영 (권장 경로)
-- 인자 이름은 앱 훅(useMeetingUpdate) 기본값(p_meeting_id, p_user_id, p_xp_delta)과 맞춥니다.
create or replace function public.apply_vote_xp(
  p_meeting_id uuid,
  p_user_id text,
  p_xp_delta int default 0,
  p_dedupe_key text default null
)
returns void
language plpgsql
security definer
as $$
declare
  v_profile_id uuid;
begin
  select id into v_profile_id
  from public.profiles
  where app_user_id = p_user_id
  limit 1;

  if v_profile_id is null then
    raise exception 'profile not found for app_user_id=%', p_user_id;
  end if;

  -- 1) ledger (idempotent)
  insert into public.xp_events(profile_id, kind, meeting_id, dedupe_key, xp_delta)
  values (v_profile_id, 'vote_completed', p_meeting_id, p_dedupe_key, coalesce(p_xp_delta, 0))
  on conflict do nothing;

  -- 2) apply XP only when inserted (avoid double count)
  if found then
    update public.profiles
    set g_xp = g_xp + coalesce(p_xp_delta, 0)
    where id = v_profile_id;
  end if;
end;
$$;

-- RLS: start strict. Adjust per product needs.
alter table public.profiles enable row level security;
alter table public.meetings enable row level security;
alter table public.meeting_participants enable row level security;
alter table public.xp_events enable row level security;

-- profiles: owner can read/update by auth_user_id
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
for select
using (auth.uid() = auth_user_id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
for update
using (auth.uid() = auth_user_id)
with check (auth.uid() = auth_user_id);

-- meetings: participants can read (simple starter policy)
drop policy if exists meetings_select_participant on public.meetings;
create policy meetings_select_participant on public.meetings
for select
using (
  exists (
    select 1
    from public.meeting_participants mp
    join public.profiles p on p.id = mp.profile_id
    where mp.meeting_id = meetings.id and p.auth_user_id = auth.uid()
  )
);

-- meeting_participants: participants can read
drop policy if exists meeting_participants_select_participant on public.meeting_participants;
create policy meeting_participants_select_participant on public.meeting_participants
for select
using (
  exists (
    select 1
    from public.profiles p
    where p.id = meeting_participants.profile_id and p.auth_user_id = auth.uid()
  )
);

-- xp_events: owner can read
drop policy if exists xp_events_select_own on public.xp_events;
create policy xp_events_select_own on public.xp_events
for select
using (
  exists (
    select 1
    from public.profiles p
    where p.id = xp_events.profile_id and p.auth_user_id = auth.uid()
  )
);

