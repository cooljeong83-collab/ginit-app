import { defaultShouldDehydrateQuery } from '@tanstack/query-core';
import { QueryClient, focusManager } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import type { ReactNode } from 'react';
import { useEffect, useMemo } from 'react';
import { AppState } from 'react-native';

const STALE_MS = 10 * 60 * 1000;
const GC_MS = 24 * 60 * 60 * 1000;

function createAppQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE_MS,
        gcTime: GC_MS,
      },
    },
  });
}

let appQueryClient: QueryClient | undefined;

function getOrCreateQueryClient() {
  if (!appQueryClient) appQueryClient = createAppQueryClient();
  return appQueryClient;
}

/** FCM 백그라운드 핸들러 등 React 트리 밖에서 동일 QueryClient 인스턴스를 참조할 때 사용 */
export function getAppQueryClient(): QueryClient {
  return getOrCreateQueryClient();
}

const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'ginit-react-query-meetings-v2',
  throttleTime: 2000,
});

export function QueryClientPersistProvider({ children }: { children: ReactNode }) {
  const client = useMemo(() => getAppQueryClient(), []);

  useEffect(() => {
    focusManager.setFocused(AppState.currentState === 'active');
    const sub = AppState.addEventListener('change', (next) => {
      focusManager.setFocused(next === 'active');
    });
    return () => {
      sub.remove();
      focusManager.setFocused(undefined);
    };
  }, []);

  return (
    <PersistQueryClientProvider
      client={client}
      persistOptions={{
        persister,
        maxAge: GC_MS,
        dehydrateOptions: {
          shouldDehydrateQuery: (query) =>
            defaultShouldDehydrateQuery(query) &&
            Array.isArray(query.queryKey) &&
            ((query.queryKey[0] === 'meetings' && query.queryKey[1] === 'feed') ||
              (query.queryKey[0] === 'meetings' && query.queryKey[1] === 'my-feed') ||
              (query.queryKey[0] === 'meeting-chat' && query.queryKey[1] === 'messages') ||
              (query.queryKey[0] === 'social-chat' && query.queryKey[1] === 'messages') ||
              (query.queryKey[0] === 'chat' && query.queryKey[1] === 'rooms') ||
              (query.queryKey[0] === 'meeting' &&
                typeof query.queryKey[1] === 'string' &&
                query.queryKey[1] !== '__none')),
        },
      }}>
      {children}
    </PersistQueryClientProvider>
  );
}
