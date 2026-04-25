-- PostgREST schema cache에 ledger_meeting_delete 가 없을 때 대비.
-- 앱은 supabase.rpc('ledger_meeting_delete', { p_meeting_id }) 로 호출합니다.

create or replace function public.ledger_meeting_delete(p_meeting_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.meetings where id = p_meeting_id::uuid;
end;
$$;

revoke all on function public.ledger_meeting_delete(text) from public;
grant execute on function public.ledger_meeting_delete(text) to anon, authenticated;

notify pgrst, 'reload schema';
