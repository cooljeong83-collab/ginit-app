import { useEffect, useMemo, useState } from 'react';

import { normalizeParticipantId } from '@/src/lib/app-user-id';
import type { Meeting } from '@/src/lib/meetings';
import { getUserProfile } from '@/src/lib/user-profile';

const DEBOUNCE_MS = 450;
const CONCURRENCY = 6;

async function runPool<T>(items: readonly T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (i < items.length) {
      const idx = i;
      i += 1;
      const item = items[idx]!;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

/**
 * 지도에 표시할 모임 주최자 `photoUrl` — RPC 배치(제한 동시) + 디바운스.
 */
export function useMapHostPhotoUrls(meetings: readonly Meeting[]): ReadonlyMap<string, string> {
  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(() => new Map());

  const keys = useMemo(() => {
    const set = new Set<string>();
    for (const m of meetings) {
      const raw = m.createdBy?.trim();
      if (!raw) continue;
      const k = normalizeParticipantId(raw) ?? raw;
      if (k) set.add(k);
    }
    return [...set].sort().join('\u0001');
  }, [meetings]);

  useEffect(() => {
    const ids = keys.split('\u0001').filter(Boolean);
    if (ids.length === 0) {
      setUrls(new Map());
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      void (async () => {
        const next = new Map<string, string>();
        await runPool(ids, CONCURRENCY, async (id) => {
          try {
            const p = await getUserProfile(id);
            const u = p?.photoUrl?.trim();
            if (u && /^https:\/\//i.test(u)) next.set(id, u);
          } catch {
            /* ignore */
          }
        });
        if (!cancelled) setUrls(next);
      })();
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [keys]);

  return urls;
}
