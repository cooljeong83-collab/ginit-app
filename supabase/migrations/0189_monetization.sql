-- Monetization: sponsors, campaigns, subscriptions (additive)

alter table public.profiles
  add column if not exists subscription_tier text not null default 'free',
  add column if not exists ad_free_until timestamptz;

create table if not exists public.sponsors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_email text,
  logo_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.sponsor_campaigns (
  id uuid primary key default gen_random_uuid(),
  sponsor_id uuid not null references public.sponsors(id) on delete cascade,
  name text not null,
  start_at timestamptz,
  end_at timestamptz,
  target_regions text[] not null default '{}',
  target_category_ids text[] not null default '{}',
  budget_cents bigint not null default 0,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  constraint sponsor_campaigns_status_check check (
    status in ('draft', 'active', 'paused', 'ended')
  )
);

create table if not exists public.ad_placements (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.sponsor_campaigns(id) on delete cascade,
  placement_key text not null,
  creative_url text,
  click_url text,
  priority int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.user_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  tier text not null default 'ad_free',
  ad_free_until timestamptz,
  provider text,
  external_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_subscriptions_profile_idx on public.user_subscriptions (profile_id);

alter table public.sponsors enable row level security;
alter table public.sponsor_campaigns enable row level security;
alter table public.ad_placements enable row level security;
alter table public.user_subscriptions enable row level security;

-- Admin list RPCs (slim)
create or replace function public.admin_list_sponsors(p_limit int default 25)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_current_user_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'created_at', s.created_at) order by s.created_at desc)
    from (select * from public.sponsors order by created_at desc limit least(p_limit, 50)) s), '[]'::jsonb);
end; $$;
grant execute on function public.admin_list_sponsors(int) to authenticated;

create or replace function public.admin_get_sponsor(p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_row public.sponsors%rowtype;
begin
  perform public.assert_current_user_admin();
  select * into v_row from public.sponsors where id = p_id;
  if not found then raise exception 'not_found'; end if;
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_get_sponsor(uuid) to authenticated;

create or replace function public.admin_upsert_sponsor(
  p_id uuid, p_name text, p_contact_email text default null, p_logo_url text default null
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := p_id;
begin
  perform public.assert_current_user_admin();
  if v_id is null then
    insert into public.sponsors (name, contact_email, logo_url) values (p_name, p_contact_email, p_logo_url) returning id into v_id;
  else
    update public.sponsors set name = p_name, contact_email = p_contact_email, logo_url = coalesce(p_logo_url, logo_url) where id = v_id;
  end if;
  return v_id;
end; $$;
grant execute on function public.admin_upsert_sponsor(uuid, text, text, text) to authenticated;

create or replace function public.admin_list_campaigns(p_limit int default 25)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_current_user_admin();
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', c.id, 'name', c.name, 'sponsor_id', c.sponsor_id, 'status', c.status,
    'start_at', c.start_at, 'end_at', c.end_at, 'budget_cents', c.budget_cents
  ) order by c.created_at desc)
    from (select * from public.sponsor_campaigns order by created_at desc limit least(p_limit, 50)) c), '[]'::jsonb);
end; $$;
grant execute on function public.admin_list_campaigns(int) to authenticated;

create or replace function public.admin_get_campaign(p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_c public.sponsor_campaigns%rowtype;
declare v_placements jsonb;
begin
  perform public.assert_current_user_admin();
  select * into v_c from public.sponsor_campaigns where id = p_id;
  if not found then raise exception 'not_found'; end if;
  select coalesce(jsonb_agg(to_jsonb(ap)), '[]'::jsonb) into v_placements from public.ad_placements ap where ap.campaign_id = p_id;
  return jsonb_build_object('campaign', to_jsonb(v_c), 'placements', v_placements);
end; $$;
grant execute on function public.admin_get_campaign(uuid) to authenticated;

create or replace function public.admin_list_subscriptions(p_limit int default 25)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_current_user_admin();
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', us.id, 'profile_id', us.profile_id, 'tier', us.tier,
    'ad_free_until', us.ad_free_until, 'provider', us.provider
  ) order by us.updated_at desc)
    from (
      select us.* from public.user_subscriptions us
      order by us.updated_at desc limit least(p_limit, 50)
    ) us), '[]'::jsonb);
end; $$;
grant execute on function public.admin_list_subscriptions(int) to authenticated;

create or replace function public.admin_insights_sponsor_recommendations(p_limit int default 5)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_current_user_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'region_norm', feed_region_norm,
      'meeting_count', cnt,
      'score', cnt
    ) order by cnt desc)
    from (
      select nullif(trim(feed_region_norm), '') as feed_region_norm, count(*)::int as cnt
      from public.meetings
      where is_public is true and feed_region_norm is not null
        and created_at > now() - interval '30 days'
      group by 1
      order by cnt desc
      limit least(p_limit, 10)
    ) t
  ), '[]'::jsonb);
end; $$;
grant execute on function public.admin_insights_sponsor_recommendations(int) to authenticated;
