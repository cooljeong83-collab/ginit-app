import { Q } from '@nozbe/watermelondb';

import { database } from '@/src/watermelon';
import type { OfflineChatRoomKey } from '@/src/lib/offline-chat/offline-chat-types';
import { normalizeRoomKey } from '@/src/lib/offline-chat/offline-chat-types';

const DEFAULT_RETAIN_DAYS = 30;
const DEFAULT_RETAIN_COUNT = 1000;
const DEFAULT_MAX_DELETE_PER_RUN = 500;
const DEFAULT_THROTTLE_MS = 12 * 60 * 60 * 1000;

export type PruneLocalChatRoomArgs = {
  key: OfflineChatRoomKey;
  retainDays?: number;
  retainCount?: number;
  maxDeletePerRun?: number;
  throttleMs?: number;
};

export async function pruneLocalChatRoomMessages(args: PruneLocalChatRoomArgs): Promise<{ deleted: number }> {
  const db = database;
  if (!db) return { deleted: 0 };
  const k = normalizeRoomKey(args.key);
  if (!k.roomId) return { deleted: 0 };

  const retainDays = Math.max(1, args.retainDays ?? DEFAULT_RETAIN_DAYS);
  const retainCount = Math.max(100, args.retainCount ?? DEFAULT_RETAIN_COUNT);
  const maxDelete = Math.max(20, args.maxDeletePerRun ?? DEFAULT_MAX_DELETE_PER_RUN);
  const throttleMs = Math.max(60_000, args.throttleMs ?? DEFAULT_THROTTLE_MS);
  const now = Date.now();

  const rooms = db.get('chat_rooms');
  const localRoom = (
    await rooms.query(Q.where('room_id', k.roomId), Q.where('room_type', k.roomType)).fetch()
  )[0] as any | undefined;
  if (!localRoom) return { deleted: 0 };
  const lastPrunedAtMs = typeof localRoom.lastPrunedAtMs === 'number' ? localRoom.lastPrunedAtMs : 0;
  if (lastPrunedAtMs > 0 && now - lastPrunedAtMs < throttleMs) return { deleted: 0 };

  const msgs = db.get('chat_messages');
  const newestRows = await msgs
    .query(
      Q.where('room_id', k.roomId),
      Q.where('room_type', k.roomType),
      Q.sortBy('created_at_ms', Q.desc),
      Q.take(retainCount),
    )
    .fetch();
  const keepIds = new Set(newestRows.map((m: any) => String(m.messageId ?? '').trim()).filter(Boolean));
  const cutoffMs = now - retainDays * 24 * 60 * 60 * 1000;
  const candidates = await msgs
    .query(
      Q.where('room_id', k.roomId),
      Q.where('room_type', k.roomType),
      Q.where('created_at_ms', Q.lt(cutoffMs)),
      Q.sortBy('created_at_ms', Q.asc),
      Q.take(maxDelete),
    )
    .fetch();
  const victims = candidates.filter((m: any) => !keepIds.has(String(m.messageId ?? '').trim()));

  await db.write(async () => {
    for (const row of victims) {
      await row.destroyPermanently();
    }
    const count = await msgs.query(Q.where('room_id', k.roomId), Q.where('room_type', k.roomType)).fetchCount();
    await localRoom.update((r: any) => {
      r.lastPrunedAtMs = now;
      r.localMessageCount = count;
    });
  });

  return { deleted: victims.length };
}
