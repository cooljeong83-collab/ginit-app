import { Redirect, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';

/** 레거시 상세 경로 → `/notices/[id]` */
export default function LegacySupportAnnouncementDetailRedirect() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = useMemo(() => {
    const raw = params.id;
    return (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? '';
  }, [params.id]);

  if (!id) return <Redirect href="/notices/inbox" />;
  return <Redirect href={`/notices/${encodeURIComponent(id)}`} />;
}
