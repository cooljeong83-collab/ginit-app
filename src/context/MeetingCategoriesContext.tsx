import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState, InteractionManager, Platform, type AppStateStatus } from 'react-native';

import type { Category } from '@/src/lib/categories';
import { fetchMeetingCategoriesFromSupabase } from '@/src/lib/categories';
import {
  readCachedMeetingCategoriesFromWatermelon,
  replaceWatermelonMeetingCategoriesCache,
} from '@/src/lib/categories-watermelon-cache';
import { MEETING_CATEGORIES_QUERY_KEY } from '@/src/lib/meeting-categories-query-key';
import { useUserSession } from '@/src/context/UserSessionContext';

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

async function hydrateMeetingCategoriesFromWatermelon(
  queryClient: ReturnType<typeof useQueryClient>,
): Promise<boolean> {
  const local = await readCachedMeetingCategoriesFromWatermelon();
  if (local.length === 0) return false;
  const existing = queryClient.getQueryData<Category[]>(MEETING_CATEGORIES_QUERY_KEY);
  if (existing && existing.length > 0) return true;
  queryClient.setQueryData(MEETING_CATEGORIES_QUERY_KEY, local);
  return true;
}

export function MeetingCategoriesProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { isHydrated } = useUserSession();
  const [networkFetchEnabled, setNetworkFetchEnabled] = useState(false);
  const hydrateInFlightRef = useRef(false);

  const runWatermelonHydrate = useCallback(() => {
    if (hydrateInFlightRef.current) return;
    hydrateInFlightRef.current = true;
    void hydrateMeetingCategoriesFromWatermelon(queryClient).finally(() => {
      hydrateInFlightRef.current = false;
    });
  }, [queryClient]);

  useLayoutEffect(() => {
    if (Platform.OS === 'web') return;
    runWatermelonHydrate();
  }, [runWatermelonHydrate]);

  /** 세션·스플래시 부트와 겹치지 않게 네트워크 fetch는 한 박자 뒤에 시작 */
  useEffect(() => {
    if (!isHydrated) return undefined;
    const task = InteractionManager.runAfterInteractions(() => {
      setNetworkFetchEnabled(true);
    });
    return () => task.cancel();
  }, [isHydrated]);

  useEffect(() => {
    if (Platform.OS === 'web') return undefined;
    const onAppState = (next: AppStateStatus) => {
      if (next !== 'active') return;
      runWatermelonHydrate();
      const rows = queryClient.getQueryData<Category[]>(MEETING_CATEGORIES_QUERY_KEY);
      if (!rows || rows.length === 0) {
        void queryClient.refetchQueries({ queryKey: MEETING_CATEGORIES_QUERY_KEY });
      }
    };
    const sub = AppState.addEventListener('change', onAppState);
    return () => sub.remove();
  }, [queryClient, runWatermelonHydrate]);

  const query = useQuery({
    queryKey: MEETING_CATEGORIES_QUERY_KEY,
    queryFn: meetingCategoriesSupabaseQueryFn,
    enabled: networkFetchEnabled,
    staleTime: Infinity,
    gcTime: Infinity,
    placeholderData: (previousData) => previousData,
    retry: 2,
    refetchOnReconnect: true,
    refetchOnMount: (query) => {
      const rows = Array.isArray(query.state.data) ? query.state.data : [];
      return rows.length === 0;
    },
  });

  const value = useMemo((): MeetingCategoriesContextValue => {
    const rows = Array.isArray(query.data) ? query.data.filter(Boolean) : [];
    const categoriesLoading = (query.isPending || query.isFetching) && rows.length === 0;
    const categoriesError =
      query.isError && rows.length === 0 && query.error instanceof Error ? query.error.message : null;
    return { categories: rows, categoriesLoading, categoriesError };
  }, [query.data, query.isPending, query.isFetching, query.isError, query.error]);

  return <MeetingCategoriesContext.Provider value={value}>{children}</MeetingCategoriesContext.Provider>;
}

export function useMeetingCategories(): MeetingCategoriesContextValue {
  const ctx = useContext(MeetingCategoriesContext);
  if (!ctx) {
    throw new Error('useMeetingCategories는 MeetingCategoriesProvider 안에서만 사용하세요.');
  }
  return ctx;
}
