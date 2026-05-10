-- 웹 게스트 모임 나가기 후 호스트 상세에서 일시·장소 후보가 사라지는 회귀 방지:
-- `extra_data.fs` 갱신 과정에서 `dateCandidates` / `placeCandidates`가 비거나 누락되면
-- FOR UPDATE 시점 스냅샷으로 복원합니다.

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

  v_snap_dc := v_fs->'dateCandidates';
  v_snap_pc := v_fs->'placeCandidates';

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

  if v_snap_dc is not null and jsonb_typeof(v_snap_dc) = 'array' and jsonb_array_length(v_snap_dc) > 0 then
    if (not (v_fs ? 'dateCandidates'))
       or jsonb_typeof(v_fs->'dateCandidates') is distinct from 'array'
       or coalesce(jsonb_array_length(v_fs->'dateCandidates'), 0) = 0
    then
      v_fs := v_fs || jsonb_build_object('dateCandidates', v_snap_dc);
    end if;
  end if;

  if v_snap_pc is not null and jsonb_typeof(v_snap_pc) = 'array' and jsonb_array_length(v_snap_pc) > 0 then
    if (not (v_fs ? 'placeCandidates'))
       or jsonb_typeof(v_fs->'placeCandidates') is distinct from 'array'
       or coalesce(jsonb_array_length(v_fs->'placeCandidates'), 0) = 0
    then
      v_fs := v_fs || jsonb_build_object('placeCandidates', v_snap_pc);
    end if;
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
