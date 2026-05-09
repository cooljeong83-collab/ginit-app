-- Web share: expose host nickname + profile photo on meeting_share_guest_get (from public.profiles).

create or replace function public.meeting_share_guest_get(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link_id uuid;
  v_mid uuid;
  v_ok boolean;
  v_fs jsonb;
  v_out jsonb;
  v_created timestamptz;
  v_host_key text;
  v_host_nick text;
  v_host_photo text;
begin
  select t.o_link_id, t.o_meeting_id, t.o_ok
  into v_link_id, v_mid, v_ok
  from public.meeting_share_try_resolve_token(p_token) as t;
  if not coalesce(v_ok, false) then
    raise exception 'meeting_share_invalid_or_expired_token';
  end if;

  update public.meeting_share_links
  set last_used_at = now()
  where id = v_link_id;

  select coalesce(m.extra_data->'fs', '{}'::jsonb), m.created_at
  into v_fs, v_created
  from public.meetings m
  where m.id = v_mid;

  if v_fs is null or v_fs = '{}'::jsonb then
    raise exception 'meeting_share_meeting_not_found';
  end if;

  v_out := public.meeting_share_redact_fs(v_fs) || jsonb_build_object('id', v_mid::text);
  if v_created is not null then
    v_out := v_out || jsonb_build_object('createdAt', to_jsonb(v_created));
  end if;

  v_host_key := public.ginit_normalize_app_user_id(coalesce(v_fs->>'createdBy', ''));
  v_host_nick := null;
  v_host_photo := null;
  if v_host_key <> '' then
    select p.nickname, p.photo_url
    into v_host_nick, v_host_photo
    from public.profiles p
    where public.ginit_normalize_app_user_id(p.app_user_id) = v_host_key
      and coalesce(p.is_withdrawn, false) = false
    order by p.updated_at desc
    limit 1;
  end if;

  if v_host_nick is not null and btrim(v_host_nick) <> '' then
    v_out := v_out || jsonb_build_object('hostDisplayName', btrim(v_host_nick));
  end if;
  if v_host_photo is not null and btrim(v_host_photo) <> '' then
    v_out := v_out || jsonb_build_object('hostPhotoUrl', btrim(v_host_photo));
  end if;

  return jsonb_build_object(
    'meeting', v_out,
    'requiresHostApproval', public.meeting_share_requires_host_approval(v_fs)
  );
end;
$$;

revoke all on function public.meeting_share_guest_get(text) from public;
grant execute on function public.meeting_share_guest_get(text) to anon, authenticated;
