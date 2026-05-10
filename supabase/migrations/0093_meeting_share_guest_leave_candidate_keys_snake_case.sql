-- 게스트 나가기 후 후보가 사라져 보이는 추가 케이스:
-- `extra_data.fs` 에 `dateCandidates` 가 빈 배열이거나 비어 있는데 `date_candidates`(snake)에만
-- 실제 후보가 남아 있으면, 0092 스냅샷은 camel 만 읽어 복원이 스킵되고 RN 매퍼도 `??` 때문에 snake를 못 봅니다.
-- → 스냅샷·최종 fs 정규화 시 camel/snake 중 비어 있지 않은 배열을 택하고 `dateCandidates`/`placeCandidates` 로 기록합니다.

create or replace function public.meeting_share_fs_effective_candidate_array(
  p_fs jsonb,
  p_camel text,
  p_snake text
)
returns jsonb
language sql
immutable
as $$
  select case
    when jsonb_typeof(p_fs->p_camel) = 'array' and coalesce(jsonb_array_length(p_fs->p_camel), 0) > 0 then
      p_fs->p_camel
    when jsonb_typeof(p_fs->p_snake) = 'array' and coalesce(jsonb_array_length(p_fs->p_snake), 0) > 0 then
      p_fs->p_snake
    when jsonb_typeof(p_fs->p_camel) = 'array' then
      p_fs->p_camel
    when jsonb_typeof(p_fs->p_snake) = 'array' then
      p_fs->p_snake
    else null
  end;
$$;

revoke all on function public.meeting_share_fs_effective_candidate_array(jsonb, text, text) from public;
grant execute on function public.meeting_share_fs_effective_candidate_array(jsonb, text, text) to anon, authenticated;

create or replace function public.meeting_share_guest_leave(p_token text, p_guest_user_id text)
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
  v_gn text := trim(coalesce(p_guest_user_id, ''));
  v_in_part boolean := false;
  v_in_jr boolean := false;
  v_old jsonb;
  v_tally jsonb;
  v_dates_old text[];
  v_places_old text[];
  v_movies_old text[];
  v_new_log jsonb;
  v_part_new jsonb;
  v_jr jsonb;
  v_new_jr jsonb;
  v_elem jsonb;
  v_cfg_msg boolean;
  v_i int;
  v_part_ids jsonb;
  v_join_req jsonb;
  v_vote_log jsonb;
  v_host text;
  v_meeting_title text;
  v_guest_label text;
  v_disp text;
  v_snap_dc jsonb;
  v_snap_pc jsonb;
  v_eff_dc jsonb;
  v_eff_pc jsonb;
begin
  if not public.meeting_share_is_ginitweb_guest_id(v_gn) then
    raise exception 'meeting_share_invalid_guest_id';
  end if;

  select t.o_link_id, t.o_meeting_id, t.o_ok
  into v_link_id, v_mid, v_ok
  from public.meeting_share_try_resolve_token(p_token) as t;
  if not coalesce(v_ok, false) then
    raise exception 'meeting_share_invalid_or_expired_token';
  end if;

  select coalesce(m.extra_data->'fs', '{}'::jsonb)
  into v_fs
  from public.meetings m
  where m.id = v_mid
  for update;

  if v_fs is null or v_fs = '{}'::jsonb then
    raise exception 'meeting_share_meeting_not_found';
  end if;

  v_snap_dc := public.meeting_share_fs_effective_candidate_array(v_fs, 'dateCandidates', 'date_candidates');
  v_snap_pc := public.meeting_share_fs_effective_candidate_array(v_fs, 'placeCandidates', 'place_candidates');

  v_part_ids := case
    when v_fs->'participantIds' is null then '[]'::jsonb
    when jsonb_typeof(v_fs->'participantIds') = 'array' then v_fs->'participantIds'
    else '[]'::jsonb
  end;

  v_join_req := case
    when v_fs->'joinRequests' is null then '[]'::jsonb
    when jsonb_typeof(v_fs->'joinRequests') = 'array' then v_fs->'joinRequests'
    when jsonb_typeof(v_fs->'joinRequests') = 'object' then jsonb_build_array(v_fs->'joinRequests')
    else '[]'::jsonb
  end;

  v_vote_log := case
    when v_fs->'participantVoteLog' is null then '[]'::jsonb
    when jsonb_typeof(v_fs->'participantVoteLog') = 'array' then v_fs->'participantVoteLog'
    else '[]'::jsonb
  end;

  select exists(
    select 1 from jsonb_array_elements_text(v_part_ids) x where x = v_gn
  ) into v_in_part;

  select exists(
    select 1 from jsonb_array_elements(v_join_req) jr where jr->>'userId' = v_gn
  ) into v_in_jr;

  if not v_in_part and not v_in_jr then
    return jsonb_build_object('ok', true, 'alreadyLeft', true);
  end if;

  v_host := public.ginit_normalize_app_user_id(coalesce(v_fs->>'createdBy', ''));
  v_meeting_title := coalesce(nullif(trim(v_fs->>'title'), ''), '모임');
  v_guest_label := '게스트';

  if v_in_part then
    v_old := null;
    select e into v_old
    from jsonb_array_elements(v_vote_log) e
    where e->>'userId' = v_gn
    limit 1;

    if v_old is not null and coalesce(trim(v_old->>'displayName'), '') <> '' then
      v_guest_label := left(trim(v_old->>'displayName'), 40);
    end if;

    if v_old is null then
      v_dates_old := array[]::text[];
      v_places_old := array[]::text[];
      v_movies_old := array[]::text[];
    else
      v_dates_old := public.meeting_share_vote_string_ids(v_old, 'dateChipIds');
      v_places_old := public.meeting_share_vote_string_ids(v_old, 'placeChipIds');
      v_movies_old := public.meeting_share_vote_string_ids(v_old, 'movieChipIds');
    end if;

    v_tally := coalesce(v_fs->'voteTallies', '{}'::jsonb);
    v_tally := jsonb_strip_nulls(
      jsonb_build_object(
        'dates', public.meeting_share_tally_apply_delta(v_tally, 'dates', v_dates_old, array[]::text[]),
        'places', public.meeting_share_tally_apply_delta(v_tally, 'places', v_places_old, array[]::text[]),
        'movies', public.meeting_share_tally_apply_delta(v_tally, 'movies', v_movies_old, array[]::text[])
      )
    );

    select coalesce(jsonb_agg(e), '[]'::jsonb)
    into v_new_log
    from jsonb_array_elements(v_vote_log) e
    where e->>'userId' is distinct from v_gn;

    select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
    into v_part_new
    from jsonb_array_elements_text(v_part_ids) as t(x)
    where x is distinct from v_gn;

    v_fs := v_fs || jsonb_build_object(
      'participantIds', v_part_new,
      'voteTallies', v_tally,
      'participantVoteLog', v_new_log,
      'id', v_mid::text
    );
  else
    v_disp := '';
    select trim(coalesce(jr->>'displayName', ''))
    into v_disp
    from jsonb_array_elements(v_join_req) jr
    where jr->>'userId' = v_gn
    limit 1;
    if coalesce(v_disp, '') <> '' then
      v_guest_label := left(v_disp, 40);
    end if;

    v_cfg_msg := coalesce((v_fs->'meetingConfig'->>'requestMessageEnabled')::boolean, false);
    v_jr := v_join_req;
    v_new_jr := '[]'::jsonb;
    for v_i in 0 .. greatest(coalesce(jsonb_array_length(v_jr), 0) - 1, -1)
    loop
      if v_i < 0 then exit; end if;
      v_elem := v_jr->v_i;
      if v_elem->>'userId' is distinct from v_gn then
        v_new_jr := v_new_jr || jsonb_build_array(v_elem);
      end if;
    end loop;
    v_fs := v_fs || jsonb_build_object('joinRequests', v_new_jr, 'id', v_mid::text);
  end if;

  v_eff_dc := public.meeting_share_fs_effective_candidate_array(v_fs, 'dateCandidates', 'date_candidates');
  if v_snap_dc is not null and jsonb_typeof(v_snap_dc) = 'array' and jsonb_array_length(v_snap_dc) > 0 then
    if v_eff_dc is null or jsonb_typeof(v_eff_dc) is distinct from 'array' or coalesce(jsonb_array_length(v_eff_dc), 0) = 0 then
      v_eff_dc := v_snap_dc;
    end if;
  end if;
  if v_eff_dc is not null and jsonb_typeof(v_eff_dc) = 'array' and jsonb_array_length(v_eff_dc) > 0 then
    v_fs := v_fs || jsonb_build_object('dateCandidates', v_eff_dc);
  end if;

  v_eff_pc := public.meeting_share_fs_effective_candidate_array(v_fs, 'placeCandidates', 'place_candidates');
  if v_snap_pc is not null and jsonb_typeof(v_snap_pc) = 'array' and jsonb_array_length(v_snap_pc) > 0 then
    if v_eff_pc is null or jsonb_typeof(v_eff_pc) is distinct from 'array' or coalesce(jsonb_array_length(v_eff_pc), 0) = 0 then
      v_eff_pc := v_snap_pc;
    end if;
  end if;
  if v_eff_pc is not null and jsonb_typeof(v_eff_pc) = 'array' and jsonb_array_length(v_eff_pc) > 0 then
    v_fs := v_fs || jsonb_build_object('placeCandidates', v_eff_pc);
  end if;

  perform public.meeting_share_sync_meeting_from_fs(v_mid, v_fs);
  update public.meeting_share_links set last_used_at = now() where id = v_link_id;

  if v_host <> '' then
    perform private.meeting_share_notify_host_web_guest_fcm(
      v_host,
      v_mid,
      v_meeting_title,
      v_guest_label,
      'left',
      v_gn
    );
  end if;

  return jsonb_build_object('ok', true, 'alreadyLeft', false);
end;
$$;

revoke all on function public.meeting_share_guest_leave(text, text) from public;
grant execute on function public.meeting_share_guest_leave(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
