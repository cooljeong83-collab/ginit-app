-- PostgREST 스키마 캐시가 `friends_send_ginit` RPC를 못 찾는 경우 재로드합니다.
-- (원격 Supabase에서 SQL 마이그레이션 적용 후에도 /rpc 노출이 늦거나 꼬였을 때 대비)

notify pgrst, 'reload schema';

