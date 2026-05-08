import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Platform } from 'react-native';

import type { Category } from '@/src/lib/categories';
import { fetchMeetingCategoriesFromSupabase, subscribeFirestoreCategories } from '@/src/lib/categories';
import {
  readCachedMeetingCategoriesFromWatermelon,
  replaceWatermelonMeetingCategoriesCache,
} from '@/src/lib/categories-watermelon-cache';
import { categoriesSource } from '@/src/lib/hybrid-data-source';
import { MEETING_CATEGORIES_QUERY_KEY } from '@/src/lib/meeting-categories-query-key';
import { supabase } from '@/src/lib/supabase';

type MeetingCategoriesContextValue = {
  /** 항상 배열 — `map` 등에서 undefined 방지 */
  categories: Category[];
  /** 화면에 쓸 데이터가 아직 없을 때만 true */
  categoriesLoading: boolean;
  /** 로컬/placeholder 없이 완전 실패일 때만 메시지 */
  categoriesError: string | null;
};

const MeetingCategoriesContext = createContext<MeetingCategoriesContextValue | null>(null);

async function meetingCategoriesSupabaseQueryFn(): Promise<Category[]> {
  const res = await fetchMeetingCategoriesFromSupabase();
  if (!res.ok) {
    const local = await readCachedMeetingCategoriesFromWatermelon();
    if (local.length > 0) return local;
    throw new Error(res.message);
  }
  await replaceWatermelonMeetingCategoriesCache(res.list);
  return res.list;
}

export function MeetingCategoriesProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const didWmHydrateRef = useRef(false);
  const [firestoreCategoriesReady, setFirestoreCategoriesReady] = useState(() => categoriesSource() === 'supabase');

  useLayoutEffect(() => {
    if (Platform.OS === 'web') return;
    let cancelled = false;
    void (async () => {
      const local = await readCachedMeetingCategoriesFromWatermelon();
      if (cancelled || didWmHydrateRef.current) return;
      didWmHydrateRef.current = true;
      if (local.length === 0) return;
      const existing = queryClient.getQueryData<Category[]>(MEETING_CATEGORIES_QUERY_KEY);
      if (existing && existing.length > 0) return;
      queryClient.setQueryData(MEETING_CATEGORIES_QUERY_KEY, local);
    })();
    return () => {
      cancelled = true;
    };
  }, [queryClient]);

  const supabaseMode = categoriesSource() === 'supabase';

  const query = useQuery({
    queryKey: MEETING_CATEGORIES_QUERY_KEY,
    queryFn: meetingCategoriesSupabaseQueryFn,
    enabled: supabaseMode,
    staleTime: Infinity,
    gcTime: Infinity,
    placeholderData: (previousData) => previousData,
    retry: 1,
  });

  useEffect(() => {
    if (!supabaseMode) return;
    void queryClient.invalidateQueries({ queryKey: MEETING_CATEGORIES_QUERY_KEY });
  }, [queryClient, supabaseMode]);

  useEffect(() => {
    if (!supabaseMode) return;
    let cancelled = false;
    const channelTopic = `meeting_categories:${Date.now()}:${Math.random().toString(36).slice(2, 11)}`;
    const channel = supabase
      .channel(channelTopic)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'meeting_categories' },
        () => {
          void queryClient.invalidateQueries({ queryKey: MEETING_CATEGORIES_QUERY_KEY });
        },
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' && !cancelled) {
          void queryClient.invalidateQueries({ queryKey: MEETING_CATEGORIES_QUERY_KEY });
        }
      });
    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [queryClient, supabaseMode]);

  useEffect(() => {
    if (supabaseMode) return;
    const unsub = subscribeFirestoreCategories(
      (list) => {
        setFirestoreCategoriesReady(true);
        const safe = Array.isArray(list) ? list.filter(Boolean) : [];
        queryClient.setQueryData(MEETING_CATEGORIES_QUERY_KEY, safe);
        void replaceWatermelonMeetingCategoriesCache(safe);
      },
      () => {
        setFirestoreCategoriesReady(true);
        /* Firestore 일시 오류: 기존 React Query 캐시 유지 */
      },
    );
    return unsub;
  }, [queryClient, supabaseMode]);

  const value = useMemo((): MeetingCategoriesContextValue => {
    const rows = Array.isArray(query.data) ? query.data.filter(Boolean) : [];
    const categoriesLoading = supabaseMode
      ? query.isPending && rows.length === 0
      : !firestoreCategoriesReady && rows.length === 0;
    const categoriesError =
      query.isError && rows.length === 0 && query.error instanceof Error ? query.error.message : null;
    return { categories: rows, categoriesLoading, categoriesError };
  }, [
    query.data,
    query.isPending,
    query.isError,
    query.error,
    supabaseMode,
    firestoreCategoriesReady,
  ]);

  return <MeetingCategoriesContext.Provider value={value}>{children}</MeetingCategoriesContext.Provider>;
}

export function useMeetingCategories(): MeetingCategoriesContextValue {
  const ctx = useContext(MeetingCategoriesContext);
  if (!ctx) {
    throw new Error('useMeetingCategories는 MeetingCategoriesProvider 안에서만 사용하세요.');
  }
  return ctx;
}
