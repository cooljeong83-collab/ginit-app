import { Q } from '@nozbe/watermelondb';

import { meetingChatRoomIdsForLocalUnread } from '@/src/lib/chat-meeting-room-id-mirror';
import { getCurrentChatRoomId } from '@/src/lib/current-chat-room';
import { unreadCountForChatRoomListRow } from '@/src/lib/offline-chat/offline-chat-rooms';
import { database } from '@/src/watermelon';

export type ChatUnreadApplyRoomKind = 'meeting' | 'social_dm';

/** 지금 이 방 UI를 보고 있으면 서버 `unread_count` bump를 로컬에 반영하지 않습니다. */
export async function isChatRoomOpenForUnreadApply(
  meAppUserId: string,
  roomKind: ChatUnreadApplyRoomKind,
  roomId: string,
): Promise<boolean> {
  const cur = getCurrentChatRoomId()?.trim();
  const rid = roomId.trim();
  if (!cur || !rid) return false;
  if (roomKind === 'social_dm') return cur === rid;
  if (cur === rid) return true;
  const ids = await meetingChatRoomIdsForLocalUnread(meAppUserId.trim(), rid);
  return ids.includes(cur);
}

/**
 * `unread_update` 브로드캐스트만 대상으로, 아주 좁게 stale bump를 걸러냅니다.
 * - 방을 열어 보는 중 → 스킵
 * - 서버가 준 `last_message_id`가 로컬 읽음 포인터와 같고 로컬 unread=0 → 스킵 (RPC 전 레이스)
 *
 * postgres/RPC participant 동기화에는 쓰지 않습니다(로컬 lastMessageId로 오판하면 새 미읽음이 안 뜸).
 */
export async function shouldSkipUnreadBroadcastApply(args: {
  meAppUserId: string;
  roomKind: ChatUnreadApplyRoomKind;
  roomId: string;
  serverUnread: number;
  serverLastMessageId?: string | null;
}): Promise<boolean> {
  const serverUnread = Math.max(0, Math.floor(args.serverUnread));
  if (serverUnread <= 0) return false;

  const me = args.meAppUserId.trim();
  const rid = args.roomId.trim();
  if (!me || !rid) return false;

  if (await isChatRoomOpenForUnreadApply(me, args.roomKind, rid)) {
    return true;
  }

  const tailFromServer =
    typeof args.serverLastMessageId === 'string' && args.serverLastMessageId.trim()
      ? args.serverLastMessageId.trim()
      : '';
  if (!tailFromServer) return false;

  const db = database;
  if (!db) return false;

  const roomType = args.roomKind === 'meeting' ? 'meeting' : 'social_dm';
  const localRoomIds =
    args.roomKind === 'meeting' ? await meetingChatRoomIdsForLocalUnread(me, rid) : [rid];

  type RowSnap = {
    unreadCount?: number | null;
    readMessageId?: string | null;
    pendingReadMessageId?: string | null;
  };

  const snaps: RowSnap[] = [];
  for (const localRoomId of localRoomIds) {
    const rows = await db
      .get('chat_rooms')
      .query(Q.where('room_id', localRoomId), Q.where('room_type', roomType))
      .fetch();
    if (rows[0]) snaps.push(rows[0] as RowSnap);
  }
  if (snaps.length === 0) return false;
  if (snaps.some((row) => unreadCountForChatRoomListRow(row) > 0)) return false;

  return snaps.some((row) => {
    const readMsg =
      (typeof row.pendingReadMessageId === 'string' && row.pendingReadMessageId.trim()) ||
      (typeof row.readMessageId === 'string' && row.readMessageId.trim()) ||
      '';
    return Boolean(readMsg && readMsg === tailFromServer);
  });
}

type UnreadReconcileSnap = {
  unreadCount: number;
  readSeq: number;
  tailSeq: number;
  readMsg: string;
  lastMessageId: string;
};

async function loadUnreadReconcileSnap(args: {
  meAppUserId: string;
  roomKind: ChatUnreadApplyRoomKind;
  roomId: string;
}): Promise<UnreadReconcileSnap | null> {
  const db = database;
  if (!db) return null;

  const roomType = args.roomKind === 'meeting' ? 'meeting' : 'social_dm';
  const localRoomIds =
    args.roomKind === 'meeting'
      ? await meetingChatRoomIdsForLocalUnread(args.meAppUserId.trim(), args.roomId.trim())
      : [args.roomId.trim()];

  let best: UnreadReconcileSnap | null = null;
  for (const localRoomId of localRoomIds) {
    const rows = await db
      .get('chat_rooms')
      .query(Q.where('room_id', localRoomId), Q.where('room_type', roomType))
      .fetch();
    const row = rows[0] as
      | {
          unreadCount?: number | null;
          readMessageId?: string | null;
          pendingReadMessageId?: string | null;
          lastMessageId?: string | null;
          lastReadServerSeq?: number | null;
          pendingReadLastSeq?: number | null;
          lastServerSeq?: number | null;
        }
      | undefined;
    if (!row) continue;

    const tailSeq =
      typeof row.lastServerSeq === 'number' && Number.isFinite(row.lastServerSeq)
        ? Math.floor(row.lastServerSeq)
        : 0;
    const snap: UnreadReconcileSnap = {
      unreadCount: unreadCountForChatRoomListRow(row),
      readSeq: readSeqFromRow(row),
      tailSeq,
      readMsg:
        (typeof row.pendingReadMessageId === 'string' && row.pendingReadMessageId.trim()) ||
        (typeof row.readMessageId === 'string' && row.readMessageId.trim()) ||
        '',
      lastMessageId: typeof row.lastMessageId === 'string' ? row.lastMessageId.trim() : '',
    };
    if (!best || snap.tailSeq >= best.tailSeq) best = snap;
  }
  return best;
}

/**
 * 로컬은 이미 0(읽음)인데 서버 participant가 리셋 전 누적 unread를 보낼 때,
 * tail/read seq·메시지 id 차이로 **새로 쌓인 분량**만 반영합니다.
 */
export async function reconcileServerUnreadWithLocal(args: {
  meAppUserId: string;
  roomKind: ChatUnreadApplyRoomKind;
  roomId: string;
  serverUnread: number;
  serverLastMessageId?: string | null;
}): Promise<number> {
  const server = Math.max(0, Math.floor(args.serverUnread));
  if (server <= 0) return 0;

  const snap = await loadUnreadReconcileSnap({
    meAppUserId: args.meAppUserId,
    roomKind: args.roomKind,
    roomId: args.roomId,
  });
  if (!snap || snap.unreadCount > 0) return server;

  const serverMsg =
    typeof args.serverLastMessageId === 'string' && args.serverLastMessageId.trim()
      ? args.serverLastMessageId.trim()
      : snap.lastMessageId;
  const readMsg = snap.readMsg;

  const newTailByMsg = Boolean(serverMsg && readMsg && serverMsg !== readMsg);
  const newTailBySeq = snap.readSeq > 0 && snap.tailSeq > snap.readSeq;

  if (!newTailByMsg && !newTailBySeq) return server;

  if (newTailBySeq) {
    return Math.min(server, snap.tailSeq - snap.readSeq);
  }

  return Math.min(server, 1);
}

function readSeqFromRow(row: {
  lastReadServerSeq?: number | null;
  pendingReadLastSeq?: number | null;
}): number {
  const lrs =
    typeof row.lastReadServerSeq === 'number' && Number.isFinite(row.lastReadServerSeq)
      ? Math.floor(row.lastReadServerSeq)
      : 0;
  const prs =
    typeof row.pendingReadLastSeq === 'number' && Number.isFinite(row.pendingReadLastSeq)
      ? Math.floor(row.pendingReadLastSeq)
      : 0;
  return Math.max(lrs, prs);
}

/** 로컬은 읽음(0)인데 서버 participant·방 진입 sync가 아직 옛 unread를 보낼 때 */
async function isLocalReadCaughtUpPendingServer(args: {
  roomKind: ChatUnreadApplyRoomKind;
  roomId: string;
  meAppUserId: string;
}): Promise<boolean> {
  const db = database;
  if (!db) return false;

  const roomType = args.roomKind === 'meeting' ? 'meeting' : 'social_dm';
  const localRoomIds =
    args.roomKind === 'meeting'
      ? await meetingChatRoomIdsForLocalUnread(args.meAppUserId.trim(), args.roomId.trim())
      : [args.roomId.trim()];

  for (const localRoomId of localRoomIds) {
    const rows = await db
      .get('chat_rooms')
      .query(Q.where('room_id', localRoomId), Q.where('room_type', roomType))
      .fetch();
    const row = rows[0] as
      | {
          unreadCount?: number | null;
          lastReadServerSeq?: number | null;
          pendingReadLastSeq?: number | null;
          lastServerSeq?: number | null;
        }
      | undefined;
    if (!row) continue;
    if (unreadCountForChatRoomListRow(row) > 0) return false;

    const tailSeq =
      typeof row.lastServerSeq === 'number' && Number.isFinite(row.lastServerSeq)
        ? Math.floor(row.lastServerSeq)
        : 0;
    const readSeq = readSeqFromRow(row);
    if (readSeq > 0 && tailSeq > 0 && readSeq >= tailSeq) {
      return true;
    }
  }
  return false;
}

/**
 * postgres/RPC `chat_room_participants` → 로컬 unread 반영 전.
 * 새 미읽음(방 밖·로컬 미확인)은 통과, 방 안·이미 읽음 처리한 stale bump만 차단.
 */
export async function shouldSkipParticipantUnreadBump(args: {
  meAppUserId: string;
  roomKind: ChatUnreadApplyRoomKind;
  roomId: string;
  serverUnread: number;
}): Promise<boolean> {
  const serverUnread = Math.max(0, Math.floor(args.serverUnread));
  if (serverUnread <= 0) return false;

  const me = args.meAppUserId.trim();
  const rid = args.roomId.trim();
  if (!me || !rid) return false;

  if (await isChatRoomOpenForUnreadApply(me, args.roomKind, rid)) {
    return true;
  }

  return isLocalReadCaughtUpPendingServer({
    meAppUserId: me,
    roomKind: args.roomKind,
    roomId: rid,
  });
}
