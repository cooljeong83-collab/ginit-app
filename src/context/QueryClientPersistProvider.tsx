import { defaultShouldDehydrateQuery } from '@tanstack/query-core';
import { QueryClient } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import type { ReactNode } from 'react';
import { useMemo } from 'react';

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

const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'ginit-react-query-meetings-v1',
  throttleTime: 2000,
});

export function QueryClientPersistProvider({ children }: { children: ReactNode }) {
  const client = useMemo(() => getOrCreateQueryClient(), []);
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
              (query.queryKey[0] === 'meeting-chat' && query.queryKey[1] === 'messages')),
        },
      }}>
      {children}
    </PersistQueryClientProvider>
  );
}
