import { Q } from '@nozbe/watermelondb';
import { useEffect, useMemo, useRef, useState } from 'react';

import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { isChatUnreadBaselineReady, subscribeChatUnreadBaseline } from '@/src/lib/chat-unread-baseline';
import { candidateUserKeys } from '@/src/lib/meeting-chat-rooms-summary';
import { unreadCountForChatRoomListRow } from '@/src/lib/offline-chat/offline-chat-rooms';
import { WM_CHAT_ROOM_LIST_OBSERVE_COLUMNS } from '@/src/lib/watermelon-observe-columns';
import { database } from '@/src/watermelon';

/** 미러 upsert 등으로 observe가 연속 emit될 때 탭 합계 깜빡임 완화 */
const TAB_UNREAD_SUM_DEBOUNCE_MS = 64;

/** 행 추가·`room_type` 보정 시에도 emit (`useChatRoomListEngine`과 동일 DB 필드) */
const TAB_BADGE_OBSERVE_COLUMNS = [...WM_CHAT_ROOM_LIST_OBSERVE_COLUMNS, 'room_id', 'room_type'] as const;

function resolveTabBadgeRoomKind(row: any): 'meeting' | 'social_dm' | null {
  const roomId = typeof row?.roomId === 'string' ? row.roomId.trim() : '';
  if (!roomId) return null;
  const rt = typeof row?.roomType === 'string' ? row.roomType.trim() : '';
  if (rt === 'meeting') return 'meeting';
  if (rt === 'social_dm' || roomId.startsWith('social_')) return 'social_dm';
  return null;
}

function rowOwnerIncludedInTabBadge(row: any, ownerKeys: readonly string[], uid: string): boolean {
  const rowOwn = typeof row?.ownerUserId === 'string' ? row.ownerUserId.trim() : '';
  if (!rowOwn) return true;
  if (ownerKeys.length > 0) return ownerKeys.includes(rowOwn);
  return rowOwn === uid;
}

function sumTabScopedUnreadRows(
  rows: readonly any[],
  ownerKeys: readonly string[],
  uid: string,
  meetingsFilterReady: boolean,
  joinedMeetingRoomIds: ReadonlySet<string>,
): number {
  let sum = 0;
  for (const r of rows) {
    if (!rowOwnerIncludedInTabBadge(r, ownerKeys, uid)) continue;

    const roomType = resolveTabBadgeRoomKind(r);
    const roomId = typeof r?.roomId === 'string' ? r.roomId.trim() : '';
    if (!roomType || !roomId) continue;

    if (roomType === 'meeting') {
      if (!meetingsFilterReady) continue;
      if (!joinedMeetingRoomIds.has(roomId)) continue;
    } else if (!roomId.startsWith('social_')) {
      continue;
    }

    sum += unreadCountForChatRoomListRow(r);
  }
  return sum;
}

/**
 * 하단 탭 채팅 배지 전용: 내 `chat_rooms.unread_count` 합.
 * `useChatRoomListEngine`·`app/(tabs)/chat.tsx`와 동일 owner·룸 종류 규칙으로 집계합니다.
 */
export function useWatermelonChatUnreadTotal(args: {
  ownerUserId: string | null | undefined;
  enabled: boolean;
  /** true일 때만 참여 모임 id로 meeting 행 필터(미준비 시 meeting 제외 — 고스트·미부트 중복 방지) */
  meetingsFilterReady?: boolean;
  /** `app/(tabs)/chat.tsx` gather 목록과 동일 — 참여 모임 `Meeting.id` */
  joinedMeetingRoomIds?: readonly string[];
}): number {
  const raw = args.ownerUserId?.trim() ?? '';
  const uid = normalizeParticipantId(raw) || raw;
  const ownerKeys = useMemo(() => candidateUserKeys(raw || uid), [raw, uid]);
  const [total, setTotal] = useState(0);
  const lastTotalRef = useRef(0);
  const [baselineReady, setBaselineReady] = useState(isChatUnreadBaselineReady);

  const meetingsFilterReady = args.meetingsFilterReady === true;

  const joinedMeetingSet = useMemo(() => {
    const s = new Set<string>();
    for (const id of args.joinedMeetingRoomIds ?? []) {
      const t = id.trim();
      if (t) s.add(t);
    }
    return s;
  }, [args.joinedMeetingRoomIds]);

  useEffect(() => subscribeChatUnreadBaseline(() => setBaselineReady(true)), []);

  const observeEnabled = args.enabled && baselineReady;

  useEffect(() => {
    const db = database;
    if (!db || !uid) {
      lastTotalRef.current = 0;
      setTotal(0);
      return;
    }
    if (!observeEnabled) {
      return;
    }

    const ownerClause =
      ownerKeys.length === 0
        ? [Q.where('owner_user_id', uid)]
        : [
            Q.or(
              Q.where('owner_user_id', null),
              ownerKeys.length === 1
                ? Q.where('owner_user_id', ownerKeys[0])
                : Q.where('owner_user_id', Q.oneOf([...ownerKeys])),
            ),
          ];
    const query = db.get('chat_rooms').query(...ownerClause);
    let sumDebounce: ReturnType<typeof setTimeout> | null = null;
    const sub = query.observeWithColumns([...TAB_BADGE_OBSERVE_COLUMNS]).subscribe((rows: any[]) => {
      const sum = sumTabScopedUnreadRows(rows, ownerKeys, uid, meetingsFilterReady, joinedMeetingSet);
      lastTotalRef.current = sum;
      if (sumDebounce) clearTimeout(sumDebounce);
      sumDebounce = setTimeout(() => {
        sumDebounce = null;
        setTotal(sum);
      }, TAB_UNREAD_SUM_DEBOUNCE_MS);
    });
    return () => {
      if (sumDebounce) clearTimeout(sumDebounce);
      sub.unsubscribe();
    };
  }, [uid, raw, ownerKeys, observeEnabled, meetingsFilterReady, joinedMeetingSet]);

  if (!observeEnabled) {
    return baselineReady ? lastTotalRef.current : 0;
  }
  return total;
}
