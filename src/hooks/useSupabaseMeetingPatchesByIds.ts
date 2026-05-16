import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { normalizeParticipantId } from '@/src/lib/app-user-id';
import type { Meeting } from '@/src/lib/meetings';
import { fetchMeetingsForSyncByIds } from '@/src/lib/supabase-meetings-list';

const SUPABASE_IN_CHUNK = 80;

function chunkIds(ids: readonly string[]): string[][] {
  const uniq = [...new Set(ids.map((x) => x.trim()).filter(Boolean))];
  const out: string[][] = [];
  for (let i = 0; i < uniq.length; i += SUPABASE_IN_CHUNK) {
    out.push(uniq.slice(i, i + SUPABASE_IN_CHUNK));
  }
  return out;
}

/**
 * 지도·목록에서 `participantIds`·투표 요약 등을 Supabase로 보강합니다.
 * (기존 Firestore `onSnapshot` 패치 훅 대체.)
 */
export function useSupabaseMeetingPatchesByIds(
  ids: readonly string[],
  enabled: boolean,
  viewerAppUserId: string | null | undefined,
): Map<string, Meeting> {
  const rawKey = useMemo(() => [...new Set(ids)].filter(Boolean).sort().join('\u0001'), [ids]);
  const [debouncedKey, setDebouncedKey] = useState('');

  useEffect(() => {
    if (!enabled) {
      setDebouncedKey('');
      return;
    }
    const t = setTimeout(() => setDebouncedKey(rawKey), 400);
    return () => clearTimeout(t);
  }, [enabled, rawKey]);

  const viewer = normalizeParticipantId(viewerAppUserId ?? '') || viewerAppUserId?.trim() || '';

  const query = useQuery({
    queryKey: ['supabase-meeting-patches', debouncedKey, viewer],
    enabled: enabled && debouncedKey.length > 0,
    staleTime: 15_000,
    queryFn: async () => {
      const idList = debouncedKey.split('\u0001').filter(Boolean);
      if (idList.length === 0) return new Map<string, Meeting>();
      const parts = chunkIds(idList);
      const merged = new Map<string, Meeting>();
      for (const part of parts) {
        const res = await fetchMeetingsForSyncByIds(part, viewer || null);
        if (!res.ok) throw new Error(res.message);
        for (const m of res.meetings) {
          const mid = typeof m.id === 'string' ? m.id.trim() : '';
          if (mid) merged.set(mid, m);
        }
      }
      return merged;
    },
  });

  return query.data ?? new Map();
}
