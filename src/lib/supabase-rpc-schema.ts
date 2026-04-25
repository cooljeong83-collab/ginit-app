/** PostgREST가 아직 RPC를 스키마 캐시에 올리지 않았거나, DB에 함수가 없을 때 나는 메시지 */
export function isSupabaseRpcMissingOrStaleSchema(message: string | undefined | null): boolean {
  const m = String(message ?? '').toLowerCase();
  return (
    m.includes('schema cache') ||
    m.includes('could not find the function') ||
    m.includes('pgrst202')
  );
}
