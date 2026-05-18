import { Q } from '@nozbe/watermelondb';
import type { QueryClient } from '@tanstack/react-query';

import { meetingDetailQueryKey } from '@/src/lib/meeting-detail-query-keys';
import { upsertMeetingDetailToWatermelon } from '@/src/lib/meeting-detail-watermelon-cache';
import { removeMeetingFromMeetingsQueryCaches } from '@/src/lib/meeting-feed-query-cache-remove';
import { database } from '@/src/watermelon';

const PURGE_BATCH = 200;

/** 서버·RPC에서 모임 문서가 없음을 나타내는 메시지(삭제·만료 등). */
export function isMeetingNotFoundMessage(message: string): boolean {
  const msg = message.trim();
  if (!msg) return false;
  return (
    /모임을?\s*찾을\s*수\s*없/i.test(msg) ||
    /모임\s*정보를?\s*찾을\s*수\s*없/i.test(msg) ||
    /\bnot\s*found\b/i.test(msg)
  );
}

export function isMeetingNotFoundError(error: unknown): boolean {
  if (error instanceof Error) return isMeetingNotFoundMessage(error.message);
  if (typeof error === 'string') return isMeetingNotFoundMessage(error);
  return false;
}

function meetingRoomIdsForLocalPurge(routeMeetingId: string, ledgerMeetingId?: string | null): string[] {
  const out = new Set<string>();
  const route = routeMeetingId.trim();
  const ledger = ledgerMeetingId?.trim() ?? '';
  if (route) out.add(route);
  if (ledger) out.add(ledger);
  return [...out];
}

async function destroyQueryRows(table: string, roomIds: string[], roomType?: string): Promise<void> {
  const db = database;
  if (!db || roomIds.length === 0) return;
  const collection = db.get(table);
  for (const roomId of roomIds) {
    for (;;) {
      const clauses = [Q.where('room_id', roomId)];
      if (roomType) clauses.push(Q.where('room_type', roomType));
      const batch = await collection.query(...clauses, Q.take(PURGE_BATCH)).fetch();
      if (batch.length === 0) break;
      await db.write(async () => {
        for (const row of batch) {
          await row.destroyPermanently();
        }
      });
    }
  }
}

/** 삭제된 모임 — 로컬 채팅 메시지·방·검색 인덱스·최근 검색·상세 캐시를 비웁니다. */
export async function purgeLocalMeetingChatWatermelon(
  routeMeetingId: string,
  ledgerMeetingId?: string | null,
): Promise<void> {
  const roomIds = meetingRoomIdsForLocalPurge(routeMeetingId, ledgerMeetingId);
  if (roomIds.length === 0) return;

  await destroyQueryRows('chat_messages', roomIds, 'meeting');
  await destroyQueryRows('chat_rooms', roomIds, 'meeting');
  await destroyQueryRows('chat_search_index_chunks', roomIds, 'meeting');
  await destroyQueryRows('recent_searches', roomIds);

  const db = database;
  if (!db) return;
  const details = db.get('cached_meeting_details');
  await db.write(async () => {
    for (const mid of roomIds) {
      try {
        const row = await details.find(mid);
        await row.destroyPermanently();
      } catch {
        /* 없음 */
      }
    }
  });
}

/**
 * 삭제된 모임 — Watermelon 상세·TanStack 상세·피드 목록 캐시에서 제거합니다.
 */
export async function purgeDeletedMeetingLocally(
  queryClient: QueryClient,
  meetingId: string,
  viewerUserId?: string | null,
  ledgerMeetingId?: string | null,
): Promise<void> {
  const id = meetingId.trim();
  if (!id) return;
  await purgeLocalMeetingChatWatermelon(id, ledgerMeetingId);
  await upsertMeetingDetailToWatermelon(id, null);
  queryClient.setQueryData(meetingDetailQueryKey(id), null);
  removeMeetingFromMeetingsQueryCaches(queryClient, id, viewerUserId);
}
