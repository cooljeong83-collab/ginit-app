-- Reservation foundation (Step C placeholder — no app references yet)

create table if not exists public.venues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  region_norm text,
  category_id text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.venue_resources (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  name text not null,
  capacity int,
  created_at timestamptz not null default now()
);

create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  resource_id uuid references public.venue_resources(id) on delete set null,
  guest_app_user_id text,
  party_size int not null default 1,
  slot_at timestamptz not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  constraint reservations_status_check check (
    status in ('pending', 'confirmed', 'checked_in', 'completed', 'cancelled', 'no_show')
  )
);

create table if not exists public.waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  guest_app_user_id text,
  party_size int not null default 1,
  position int not null default 0,
  status text not null default 'waiting',
  created_at timestamptz not null default now()
);

alter table public.meetings
  add column if not exists venue_id uuid references public.venues(id) on delete set null;

alter table public.venues enable row level security;
alter table public.venue_resources enable row level security;
alter table public.reservations enable row level security;
alter table public.waitlist_entries enable row level security;

create or replace function public.admin_list_reservations_placeholder()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_current_user_admin();
  return jsonb_build_object('status', 'coming_soon', 'count', (select count(*) from public.reservations));
end; $$;
grant execute on function public.admin_list_reservations_placeholder() to authenticated;
