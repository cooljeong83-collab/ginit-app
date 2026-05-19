-- 정산 완료 후 장소 후기 안내 — public.notifications + RPC

create or replace function public.insert_meeting_place_review_notifications(
  p_meeting_id text,
  p_meeting_title text,
  p_recipient_app_user_ids text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mid text := nullif(trim(coalesce(p_meeting_id, '')), '');
  v_title text := coalesce(nullif(trim(coalesce(p_meeting_title, '')), ''), '모임');
  v_uid text;
  v_inserted int := 0;
  v_ids uuid[] := array[]::uuid[];
  v_id uuid;
begin
  if v_mid is null then
    raise exception 'meeting_id_required';
  end if;

  if p_recipient_app_user_ids is null then
    return jsonb_build_object('ok', true, 'inserted', 0, 'ids', '[]'::jsonb);
  end if;

  foreach v_uid in array p_recipient_app_user_ids
  loop
    v_uid := public.ginit_normalize_app_user_id(trim(coalesce(v_uid, '')));
    if v_uid is null or v_uid = '' then
      continue;
    end if;
    v_id := private.insert_notification_for_app_user(
      v_uid,
      'meeting_place_review',
      jsonb_build_object(
        'meetingId', v_mid,
        'meetingTitle', v_title
      )
    );
    if v_id is not null then
      v_inserted := v_inserted + 1;
      v_ids := array_append(v_ids, v_id);
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'inserted', v_inserted,
    'ids', to_jsonb(v_ids)
  );
end;
$$;

revoke all on function public.insert_meeting_place_review_notifications(text, text, text[]) from public;
grant execute on function public.insert_meeting_place_review_notifications(text, text, text[]) to anon, authenticated;

notify pgrst, 'reload schema';
