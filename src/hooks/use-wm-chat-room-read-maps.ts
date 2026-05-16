import { Q } from '@nozbe/watermelondb';
import { useEffect, useMemo, useState } from 'react';

import { mergeRoomReadSummaries, type MergedRoomReadMaps } from '@/src/lib/meeting-chat-bubble-unread';
import { mapLocalChatRoomRow } from '@/src/lib/offline-chat/offline-chat-rooms';
import type { OfflineChatRoomType } from '@/src/lib/offline-chat/offline-chat-types';
import { WM_CHAT_ROOM_MESSAGE_READ_MAPS_OBSERVE_COLUMNS } from '@/src/lib/watermelon-observe-columns';
import { database } from '@/src/watermelon';

const EMPTY_READ_MAPS: MergedRoomReadMaps = {
  messageReadMessageIdBy: {},
  messageReadAtMsBy: {},
  messageReadLastSeqBy: {},
};

/**
 * 말풍선 읽음 숫자 전용 — `chat_rooms` JSON 읽음 맵만 `observeWithColumns`로 구독합니다.
 */
export function useWmChatRoomReadMaps(args: {
  roomType: OfflineChatRoomType;
  wmChatRoomIds: readonly string[];
  /** pull·Realtime 병합 후 부모가 올리는 보조 틱 */
  readMapsRevision?: number;
}): MergedRoomReadMaps {
  const [wmReadMaps, setWmReadMaps] = useState<MergedRoomReadMaps>(EMPTY_READ_MAPS);

  const roomKey = useMemo(() => {
    const ids = [...new Set(args.wmChatRoomIds.map((x) => String(x ?? '').trim()).filter(Boolean))].sort();
    return ids.join('\u0001');
  }, [args.wmChatRoomIds]);

  useEffect(() => {
    const db = database;
    const ids = roomKey.split('\u0001').filter(Boolean);
    if (!db || ids.length === 0) {
      setWmReadMaps(EMPTY_READ_MAPS);
      return;
    }
    const base = Q.where('room_type', args.roomType);
    const roomClause = ids.length === 1 ? Q.where('room_id', ids[0]!) : Q.or(...ids.map((id) => Q.where('room_id', id)));
    const sub = db
      .get('chat_rooms')
      .query(base, roomClause)
      .observeWithColumns([...WM_CHAT_ROOM_MESSAGE_READ_MAPS_OBSERVE_COLUMNS])
      .subscribe((records: unknown[]) => {
        const summaries = (records as any[]).map((r) => {
          const row = mapLocalChatRoomRow(r);
          return {
            messageReadMessageIdBy: row.messageReadMessageIdBy ?? {},
            messageReadAtMsBy: row.messageReadAtMsBy ?? {},
            messageReadLastSeqBy: row.messageReadLastSeqBy ?? {},
          };
        });
        setWmReadMaps(mergeRoomReadSummaries(summaries));
      });
    return () => sub.unsubscribe();
  }, [roomKey, args.roomType, args.readMapsRevision]);

  return wmReadMaps;
}
