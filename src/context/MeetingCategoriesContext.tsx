import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { Platform } from 'react-native';

import type { Category } from '@/src/lib/categories';
import { fetchMeetingCategoriesFromSupabase } from '@/src/lib/categories';
import {
  readCachedMeetingCategoriesFromWatermelon,
  replaceWatermelonMeetingCategoriesCache,
} from '@/src/lib/categories-watermelon-cache';
import { MEETING_CATEGORIES_QUERY_KEY } from '@/src/lib/meeting-categories-query-key';

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

  const query = useQuery({
    queryKey: MEETING_CATEGORIES_QUERY_KEY,
    queryFn: meetingCategoriesSupabaseQueryFn,
    staleTime: Infinity,
    gcTime: Infinity,
    placeholderData: (previousData) => previousData,
    retry: 1,
  });

  const value = useMemo((): MeetingCategoriesContextValue => {
    const rows = Array.isArray(query.data) ? query.data.filter(Boolean) : [];
    const categoriesLoading = query.isPending && rows.length === 0;
    const categoriesError =
      query.isError && rows.length === 0 && query.error instanceof Error ? query.error.message : null;
    return { categories: rows, categoriesLoading, categoriesError };
  }, [query.data, query.isPending, query.isError, query.error]);

  return <MeetingCategoriesContext.Provider value={value}>{children}</MeetingCategoriesContext.Provider>;
}

export function useMeetingCategories(): MeetingCategoriesContextValue {
  const ctx = useContext(MeetingCategoriesContext);
  if (!ctx) {
    throw new Error('useMeetingCategories는 MeetingCategoriesProvider 안에서만 사용하세요.');
  }
  return ctx;
}
