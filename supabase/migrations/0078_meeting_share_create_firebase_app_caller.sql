-- meeting_share_create: Supabase JWT에 app_user_id 클레임이 없는 클라이언트(Firebase Auth 전용 앱) 지원.
-- 호스트 검증은 ledger_meeting_create 와 동일하게 p_host_app_user_id + meetings.extra_data.fs.createdBy 일치로 수행.

create extension if not exists pgcrypto;

create or replace function public.meeting_share_create(p_meeting_id text, p_host_app_user_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mid uuid;
  v_jwt_claim text := public.ginit_normalize_app_user_id(coalesce(current_setting('request.jwt.claims', true)::json->>'app_user_id', ''));
  v_host_param text := public.ginit_normalize_app_user_id(coalesce(p_host_app_user_id, ''));
  v_caller text;
  v_fs jsonb;
  v_created_by text;
  v_secret_hex text;
  v_hash bytea;
  v_link_id uuid;
  v_expires timestamptz := now() + interval '365 days';
begin
  if v_jwt_claim <> '' then
    if v_host_param = '' or v_host_param is distinct from v_jwt_claim then
      raise exception 'meeting_share_host_mismatch';
    end if;
    v_caller := v_jwt_claim;
  else
    if v_host_param = '' then
      raise exception 'meeting_share_auth_required';
    end if;
    v_caller := v_host_param;
  end if;

  begin
    v_mid := trim(p_meeting_id)::uuid;
  exception when others then
    raise exception 'meeting_share_invalid_meeting_id';
  end;

  select coalesce(m.extra_data->'fs', '{}'::jsonb)
  into v_fs
  from public.meetings m
  where m.id = v_mid;
  if v_fs is null or v_fs = '{}'::jsonb then
    raise exception 'meeting_share_meeting_not_found';
  end if;

  v_created_by := public.ginit_normalize_app_user_id(coalesce(v_fs->>'createdBy', ''));
  if v_created_by = '' or v_created_by is distinct from v_caller then
    raise exception 'meeting_share_not_meeting_host';
  end if;

  v_secret_hex := encode(gen_random_bytes(32), 'hex');
  v_hash := digest(decode(v_secret_hex, 'hex'), 'sha256');

  insert into public.meeting_share_links (meeting_id, token_hash, created_by_app_user_id, expires_at)
  values (v_mid, v_hash, v_caller, v_expires)
  returning id into v_link_id;

  return jsonb_build_object(
    'token', v_secret_hex,
    'shareId', v_link_id::text,
    'meetingId', v_mid::text,
    'expiresAt', to_jsonb(v_expires)
  );
end;
$$;

revoke all on function public.meeting_share_create(text, text) from public;
grant execute on function public.meeting_share_create(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
