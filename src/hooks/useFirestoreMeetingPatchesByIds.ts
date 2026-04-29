import { collection, documentId, onSnapshot, query, where, type Unsubscribe } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';

import { getFirestoreDb, mapFirestoreMeetingDoc, MEETINGS_COLLECTION, type Meeting } from '@/src/lib/meetings';

const FIRESTORE_IN_CHUNK = 28;

function chunkIds(ids: readonly string[]): string[][] {
  const uniq = [...new Set(ids.map((x) => x.trim()).filter(Boolean))];
  const out: string[][] = [];
  for (let i = 0; i < uniq.length; i += FIRESTORE_IN_CHUNK) {
    out.push(uniq.slice(i, i + FIRESTORE_IN_CHUNK));
  }
  return out;
}

/**
 * Supabase 목록만 쓸 때 지도·목록에 Firestore `participantIds` 등 실시간 반영.
 * id 집합이 자주 바뀌므로 구독 키는 디바운스합니다.
 */
export function useFirestoreMeetingPatchesByIds(ids: readonly string[], enabled: boolean): Map<string, Meeting> {
  const [patches, setPatches] = useState<Map<string, Meeting>>(() => new Map());
  const [debouncedKey, setDebouncedKey] = useState('');

  const rawKey = useMemo(() => [...new Set(ids)].filter(Boolean).sort().join('\u0001'), [ids]);

  useEffect(() => {
    if (!enabled) {
      setDebouncedKey('');
      return;
    }
    const t = setTimeout(() => setDebouncedKey(rawKey), 400);
    return () => clearTimeout(t);
  }, [enabled, rawKey]);

  useEffect(() => {
    if (!enabled || !debouncedKey) {
      setPatches(new Map());
      return;
    }
    const idList = debouncedKey.split('\u0001').filter(Boolean);
    if (idList.length === 0) {
      setPatches(new Map());
      return;
    }

    const parts = chunkIds(idList);
    const merged = new Map<string, Meeting>();
    const unsubs: Unsubscribe[] = [];

    const emit = () => {
      setPatches(new Map(merged));
    };

    for (const part of parts) {
      try {
        const ref = collection(getFirestoreDb(), MEETINGS_COLLECTION);
        const q = query(ref, where(documentId(), 'in', part));
        unsubs.push(
          onSnapshot(
            q,
            (snap) => {
              for (const d of snap.docs) {
                if (!d.exists()) continue;
                merged.set(d.id, mapFirestoreMeetingDoc(d.id, d.data() as Record<string, unknown>));
              }
              emit();
            },
            () => {
              /* 권한·네트워크 오류 시 Supabase 데이터만 사용 */
            },
          ),
        );
      } catch {
        /* getFirestoreDb 등 초기화 실패 */
      }
    }

    return () => {
      for (const u of unsubs) {
        try {
          u();
        } catch {
          /* ignore */
        }
      }
    };
  }, [enabled, debouncedKey]);

  return patches;
}
