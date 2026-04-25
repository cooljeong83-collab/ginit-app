import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { publicEnv } from '@/src/config/public-env';
import {
  hydrateAppPoliciesFromRows,
  type AppPolicyCacheRow,
} from '@/src/lib/app-policies-store';
import { supabase } from '@/src/lib/supabase';

export type AppPolicyRow = AppPolicyCacheRow;

type AppPoliciesContextValue = {
  policies: AppPolicyRow[];
  isReady: boolean;
  loadError: string | null;
  refresh: () => Promise<void>;
  /** 정책 캐시 갱신 시 증가 — 겹침·참여 게이트 등 메모이제이션 의존용 */
  version: number;
};

const AppPoliciesContext = createContext<AppPoliciesContextValue | null>(null);

const POLICY_POLL_MS = 10 * 60 * 1000;

async function fetchAppPolicies(): Promise<{ ok: true; rows: AppPolicyRow[] } | { ok: false; message: string }> {
  if (!publicEnv.supabaseUrl?.trim() || !publicEnv.supabaseAnonKey?.trim()) {
    return { ok: true, rows: [] };
  }
  const { data, error } = await supabase
    .from('app_policies')
    .select('policy_group, policy_key, policy_value, is_active, description');
  if (error) return { ok: false, message: error.message };

  const rows: AppPolicyRow[] = (data ?? []).map((r) => {
    const o = r as Record<string, unknown>;
    return {
      policy_group: String(o.policy_group ?? '').trim(),
      policy_key: String(o.policy_key ?? '').trim(),
      policy_value: o.policy_value,
      is_active: o.is_active !== false,
      description: typeof o.description === 'string' ? o.description : null,
    };
  });

  return {
    ok: true,
    rows: rows.filter((x) => x.policy_group.length > 0 && x.policy_key.length > 0),
  };
}

export function AppPoliciesProvider({ children }: { children: ReactNode }) {
  const [policies, setPolicies] = useState<AppPolicyRow[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const refresh = useCallback(async () => {
    const res = await fetchAppPolicies();
    if (!res.ok) {
      setLoadError(res.message);
      setPolicies([]);
      hydrateAppPoliciesFromRows([]);
      setVersion((v) => v + 1);
      setIsReady(true);
      return;
    }
    setLoadError(null);
    setPolicies(res.rows);
    hydrateAppPoliciesFromRows(res.rows);
    setVersion((v) => v + 1);
    setIsReady(true);
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      await refresh();
      if (!alive) return;
    })();
    return () => {
      alive = false;
    };
  }, [refresh]);

  /** Supabase Realtime: 관리자가 정책 테이블을 수정하면 즉시 재로드 */
  useEffect(() => {
    if (!publicEnv.supabaseUrl?.trim() || !publicEnv.supabaseAnonKey?.trim()) return;

    const channel = supabase
      .channel(`app_policies:${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'app_policies' },
        () => {
          void refresh();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [refresh]);

  /** 주기적 재검증(Realtime 누락·네트워크 복구 대비) */
  useEffect(() => {
    if (!publicEnv.supabaseUrl?.trim() || !publicEnv.supabaseAnonKey?.trim()) return;
    const id = setInterval(() => {
      void refresh();
    }, POLICY_POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const value = useMemo(
    () => ({
      policies,
      isReady,
      loadError,
      refresh,
      version,
    }),
    [policies, isReady, loadError, refresh, version],
  );

  return <AppPoliciesContext.Provider value={value}>{children}</AppPoliciesContext.Provider>;
}

export function useAppPolicies(): AppPoliciesContextValue {
  const ctx = useContext(AppPoliciesContext);
  if (!ctx) {
    throw new Error('useAppPolicies must be used within AppPoliciesProvider');
  }
  return ctx;
}
