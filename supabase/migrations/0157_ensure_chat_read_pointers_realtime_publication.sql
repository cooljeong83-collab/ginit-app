-- 말풍선 읽음 Realtime: `chat_read_pointers`가 publication에 없으면 추가(0143와 동일·멱등).
-- 배포 누락·수동 제거 복구용 side-effect 없음.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_read_pointers'
  ) then
    execute 'alter publication supabase_realtime add table public.chat_read_pointers';
  end if;
end $$;

notify pgrst, 'reload schema';
