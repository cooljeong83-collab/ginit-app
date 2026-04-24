-- 구글 연동 등 `ensure_profile_minimal` RPC 호출 시
-- "could not find the function ... in the schema cache" (PostgREST 캐시) 방지.
-- 0008에 이미 있어도 idempotent 하며, 적용 직후 NOTIFY 로 API 스키마를 갱신합니다.

create or replace function public.ensure_profile_minimal(p_app_user_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nick text := '모임친구' || substr(md5(random()::text), 1, 6);
begin
  if p_app_user_id is null or trim(p_app_user_id) = '' then
    raise exception 'app_user_id required';
  end if;
  insert into public.profiles (app_user_id, nickname)
  values (trim(p_app_user_id), v_nick)
  on conflict (app_user_id) do nothing;
end;
$$;

revoke all on function public.ensure_profile_minimal(text) from public;
grant execute on function public.ensure_profile_minimal(text) to anon, authenticated;

notify pgrst, 'reload schema';
