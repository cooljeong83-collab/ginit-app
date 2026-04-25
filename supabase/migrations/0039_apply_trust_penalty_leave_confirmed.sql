-- 확정 일정 모임에서 참여자가 나갈 때 신뢰·XP·패널티(원장) — 모임당 1회(idempotent).

insert into public.app_policies (policy_group, policy_key, policy_value, is_active, description)
values
  (
    'trust',
    'penalty_leave_confirmed',
    '{"xp":-30,"trust":-12,"restricted_below":30}'::jsonb,
    true,
    '확정된 일정이 있는 모임에서 참여자가 나가기: gTrust·XP·누적 패널티'
  )
on conflict (policy_group, policy_key) do update
set
  policy_value = excluded.policy_value,
  description = excluded.description,
  is_active = true;

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
  v_inserted boolean := false;
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

  select id, g_trust, penalty_count, g_xp, is_restricted
  into v_profile_id, v_trust, v_penalty, v_xp, v_restricted
  from public.profiles
  where app_user_id = trim(p_app_user_id)
  limit 1;

  if v_profile_id is null then
    raise exception 'profile not found for app_user_id=%', p_app_user_id;
  end if;

  v_dedupe := trim(p_meeting_firestore_id);

  insert into public.xp_events(profile_id, kind, dedupe_key, xp_delta)
  values (v_profile_id, 'penalty_leave_confirmed', v_dedupe, v_xp_delta)
  on conflict do nothing
  returning true into v_inserted;

  if not coalesce(v_inserted, false) then
    select g_trust, penalty_count, is_restricted into v_trust, v_penalty, v_restricted
    from public.profiles
    where id = v_profile_id;
    return query select v_trust, v_penalty, v_restricted;
    return;
  end if;

  v_trust := greatest(0, v_trust + v_trust_delta);
  v_penalty := v_penalty + 1;
  v_xp := v_xp + v_xp_delta;
  v_restricted := v_restricted or (v_trust < v_rb);

  update public.profiles
  set
    g_trust = v_trust,
    penalty_count = v_penalty,
    g_xp = v_xp,
    is_restricted = v_restricted,
    trust_recovery_streak = 0
  where id = v_profile_id;

  return query select v_trust, v_penalty, v_restricted;
end;
$$;

revoke all on function public.apply_trust_penalty_leave_confirmed_meeting(text, text) from public;
grant execute on function public.apply_trust_penalty_leave_confirmed_meeting(text, text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
