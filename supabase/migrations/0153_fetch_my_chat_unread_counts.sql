-- 가벼운 별칭: JWT 기준 내 `chat_room_participants` unread 스냅샷(JSON 배열).
-- 클라이언트 파라미터 없이 호출 가능(실시간 끊김 후 포그라운드 복구용).

create or replace function public.fetch_my_chat_unread_counts()
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select public.chat_room_participants_pull_for_me(
    coalesce(
      nullif(
        trim(
          coalesce(
            (select p.app_user_id from public.profiles p where p.auth_user_id = auth.uid() limit 1),
            ''
          )
        ),
        ''
      ),
      ''
    )
  );
$$;

revoke all on function public.fetch_my_chat_unread_counts() from public;
grant execute on function public.fetch_my_chat_unread_counts() to authenticated;

notify pgrst, 'reload schema';
