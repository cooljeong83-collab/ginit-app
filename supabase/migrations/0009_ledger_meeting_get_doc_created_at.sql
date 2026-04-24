-- Anon은 비공개 모임 행을 SELECT 할 수 없으므로, get_doc RPC가 created_at을 fs와 병합해 반환합니다.

create or replace function public.ledger_meeting_get_doc(p_meeting_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v uuid;
  v_fs jsonb;
  v_created timestamptz;
begin
  if p_meeting_id is null or trim(p_meeting_id) = '' then
    return null;
  end if;
  begin
    v := trim(p_meeting_id)::uuid;
  exception when others then
    return null;
  end;

  select coalesce(m.extra_data->'fs', '{}'::jsonb), m.created_at
  into v_fs, v_created
  from public.meetings m
  where m.id = v;

  if not found then
    return null;
  end if;

  if v_created is not null then
    return v_fs || jsonb_build_object('createdAt', to_jsonb(v_created));
  end if;

  return v_fs;
end;
$$;
