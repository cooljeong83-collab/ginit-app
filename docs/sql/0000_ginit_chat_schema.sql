-- =====================================================================
-- 0000_ginit_chat_schema.sql — Ginit 채팅 그린필드 베이스라인 (PostgreSQL / Supabase)
--
-- 용도:
--   • 새 Supabase 프로젝트 / SQL Editor에 **통째로 붙여넣어** 기반 스키마를 만들 때.
--   • 이 **저장소(ginit-app)** 는 이미 `0040_chat_rooms.sql`, `0135_chat_messages_delta_rpc.sql`
--     등으로 채팅 스키마가 존재합니다. `supabase db reset` 체인에 이 파일을 그대로 넣지 마세요.
--
-- 철학: Ping-only Broadcast + RPC 증분 + 파티션 프루닝
--   • Realtime payload는 DB가 아닌 채널만 쓰고, 메시지 본문은 항상 이 테이블 + RPC로 조회.
--   • chat_pull_deltas: (room_id, after_seq] 구간을 제한적으로 가져옴.
--
-- 주의 (파티션 + UNIQUE):
--   • RANGE(created_at) 파티션에서는 UNIQUE가 파티션 키를 포함해야 합니다.
--   • 본 스키마는 PK를 (id, created_at) 복합으로 두고, 앱/RPC에서 (room_id, seq) 유일성을 보장합니다
--     (기존 Ginit은 chat_room_seq + 트리거/RPC 패턴 사용).
-- =====================================================================

begin;

-- ─── Extensions (선택: gen_random_uuid) ─────────────────────────────────────
create extension if not exists "pgcrypto";

-- ─── chat_rooms ───────────────────────────────────────────────────────────────
create table if not exists public.chat_rooms (
  id text primary key,
  title text,
  is_group boolean not null default false,
  participant_ids text[] not null default '{}'::text[]
    check (cardinality(participant_ids) >= 0),
  last_message_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists chat_rooms_participant_ids_gin
  on public.chat_rooms using gin (participant_ids);

create index if not exists chat_rooms_list_order_idx
  on public.chat_rooms (
    coalesce(last_message_at, updated_at) desc nulls last,
    id desc
  );

comment on table public.chat_rooms is '채팅방 메타. 1:1은 participant_ids[2] 또는 chat_room_members로 표현.';

-- ─── chat_room_members (RLS EXISTS 1-depth / 인덱스 친화) ───────────────────────
create table if not exists public.chat_room_members (
  room_id text not null references public.chat_rooms (id) on delete cascade,
  app_user_id text not null,
  role text not null default 'member' check (role in ('member', 'admin', 'owner')),
  joined_at timestamptz not null default now(),
  primary key (room_id, app_user_id)
);

create index if not exists chat_room_members_room_user_idx
  on public.chat_room_members (room_id, app_user_id);

create index if not exists chat_room_members_user_room_idx
  on public.chat_room_members (app_user_id, room_id);

comment on table public.chat_room_members is '방별 멤버십. RLS는 이 테이블 EXISTS 단일 뎁스로만 조인.';

-- ─── chat_messages (RANGE 파티션 부모) ───────────────────────────────────────
-- PK (id, created_at): 파티션 키 포함 필수
create table if not exists public.chat_messages (
  id uuid not null default gen_random_uuid(),
  room_id text not null references public.chat_rooms (id) on delete cascade,
  seq bigint not null,
  sender_app_user_id text not null,
  kind text not null default 'text' check (kind in ('text', 'image', 'system')),
  body_text text,
  image_url text,
  image_album_batch_id text,
  reply_to jsonb,
  link_preview jsonb,
  client_mutation_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  deleted_at timestamptz,
  primary key (id, created_at)
) partition by range (created_at);

comment on table public.chat_messages is '메시지 본문. 파티션 프루닝: WHERE created_at 범위를 항상 포함할 것.';

-- 최소 1개 자식 파티션 (없으면 INSERT 불가).
-- 0135 마이그레이션으로 이미 만든 public.chat_messages는 일반 테이블이라
-- CREATE TABLE IF NOT EXISTS … PARTITION BY 가 적용되지 않음 → 아래는 스킵.
do $$
declare
  p_start timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
  p_end timestamptz := (date_trunc('month', now() at time zone 'utc') + interval '1 month') at time zone 'utc';
  part_name text := 'chat_messages_' || to_char(p_start at time zone 'utc', 'YYYY_MM');
begin
  if not exists (
    select 1
    from pg_partitioned_table pt
    join pg_class c on c.oid = pt.partrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'chat_messages'
  ) then
    raise notice
      '0000_ginit_chat_schema: public.chat_messages 가 RANGE 파티션 부모가 아니어서 월 파티션 생성을 건너뜁니다. '
      'Supabase 체인(예: 0135_chat_messages_delta_rpc)을 쓰는 DB에서는 이 단계가 필요 없습니다.';
    return;
  end if;

  if not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = part_name
  ) then
    execute format(
      'create table public.%I partition of public.chat_messages for values from (%L) to (%L);',
      part_name,
      p_start,
      p_end
    );
  end if;
end $$;

-- 파티션별 동일 인덱스: room + seq (타임라인)
-- (각 자식 파티션에 붙이려면 템플릿 대신 부모에 CREATE INDEX IF NOT EXISTS …)
create index if not exists chat_messages_room_seq_idx
  on public.chat_messages (room_id, seq asc, created_at desc);

create index if not exists chat_messages_room_created_idx
  on public.chat_messages (room_id, created_at desc);

create unique index if not exists chat_messages_idem_ux
  on public.chat_messages (room_id, client_mutation_id, created_at)
  where client_mutation_id is not null and length(trim(client_mutation_id)) > 0;

-- ─── RLS ──────────────────────────────────────────────────────────────────────
alter table public.chat_rooms enable row level security;
alter table public.chat_room_members enable row level security;
alter table public.chat_messages enable row level security;

-- 멤버만 방 조회 (단일 EXISTS, chat_room_members 인덱스 사용)
drop policy if exists chat_rooms_select_member on public.chat_rooms;
create policy chat_rooms_select_member on public.chat_rooms
for select to authenticated
using (
  exists (
    select 1
    from public.chat_room_members m
    where m.room_id = chat_rooms.id
      and m.app_user_id = coalesce(
        nullif(current_setting('request.jwt.claims', true)::json->>'app_user_id', ''),
        auth.uid()::text
      )
  )
);

drop policy if exists chat_rooms_block_mutate on public.chat_rooms;
create policy chat_rooms_block_mutate on public.chat_rooms
for all to anon, authenticated
using (false) with check (false);

-- 멤버만 멤버 테이블 조회
drop policy if exists chat_room_members_select_self on public.chat_room_members;
create policy chat_room_members_select_self on public.chat_room_members
for select to authenticated
using (
  app_user_id = coalesce(
    nullif(current_setting('request.jwt.claims', true)::json->>'app_user_id', ''),
    auth.uid()::text
  )
);

drop policy if exists chat_room_members_block_mutate on public.chat_room_members;
create policy chat_room_members_block_mutate on public.chat_room_members
for all to anon, authenticated
using (false) with check (false);

-- 메시지: 같은 방 멤버만 (EXISTS 1-depth)
drop policy if exists chat_messages_select_member on public.chat_messages;
create policy chat_messages_select_member on public.chat_messages
for select to authenticated
using (
  exists (
    select 1
    from public.chat_room_members m
    where m.room_id = chat_messages.room_id
      and m.app_user_id = coalesce(
        nullif(current_setting('request.jwt.claims', true)::json->>'app_user_id', ''),
        auth.uid()::text
      )
  )
);

drop policy if exists chat_messages_block_mutate on public.chat_messages;
create policy chat_messages_block_mutate on public.chat_messages
for all to anon, authenticated
using (false) with check (false);

-- JWT에 app_user_id가 없으면 auth.uid()::text로 폴백 — 실제 Ginit은 profiles 매핑 RPC 패턴 권장.

-- ─── RPC: chat_pull_deltas (3-인자 오버로드 — 기존 5-인자와 공존 가능) ─────────
-- 주의: Ginit 기존 DB에 이미 동일 이름·다른 시그니처가 있으면 "CREATE OR REPLACE" 충돌이 납니다.
--       그린필드 전용이거나, 프로덕션에서는 이름을 바꿔 배포하세요.

create or replace function public.chat_pull_deltas(
  p_room_id text,
  p_after_seq bigint,
  p_limit int
)
returns jsonb
language plpgsql
security definer
set search_path = public
volatile
as $$
declare
  v_me text := coalesce(
    nullif(current_setting('request.jwt.claims', true)::json->>'app_user_id', ''),
    auth.uid()::text
  );
  v_lim int := greatest(1, least(coalesce(p_limit, 50), 500));
  v_room_max bigint;
  v_rows jsonb;
  v_has_more boolean;
begin
  if v_me is null or length(trim(v_me)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated', 'rows', '[]'::jsonb, 'max_seq', 0, 'has_more', false);
  end if;

  if not exists (
    select 1 from public.chat_room_members m
    where m.room_id = p_room_id and m.app_user_id = v_me
  ) then
    return jsonb_build_object('ok', false, 'error', 'forbidden', 'rows', '[]'::jsonb, 'max_seq', 0, 'has_more', false);
  end if;

  select coalesce(max(m.seq), p_after_seq)
    into v_room_max
  from public.chat_messages m
  where m.room_id = p_room_id;

  with q as (
    select m.id, m.room_id, m.seq, m.sender_app_user_id, m.kind, m.body_text, m.image_url,
           m.image_album_batch_id, m.reply_to, m.link_preview, m.client_mutation_id,
           m.created_at, m.updated_at, m.deleted_at
    from public.chat_messages m
    where m.room_id = p_room_id
      and m.seq > p_after_seq
    order by m.seq asc
    limit v_lim + 1
  ),
  meta as (
    select (select count(*)::int from q) as fetched
  ),
  numbered as (
    select q.*, row_number() over (order by q.seq asc) as rn
    from q
  )
  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'id', n.id,
        'room_id', n.room_id,
        'seq', n.seq,
        'sender_app_user_id', n.sender_app_user_id,
        'kind', n.kind,
        'body_text', n.body_text,
        'image_url', n.image_url,
        'image_album_batch_id', n.image_album_batch_id,
        'reply_to', n.reply_to,
        'link_preview', n.link_preview,
        'client_mutation_id', n.client_mutation_id,
        'created_at', n.created_at,
        'updated_at', n.updated_at,
        'deleted_at', n.deleted_at
      ) order by n.seq
    ), '[]'::jsonb),
    (select meta.fetched > v_lim from meta)
  into v_rows, v_has_more
  from numbered n
  where n.rn <= v_lim;

  return jsonb_build_object(
    'ok', true,
    'rows', coalesce(v_rows, '[]'::jsonb),
    'max_seq', coalesce(v_room_max, p_after_seq),
    'has_more', coalesce(v_has_more, false)
  );
end;
$$;

revoke all on function public.chat_pull_deltas(text, bigint, int) from public;
grant execute on function public.chat_pull_deltas(text, bigint, int) to authenticated;

notify pgrst, 'reload schema';

-- ─── 파티션 선행 생성 (Cron에서 호출) ─────────────────────────────────────────
create or replace function public.ensure_chat_message_partitions(months_ahead int default 3)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
  i int;
  p_start timestamptz;
  p_end timestamptz;
  part_name text;
begin
  if not exists (
    select 1
    from pg_partitioned_table pt
    join pg_class c on c.oid = pt.partrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'chat_messages'
  ) then
    raise notice
      'ensure_chat_message_partitions: public.chat_messages 가 파티션 테이블이 아니어서 종료합니다. '
      '(0135 경로의 단일 테이블에는 이 함수가 필요 없습니다.)';
    return;
  end if;

  months_ahead := greatest(1, least(coalesce(months_ahead, 3), 24));
  for i in 0..months_ahead loop
    p_start := (m + (i || ' months')::interval);
    p_end := p_start + interval '1 month';
    part_name := 'chat_messages_' || to_char(p_start at time zone 'utc', 'YYYY_MM');
    if not exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = part_name
    ) then
      execute format(
        'create table public.%I partition of public.chat_messages for values from (%L) to (%L);',
        part_name,
        p_start,
        p_end
      );
      -- 부모에 선언한 인덱스는 신규 파티션에 자동 전파됨(Declarative partitioning).
    end if;
  end loop;
end;
$$;

revoke all on function public.ensure_chat_message_partitions(int) from public;
grant execute on function public.ensure_chat_message_partitions(int) to service_role;

comment on function public.ensure_chat_message_partitions(int) is
  '다음 N개월 chat_messages RANGE 파티션 생성. Supabase pg_cron에서 service_role로 호출 권장.';

-- pg_cron 예시 (프로젝트에서 확장 활성화된 경우에만 주석 해제)
-- select cron.schedule(
--   'ensure-chat-message-parts',
--   '0 2 1 * *',
--   $$select public.ensure_chat_message_partitions(4);$$
-- );

commit;
