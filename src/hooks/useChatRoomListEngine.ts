import { Q } from '@nozbe/watermelondb';
import { useEffect, useMemo, useState } from 'react';

import { candidateUserKeys } from '@/src/lib/meeting-chat-rooms-summary';
import { mapLocalChatRoomRow, type LocalChatRoomSummary } from '@/src/lib/offline-chat/offline-chat-rooms';
import type { OfflineChatRoomType } from '@/src/lib/offline-chat/offline-chat-types';
import { WM_CHAT_ROOM_LIST_OBSERVE_COLUMNS } from '@/src/lib/watermelon-observe-columns';
import { database } from '@/src/watermelon';

/**
 * 채팅 목록 전용: `chat_rooms`를 Watermelon `observeWithColumns`로 구독합니다.
 * 서버 목록 API는 이 훅 밖(예: `useChatRoomsInfiniteQuery`의 sync)에서 로컬에 upsert하고,
 * UI는 로컬 변경만으로 즉시 갱신됩니다.
 */
export function useChatRoomListEngine(args: {
  roomType: OfflineChatRoomType;
  ownerUserId?: string | null;
  enabled: boolean;
  limit?: number;
}): LocalChatRoomSummary[] {
  const { roomType, ownerUserId, enabled, limit } = args;
  const [rows, setRows] = useState<LocalChatRoomSummary[]>([]);
  const owner = ownerUserId?.trim() ?? '';

  useEffect(() => {
    const db = database;
    if (!db || !enabled) {
      setRows([]);
      return;
    }
    const take = Math.min(Math.max(20, limit ?? 500), 5000);
    const ownerKeys = owner ? candidateUserKeys(owner) : [];
    /**
     * `take`는 DB 전체가 아니라 **내 owner 행만** 대상이어야 합니다.
     * 그렇지 않으면 타 owner·레거시 행이 상위 500을 채워 내 소셜 방이 observe 결과에서 빠지고 목록이 안 움직입니다.
     */
    const ownerSql =
      ownerKeys.length === 0
        ? []
        : [
            Q.or(
              Q.where('owner_user_id', null),
              ownerKeys.length === 1
                ? Q.where('owner_user_id', ownerKeys[0])
                : Q.where('owner_user_id', Q.oneOf(ownerKeys)),
            ),
          ];
    const clauses = [
      Q.where('room_type', roomType),
      ...ownerSql,
      Q.sortBy('last_message_at_ms', Q.desc),
      Q.sortBy('remote_updated_at_ms', Q.desc),
      Q.take(take),
    ];
    const query = db.get('chat_rooms').query(...clauses);
    const sub = query.observeWithColumns([...WM_CHAT_ROOM_LIST_OBSERVE_COLUMNS]).subscribe((records: any[]) => {
      const mapped = records
        .map(mapLocalChatRoomRow)
        .filter((r) => {
          if (!r.roomId.trim()) return false;
          if (roomType === 'social_dm' && !r.peerAppUserId.trim()) return false;
          if (owner) {
            const rowOwn = (r.ownerUserId ?? '').trim();
            if (rowOwn && ownerKeys.length > 0 && !ownerKeys.includes(rowOwn)) return false;
            if (rowOwn && ownerKeys.length === 0 && rowOwn !== owner.trim()) return false;
          }
          return true;
        });
      setRows(mapped);
    });
    return () => sub.unsubscribe();
  }, [enabled, limit, owner, roomType]);

  return useMemo(() => rows, [rows]);
}
