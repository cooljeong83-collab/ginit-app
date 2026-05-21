import { useEffect, useState } from 'react';

import { isTransientNetworkErrorMessage } from '@/src/lib/supabase-realtime-resilience';
import {
  getUserProfile,
  isMeetingServiceComplianceComplete,
} from '@/src/lib/user-profile';
import { readUserProfileFromWatermelon } from '@/src/lib/user-profile-watermelon-cache';

export type MeetingServiceComplianceGateStatus =
  | 'pending'
  | 'complete'
  | 'incomplete'
  /** 네트워크 등으로 인증 완료 여부를 확인하지 못함 — 미인증 UI 표시 안 함 */
  | 'unknown';

export type MeetingServiceComplianceGate = {
  status: MeetingServiceComplianceGateStatus;
  ready: boolean;
  /** @deprecated `status === 'complete'` 사용 */
  complete: boolean;
  viewBlockedByCompliance: boolean;
};

function isProfileGateTransientError(e: unknown): boolean {
  if (e instanceof Error && isTransientNetworkErrorMessage(e.message)) return true;
  if (typeof e === 'string' && isTransientNetworkErrorMessage(e)) return true;
  return false;
}

/**
 * 모임 상세 열람용 인증 게이트 — Watermelon 캐시 우선, 네트워크 실패는 `unknown`(미인증 오판 방지).
 * 홈 피드 모임 탭 진입 정책과 동일: 「확인 못 함 ≠ 미인증」.
 */
export function useMeetingServiceComplianceGate(sessionPk: string | null | undefined): MeetingServiceComplianceGate {
  const [status, setStatus] = useState<MeetingServiceComplianceGateStatus>('pending');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const pk = sessionPk?.trim() ?? '';

    const finish = (next: MeetingServiceComplianceGateStatus) => {
      if (cancelled) return;
      setStatus(next);
      setReady(true);
    };

    if (!pk) {
      finish('incomplete');
      return () => {
        cancelled = true;
      };
    }

    setReady(false);
    setStatus('pending');

    void (async () => {
      try {
        const local = await readUserProfileFromWatermelon(pk);
        if (local && isMeetingServiceComplianceComplete(local, pk)) {
          finish('complete');
          void getUserProfile(pk).catch(() => {
            /* 백그라운드 revalidate */
          });
          return;
        }

        const p = await getUserProfile(pk);
        if (cancelled) return;
        finish(isMeetingServiceComplianceComplete(p, pk) ? 'complete' : 'incomplete');
      } catch (e) {
        if (cancelled) return;
        if (isProfileGateTransientError(e)) {
          const local = await readUserProfileFromWatermelon(pk).catch(() => null);
          if (cancelled) return;
          if (local && isMeetingServiceComplianceComplete(local, pk)) {
            finish('complete');
            return;
          }
          finish('unknown');
          return;
        }
        finish('incomplete');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionPk]);

  const viewBlockedByCompliance = ready && status === 'incomplete';

  return {
    status,
    ready,
    complete: status === 'complete',
    viewBlockedByCompliance,
  };
}
