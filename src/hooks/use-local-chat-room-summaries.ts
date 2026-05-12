import { Q } from '@nozbe/watermelondb';
import { useEffect, useMemo, useState } from 'react';

import {
  mapLocalChatRoomRow,
  type LocalChatRoomSummary,
} from '@/src/lib/offline-chat/offline-chat-rooms';
import type { OfflineChatRoomType } from '@/src/lib/offline-chat/offline-chat-types';
import { database } from '@/src/watermelon';

export function useLocalChatRoomSummaries(args: {
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
    const clauses = [
      Q.where('room_type', roomType),
      Q.sortBy('last_message_at_ms', Q.desc),
      Q.sortBy('remote_updated_at_ms', Q.desc),
      Q.take(take),
    ];
    const query = db.get('chat_rooms').query(...clauses);
    const sub = query.observe().subscribe((records: any[]) => {
      const mapped = records
        .map(mapLocalChatRoomRow)
        .filter((r) => {
          if (!r.roomId.trim()) return false;
          if (roomType === 'social_dm' && !r.peerAppUserId.trim()) return false;
          if (owner && r.ownerUserId && r.ownerUserId !== owner) return false;
          return true;
        });
      setRows(mapped);
    });
    return () => sub.unsubscribe();
  }, [enabled, limit, owner, roomType]);

  return useMemo(() => rows, [rows]);
}

