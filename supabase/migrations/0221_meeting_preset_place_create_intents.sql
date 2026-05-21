-- 선택장소로 모임 생성: intent·전환 집계 (후기 써머리, 가게 광고 등 다채널)

create table if not exists public.meeting_preset_place_create_intents (
  id uuid primary key,
  entry_source text not null,
  entry_context jsonb not null default '{}'::jsonb,
  analytics_place_id text not null,
  creator_app_user_id text not null,
  intent_at timestamptz not null default now(),
  created_meeting_id uuid references public.meetings (id) on delete set null,
  converted_at timestamptz,
  place_name text,
  address text,
  latitude double precision,
  longitude double precision,
  category text,
  constraint meeting_preset_place_create_intents_entry_source_chk check (
    entry_source in ('meeting_place_review_summary', 'store_promo')
  )
);

create unique index if not exists meeting_preset_place_create_intents_created_meeting_ux
  on public.meeting_preset_place_create_intents (created_meeting_id)
  where created_meeting_id is not null;

create index if not exists meeting_preset_place_create_intents_entry_source_intent_idx
  on public.meeting_preset_place_create_intents (entry_source, intent_at desc);

create index if not exists meeting_preset_place_create_intents_analytics_place_idx
  on public.meeting_preset_place_create_intents (analytics_place_id, converted_at desc nulls last);

create index if not exists meeting_preset_place_create_intents_creator_idx
  on public.meeting_preset_place_create_intents (creator_app_user_id, intent_at desc);

create index if not exists meeting_preset_place_create_intents_converted_idx
  on public.meeting_preset_place_create_intents (converted_at desc)
  where created_meeting_id is not null;

alter table public.meeting_preset_place_create_intents enable row level security;

revoke all on table public.meeting_preset_place_create_intents from public;
revoke all on table public.meeting_preset_place_create_intents from anon;
revoke all on table public.meeting_preset_place_create_intents from authenticated;

-- ─── log intent ───────────────────────────────────────────────────────────
create or replace function public.log_preset_place_meeting_create_intent(
  p_intent_id uuid,
  p_entry_source text,
  p_entry_context jsonb,
  p_analytics_place_id text,
  p_creator_app_user_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source text := nullif(trim(coalesce(p_entry_source, '')), '');
  v_place_id text := nullif(trim(coalesce(p_analytics_place_id, '')), '');
  v_creator text := nullif(trim(coalesce(p_creator_app_user_id, '')), '');
  v_mid uuid;
  v_ctx jsonb := coalesce(p_entry_context, '{}'::jsonb);
begin
  if p_intent_id is null then
    raise exception 'intent_id_required';
  end if;
  if v_creator is null then
    raise exception 'creator_required';
  end if;
  if v_place_id is null then
    raise exception 'analytics_place_id_required';
  end if;
  if v_source is null or v_source not in ('meeting_place_review_summary', 'store_promo') then
    raise exception 'invalid_entry_source';
  end if;

  if v_source = 'meeting_place_review_summary' then
    begin
      v_mid := nullif(trim(coalesce(v_ctx->>'sourceMeetingId', '')), '')::uuid;
    exception
      when others then
        raise exception 'invalid_source_meeting_id';
    end;
    if not exists (select 1 from public.meetings m where m.id = v_mid) then
      raise exception 'meeting_not_found';
    end if;
    if not public.meeting_review_is_settled(v_mid) then
      raise exception 'meeting_not_settled';
    end if;
    if nullif(trim(coalesce(v_ctx->>'sourcePlaceId', '')), '') is null then
      raise exception 'source_place_id_required';
    end if;
  elsif v_source = 'store_promo' then
    if nullif(trim(coalesce(v_ctx->>'campaignId', '')), '') is null then
      raise exception 'campaign_id_required';
    end if;
  end if;

  insert into public.meeting_preset_place_create_intents (
    id,
    entry_source,
    entry_context,
    analytics_place_id,
    creator_app_user_id
  )
  values (p_intent_id, v_source, v_ctx, v_place_id, v_creator)
  on conflict (id) do nothing;
end;
$$;

-- ─── convert intent ───────────────────────────────────────────────────────
create or replace function public.convert_preset_place_meeting_create_intent(
  p_intent_id uuid,
  p_created_meeting_id uuid,
  p_creator_app_user_id text,
  p_place_snapshot jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_creator text := nullif(trim(coalesce(p_creator_app_user_id, '')), '');
  v_host uuid;
  v_snap jsonb := coalesce(p_place_snapshot, '{}'::jsonb);
  v_pname text := nullif(trim(coalesce(v_snap->>'placeName', '')), '');
  v_addr text := nullif(trim(coalesce(v_snap->>'address', '')), '');
  v_lat double precision;
  v_lng double precision;
  v_cat text := nullif(trim(coalesce(v_snap->>'category', '')), '');
begin
  if p_intent_id is null or p_created_meeting_id is null then
    raise exception 'ids_required';
  end if;
  if v_creator is null then
    raise exception 'creator_required';
  end if;

  if not exists (
    select 1
    from public.meeting_preset_place_create_intents i
    where i.id = p_intent_id
      and public.ginit_normalize_app_user_id(i.creator_app_user_id)
        = public.ginit_normalize_app_user_id(v_creator)
  ) then
    raise exception 'intent_not_found';
  end if;

  if not exists (select 1 from public.meetings m where m.id = p_created_meeting_id) then
    raise exception 'created_meeting_not_found';
  end if;

  select p.id into v_host
  from public.profiles p
  where public.ginit_normalize_app_user_id(p.app_user_id)
      = public.ginit_normalize_app_user_id(v_creator)
    and p.is_withdrawn is not true
  limit 1;

  if v_host is null then
    raise exception 'creator_profile_not_found';
  end if;

  if not exists (
    select 1
    from public.meetings m
    where m.id = p_created_meeting_id
      and m.created_by_profile_id = v_host
  ) then
    raise exception 'creator_not_meeting_host';
  end if;

  begin
    v_lat := (v_snap->>'latitude')::double precision;
    v_lng := (v_snap->>'longitude')::double precision;
  exception
    when others then
      v_lat := null;
      v_lng := null;
  end;

  update public.meeting_preset_place_create_intents i
  set
    created_meeting_id = p_created_meeting_id,
    converted_at = now(),
    place_name = coalesce(v_pname, i.place_name),
    address = coalesce(v_addr, i.address),
    latitude = coalesce(v_lat, i.latitude),
    longitude = coalesce(v_lng, i.longitude),
    category = coalesce(v_cat, i.category)
  where i.id = p_intent_id
    and i.created_meeting_id is null;

  if not found then
    update public.meeting_preset_place_create_intents i
    set
      converted_at = coalesce(i.converted_at, now()),
      place_name = coalesce(v_pname, i.place_name),
      address = coalesce(v_addr, i.address),
      latitude = coalesce(v_lat, i.latitude),
      longitude = coalesce(v_lng, i.longitude),
      category = coalesce(v_cat, i.category)
    where i.id = p_intent_id
      and i.created_meeting_id = p_created_meeting_id;
  end if;
end;
$$;

revoke all on function public.log_preset_place_meeting_create_intent(uuid, text, jsonb, text, text) from public;
grant execute on function public.log_preset_place_meeting_create_intent(uuid, text, jsonb, text, text) to anon, authenticated;

revoke all on function public.convert_preset_place_meeting_create_intent(uuid, uuid, text, jsonb) from public;
grant execute on function public.convert_preset_place_meeting_create_intent(uuid, uuid, text, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
