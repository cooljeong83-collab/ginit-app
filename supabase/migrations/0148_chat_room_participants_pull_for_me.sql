-- 내 `chat_room_participants` 전부 조회 — 앱 부트·포그라운드 시 로컬(Watermelon) unread_count 최종 동기화용.
-- JWT가 있으면 `profiles.app_user_id`만 신뢰하고, 클라이언트 `p_me`는 검증용(불일치 시 빈 배열).

create or replace function public.chat_room_participants_pull_for_me(p_me text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from_auth text := nullif(
    trim(
      coalesce(
        (select p.app_user_id from public.profiles p where p.auth_user_id = auth.uid() limit 1),
        ''
      )
    ),
    ''
  );
  v_param text := nullif(trim(coalesce(p_me, '')), '');
  v_me text;
begin
  if v_from_auth is not null then
    if v_param is not null and lower(v_param) <> lower(v_from_auth) then
      return '[]'::jsonb;
    end if;
    v_me := v_from_auth;
  elsif v_param is not null then
    v_me := v_param;
  else
    return '[]'::jsonb;
  end if;

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'room_kind', crp.room_kind,
          'room_id', crp.room_id,
          'unread_count', crp.unread_count,
          'updated_at', crp.updated_at
        )
        order by crp.updated_at desc nulls last
      )
      from public.chat_room_participants crp
      where lower(trim(crp.app_user_id)) = lower(trim(v_me))
    ),
    '[]'::jsonb
  );
end;
$$;

revoke all on function public.chat_room_participants_pull_for_me(text) from public;
grant execute on function public.chat_room_participants_pull_for_me(text) to authenticated;

notify pgrst, 'reload schema';
