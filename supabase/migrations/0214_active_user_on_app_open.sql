-- DAU: 로그인 게이트가 아닌 앱 클라이언트가 record_daily_active_user RPC를 직접 호출
-- (앱 실행·포그라운드 진입 시, 일별 고유 1회)

create or replace function public.get_account_session_gate(p_app_user_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me text := nullif(trim(coalesce(p_app_user_id, '')), '');
  v_row public.profiles%rowtype;
  v_allowed boolean := false;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_user', 'message', '사용자 정보가 없습니다.');
  end if;

  if public.is_current_user_admin() then
    v_allowed := true;
  elsif auth.uid() is not null then
    select exists (
      select 1
      from public.profiles p
      where p.auth_user_id = auth.uid()
        and lower(trim(p.app_user_id)) = lower(v_me)
        and coalesce(p.is_withdrawn, false) = false
    ) into v_allowed;
  end if;

  if not v_allowed then
    return jsonb_build_object('ok', false, 'reason', 'forbidden', 'message', '계정을 확인할 수 없습니다.');
  end if;

  select * into v_row
  from public.profiles p
  where lower(trim(p.app_user_id)) = lower(v_me)
  limit 1;

  if not found then
    return jsonb_build_object('ok', true);
  end if;

  if coalesce(v_row.is_withdrawn, false) then
    return jsonb_build_object(
      'ok', false,
      'reason', 'withdrawn',
      'message', '탈퇴한 계정입니다. 다시 가입하려면 고객센터에 문의해 주세요.'
    );
  end if;

  if coalesce(v_row.is_suspended, false) then
    return jsonb_build_object(
      'ok', false,
      'reason', 'suspended',
      'message', '운영 정책에 따라 이용이 중지된 계정입니다. 문의가 필요하면 고객센터로 연락해 주세요.'
    );
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.record_daily_active_user(text) is
  '앱 실행(포그라운드) 시 클라이언트가 호출. 동일 사용자·동일 일자 1회만 active_users rollup 증가.';

notify pgrst, 'reload schema';
