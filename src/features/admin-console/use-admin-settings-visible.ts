import { useCallback, useRef, useState } from 'react';

import { fetchAdminSessionGate } from '@/src/features/admin-reports/admin-session-gate';

/**
 * 프로필 설정 등 일반 UI에서 어드민 섹션 노출 여부만 판별합니다.
 * — 어드민 라우트·신고 API와 분리된 얇은 게이트 조회 (실패 시 비노출).
 */
export function useAdminSettingsVisible(sessionActive: boolean) {
  const [adminSectionVisible, setAdminSectionVisible] = useState(false);
  const fetchGenRef = useRef(0);

  const refreshAdminGate = useCallback(async () => {
    if (!sessionActive) {
      setAdminSectionVisible(false);
      return;
    }
    const gen = ++fetchGenRef.current;
    try {
      const gate = await fetchAdminSessionGate();
      if (gen !== fetchGenRef.current) return;
      setAdminSectionVisible(Boolean(gate.ok && gate.admin));
    } catch {
      if (gen !== fetchGenRef.current) return;
      setAdminSectionVisible(false);
    }
  }, [sessionActive]);

  return { adminSectionVisible, refreshAdminGate };
}
