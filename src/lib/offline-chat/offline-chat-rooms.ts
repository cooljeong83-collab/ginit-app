import { Q } from '@nozbe/watermelondb';

import { database } from '@/src/watermelon';
import type { OfflineChatRoomType } from '@/src/lib/offline-chat/offline-chat-types';
import { buildSearchText, sanitizeUnicodeForSqliteStorage } from '@/src/lib/offline-chat/offline-chat-utils';
import type { SocialChatMessage, SocialChatRoomDoc, SocialChatRoomSummary } from '@/src/lib/social-chat-rooms';
import type { MeetingChatMessage } from '@/src/lib/meeting-chat';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
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
  messageReadStateLastAtMs: number;
  remoteUpdatedAtMs: number;
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
};

export type LocalChatRoomReadStateInput = {
  roomId: string;
  roomType: OfflineChatRoomType;
  ownerUserId?: string | null;
  peerUserId?: string | null;
  readMessageIdBy?: Record<string, unknown> | null;
  readAtBy?: Record<string, unknown> | null;
  readAtMsBy?: Record<string, number | null | undefined> | null;
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
  if (input.unreadCount === undefined && input.readMessageId === undefined && input.readAtMs === undefined) return true;
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

  await enqueueChatRoomWrite(async () => {
    await db.write(async () => {
      const rooms = db.get('chat_rooms');
      const existing = await rooms.query(Q.where('room_id', roomId), Q.where('room_type', roomType)).fetch();
      const apply = (r: any) => {
        const applyUnread = shouldApplyUnreadUpdate(r, input);
        r.roomId = roomId;
        r.roomType = roomType;
        assignDefined(r, 'ownerUserId', input.ownerUserId === undefined ? undefined : cleanString(input.ownerUserId));
        assignDefined(r, 'peerUserId', input.peerUserId === undefined ? undefined : cleanString(input.peerUserId));
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
        }
        assignDefined(
          r,
          'remoteUpdatedAtMs',
          input.remoteUpdatedAtMs === undefined ? undefined : cleanNumber(input.remoteUpdatedAtMs) ?? Date.now(),
        );
        assignDefined(r, 'roomSearchText', input.roomSearchText === undefined ? defaultSearchText(input) : cleanString(input.roomSearchText));
      };
      const row = existing[0];
      if (row) await row.update(apply);
      else await rooms.create(apply);
    });
  });
}

export function mapLocalChatRoomRow(row: any): LocalChatRoomSummary {
  const roomId = cleanString(row.roomId) ?? '';
  const peer = cleanString(row.peerUserId) ?? '';
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
    unreadCount: typeof row.unreadCount === 'number' && Number.isFinite(row.unreadCount) ? Math.max(0, row.unreadCount) : 0,
    unreadLastAtMs:
      typeof row.unreadLastAtMs === 'number' && Number.isFinite(row.unreadLastAtMs) ? Math.max(0, row.unreadLastAtMs) : 0,
    readMessageId: cleanString(row.readMessageId),
    readAtMs: typeof row.readAtMs === 'number' && Number.isFinite(row.readAtMs) ? row.readAtMs : 0,
    messageReadMessageIdBy: parseStringMapJson(row.messageReadMessageIdByJson),
    messageReadAtMsBy: parseNumberMapJson(row.messageReadAtByJson),
    messageReadStateLastAtMs:
      typeof row.messageReadStateLastAtMs === 'number' && Number.isFinite(row.messageReadStateLastAtMs)
        ? Math.max(0, row.messageReadStateLastAtMs)
        : 0,
    remoteUpdatedAtMs:
      typeof row.remoteUpdatedAtMs === 'number' && Number.isFinite(row.remoteUpdatedAtMs) ? row.remoteUpdatedAtMs : 0,
  };
}

export async function clearLocalChatRoomUnread(args: {
  roomType: OfflineChatRoomType;
  roomId: string;
  ownerUserId?: string | null;
  readMessageId?: string | null;
  readAtMs?: number | null;
}): Promise<void> {
  const readAtMs = cleanNumber(args.readAtMs) ?? Date.now();
  await upsertLocalChatRoomSummary({
    roomType: args.roomType,
    roomId: args.roomId,
    ownerUserId: args.ownerUserId ?? null,
    unreadCount: 0,
    unreadLastAtMs: readAtMs,
    readMessageId: args.readMessageId ?? null,
    readAtMs,
    remoteUpdatedAtMs: readAtMs,
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
  const incomingLastAt =
    cleanNumber(input.readStateLastAtMs) ??
    Math.max(0, ...Object.values(incomingReadAts).filter((v) => Number.isFinite(v) && v > 0));
  if (Object.keys(incomingReadIds).length === 0 && Object.keys(incomingReadAts).length === 0) return;

  await enqueueChatRoomWrite(async () => {
    await db.write(async () => {
      const rooms = db.get('chat_rooms');
      const existing = await rooms.query(Q.where('room_id', roomId), Q.where('room_type', roomType)).fetch();
      const apply = (r: any) => {
        r.roomId = roomId;
        r.roomType = roomType;
        assignDefined(r, 'ownerUserId', input.ownerUserId === undefined ? undefined : cleanString(input.ownerUserId));
        assignDefined(r, 'peerUserId', input.peerUserId === undefined ? undefined : cleanString(input.peerUserId));

        const nextIds = parseStringMapJson(r.messageReadMessageIdByJson);
        const nextAts = parseNumberMapJson(r.messageReadAtByJson);
        let changed = false;
        const keys = new Set([...Object.keys(incomingReadIds), ...Object.keys(incomingReadAts)]);
        for (const key of keys) {
          const incomingAt = incomingReadAts[key] ?? incomingLastAt ?? 0;
          const currentAt = nextAts[key] ?? 0;
          const incomingId = incomingReadIds[key] ?? null;
          if (incomingAt > 0 && currentAt > 0 && incomingAt < currentAt) continue;
          if (incomingAt > currentAt) {
            nextAts[key] = incomingAt;
            changed = true;
          }
          if (incomingId && (incomingAt >= currentAt || !nextIds[key])) {
            if (nextIds[key] !== incomingId) {
              nextIds[key] = incomingId;
              changed = true;
            }
          }
        }
        if (!changed) return;
        r.messageReadMessageIdByJson = encodeJsonMap(nextIds);
        r.messageReadAtByJson = encodeJsonMap(nextAts);
        r.messageReadStateLastAtMs = Math.max(
          typeof r.messageReadStateLastAtMs === 'number' && Number.isFinite(r.messageReadStateLastAtMs)
            ? r.messageReadStateLastAtMs
            : 0,
          incomingLastAt ?? 0,
          ...Object.values(nextAts),
        );
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
    ownerUserId: args.ownerUserId ?? null,
    peerUserId: args.peerUserId ?? null,
    readMessageIdBy: { [userKey]: messageId },
    readAtMsBy: { [userKey]: readAtMs },
    readStateLastAtMs: readAtMs,
  });
}

export function socialMessageFromLocalRoom(room: LocalChatRoomSummary): SocialChatMessage | null {
  if (!room.lastMessageId || !room.lastMessageAtMs) return null;
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
    createdAt: {
      toMillis: () => room.lastMessageAtMs,
    } as any,
    updatedAt: {
      toMillis: () => room.remoteUpdatedAtMs || room.lastMessageAtMs,
    } as any,
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
