import type { OfflineChatRoomType } from '@/src/lib/offline-chat/offline-chat-types';
import { incrementalSyncRoomMessagesToLocal } from '@/src/lib/offline-chat/offline-chat-sync';
import { ginitNotifyDbg } from '@/src/lib/ginit-notify-debug';

const PREWARM_DEDUPE_MS = 30_000;
const prewarmSeenAtByKey = new Map<string, number>();
const prewarmInflightByRoom = new Map<string, Promise<unknown>>();

function stringValue(data: Record<string, unknown>, key: string): string {
  const v = data[key];
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
}

function parseChatRoomFromPushData(data: Record<string, unknown> | undefined | null): {
  roomType: OfflineChatRoomType;
  roomId: string;
  lastMessageId: string;
} | null {
  if (!data || typeof data !== 'object') return null;
  const action = stringValue(data, 'action');
  if (action !== 'in_app_chat' && action !== 'in_app_social_dm') return null;
  const roomType: OfflineChatRoomType =
    stringValue(data, 'roomType') === 'social_dm' || action === 'in_app_social_dm' ? 'social_dm' : 'meeting';
  const roomId = stringValue(data, 'roomId') || stringValue(data, 'meetingId');
  if (!roomId) return null;
  return {
    roomType,
    roomId,
    lastMessageId: stringValue(data, 'lastMessageId') || stringValue(data, 'messageId'),
  };
}

export function prewarmChatRoomMessagesFromPushData(
  data: Record<string, unknown> | undefined | null,
  source: string,
): boolean {
  const parsed = parseChatRoomFromPushData(data);
  if (!parsed) return false;

  const roomKey = `${parsed.roomType}:${parsed.roomId}`;
  if (prewarmInflightByRoom.has(roomKey)) return false;

  const dedupeKey = `${roomKey}:${parsed.lastMessageId || 'latest'}`;
  const now = Date.now();
  const lastSeenAt = prewarmSeenAtByKey.get(dedupeKey) ?? 0;
  if (now - lastSeenAt < PREWARM_DEDUPE_MS) return false;
  prewarmSeenAtByKey.set(dedupeKey, now);

  const task = incrementalSyncRoomMessagesToLocal({
    key: { roomType: parsed.roomType, roomId: parsed.roomId },
    initialSinceMs: now - 24 * 60 * 60 * 1000,
    latestBlockSize: 20,
    pageSize: 50,
    maxDocs: 200,
    maxPagesPerRun: 1,
    timeBudgetMs: 900,
  })
    .then((res) => {
      ginitNotifyDbg('chat-prewarm', 'done', {
        source,
        roomType: parsed.roomType,
        roomId: parsed.roomId,
        pulledDocs: res.pulledDocs,
      });
    })
    .catch((e) => {
      ginitNotifyDbg('chat-prewarm', 'error', {
        source,
        roomType: parsed.roomType,
        roomId: parsed.roomId,
        message: e instanceof Error ? e.message : String(e),
      });
    })
    .finally(() => {
      prewarmInflightByRoom.delete(roomKey);
    });

  prewarmInflightByRoom.set(roomKey, task);
  return true;
}
