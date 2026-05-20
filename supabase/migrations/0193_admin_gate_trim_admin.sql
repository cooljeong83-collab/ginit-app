-- Prefer admin profile row; tolerate accidental whitespace in profiles.admin

create or replace function public.admin_get_session_gate()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.profiles%rowtype;
  v_email text;
  v_linked int;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'admin', false, 'reason', 'not_authenticated');
  end if;

  select * into v_row
  from public.profiles p
  where p.auth_user_id = auth.uid()
  order by case when lower(trim(p.admin)) = 'y' then 0 else 1 end, p.updated_at desc nulls last
  limit 1;

  if not found then
    select lower(trim(u.email))
    into v_email
    from auth.users u
    where u.id = auth.uid();

    if v_email is not null and v_email <> '' then
      update public.profiles p
      set auth_user_id = auth.uid(),
          updated_at = now()
      where p.auth_user_id is null
        and coalesce(p.is_withdrawn, false) = false
        and (
          lower(trim(p.app_user_id)) = v_email
          or lower(trim(coalesce(p.email, ''))) = v_email
        )
        and not exists (
          select 1
          from public.profiles q
          where q.auth_user_id = auth.uid()
            and q.id <> p.id
        );

      get diagnostics v_linked = row_count;

      if v_linked > 0 then
        select * into v_row
        from public.profiles p
        where p.auth_user_id = auth.uid()
        order by case when lower(trim(p.admin)) = 'y' then 0 else 1 end
        limit 1;
      end if;
    end if;
  end if;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'admin', false,
      'reason', 'no_profile',
      'hint', 'ginit 앱에서 동일 Google 계정으로 한 번 로그인하거나, profiles.auth_user_id를 연결하세요.'
    );
  end if;

  if lower(trim(v_row.admin)) is distinct from 'y' then
    return jsonb_build_object(
      'ok', false,
      'admin', false,
      'reason', 'not_admin',
      'profile', jsonb_build_object(
        'id', v_row.id,
        'nickname', v_row.nickname,
        'app_user_id', v_row.app_user_id,
        'email', v_row.email,
        'auth_user_id', v_row.auth_user_id
      )
    );
  end if;

  if coalesce(v_row.is_withdrawn, false) then
    return jsonb_build_object(
      'ok', false,
      'admin', false,
      'reason', 'withdrawn',
      'profile', jsonb_build_object('id', v_row.id, 'app_user_id', v_row.app_user_id)
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'admin', true,
    'profile', jsonb_build_object(
      'id', v_row.id,
      'nickname', v_row.nickname,
      'app_user_id', v_row.app_user_id,
      'email', v_row.email
    )
  );
end;
$$;

revoke all on function public.admin_get_session_gate() from public;
grant execute on function public.admin_get_session_gate() to authenticated;

notify pgrst, 'reload schema';
