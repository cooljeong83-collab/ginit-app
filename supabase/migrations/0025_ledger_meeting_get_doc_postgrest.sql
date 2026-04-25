-- PostgREST schema cache에 ledger_meeting_get_doc 가 없을 때(캐시 미갱신·RPC 미노출) 대비.
-- 0009 와 동일 본문; grants + NOTIFY 로 PostgREST가 함수를 다시 노출합니다.

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

revoke all on function public.ledger_meeting_get_doc(text) from public;
grant execute on function public.ledger_meeting_get_doc(text) to anon, authenticated;

notify pgrst, 'reload schema';
