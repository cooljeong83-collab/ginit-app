-- submit_user_report: auth_user_id 미연결 프로필을 신고자 PK로 안전하게 연결한 뒤 신고 접수

drop function if exists public.submit_user_report(text, text, text, jsonb);

create or replace function public.submit_user_report(
  p_reported_app_user_id text,
  p_reason_code text,
  p_description text default null,
  p_evidence jsonb default null,
  p_reporter_app_user_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reporter text;
  v_reporter_key text := nullif(trim(coalesce(p_reporter_app_user_id, '')), '');
  v_reported text;
  v_reason text;
  v_desc text;
  v_evidence jsonb;
  v_urls jsonb;
  v_url text;
  v_i int;
  v_id uuid;
  v_allowed text[] := array[
    'harassment', 'spam', 'fake_profile', 'inappropriate', 'scam', 'other'
  ];
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if v_reporter_key is not null then
    if exists (
      select 1
      from public.profiles p
      where p.auth_user_id = auth.uid()
        and public.ginit_normalize_app_user_id(p.app_user_id)
          = public.ginit_normalize_app_user_id(v_reporter_key)
        and coalesce(p.is_withdrawn, false) = false
    ) or not exists (
      select 1 from public.profiles p where p.auth_user_id = auth.uid()
    ) then
      perform public.ensure_profile_minimal(v_reporter_key);
    end if;
  end if;

  select public.ginit_normalize_app_user_id(p.app_user_id)
  into v_reporter
  from public.profiles p
  where p.auth_user_id = auth.uid()
    and coalesce(p.is_withdrawn, false) = false
  limit 1;

  if coalesce(v_reporter, '') = '' then
    raise exception 'profile_not_found';
  end if;

  v_reported := public.ginit_normalize_app_user_id(coalesce(p_reported_app_user_id, ''));
  if v_reported = '' then
    raise exception 'reported_user_required';
  end if;

  if v_reporter = v_reported then
    raise exception 'cannot_report_self';
  end if;

  if lower(v_reported) = 'ginit_ai' then
    raise exception 'cannot_report_system_user';
  end if;

  v_reason := lower(trim(coalesce(p_reason_code, '')));
  if v_reason = '' or not (v_reason = any (v_allowed)) then
    raise exception 'invalid_reason_code';
  end if;

  v_desc := nullif(left(trim(coalesce(p_description, '')), 2000), '');

  v_evidence := null;
  if p_evidence is not null and jsonb_typeof(p_evidence) = 'object' then
    v_urls := p_evidence->'image_urls';
    if v_urls is not null and jsonb_typeof(v_urls) <> 'array' then
      raise exception 'invalid_evidence';
    end if;
    if v_urls is not null then
      if jsonb_array_length(v_urls) > 5 then
        raise exception 'too_many_images';
      end if;
      for v_i in 0 .. (jsonb_array_length(v_urls) - 1) loop
        v_url := trim(both '"' from (v_urls->>v_i));
        if length(v_url) < 12 or length(v_url) > 2048 then
          raise exception 'invalid_image_url';
        end if;
        if lower(left(v_url, 8)) <> 'https://' then
          raise exception 'invalid_image_url';
        end if;
      end loop;
      v_evidence := jsonb_build_object('image_urls', v_urls);
    end if;
  end if;

  if exists (
    select 1
    from public.user_reports ur
    where ur.reporter_app_user_id = v_reporter
      and ur.reported_app_user_id = v_reported
      and ur.status in ('pending', 'reviewing')
  ) then
    raise exception 'duplicate_report';
  end if;

  insert into public.user_reports (
    reporter_app_user_id,
    reported_app_user_id,
    reason_code,
    description,
    evidence,
    status,
    priority
  )
  values (
    v_reporter,
    v_reported,
    v_reason,
    v_desc,
    v_evidence,
    'pending',
    'normal'
  )
  returning id into v_id;

  perform private.notify_admins_user_report_submitted(v_id, v_reported, v_reason);

  return v_id;
end;
$$;

revoke all on function public.submit_user_report(text, text, text, jsonb, text) from public;
grant execute on function public.submit_user_report(text, text, text, jsonb, text) to authenticated;

notify pgrst, 'reload schema';
