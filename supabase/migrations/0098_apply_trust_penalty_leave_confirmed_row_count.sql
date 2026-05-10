-- INSERT ... RETURNING ... INTO 가 ON CONFLICT 시 PL/pgSQL에서 기대와 다르게 남는 환경 대비:
-- ROW_COUNT로 실제 삽입 여부를 판별해 패널티 UPDATE가 건너뛰지 않도록 함.

create or replace function public.apply_trust_penalty_leave_confirmed_meeting(
  p_app_user_id text,
  p_meeting_firestore_id text
)
returns table(new_g_trust int, new_penalty_count int, is_restricted boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_trust int;
  v_penalty int;
  v_xp bigint;
  v_restricted boolean;
  v_xp_insert_rowcount int;
  v_cfg jsonb;
  v_xp_delta int;
  v_trust_delta int;
  v_rb int;
  v_dedupe text;
begin
  perform set_config('ginit.skip_profile_metric_guard', '1', true);

  if coalesce(trim(p_app_user_id), '') = '' then
    raise exception 'app_user_id required';
  end if;
  if coalesce(trim(p_meeting_firestore_id), '') = '' then
    raise exception 'meeting id required';
  end if;

  v_cfg := coalesce(
    public.get_policy_jsonb('trust', 'penalty_leave_confirmed'),
    '{"xp":-30,"trust":-12,"restricted_below":30}'::jsonb
  );
  v_xp_delta := coalesce((v_cfg->>'xp')::int, -30);
  v_trust_delta := coalesce((v_cfg->>'trust')::int, -12);
  v_rb := coalesce((v_cfg->>'restricted_below')::int, 30);

  select prf.id, prf.g_trust, prf.penalty_count, prf.g_xp, prf.is_restricted
  into v_profile_id, v_trust, v_penalty, v_xp, v_restricted
  from public.profiles prf
  where prf.app_user_id = trim(p_app_user_id)
  limit 1;

  if v_profile_id is null then
    raise exception 'profile not found for app_user_id=%', p_app_user_id;
  end if;

  v_dedupe := trim(p_meeting_firestore_id);

  insert into public.xp_events(profile_id, kind, dedupe_key, xp_delta)
  values (v_profile_id, 'penalty_leave_confirmed', v_dedupe, v_xp_delta)
  on conflict do nothing;

  get diagnostics v_xp_insert_rowcount = row_count;

  if v_xp_insert_rowcount = 0 then
    select prf.g_trust, prf.penalty_count, prf.is_restricted into v_trust, v_penalty, v_restricted
    from public.profiles prf
    where prf.id = v_profile_id;
    return query select v_trust, v_penalty, v_restricted;
    return;
  end if;

  v_trust := greatest(0, v_trust + v_trust_delta);
  v_penalty := v_penalty + 1;
  v_xp := v_xp + v_xp_delta;
  v_restricted := v_restricted or (v_trust < v_rb);

  update public.profiles prf
  set
    (g_trust, penalty_count, g_xp, is_restricted, trust_recovery_streak)
      = (v_trust, v_penalty, v_xp, v_restricted, 0)
  where prf.id = v_profile_id;

  return query select v_trust, v_penalty, v_restricted;
end;
$$;

revoke all on function public.apply_trust_penalty_leave_confirmed_meeting(text, text) from PUBLIC;
grant execute on function public.apply_trust_penalty_leave_confirmed_meeting(text, text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
