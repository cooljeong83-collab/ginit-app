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
import type { ActiveNoticeItem } from '@/src/features/notices/notices-api';
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

  const [visibleNotices, setVisibleNotices] = useState<ActiveNoticeItem[]>([]);
  const sessionShownRef = useRef<Set<string>>(new Set());
  const evaluatingRef = useRef(false);

  const pickAndShow = useCallback(async () => {
    if (evaluatingRef.current || !enabled || visibleNotices.length > 0) return;
    const items = popupItems ?? [];
    if (items.length === 0) return;

    evaluatingRef.current = true;
    try {
      const eligible: ActiveNoticeItem[] = [];
      for (const item of items) {
        if (sessionShownRef.current.has(item.id)) continue;
        if (await isNoticePopupSnoozedToday(item.id)) continue;
        sessionShownRef.current.add(item.id);
        eligible.push(item);
      }
      if (eligible.length > 0) {
        setVisibleNotices(eligible);
      }
    } finally {
      evaluatingRef.current = false;
    }
  }, [enabled, popupItems, visibleNotices.length]);

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

  const dismiss = useCallback(() => {
    setVisibleNotices([]);
  }, []);

  const ackRead = useCallback(
    async (notice: ActiveNoticeItem) => {
      try {
        if (notice.inboxId) {
          await markRead.mutateAsync({ inboxId: notice.inboxId });
        } else {
          await markRead.mutateAsync({ noticeId: notice.id });
        }
      } catch {
        /* best-effort */
      }
    },
    [markRead],
  );

  const onConfirm = useCallback(
    (notice: ActiveNoticeItem) => {
      void ackRead(notice);
      dismiss();
      navigateFromNoticeLink(router, { noticeId: notice.id, linkUrl: notice.linkUrl });
    },
    [ackRead, dismiss, router],
  );

  const onClose = useCallback(
    (notice: ActiveNoticeItem) => {
      void ackRead(notice);
      dismiss();
    },
    [ackRead, dismiss],
  );

  const onSnoozeToday = useCallback(
    (notice: ActiveNoticeItem) => {
      void snoozeNoticePopupForToday(notice.id);
      dismiss();
    },
    [dismiss],
  );

  if (visibleNotices.length === 0) return null;

  return (
    <NoticePopupModal
      notices={visibleNotices}
      visible
      onClose={onClose}
      onConfirm={onConfirm}
      onSnoozeToday={onSnoozeToday}
    />
  );
}
