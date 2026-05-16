import { Q } from '@nozbe/watermelondb';
import type { QueryClient } from '@tanstack/react-query';
import { Platform } from 'react-native';

import { meetingDetailQueryKey } from '@/src/hooks/use-meeting-detail-query';
import { setNativeShareShortcuts, type NativeShareShortcutItem } from '@/src/lib/direct-share-native';
import type { Meeting } from '@/src/lib/meetings';
import { WM_CHAT_ROOM_LIST_OBSERVE_COLUMNS } from '@/src/lib/watermelon-observe-columns';
import { database } from '@/src/watermelon/database';
import type { ChatMessage } from '@/src/watermelon/models/ChatMessage';
import type { ChatRoom } from '@/src/watermelon/models/ChatRoom';

function mapTargetType(roomType: string): 'meeting' | 'dm' | null {
  if (roomType === 'meeting') return 'meeting';
  if (roomType === 'social_dm') return 'dm';
  return null;
}

/** Android 동적 숏컷 id는 영숫자·`_`·`-`만 허용(콜론 등이 있으면 setDynamicShortcuts 전체 실패). */
function androidDynamicShortcutId(roomType: string, targetId: string): string {
  const combined = `${roomType}_${targetId}`.replace(/[^a-zA-Z0-9_-]/g, '_');
  return combined.length <= 64 ? combined : combined.slice(0, 64);
}

async function fetchLatestMessage(roomId: string, roomType: string): Promise<ChatMessage | null> {
  if (!database) return null;
  const rows = await database
    .get<ChatMessage>('chat_messages')
    .query(
      Q.where('room_id', roomId),
      Q.where('room_type', roomType),
      Q.sortBy('created_at_ms', Q.desc),
      Q.take(1),
    )
    .fetch();
  return rows[0] ?? null;
}

async function roomsToShortcutItems(rooms: ChatRoom[], queryClient: QueryClient): Promise<NativeShareShortcutItem[]> {
  const items: NativeShareShortcutItem[] = [];
  for (const room of rooms) {
    const targetType = mapTargetType(room.roomType);
    if (!targetType) continue;
    const targetId = room.roomId.trim();
    if (!targetId) continue;

    const latest = await fetchLatestMessage(room.roomId, room.roomType);

    let title: string;
    let subtitle: string | undefined;
    let avatarUrl: string | null = null;

    if (targetType === 'meeting') {
      const cached = queryClient.getQueryData<Meeting | null>(meetingDetailQueryKey(targetId));
      title = (cached?.title ?? '').trim() || (latest?.senderName?.trim() ?? '') || '모임';
      subtitle = '모임 채팅';
      const fromMeeting = typeof cached?.imageUrl === 'string' ? cached.imageUrl.trim() : '';
      avatarUrl = fromMeeting || latest?.senderAvatarUrl?.trim() || null;
    } else {
      title = (latest?.senderName?.trim() ?? '') || '친구';
      subtitle = '친구 메시지';
      avatarUrl = latest?.senderAvatarUrl?.trim() || null;
    }

    items.push({
      id: androidDynamicShortcutId(room.roomType, targetId),
      title,
      subtitle,
      targetType,
      targetId,
      avatarUrl,
    });
  }
  return items;
}

function itemsStableKey(items: NativeShareShortcutItem[]): string {
  return items.map((x) => `${x.id}|${x.targetType}|${x.targetId}|${x.avatarUrl ?? ''}|${x.title}`).join('\u0001');
}

/** 앱이 다시 활성일 때 등, observe 없이 한 번 숏컷을 재등록할 때 사용 */
export async function refreshShareShortcutsFromWatermelonNow(
  queryClient: QueryClient,
  userId: string,
): Promise<void> {
  if (Platform.OS !== 'android' || !database || !userId.trim()) return;
  const collection = database.get<ChatRoom>('chat_rooms');
  const rooms = await collection.query(Q.sortBy('last_message_at_ms', Q.desc), Q.take(10)).fetch();
  const items = await roomsToShortcutItems(rooms, queryClient);
  await setNativeShareShortcuts(items);
}

/**
 * WatermelonDB `chat_rooms`(최근 10) 변경 시 Android Direct Share 동적 숏컷을 갱신합니다.
 */
export function subscribeShareShortcutsFromWatermelon(args: {
  queryClient: QueryClient;
  userId: string;
  enabled: boolean;
}): () => void {
  if (Platform.OS !== 'android' || !database) {
    return () => {};
  }

  const { queryClient, userId, enabled } = args;

  if (!enabled || !userId.trim()) {
    void setNativeShareShortcuts([]);
    return () => {
      void setNativeShareShortcuts([]);
    };
  }

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastKey = '';
  let alive = true;

  const collection = database.get<ChatRoom>('chat_rooms');
  const baseQuery = collection.query(Q.sortBy('last_message_at_ms', Q.desc), Q.take(10));

  const runPush = async (rooms: ChatRoom[]) => {
    if (!alive) return;
    try {
      const items = await roomsToShortcutItems(rooms, queryClient);
      const key = itemsStableKey(items);
      if (key === lastKey) return;
      lastKey = key;
      await setNativeShareShortcuts(items);
    } catch {
      /* ignore */
    }
  };

  const schedulePush = (rooms: ChatRoom[]) => {
    if (!alive) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void runPush(rooms);
    }, 600);
  };

  const sub = baseQuery.observeWithColumns([...WM_CHAT_ROOM_LIST_OBSERVE_COLUMNS]).subscribe((rooms) => {
    schedulePush(rooms);
  });

  // 구독 직후 1회: observe 재생 전/StrictMode 언마운트 직후에도 숏컷이 비지 않도록 스냅샷을 밀어 넣습니다.
  void (async () => {
    try {
      const initial = await baseQuery.fetch();
      if (!alive) return;
      await runPush(initial);
    } catch {
      /* ignore */
    }
  })();

  return () => {
    alive = false;
    if (debounceTimer) clearTimeout(debounceTimer);
    sub.unsubscribe();
    void setNativeShareShortcuts([]);
  };
}
