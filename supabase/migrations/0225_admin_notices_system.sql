-- Admin notices: notices master, user_notifications inbox, notice_bucket storage, admin RPCs.
-- Additive; idempotent where possible.

create extension if not exists pg_net;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.notices (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  link_url text,
  image_url text,
  is_home_banner boolean not null default false,
  is_popup boolean not null default false,
  is_push_alarm boolean not null default false,
  start_at timestamptz,
  end_at timestamptz,
  target_scope text not null default 'all',
  target_region_norm text,
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notices_target_scope_check check (
    target_scope in ('all', 'region', 'admin_preview')
  )
);

create index if not exists notices_created_at_idx
  on public.notices (created_at desc);

create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  notice_id uuid not null references public.notices(id) on delete cascade,
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  constraint user_notifications_profile_notice_uniq unique (profile_id, notice_id)
);

create index if not exists user_notifications_profile_created_idx
  on public.user_notifications (profile_id, created_at desc);

create index if not exists user_notifications_notice_idx
  on public.user_notifications (notice_id);

alter table public.notices enable row level security;
alter table public.user_notifications enable row level security;

revoke all on table public.notices from anon, authenticated;
revoke all on table public.user_notifications from anon, authenticated;

-- App users read own inbox via RPC (future); admin via RPC only for now.

-- ---------------------------------------------------------------------------
-- Storage: notice_bucket
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'notice_bucket',
  'notice_bucket',
  true,
  5242880,
  array['image/jpeg', 'image/jpg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set
  public = true,
  file_size_limit = coalesce(excluded.file_size_limit, 5242880),
  allowed_mime_types = coalesce(
    excluded.allowed_mime_types,
    array['image/jpeg', 'image/jpg', 'image/png', 'image/webp']::text[]
  );

drop policy if exists notice_bucket_select_public on storage.objects;
create policy notice_bucket_select_public
on storage.objects for select
using (bucket_id = 'notice_bucket');

drop policy if exists notice_bucket_insert_authenticated on storage.objects;
create policy notice_bucket_insert_authenticated
on storage.objects for insert
to authenticated
with check (bucket_id = 'notice_bucket');

drop policy if exists notice_bucket_delete_authenticated on storage.objects;
create policy notice_bucket_delete_authenticated
on storage.objects for delete
to authenticated
using (bucket_id = 'notice_bucket');

-- ---------------------------------------------------------------------------
-- FCM helper (best-effort, uses same vault secrets as meeting_share_host_push)
-- ---------------------------------------------------------------------------
create or replace function private.admin_notice_send_fcm_batch(
  p_app_user_ids text[],
  p_title text,
  p_body text,
  p_notice_id uuid,
  p_link_url text
)
returns void
language plpgsql
security definer
set search_path = public, net
as $$
declare
  v_url text;
  v_auth text;
  v_payload jsonb;
  v_norm text[];
  v_chunk text[];
  v_i int;
  v_batch_size int := 50;
  v_len int;
begin
  if p_app_user_ids is null or array_length(p_app_user_ids, 1) is null then
    return;
  end if;

  select coalesce(array_agg(distinct public.ginit_normalize_app_user_id(x)), '{}'::text[])
  into v_norm
  from unnest(p_app_user_ids) as x
  where public.ginit_normalize_app_user_id(x) <> '';

  v_len := coalesce(array_length(v_norm, 1), 0);
  if v_len = 0 then
    return;
  end if;

  if to_regclass('vault.decrypted_secrets') is null then
    return;
  end if;

  select ds.decrypted_secret into v_url
  from vault.decrypted_secrets ds
  where ds.name = 'meeting_share_host_push_url'
  limit 1;

  select ds.decrypted_secret into v_auth
  from vault.decrypted_secrets ds
  where ds.name = 'meeting_share_host_push_authorization'
  limit 1;

  if coalesce(trim(v_url), '') = '' or coalesce(trim(v_auth), '') = '' then
    return;
  end if;

  for v_i in 1 .. v_len by v_batch_size loop
    v_chunk := v_norm[v_i : least(v_i + v_batch_size - 1, v_len)];

    v_payload := jsonb_build_object(
      'toUserIds', to_jsonb(v_chunk),
      'title', coalesce(nullif(trim(p_title), ''), '공지'),
      'body', coalesce(nullif(trim(p_body), ''), ''),
      'data', jsonb_build_object(
        'type', 'notice',
        'notice_id', p_notice_id::text,
        'link_url', coalesce(p_link_url, '')
      )
    );

    perform net.http_post(
      url := trim(v_url),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', trim(v_auth)
      ),
      body := v_payload
    );
  end loop;
end;
$$;

revoke all on function private.admin_notice_send_fcm_batch(text[], text, text, uuid, text) from public;

-- ---------------------------------------------------------------------------
-- admin_create_notice
-- ---------------------------------------------------------------------------
create or replace function public.admin_create_notice(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_notice_id uuid;
  v_title text := nullif(trim(coalesce(p_payload->>'title', '')), '');
  v_content text := nullif(trim(coalesce(p_payload->>'content', '')), '');
  v_link_url text := nullif(trim(coalesce(p_payload->>'link_url', '')), '');
  v_image_url text := nullif(trim(coalesce(p_payload->>'image_url', '')), '');
  v_is_home boolean := coalesce((p_payload->>'is_home_banner')::boolean, false);
  v_is_popup boolean := coalesce((p_payload->>'is_popup')::boolean, false);
  v_is_push boolean := coalesce((p_payload->>'is_push_alarm')::boolean, false);
  v_start_at timestamptz := nullif(trim(coalesce(p_payload->>'start_at', '')), '')::timestamptz;
  v_end_at timestamptz := nullif(trim(coalesce(p_payload->>'end_at', '')), '')::timestamptz;
  v_scope text := coalesce(nullif(trim(coalesce(p_payload->>'target_scope', '')), ''), 'all');
  v_region text := public.normalize_announcement_region_norm(p_payload->>'target_region_norm');
  v_inbox_inserted int := 0;
  v_fcm_ids text[];
begin
  perform public.assert_current_user_admin();

  if v_title is null then
    raise exception 'title_required';
  end if;
  if v_content is null then
    raise exception 'content_required';
  end if;
  if v_is_popup and v_image_url is null then
    raise exception 'popup_requires_image';
  end if;
  if v_start_at is not null and v_end_at is not null and v_start_at > v_end_at then
    raise exception 'invalid_schedule_range';
  end if;
  if v_scope not in ('all', 'region', 'admin_preview') then
    raise exception 'invalid_target_scope';
  end if;
  if v_scope = 'region' and v_region is null then
    raise exception 'region_required';
  end if;

  select id into v_actor from public.profiles where auth_user_id = auth.uid() limit 1;

  insert into public.notices (
    title,
    content,
    link_url,
    image_url,
    is_home_banner,
    is_popup,
    is_push_alarm,
    start_at,
    end_at,
    target_scope,
    target_region_norm,
    created_by_profile_id
  )
  values (
    v_title,
    v_content,
    v_link_url,
    v_image_url,
    v_is_home,
    v_is_popup,
    v_is_push,
    v_start_at,
    v_end_at,
    v_scope,
    v_region,
    v_actor
  )
  returning id into v_notice_id;

  if v_scope = 'admin_preview' then
    if v_actor is not null then
      insert into public.user_notifications (profile_id, notice_id, is_read)
      values (v_actor, v_notice_id, false)
      on conflict (profile_id, notice_id) do nothing;
      get diagnostics v_inbox_inserted = row_count;
    end if;
  elsif v_scope = 'region' then
    insert into public.user_notifications (profile_id, notice_id, is_read)
    select p.id, v_notice_id, false
    from public.profiles p
    where p.is_withdrawn is not true
      and p.app_user_id is not null
      and public.normalize_announcement_region_norm(p.metadata->>'base_region') = v_region
    on conflict (profile_id, notice_id) do nothing;
    get diagnostics v_inbox_inserted = row_count;
  else
    insert into public.user_notifications (profile_id, notice_id, is_read)
    select p.id, v_notice_id, false
    from public.profiles p
    where p.is_withdrawn is not true
      and p.app_user_id is not null
    on conflict (profile_id, notice_id) do nothing;
    get diagnostics v_inbox_inserted = row_count;
  end if;

  if v_is_push then
    if v_scope = 'admin_preview' and v_actor is not null then
      select array_agg(p.app_user_id)
      into v_fcm_ids
      from public.profiles p
      where p.id = v_actor and p.app_user_id is not null;
    elsif v_scope = 'region' then
      select array_agg(p.app_user_id)
      into v_fcm_ids
      from public.profiles p
      where p.is_withdrawn is not true
        and p.app_user_id is not null
        and public.normalize_announcement_region_norm(p.metadata->>'base_region') = v_region;
    else
      select array_agg(p.app_user_id)
      into v_fcm_ids
      from public.profiles p
      where p.is_withdrawn is not true
        and p.app_user_id is not null;
    end if;

    begin
      perform private.admin_notice_send_fcm_batch(
        v_fcm_ids,
        v_title,
        left(v_content, 200),
        v_notice_id,
        v_link_url
      );
    exception
      when others then
        raise notice 'admin_notice_send_fcm_batch failed: %', sqlerrm;
    end;
  end if;

  return jsonb_build_object(
    'notice_id', v_notice_id,
    'inbox_inserted', v_inbox_inserted,
    'push_requested', v_is_push
  );
end;
$$;

revoke all on function public.admin_create_notice(jsonb) from public;
grant execute on function public.admin_create_notice(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_list_notices / admin_get_notice
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_notices(
  p_limit int default 25,
  p_cursor timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 25), 1), 50);
  v_items jsonb;
  v_next timestamptz;
begin
  perform public.assert_current_user_admin();

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.created_at desc), '[]'::jsonb),
         min(x.created_at)
  into v_items, v_next
  from (
    select
      n.id,
      n.title,
      n.content,
      n.link_url,
      n.image_url,
      n.is_home_banner,
      n.is_popup,
      n.is_push_alarm,
      n.start_at,
      n.end_at,
      n.target_scope,
      n.target_region_norm,
      n.created_at,
      (
        select count(*)::int
        from public.user_notifications un
        where un.notice_id = n.id
      ) as inbox_count
    from public.notices n
    where p_cursor is null or n.created_at < p_cursor
    order by n.created_at desc
    limit v_limit + 1
  ) x;

  return jsonb_build_object('items', coalesce(v_items, '[]'::jsonb), 'next_cursor', v_next);
end;
$$;

revoke all on function public.admin_list_notices(int, timestamptz) from public;
grant execute on function public.admin_list_notices(int, timestamptz) to authenticated;

create or replace function public.admin_get_notice(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.notices%rowtype;
  v_inbox int;
begin
  perform public.assert_current_user_admin();
  select * into v_row from public.notices where id = p_id;
  if not found then
    raise exception 'not_found';
  end if;
  select count(*)::int into v_inbox
  from public.user_notifications un
  where un.notice_id = p_id;
  return to_jsonb(v_row) || jsonb_build_object('inbox_count', v_inbox);
end;
$$;

revoke all on function public.admin_get_notice(uuid) from public;
grant execute on function public.admin_get_notice(uuid) to authenticated;
