/**
 * 실시간 알림 신호 — Firestore `notifications` 컬렉션(스펙 확장).
 *
 * - 문서 예시 필드: `userId`(앱 PK = app_user_id), `type`, `payload`, `createdAt`, `readAt`
 * - 채팅 메시지 본문은 `meetings/{meetingId}/messages`에 유지하고, 여기서는 "새 이벤트 있음"만 전달하는 용도를 권장합니다.
 *
 * `InAppAlarmsContext` 등에서 `subscribeNotificationsForUser`를 연결하면 멀티 기기 동기화에 유리합니다.
 */
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type Unsubscribe,
} from 'firebase/firestore';

import { getFirebaseFirestore } from '@/src/lib/firebase';

export const NOTIFICATIONS_COLLECTION = 'notifications';

export type NotificationDoc = {
  id: string;
  userId: string;
  type: string;
  payload?: Record<string, unknown> | null;
  createdAt?: unknown;
  readAt?: unknown;
};

function mapNotificationDoc(id: string, data: Record<string, unknown>): NotificationDoc {
  return {
    id,
    userId: typeof data.userId === 'string' ? data.userId.trim() : '',
    type: typeof data.type === 'string' ? data.type.trim() : 'unknown',
    payload:
      data.payload && typeof data.payload === 'object' && !Array.isArray(data.payload)
        ? (data.payload as Record<string, unknown>)
        : null,
    createdAt: data.createdAt ?? data.created_at ?? null,
    readAt: data.readAt ?? data.read_at ?? null,
  };
}

/**
 * 특정 사용자(`userId` = 앱 PK)의 알림 문서를 최신순으로 구독합니다.
 */
export function subscribeNotificationsForUser(
  appUserId: string,
  onData: (items: NotificationDoc[]) => void,
  onError?: (message: string) => void,
  maxRows = 80,
): Unsubscribe {
  const uid = appUserId.trim();
  if (!uid) {
    onData([]);
    return () => {};
  }
  const ref = collection(getFirebaseFirestore(), NOTIFICATIONS_COLLECTION);
  const q = query(ref, where('userId', '==', uid), orderBy('createdAt', 'desc'), limit(maxRows));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => mapNotificationDoc(d.id, d.data() as Record<string, unknown>));
      onData(list);
    },
    (err) => {
      onError?.(err.message ?? '알림 구독 오류');
    },
  );
}
