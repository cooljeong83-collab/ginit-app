import { useCallback, useMemo, useState } from 'react';

import { supabase } from '@/src/lib/supabase';

export const MEETING_REALTIME_SIGNALS_SUBCOLLECTION = 'realtimeSignals';

export type MeetingRealtimeSignalKind = 'vote_completed';

export type MeetingRealtimeSignalDoc = {
  kind: MeetingRealtimeSignalKind;
  /** 앱 사용자 PK(전화 PK 또는 이메일 PK 등) */
  userId: string;
  meetingId: string;
  /** 중복 방지/클라이언트 추적용(선택) */
  dedupeKey?: string | null;
  /** Supabase 쪽 처리 결과 요약(디버깅/운영용) */
  supabase?: {
    ok: boolean;
    /** RPC 이름 또는 테이블 업데이트 식별자 */
    mode: 'rpc' | 'table';
    rpcName?: string;
    table?: string;
  };
  createdAt: unknown;
};

export type UseMeetingUpdateOptions = {
  /**
   * Supabase 경험치 반영 방식.
   * - `rpc`: `supabase.rpc(rpcName, rpcArgs)` (권장: 서버에서 원자적으로 XP/레벨 처리)
   * - `table`: `supabase.from(table).update(patch).eq(eqColumn, eqValue)` (간단 패치)
   */
  supabaseXpMode?: 'rpc' | 'table';
  /** rpc 모드에서 호출할 함수명 (예: `apply_vote_xp`) */
  supabaseRpcName?: string;
  /** table 모드에서 업데이트할 테이블명 (예: `profiles`) */
  supabaseTable?: string;
  /** table 모드에서 where 컬럼 (예: `id` / `user_id`) */
  supabaseEqColumn?: string;
  /** table 모드에서 where 값으로 사용할 사용자 키(기본: `userId`) */
  supabaseEqValue?: string;
};

export type VoteCompletedPayload = {
  meetingId: string;
  userId: string;
  /** 레거시 필드 — Supabase `apply_vote_xp`는 `app_policies` xp.meeting_vote 를 사용합니다. */
  xpDelta?: number;
  /** RPC 인자로 그대로 전달할 추가 컨텍스트(선택) */
  rpcArgs?: Record<string, unknown>;
  /** table 모드에서 update patch에 합쳐질 추가 필드(선택) */
  tableExtraPatch?: Record<string, unknown>;
  /** 동일 사용자/모임/라운드에서 중복 신호 방지 키(선택) */
  dedupeKey?: string;
};

/**
 * 투표 완료 시 Supabase만 갱신합니다. (레거시 Firestore `realtimeSignals` 기록 제거)
 */
export function useMeetingUpdate(opts: UseMeetingUpdateOptions = {}) {
  const {
    supabaseXpMode = 'rpc',
    supabaseRpcName = 'apply_vote_xp',
    supabaseTable = 'profiles',
    supabaseEqColumn = 'id',
    supabaseEqValue,
  } = opts;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetError = useCallback(() => setError(null), []);

  const applyVoteXpInSupabase = useCallback(
    async (p: VoteCompletedPayload) => {
      if (supabaseXpMode === 'rpc') {
        const args: Record<string, unknown> = {
          p_meeting_id: p.meetingId,
          p_user_id: p.userId,
          p_xp_delta: p.xpDelta ?? 0,
          ...(p.rpcArgs ?? {}),
        };
        const { data, error: rpcError } = await supabase.rpc(supabaseRpcName, args);
        if (rpcError) throw rpcError;
        return { mode: 'rpc' as const, rpcName: supabaseRpcName, data };
      }

      const eqValue = (supabaseEqValue ?? p.userId).trim();
      if (!eqValue) throw new Error('Supabase table 업데이트에 필요한 eq 값이 비어있습니다.');

      const patch: Record<string, unknown> = {
        ...(p.tableExtraPatch ?? {}),
      };

      const { data, error: upError } = await supabase.from(supabaseTable).update(patch).eq(supabaseEqColumn, eqValue).select();
      if (upError) throw upError;
      return { mode: 'table' as const, table: supabaseTable, data };
    },
    [supabaseEqColumn, supabaseEqValue, supabaseRpcName, supabaseTable, supabaseXpMode],
  );

  const onVoteCompleted = useCallback(
    async (p: VoteCompletedPayload) => {
      setBusy(true);
      setError(null);
      try {
        const mid = p.meetingId.trim();
        const uid = p.userId.trim();
        if (!mid) throw new Error('meetingId가 비어있습니다.');
        if (!uid) throw new Error('userId가 비어있습니다.');

        await applyVoteXpInSupabase(p);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [applyVoteXpInSupabase],
  );

  return useMemo(
    () => ({
      busy,
      error,
      resetError,
      onVoteCompleted,
    }),
    [busy, error, onVoteCompleted, resetError],
  );
}
