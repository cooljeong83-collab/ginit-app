import { Q } from '@nozbe/watermelondb';

import { database } from '@/src/watermelon';
import type { OfflineChatRoomType } from '@/src/lib/offline-chat/offline-chat-types';
import { buildSearchText, sanitizeUnicodeForSqliteStorage } from '@/src/lib/offline-chat/offline-chat-utils';
import {
  socialDmPreviewLine,
  type SocialChatMessage,
  type SocialChatRoomDoc,
  type SocialChatRoomSummary,
} from '@/src/lib/social-chat-rooms';
import type { MeetingChatMessage } from '@/src/lib/meeting-chat';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { Timestamp } from '@/src/lib/ginit-timestamp';
import { normalizePhoneUserId } from '@/src/lib/phone-user-id';

export type LocalChatRoomSummary = SocialChatRoomSummary & {
  roomType: OfflineChatRoomType;
  ownerUserId: string | null;
  peerUserId: string | null;
  isGroup: boolean | null;
  lastMessageId: string | null;
  lastMessageAtMs: number;
  lastMessagePreview: string | null;
  lastMessageKind: string | null;
  lastSenderId: string | null;
  lastSenderName: string | null;
  lastSenderAvatarUrl: string | null;
  unreadCount: number;
  unreadLastAtMs: number;
  readMessageId: string | null;
  readAtMs: number;
  messageReadMessageIdBy: Record<string, string>;
  messageReadAtMsBy: Record<string, number>;
  /** 참가자별 `chat_read_pointers.last_read_seq` — 말풍선 읽음(목록 미읽음과 무관) */
  messageReadLastSeqBy: Record<string, number>;
  messageReadStateLastAtMs: number;
  remoteUpdatedAtMs: number;
  /** Supabase `chat_messages.seq` 상한 — 메시지 델타·동기화 커서 */
  lastServerSeq: number;
  /** 내가 읽은 마지막 서버 seq — 읽음 RPC·로컬 동기화용(목록 미읽음 표시는 `unreadCount`만 사용) */
  lastReadServerSeq: number | null;
};

export type LocalChatRoomSummaryInput = {
  roomId: string;
  roomType: OfflineChatRoomType;
  ownerUserId?: string | null;
  peerUserId?: string | null;
  isGroup?: boolean | null;
  lastMessageId?: string | null;
  lastMessageAtMs?: number | null;
  lastMessagePreview?: string | null;
  lastMessageKind?: string | null;
  lastSenderId?: string | null;
  lastSenderName?: string | null;
  lastSenderAvatarUrl?: string | null;
  unreadCount?: number | null;
  unreadLastAtMs?: number | null;
  readMessageId?: string | null;
  readAtMs?: number | null;
  remoteUpdatedAtMs?: number | null;
  roomSearchText?: string | null;
  lastServerSeq?: number | null;
  lastReadServerSeq?: number | null;
  /** true면 서버 재동기화 등에서 `unread_count`를 로컬 타임스탬프 비교 없이 덮어씁니다. */
  forceServerUnread?: boolean;
  /** true면 `last_synced_changed_at_ms`를 갱신해 목록 observe()가 확실히 리렌더되도록 합니다. */
  touchListSurface?: boolean;
};

export type LocalChatRoomReadStateInput = {
  roomId: string;
  roomType: OfflineChatRoomType;
  ownerUserId?: string | null;
  peerUserId?: string | null;
  readMessageIdBy?: Record<string, unknown> | null;
  readAtBy?: Record<string, unknown> | null;
  readAtMsBy?: Record<string, number | null | undefined> | null;
  readLastSeqBy?: Record<string, number | null | undefined> | null;
  readStateLastAtMs?: number | null;
};

let chatRoomWriteQueue: Promise<void> = Promise.resolve();

function enqueueChatRoomWrite(work: () => Promise<void>): Promise<void> {
  const run = chatRoomWriteQueue.then(work, work);
  chatRoomWriteQueue = run.catch(() => {});
  return run;
}

function cleanString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t) return null;
  const s = sanitizeUnicodeForSqliteStorage(t);
  return s.trim() ? s.trim() : null;
}

function cleanNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : null;
}

function readStateUserKey(v: unknown): string | null {
  const raw = cleanString(v);
  if (!raw) return null;
  return normalizeParticipantId(raw) ?? normalizePhoneUserId(raw) ?? raw;
}

function parseStringMapJson(v: unknown): Record<string, string> {
  if (typeof v !== 'string' || !v.trim()) return {};
  try {
    const parsed = JSON.parse(v) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(parsed as Record<string, unknown>)) {
      const key = readStateUserKey(k);
      const str = cleanString(val);
      if (key && str) out[key] = str;
    }
    return out;
  } catch {
    return {};
  }
}

function parseNumberMapJson(v: unknown): Record<string, number> {
  if (typeof v !== 'string' || !v.trim()) return {};
  try {
    const parsed = JSON.parse(v) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [k, val] of Object.entries(parsed as Record<string, unknown>)) {
      const key = readStateUserKey(k);
      const ms = cleanNumber(val);
      if (key && ms) out[key] = ms;
    }
    return out;
  } catch {
    return {};
  }
}

function encodeJsonMap(v: Record<string, string | number>): string | null {
  const safe: Record<string, string | number> = {};
  for (const [k, val] of Object.entries(v)) {
    const sk = sanitizeUnicodeForSqliteStorage(k).trim();
    if (!sk) continue;
    if (typeof val === 'number' && Number.isFinite(val)) safe[sk] = val;
    else safe[sk] = sanitizeUnicodeForSqliteStorage(String(val));
  }
  return Object.keys(safe).length ? JSON.stringify(safe) : null;
}

function normalizeReadMessageIdMap(map: Record<string, unknown> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!map) return out;
  for (const [k, v] of Object.entries(map)) {
    const key = readStateUserKey(k);
    const id = cleanString(v);
    if (key && id) out[key] = id;
  }
  return out;
}

function normalizeReadAtMsMap(args: {
  readAtBy?: Record<string, unknown> | null;
  readAtMsBy?: Record<string, number | null | undefined> | null;
}): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(args.readAtBy ?? {})) {
    const key = readStateUserKey(k);
    const ms = firestoreTimeToMs(v);
    if (key && ms > 0) out[key] = Math.max(out[key] ?? 0, ms);
  }
  for (const [k, v] of Object.entries(args.readAtMsBy ?? {})) {
    const key = readStateUserKey(k);
    const ms = cleanNumber(v);
    if (key && ms) out[key] = Math.max(out[key] ?? 0, ms);
  }
  return out;
}

export function firestoreTimeToMs(v: unknown): number {
  if (!v) return 0;
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.floor(v));
  if (typeof v === 'string') {
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : 0;
  }
  if (typeof v === 'object') {
    const o = v as { toMillis?: () => number; seconds?: number; nanoseconds?: number };
    if (typeof o.toMillis === 'function') {
      try {
        return o.toMillis();
      } catch {
        return 0;
      }
    }
    if (typeof o.seconds === 'number') {
      const ns = typeof o.nanoseconds === 'number' ? o.nanoseconds : 0;
      return Math.max(0, Math.floor(o.seconds * 1000 + ns / 1e6));
    }
  }
  return 0;
}

export function localRoomPreviewForMessage(args: {
  kind?: string | null;
  text?: string | null;
  imageUrl?: string | null;
}): string | null {
  const text = cleanString(args.text);
  if (text) return text.length > 100 ? `${text.slice(0, 100)}…` : text;
  if (args.kind === 'image' || cleanString(args.imageUrl)) return '사진';
  if (args.kind === 'system') return '알림';
  return null;
}

function defaultSearchText(input: LocalChatRoomSummaryInput): string | null {
  return buildSearchText([
    input.peerUserId,
    input.lastMessagePreview,
    input.lastSenderName,
    input.roomType === 'meeting' ? '모임 채팅' : '친구 채팅',
  ]);
}

function assignDefined(r: any, key: string, value: unknown): void {
  if (value !== undefined) r[key] = value;
}

/** `null`은 “필드 미전달”로 취급 — 읽음 맵 병합 등에서 기존 owner/peer를 지우지 않습니다. */
function assignOwnerPeerIfProvided(
  r: any,
  input: { ownerUserId?: string | null; peerUserId?: string | null },
): void {
  if (input.ownerUserId !== undefined && input.ownerUserId !== null) {
    const o = cleanString(input.ownerUserId);
    if (o) r.ownerUserId = o;
  }
  if (input.peerUserId !== undefined && input.peerUserId !== null) {
    const p = cleanString(input.peerUserId);
    if (p) r.peerUserId = p;
  }
}

function resolveUnreadLastAtMs(input: LocalChatRoomSummaryInput): number | null {
  return cleanNumber(input.unreadLastAtMs) ?? cleanNumber(input.remoteUpdatedAtMs) ?? null;
}

function shouldApplyUnreadByMessageVersion(row: any, input: LocalChatRoomSummaryInput): boolean {
  const incomingUnread =
    typeof input.unreadCount === 'number' && Number.isFinite(input.unreadCount)
      ? Math.max(0, Math.floor(input.unreadCount))
      : 0;
  if (incomingUnread <= 0) return false;

  const incomingLastMessageId = cleanString(input.lastMessageId);
  if (!incomingLastMessageId) return false;

  const currentReadMessageId = cleanString(row.readMessageId);
  if (currentReadMessageId && incomingLastMessageId === currentReadMessageId) return false;

  const incomingLastMessageAtMs = cleanNumber(input.lastMessageAtMs) ?? 0;
  const currentLastMessageAtMs =
    typeof row.lastMessageAtMs === 'number' && Number.isFinite(row.lastMessageAtMs) && row.lastMessageAtMs > 0
      ? Math.floor(row.lastMessageAtMs)
      : 0;
  if (incomingLastMessageAtMs > 0 && currentLastMessageAtMs > 0 && incomingLastMessageAtMs < currentLastMessageAtMs) {
    return false;
  }

  const currentLastMessageId = cleanString(row.lastMessageId);
  if (currentLastMessageId && incomingLastMessageId !== currentLastMessageId) return true;
  if (incomingLastMessageAtMs > 0 && currentLastMessageAtMs > 0 && incomingLastMessageAtMs > currentLastMessageAtMs) return true;
  return Boolean(currentReadMessageId && incomingLastMessageId !== currentReadMessageId && incomingLastMessageId === currentLastMessageId);
}

function shouldApplyUnreadUpdate(row: any, input: LocalChatRoomSummaryInput): boolean {
  if (input.forceServerUnread && input.unreadCount !== undefined) return true;
  if (input.unreadCount === undefined && input.readMessageId === undefined && input.readAtMs === undefined) return true;
  /** 목록 배지 0 반영: 명시적 unread=0은 읽음 처리로 간주해 타임스탬프 가드보다 우선(가드만 쓰면 shouldApplyUnreadByMessageVersion이 항상 false). */
  if (typeof input.unreadCount === 'number' && Number.isFinite(input.unreadCount) && input.unreadCount === 0) return true;
  const incoming = resolveUnreadLastAtMs(input);
  if (!incoming) return true;
  const current = typeof row.unreadLastAtMs === 'number' && Number.isFinite(row.unreadLastAtMs) ? row.unreadLastAtMs : 0;
  return incoming >= current || shouldApplyUnreadByMessageVersion(row, input);
}

export async function upsertLocalChatRoomSummary(input: LocalChatRoomSummaryInput): Promise<void> {
  const db = database;
  if (!db) return;
  const roomId = cleanString(input.roomId);
  const roomType = input.roomType === 'meeting' ? 'meeting' : input.roomType === 'social_dm' ? 'social_dm' : null;
  if (!roomId || !roomType) return;

  if (__DEV__) {
    const uc = input.unreadCount;
    const ucLog =
      typeof uc === 'number' && Number.isFinite(uc)
        ? uc
        : uc === undefined
          ? 'omit(참가자 unread RPC·Realtime에서 별도 반영)'
          : String(uc);
    const own = input.ownerUserId === undefined ? 'undefined' : String(input.ownerUserId ?? '');
    // eslint-disable-next-line no-console
    console.log('[upsertLocalChatRoomSummary] →', { roomId, roomType, ownerUserId: own, unreadCount: ucLog });
  }

  await enqueueChatRoomWrite(async () => {
    await db.write(async () => {
      const rooms = db.get('chat_rooms');
      const existing = await rooms.query(Q.where('room_id', roomId), Q.where('room_type', roomType)).fetch();
      const apply = (r: any) => {
        const applyUnread = shouldApplyUnreadUpdate(r, input);
        r.roomId = roomId;
        r.roomType = roomType;
        assignOwnerPeerIfProvided(r, input);
        assignDefined(r, 'isGroup', input.isGroup === undefined ? undefined : input.isGroup === true);
        assignDefined(r, 'lastMessageId', input.lastMessageId === undefined ? undefined : cleanString(input.lastMessageId));
        assignDefined(r, 'lastMessageAtMs', input.lastMessageAtMs === undefined ? undefined : cleanNumber(input.lastMessageAtMs));
        assignDefined(r, 'lastMessagePreview', input.lastMessagePreview === undefined ? undefined : cleanString(input.lastMessagePreview));
        assignDefined(r, 'lastMessageKind', input.lastMessageKind === undefined ? undefined : cleanString(input.lastMessageKind));
        assignDefined(r, 'lastSenderId', input.lastSenderId === undefined ? undefined : cleanString(input.lastSenderId));
        assignDefined(r, 'lastSenderName', input.lastSenderName === undefined ? undefined : cleanString(input.lastSenderName));
        assignDefined(
          r,
          'lastSenderAvatarUrl',
          input.lastSenderAvatarUrl === undefined ? undefined : cleanString(input.lastSenderAvatarUrl),
        );
        assignDefined(
          r,
          'lastServerSeq',
          input.lastServerSeq === undefined
            ? undefined
            : typeof input.lastServerSeq === 'number' && Number.isFinite(input.lastServerSeq)
              ? Math.max(0, Math.floor(input.lastServerSeq))
              : null,
        );
        assignDefined(
          r,
          'lastReadServerSeq',
          input.lastReadServerSeq === undefined
            ? undefined
            : input.lastReadServerSeq === null
              ? null
              : typeof input.lastReadServerSeq === 'number' && Number.isFinite(input.lastReadServerSeq)
                ? Math.max(0, Math.floor(input.lastReadServerSeq))
                : null,
        );
        if (applyUnread) {
          assignDefined(
            r,
            'unreadCount',
            input.unreadCount === undefined
              ? undefined
              : typeof input.unreadCount === 'number' && Number.isFinite(input.unreadCount)
                ? Math.max(0, Math.floor(input.unreadCount))
                : null,
          );
          assignDefined(
            r,
            'unreadLastAtMs',
            input.unreadLastAtMs === undefined && input.remoteUpdatedAtMs === undefined ? undefined : resolveUnreadLastAtMs(input),
          );
          assignDefined(r, 'readMessageId', input.readMessageId === undefined ? undefined : cleanString(input.readMessageId));
          assignDefined(r, 'readAtMs', input.readAtMs === undefined ? undefined : cleanNumber(input.readAtMs));
          if (typeof input.unreadCount === 'number' && Number.isFinite(input.unreadCount) && input.unreadCount === 0) {
            const curSrv =
              typeof r.lastServerSeq === 'number' && Number.isFinite(r.lastServerSeq) ? Math.max(0, Math.floor(r.lastServerSeq)) : 0;
            if (input.lastReadServerSeq === undefined) {
              r.lastReadServerSeq = curSrv;
            }
          }
        }
        let remoteUpdatedAtMsToApply =
          input.remoteUpdatedAtMs === undefined ? undefined : cleanNumber(input.remoteUpdatedAtMs) ?? Date.now();
        if (remoteUpdatedAtMsToApply != null && input.unreadCount === undefined) {
          const curRemote =
            typeof r.remoteUpdatedAtMs === 'number' && Number.isFinite(r.remoteUpdatedAtMs)
              ? Math.floor(r.remoteUpdatedAtMs)
              : 0;
          if (curRemote > remoteUpdatedAtMsToApply) remoteUpdatedAtMsToApply = undefined;
        }
        assignDefined(r, 'remoteUpdatedAtMs', remoteUpdatedAtMsToApply);
        assignDefined(r, 'roomSearchText', input.roomSearchText === undefined ? defaultSearchText(input) : cleanString(input.roomSearchText));
        if (input.touchListSurface === true) {
          r.lastSyncedChangedAtMs = Date.now();
        }
      };
      const row = existing[0];
      if (row) await row.update(apply);
      else await rooms.create(apply);
    });
  });
}

/** 목록 UI용: 서버·브로드캐스트가 맞춘 `unread_count`(로컬 컬럼)만 사용합니다. */
export function unreadCountForChatRoomListRow(row: any): number {
  const stored =
    typeof row.unreadCount === 'number' && Number.isFinite(row.unreadCount) ? Math.max(0, Math.floor(row.unreadCount)) : 0;
  return stored;
}

export async function readLocalChatRoomUnreadCount(args: {
  roomType: OfflineChatRoomType;
  roomId: string;
}): Promise<number> {
  const db = database;
  const rid = cleanString(args.roomId);
  const rt = args.roomType === 'meeting' ? 'meeting' : args.roomType === 'social_dm' ? 'social_dm' : null;
  if (!db || !rid || !rt) return 0;
  const rows = await db.get('chat_rooms').query(Q.where('room_id', rid), Q.where('room_type', rt)).fetch();
  const row = rows[0];
  if (!row) return 0;
  return unreadCountForChatRoomListRow(row);
}

export function mapLocalChatRoomRow(row: any): LocalChatRoomSummary {
  const roomId = cleanString(row.roomId) ?? '';
  const peer = cleanString(row.peerUserId) ?? '';
  const lastSrv =
    typeof row.lastServerSeq === 'number' && Number.isFinite(row.lastServerSeq) ? Math.max(0, Math.floor(row.lastServerSeq)) : 0;
  const lastReadRaw = row.lastReadServerSeq;
  const lastReadResolved =
    typeof lastReadRaw === 'number' && Number.isFinite(lastReadRaw) ? Math.max(0, Math.floor(lastReadRaw)) : null;
  return {
    roomId,
    peerAppUserId: peer,
    roomType: row.roomType === 'meeting' ? 'meeting' : 'social_dm',
    ownerUserId: cleanString(row.ownerUserId),
    peerUserId: peer || null,
    isGroup: typeof row.isGroup === 'boolean' ? row.isGroup : null,
    lastMessageId: cleanString(row.lastMessageId),
    lastMessageAtMs: typeof row.lastMessageAtMs === 'number' && Number.isFinite(row.lastMessageAtMs) ? row.lastMessageAtMs : 0,
    lastMessagePreview: cleanString(row.lastMessagePreview),
    lastMessageKind: cleanString(row.lastMessageKind),
    lastSenderId: cleanString(row.lastSenderId),
    lastSenderName: cleanString(row.lastSenderName),
    lastSenderAvatarUrl: cleanString(row.lastSenderAvatarUrl),
    lastServerSeq: lastSrv,
    lastReadServerSeq: lastReadResolved,
    unreadCount: unreadCountForChatRoomListRow(row),
    unreadLastAtMs:
      typeof row.unreadLastAtMs === 'number' && Number.isFinite(row.unreadLastAtMs) ? Math.max(0, row.unreadLastAtMs) : 0,
    readMessageId: cleanString(row.readMessageId),
    readAtMs: typeof row.readAtMs === 'number' && Number.isFinite(row.readAtMs) ? row.readAtMs : 0,
    messageReadMessageIdBy: parseStringMapJson(row.messageReadMessageIdByJson),
    messageReadAtMsBy: parseNumberMapJson(row.messageReadAtByJson),
    messageReadLastSeqBy: parseNumberMapJson(row.messageReadLastSeqByJson),
    messageReadStateLastAtMs:
      typeof row.messageReadStateLastAtMs === 'number' && Number.isFinite(row.messageReadStateLastAtMs)
        ? Math.max(0, row.messageReadStateLastAtMs)
        : 0,
    remoteUpdatedAtMs:
      typeof row.remoteUpdatedAtMs === 'number' && Number.isFinite(row.remoteUpdatedAtMs) ? row.remoteUpdatedAtMs : 0,
  };
}

export async function optimisticZeroUnreadLocalChatRoomOnMount(input: {
  roomType: OfflineChatRoomType;
  roomId: string;
  ownerUserId: string | null | undefined;
  isGroup?: boolean | null;
  peerUserId?: string | null;
}): Promise<void> {
  const roomId = cleanString(input.roomId);
  const roomType = input.roomType === 'meeting' ? 'meeting' : input.roomType === 'social_dm' ? 'social_dm' : null;
  if (!roomId || !roomType) return;
  const rawOwner = typeof input.ownerUserId === 'string' ? input.ownerUserId.trim() : '';
  const ownerNorm = rawOwner ? normalizeParticipantId(rawOwner) || rawOwner : null;
  const now = Date.now();
  await upsertLocalChatRoomSummary({
    roomType,
    roomId,
    ownerUserId: ownerNorm,
    peerUserId: input.peerUserId === undefined ? undefined : cleanString(input.peerUserId),
    isGroup: input.isGroup != null ? input.isGroup === true : roomType === 'meeting',
    unreadCount: 0,
    unreadLastAtMs: now,
    remoteUpdatedAtMs: now,
    forceServerUnread: true,
    touchListSurface: true,
  });
}

export async function clearLocalChatRoomUnread(args: {
  roomType: OfflineChatRoomType;
  roomId: string;
  ownerUserId?: string | null;
  readMessageId?: string | null;
  readAtMs?: number | null;
}): Promise<void> {
  const readAtMs = cleanNumber(args.readAtMs) ?? Date.now();
  const rawOwner = args.ownerUserId != null ? String(args.ownerUserId).trim() : '';
  const ownerNorm = rawOwner ? normalizeParticipantId(rawOwner) || rawOwner : null;
  await upsertLocalChatRoomSummary({
    roomType: args.roomType,
    roomId: args.roomId,
    ownerUserId: ownerNorm,
    unreadCount: 0,
    unreadLastAtMs: readAtMs,
    readMessageId: args.readMessageId ?? null,
    readAtMs,
    remoteUpdatedAtMs: readAtMs,
    forceServerUnread: true,
    touchListSurface: true,
  });
}

export async function upsertLocalChatRoomReadState(input: LocalChatRoomReadStateInput): Promise<void> {
  const db = database;
  if (!db) return;
  const roomId = cleanString(input.roomId);
  const roomType = input.roomType === 'meeting' ? 'meeting' : input.roomType === 'social_dm' ? 'social_dm' : null;
  if (!roomId || !roomType) return;

  const incomingReadIds = normalizeReadMessageIdMap(input.readMessageIdBy);
  const incomingReadAts = normalizeReadAtMsMap({ readAtBy: input.readAtBy, readAtMsBy: input.readAtMsBy });
  const incomingReadSeqs: Record<string, number> = {};
  const rawSeqBy = input.readLastSeqBy;
  if (rawSeqBy && typeof rawSeqBy === 'object') {
    for (const [k, v] of Object.entries(rawSeqBy)) {
      const key = cleanString(k);
      if (!key) continue;
      const n = typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : Number(v);
      if (Number.isFinite(n) && n > 0) incomingReadSeqs[key] = Math.floor(n);
    }
  }
  const incomingLastAt =
    cleanNumber(input.readStateLastAtMs) ??
    Math.max(0, ...Object.values(incomingReadAts).filter((v) => Number.isFinite(v) && v > 0));
  if (
    Object.keys(incomingReadIds).length === 0 &&
    Object.keys(incomingReadAts).length === 0 &&
    Object.keys(incomingReadSeqs).length === 0
  ) {
    return;
  }

  await enqueueChatRoomWrite(async () => {
    await db.write(async () => {
      const rooms = db.get('chat_rooms');
      const existing = await rooms.query(Q.where('room_id', roomId), Q.where('room_type', roomType)).fetch();
      const apply = (r: any) => {
        r.roomId = roomId;
        r.roomType = roomType;
        assignOwnerPeerIfProvided(r, input);

        const nextIds = parseStringMapJson(r.messageReadMessageIdByJson);
        const nextAts = parseNumberMapJson(r.messageReadAtByJson);
        const nextSeqs = parseNumberMapJson(r.messageReadLastSeqByJson);
        let changed = false;
        const keys = new Set([...Object.keys(incomingReadIds), ...Object.keys(incomingReadAts), ...Object.keys(incomingReadSeqs)]);
        for (const key of keys) {
          const incomingAt = incomingReadAts[key] ?? incomingLastAt ?? 0;
          const currentAt = nextAts[key] ?? 0;
          const incomingId = incomingReadIds[key] ?? null;
          if (incomingAt > 0 && currentAt > 0 && incomingAt < currentAt && !incomingId) continue;
          if (incomingAt > currentAt) {
            nextAts[key] = incomingAt;
            changed = true;
          }
          if (incomingId && (incomingAt >= currentAt || !nextIds[key] || nextIds[key] !== incomingId)) {
            if (nextIds[key] !== incomingId) {
              nextIds[key] = incomingId;
              changed = true;
            }
          }
          const incomingSeq = incomingReadSeqs[key] ?? 0;
          const currentSeq = nextSeqs[key] ?? 0;
          if (incomingSeq > currentSeq) {
            nextSeqs[key] = incomingSeq;
            changed = true;
          }
        }
        const nextStateLastAtMs = Math.max(
          typeof r.messageReadStateLastAtMs === 'number' && Number.isFinite(r.messageReadStateLastAtMs)
            ? r.messageReadStateLastAtMs
            : 0,
          incomingLastAt ?? 0,
          ...Object.values(nextAts),
        );
        if (!changed) return;
        r.messageReadMessageIdByJson = encodeJsonMap(nextIds);
        r.messageReadAtByJson = encodeJsonMap(nextAts);
        r.messageReadLastSeqByJson = encodeJsonMap(nextSeqs);
        r.messageReadStateLastAtMs = nextStateLastAtMs;
      };
      const row = existing[0];
      if (row) await row.update(apply);
      else await rooms.create(apply);
    });
  });
}

export async function markLocalChatRoomReadState(args: {
  roomType: OfflineChatRoomType;
  roomId: string;
  ownerUserId?: string | null;
  peerUserId?: string | null;
  userId: string;
  readMessageId: string;
  readAtMs?: number | null;
}): Promise<void> {
  const userKey = readStateUserKey(args.userId);
  const messageId = cleanString(args.readMessageId);
  if (!userKey || !messageId) return;
  const readAtMs = cleanNumber(args.readAtMs) ?? Date.now();
  await upsertLocalChatRoomReadState({
    roomType: args.roomType,
    roomId: args.roomId,
    ownerUserId: args.ownerUserId ?? undefined,
    peerUserId: args.peerUserId ?? undefined,
    readMessageIdBy: { [userKey]: messageId },
    readAtMsBy: { [userKey]: readAtMs },
    readStateLastAtMs: readAtMs,
  });
}

/** 친구 채팅 목록 미리보기 — 메시지 스텁이 없어도 `chat_rooms` denorm 폴백 */
export function socialListPreviewFromLocalRoom(
  room: Pick<LocalChatRoomSummary, 'lastMessagePreview'>,
  latest: SocialChatMessage | null | undefined,
): string {
  if (latest != null) {
    const line = socialDmPreviewLine(latest);
    if (line) return line;
  }
  return room.lastMessagePreview?.trim() ?? '';
}

/** 친구 채팅 목록 우측 상대 시각(ms) */
export function socialListLastMessageMs(
  room: Pick<LocalChatRoomSummary, 'lastMessageAtMs'>,
  latest: SocialChatMessage | null | undefined,
): number {
  const ts = latest?.createdAt;
  if (ts && typeof ts.toMillis === 'function') {
    try {
      const ms = ts.toMillis();
      if (ms > 0) return ms;
    } catch {
      /* noop */
    }
  }
  const lm = room.lastMessageAtMs;
  return typeof lm === 'number' && Number.isFinite(lm) && lm > 0 ? lm : 0;
}

export function socialMessageFromLocalRoom(room: LocalChatRoomSummary): SocialChatMessage | null {
  if (!room.lastMessageId || !room.lastMessageAtMs) return null;
  const createdAt = Timestamp.fromMillis(room.lastMessageAtMs);
  const updatedAt = Timestamp.fromMillis(room.remoteUpdatedAtMs || room.lastMessageAtMs);
  return {
    id: room.lastMessageId,
    senderId: room.lastSenderId,
    text: room.lastMessagePreview ?? '',
    kind:
      room.lastMessageKind === 'system' || room.lastMessageKind === 'image' || room.lastMessageKind === 'text'
        ? room.lastMessageKind
        : 'text',
    imageUrl: null,
    imageAlbumBatchId: null,
    linkPreview: null,
    replyTo: null,
    createdAt,
    updatedAt,
    deletedAt: null,
  };
}

export function meetingMessageFromLocalRoom(room: LocalChatRoomSummary): MeetingChatMessage | null {
  const m = socialMessageFromLocalRoom(room);
  if (!m) return null;
  return {
    id: m.id,
    senderId: m.senderId,
    text: m.text,
    kind: m.kind ?? 'text',
    imageUrl: null,
    imageAlbumBatchId: null,
    linkPreview: null,
    replyTo: null,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    deletedAt: null,
  };
}

export function localSocialRoomDocFromSummary(room: LocalChatRoomSummary): SocialChatRoomDoc {
  const hasLocalUnreadState = room.unreadLastAtMs > 0;
  return {
    id: room.roomId,
    isGroup: room.isGroup ?? false,
    participantIds: [room.ownerUserId, room.peerUserId].filter((x): x is string => Boolean(x?.trim())),
    unreadCountBy: hasLocalUnreadState && room.ownerUserId ? { [room.ownerUserId]: room.unreadCount } : undefined,
    readMessageIdBy:
      hasLocalUnreadState && room.ownerUserId && room.readMessageId ? { [room.ownerUserId]: room.readMessageId } : undefined,
    readAtBy:
      hasLocalUnreadState && room.ownerUserId && room.readAtMs > 0
        ? { [room.ownerUserId]: { toMillis: () => room.readAtMs } }
        : undefined,
  };
}
