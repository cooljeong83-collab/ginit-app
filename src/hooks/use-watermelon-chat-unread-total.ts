import { Q } from '@nozbe/watermelondb';
import { useEffect, useState } from 'react';

import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { candidateUserKeys } from '@/src/lib/meeting-chat-rooms-summary';
import { unreadCountForChatRoomListRow } from '@/src/lib/offline-chat/offline-chat-rooms';
import { WM_CHAT_ROOM_LIST_OBSERVE_COLUMNS } from '@/src/lib/watermelon-observe-columns';
import { database } from '@/src/watermelon';

/**
 * 내 `chat_rooms` 행의 `unread_count` 합 — 서버·브로드캐스트가 로컬에 반영된 값만 사용(클라이언트 가산 없음).
 */
export function useWatermelonChatUnreadTotal(args: { ownerUserId: string | null | undefined; enabled: boolean }): number {
  const raw = args.ownerUserId?.trim() ?? '';
  const uid = normalizeParticipantId(raw) || raw;
  const [total, setTotal] = useState(0);

  useEffect(() => {
    const db = database;
    if (!db || !args.enabled || !uid) {
      setTotal(0);
      return;
    }

    const ownerKeys = candidateUserKeys(uid);
    const ownerClause =
      ownerKeys.length === 0
        ? Q.where('owner_user_id', uid)
        : ownerKeys.length === 1
          ? Q.where('owner_user_id', ownerKeys[0])
          : Q.where('owner_user_id', Q.oneOf(ownerKeys));
    const query = db.get('chat_rooms').query(ownerClause);
    const sub = query.observeWithColumns([...WM_CHAT_ROOM_LIST_OBSERVE_COLUMNS]).subscribe((rows: any[]) => {
      let sum = 0;
      for (const r of rows) {
        sum += unreadCountForChatRoomListRow(r);
      }
      setTotal(sum);
    });
    return () => sub.unsubscribe();
  }, [uid, args.enabled]);

  return total;
}
