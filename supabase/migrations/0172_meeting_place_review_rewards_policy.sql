-- 장소 후기 제출 보상: app_policies(meeting.place_review) + upsert_meeting_place_review RPC 보상(최초 1회/모임·유저)

insert into public.app_policies (policy_group, policy_key, policy_value, is_active, description)
values (
  'meeting',
  'place_review',
  '{
    "xp_reward": 10,
    "trust_reward": 3,
    "trust_cap": 100
  }'::jsonb,
  true,
  '장소 후기(정산 완료 후): xp_reward·trust_reward(신뢰 회복)·trust_cap(gTrust 상한). 서버 RPC에서만 적용, 모임·유저당 최초 제출 1회.'
)
on conflict (policy_group, policy_key) do update
set
  policy_value = excluded.policy_value,
  is_active = excluded.is_active,
  description = excluded.description,
  updated_at = now();

create or replace function public.upsert_meeting_place_review(
  p_meeting_id text,
  p_app_user_id text,
  p_place_id text,
  p_rating integer,
  p_selected_keywords text[] default '{}'::text[],
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mid uuid;
  v_uid text := nullif(trim(coalesce(p_app_user_id, '')), '');
  v_place text := nullif(trim(coalesce(p_place_id, '')), '');
  v_keywords text[] := coalesce(p_selected_keywords, '{}'::text[]);
  v_comment text := nullif(trim(coalesce(p_comment, '')), '');
  v_allowed text[] := public.meeting_review_allowed_keywords();
  v_bad_kw text;
  v_profile_id uuid;
  v_pol jsonb;
  v_xp int;
  v_trust_delta int;
  v_trust_cap int;
  v_xp_rows int := 0;
  v_inserted boolean := false;
  v_xp_granted int := 0;
  v_trust_granted int := 0;
begin
  perform set_config('ginit.skip_profile_metric_guard', '1', true);

  if v_uid is null then
    raise exception 'app_user_id_required';
  end if;
  if v_place is null then
    raise exception 'place_id_required';
  end if;

  begin
    v_mid := p_meeting_id::uuid;
  exception
    when others then
      raise exception 'invalid_meeting_id';
  end;

  if not exists (select 1 from public.meetings m where m.id = v_mid) then
    raise exception 'meeting_not_found';
  end if;

  if not public.meeting_review_is_settled(v_mid) then
    raise exception 'meeting_not_settled';
  end if;

  if not public.meeting_review_is_participant(v_mid, v_uid) then
    raise exception 'not_a_meeting_participant';
  end if;

  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'invalid_rating';
  end if;

  if coalesce(array_length(v_keywords, 1), 0) > 3 then
    raise exception 'too_many_keywords';
  end if;

  select kw into v_bad_kw
  from unnest(v_keywords) as kw
  where not (kw = any (v_allowed))
  limit 1;

  if v_bad_kw is not null then
    raise exception 'invalid_keyword';
  end if;

  select p.id
  into v_profile_id
  from public.profiles p
  where public.ginit_normalize_app_user_id(p.app_user_id) = public.ginit_normalize_app_user_id(v_uid)
    and p.is_withdrawn is not true
  limit 1;

  if v_profile_id is null then
    raise exception 'profile_not_found';
  end if;

  insert into public.meeting_reviews (
    meeting_id,
    reviewer_app_user_id,
    place_id,
    rating,
    selected_keywords,
    comment
  )
  values (
    v_mid,
    v_uid,
    v_place,
    p_rating::smallint,
    v_keywords,
    v_comment
  )
  on conflict (meeting_id, reviewer_app_user_id) do update
  set
    place_id = excluded.place_id,
    rating = excluded.rating,
    selected_keywords = excluded.selected_keywords,
    comment = excluded.comment,
    created_at = now()
  returning (xmax = 0) into v_inserted;

  if coalesce(v_inserted, false) then
    v_pol := coalesce(public.get_policy_jsonb('meeting', 'place_review'), '{}'::jsonb);

    v_xp := greatest(
      0,
      round(coalesce(nullif(trim(v_pol->>'xp_reward'), '')::numeric, 10::numeric))::int
    );
    v_trust_delta := greatest(
      0,
      round(coalesce(nullif(trim(v_pol->>'trust_reward'), '')::numeric, 3::numeric))::int
    );
    v_trust_cap := greatest(
      0,
      least(100, round(coalesce(nullif(trim(v_pol->>'trust_cap'), '')::numeric, 100::numeric))::int)
    );

    if v_xp > 0 then
      insert into public.xp_events (profile_id, kind, meeting_id, dedupe_key, xp_delta)
      values (
        v_profile_id,
        'meeting_place_review',
        v_mid,
        'place_review:' || v_mid::text || ':' || public.ginit_normalize_app_user_id(v_uid),
        v_xp
      )
      on conflict do nothing;

      get diagnostics v_xp_rows = row_count;
      if v_xp_rows > 0 then
        update public.profiles
        set g_xp = g_xp + v_xp
        where id = v_profile_id;
        v_xp_granted := v_xp;
      end if;
    end if;

    if v_trust_delta > 0 then
      update public.profiles
      set g_trust = least(v_trust_cap, g_trust + v_trust_delta)
      where id = v_profile_id;
      v_trust_granted := v_trust_delta;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'rewards_applied', coalesce(v_inserted, false),
    'xp_granted', v_xp_granted,
    'trust_granted', v_trust_granted
  );
end;
$$;

revoke all on function public.upsert_meeting_place_review(text, text, text, integer, text[], text) from public;
grant execute on function public.upsert_meeting_place_review(text, text, text, integer, text[], text) to anon, authenticated;

notify pgrst, 'reload schema';
