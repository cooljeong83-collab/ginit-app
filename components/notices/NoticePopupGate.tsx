import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { NoticePopupModal } from '@/components/notices/NoticePopupModal';
import { useUserSession } from '@/src/context/UserSessionContext';
import { navigateFromNoticeLink } from '@/src/features/notices/notice-link-navigation';
import {
  isNoticePopupSnoozedToday,
  snoozeNoticePopupForToday,
} from '@/src/features/notices/notice-popup-storage';
import { useActiveNoticesQuery } from '@/src/hooks/use-active-notices-query';
import { useMarkNoticeInboxReadMutation } from '@/src/hooks/use-mark-notice-read-mutation';
import { useTransitionRouter } from '@/src/lib/screen-transition-navigation';

/**
 * 첫 화면 팝업 — 로그인 후 cold start / foreground 시 1회(세션) 노출.
 * DB 테이블 `user_notifications` 수신함과 별개; 채팅 Realtime 토픽 `user_notifications:{profiles.id}` 와 무관.
 */
export function NoticePopupGate() {
  const { userId, isHydrated } = useUserSession();
  const router = useTransitionRouter();
  const queryClient = useQueryClient();
  const enabled = Boolean(isHydrated && userId?.trim());
  const { data: popupItems } = useActiveNoticesQuery('popup', enabled);
  const markRead = useMarkNoticeInboxReadMutation();

  const [visibleNoticeId, setVisibleNoticeId] = useState<string | null>(null);
  const sessionShownRef = useRef<Set<string>>(new Set());
  const evaluatingRef = useRef(false);

  const pickAndShow = useCallback(async () => {
    if (evaluatingRef.current || !enabled) return;
    const items = popupItems ?? [];
    if (items.length === 0) return;

    evaluatingRef.current = true;
    try {
      for (const item of items) {
        if (sessionShownRef.current.has(item.id)) continue;
        if (await isNoticePopupSnoozedToday(item.id)) continue;
        sessionShownRef.current.add(item.id);
        setVisibleNoticeId(item.id);
        return;
      }
    } finally {
      evaluatingRef.current = false;
    }
  }, [enabled, popupItems]);

  useEffect(() => {
    void pickAndShow();
  }, [pickAndShow]);

  useEffect(() => {
    if (!enabled) return;
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        void queryClient.invalidateQueries({ queryKey: ['notices', 'active', 'popup'] });
        void pickAndShow();
      }
    });
    return () => sub.remove();
  }, [enabled, pickAndShow, queryClient]);

  const activeNotice = (popupItems ?? []).find((n) => n.id === visibleNoticeId) ?? null;

  const dismiss = useCallback(() => {
    setVisibleNoticeId(null);
  }, []);

  const ackRead = useCallback(
    async (noticeId: string, inboxId: string | null) => {
      try {
        if (inboxId) {
          await markRead.mutateAsync({ inboxId });
        } else {
          await markRead.mutateAsync({ noticeId });
        }
      } catch {
        /* best-effort */
      }
    },
    [markRead],
  );

  const onConfirm = useCallback(() => {
    if (!activeNotice) return;
    void ackRead(activeNotice.id, activeNotice.inboxId);
    dismiss();
    navigateFromNoticeLink(router, { noticeId: activeNotice.id, linkUrl: activeNotice.linkUrl });
  }, [activeNotice, ackRead, dismiss, router]);

  const onClose = useCallback(() => {
    if (activeNotice) void ackRead(activeNotice.id, activeNotice.inboxId);
    dismiss();
  }, [activeNotice, ackRead, dismiss]);

  const onSnoozeToday = useCallback(() => {
    if (activeNotice) void snoozeNoticePopupForToday(activeNotice.id);
    dismiss();
  }, [activeNotice, dismiss]);

  if (!activeNotice) return null;

  return (
    <NoticePopupModal
      notice={activeNotice}
      visible={Boolean(visibleNoticeId)}
      onClose={onClose}
      onConfirm={onConfirm}
      onSnoozeToday={onSnoozeToday}
    />
  );
}
