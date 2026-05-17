import { Q } from '@nozbe/watermelondb';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { InteractionManager, Platform } from 'react-native';

import type { ChatRoomKindDelta } from '@/src/lib/chat-supabase-delta';
import { chatSendMessageRpc, newChatClientMutationId } from '@/src/lib/chat-supabase-delta';
import {
  meetingChatCommitImageFromLocalUri,
  notifyMeetingChatParticipantsRemoteFireAndForget,
} from '@/src/lib/meeting-chat';
import {
  scheduleChatBubbleReadPointersPull,
  schedulePostSendChatBubbleReadPointersPull,
} from '@/src/lib/chat-bubble-read-pointers-pull';
import { upsertSocialDmListSurfaceAcrossLocalRoomIds } from '@/src/lib/chat-social-room-id-mirror';
import { getOrCreateLocalRoom } from '@/src/lib/offline-chat/offline-chat-sync';
import { localRoomPreviewForMessage } from '@/src/lib/offline-chat/offline-chat-rooms';
import { buildSearchText, sanitizeUnicodeForSqliteStorage } from '@/src/lib/offline-chat/offline-chat-utils';
import { normalizePhoneUserId } from '@/src/lib/phone-user-id';
import { getUserProfile } from '@/src/lib/user-profile';
import { WM_CHAT_MESSAGE_LIST_OBSERVE_COLUMNS } from '@/src/lib/watermelon-observe-columns';
import { database } from '@/src/watermelon';
import type { ChatRoom } from '@/src/watermelon/models/ChatRoom';

const DEFAULT_OBSERVE_LIMIT = 1000;

function sanitizeStoredText(s: string | null | undefined): string | null {
  if (s == null || typeof s !== 'string') return null;
  const t = s.trim();
  if (!t) return null;
  const out = sanitizeUnicodeForSqliteStorage(t);
  return out.trim() ? out.trim() : null;
}

function safeJson(value: unknown): string | null {
  if (value == null) return null;
  try {
    const j = JSON.stringify(value);
    return j ? sanitizeUnicodeForSqliteStorage(j) : null;
  } catch {
    return null;
  }
}

function deferAfterInteractions(task: () => void) {
  if (Platform.OS === 'web') {
    queueMicrotask(task);
    return;
  }
  InteractionManager.runAfterInteractions(() => {
    queueMicrotask(task);
  });
}

export type ChatEngineMessageSnapshot = {
  watermelonId: string;
  roomId: string;
  roomType: ChatRoomKindDelta;
  messageId: string;
  createdAtMs: number;
  updatedAtMs: number | null;
  deletedAtMs: number | null;
  /** Supabase `seq` — 로컬 컬럼 `server_seq` */
  seq: number | null;
  clientMutationId: string | null;
  chatRoomId: string | null;
  senderId: string | null;
  senderName: string | null;
  senderAvatarUrl: string | null;
  kind: string | null;
  text: string | null;
  imageUrl: string | null;
  imageAlbumBatchId: string | null;
  replyToMessageId: string | null;
  replyToJson: string | null;
  linkPreviewJson: string | null;
  isDeleted: boolean | null;
};

/** 동일 `client_mutation_id`로 낙관적 행·서버 upsert 행이 겹칠 때 한 건만 남깁니다. */
function dedupeChatEngineSnapshots(rows: ChatEngineMessageSnapshot[]): ChatEngineMessageSnapshot[] {
  const byCmid = new Map<string, ChatEngineMessageSnapshot>();
  const noCmid: ChatEngineMessageSnapshot[] = [];
  const pick = (a: ChatEngineMessageSnapshot, b: ChatEngineMessageSnapshot) => {
    const aLoc = a.messageId.startsWith('local:');
    const bLoc = b.messageId.startsWith('local:');
    if (aLoc !== bLoc) return aLoc ? b : a;
    const as = a.seq ?? 0;
    const bs = b.seq ?? 0;
    if (as !== bs) return as >= bs ? a : b;
    const au = a.updatedAtMs ?? 0;
    const bu = b.updatedAtMs ?? 0;
    return au >= bu ? a : b;
  };
  for (const r of rows) {
    const cm = typeof r.clientMutationId === 'string' ? r.clientMutationId.trim() : '';
    if (!cm) {
      noCmid.push(r);
      continue;
    }
    const prev = byCmid.get(cm);
    if (!prev) byCmid.set(cm, r);
    else byCmid.set(cm, pick(prev, r));
  }
  return [...noCmid, ...byCmid.values()].sort((a, b) => b.createdAtMs - a.createdAtMs);
}

function modelRowToSnapshot(row: any): ChatEngineMessageSnapshot {
  return {
    watermelonId: String(row?.id ?? ''),
    roomId: typeof row?.roomId === 'string' ? row.roomId : String(row?.roomId ?? ''),
    roomType: row?.roomType === 'social_dm' ? 'social_dm' : 'meeting',
    messageId: typeof row?.messageId === 'string' ? row.messageId : String(row?.messageId ?? ''),
    createdAtMs: typeof row?.createdAtMs === 'number' && Number.isFinite(row.createdAtMs) ? row.createdAtMs : 0,
    updatedAtMs: typeof row?.updatedAtMs === 'number' && Number.isFinite(row.updatedAtMs) ? row.updatedAtMs : null,
    deletedAtMs: typeof row?.deletedAtMs === 'number' && Number.isFinite(row.deletedAtMs) ? row.deletedAtMs : null,
    seq: typeof row?.serverSeq === 'number' && Number.isFinite(row.serverSeq) ? row.serverSeq : null,
    clientMutationId: typeof row?.clientMutationId === 'string' ? row.clientMutationId : row?.clientMutationId ?? null,
    chatRoomId: typeof row?.chatRoomId === 'string' ? row.chatRoomId : row?.chatRoomId ?? null,
    senderId: typeof row?.senderId === 'string' ? row.senderId : null,
    senderName: typeof row?.senderName === 'string' ? row.senderName : null,
    senderAvatarUrl: typeof row?.senderAvatarUrl === 'string' ? row.senderAvatarUrl : null,
    kind: typeof row?.kind === 'string' ? row.kind : null,
    text: typeof row?.text === 'string' ? row.text : null,
    imageUrl: typeof row?.imageUrl === 'string' ? row.imageUrl : null,
    imageAlbumBatchId: typeof row?.imageAlbumBatchId === 'string' ? row.imageAlbumBatchId : null,
    replyToMessageId: typeof row?.replyToMessageId === 'string' ? row.replyToMessageId : null,
    replyToJson: typeof row?.replyToJson === 'string' ? row.replyToJson : null,
    linkPreviewJson: typeof row?.linkPreviewJson === 'string' ? row.linkPreviewJson : null,
    isDeleted: typeof row?.isDeleted === 'boolean' ? row.isDeleted : null,
  };
}

export type ChatEngineSendMessageInput = {
  kind: 'text' | 'image' | 'system';
  bodyText?: string | null;
  imageUrl?: string | null;
  imageAlbumBatchId?: string | null;
  replyTo?: Record<string, unknown> | null;
  linkPreview?: Record<string, unknown> | null;
  senderId?: string | null;
  senderName?: string | null;
  senderAvatarUrl?: string | null;
};

export type ChatEngineSendMeetingImageBatchInput = {
  uris: string[];
  naturalWidths?: (number | undefined)[];
  caption?: string;
  senderId?: string | null;
  senderName?: string | null;
  senderAvatarUrl?: string | null;
};

export function useChatEngine(options: {
  roomKind: ChatRoomKindDelta;
  roomId: string;
  meAppUserId: string;
  enabled?: boolean;
  observeLimit?: number;
}): {
  messages: ChatEngineMessageSnapshot[];
  sendMessage: (input: ChatEngineSendMessageInput) => Promise<void>;
  /** `roomKind === 'meeting'` 일 때만 동작. 각 URI마다 낙관적 `local:` 행 후 업로드·RPC로 갱신. */
  sendMeetingImageUrisBatch: (input: ChatEngineSendMeetingImageBatchInput) => Promise<void>;
  isDatabaseAvailable: boolean;
} {
  const { roomKind, roomId, meAppUserId, enabled = true, observeLimit } = options;
  const [messages, setMessages] = useState<ChatEngineMessageSnapshot[]>([]);
  const isDatabaseAvailable = database != null;

  const take = useMemo(
    () => Math.min(Math.max(20, observeLimit ?? DEFAULT_OBSERVE_LIMIT), 5000),
    [observeLimit],
  );

  useEffect(() => {
    const db = database;
    const rid = roomId.trim();
    const uid = meAppUserId.trim();
    if (!db || !enabled || !rid || !uid) {
      setMessages([]);
      return;
    }

    setMessages([]);

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    let readPullTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleReadPullFromMessages = () => {
      if (cancelled) return;
      if (readPullTimer) clearTimeout(readPullTimer);
      readPullTimer = setTimeout(() => {
        readPullTimer = null;
        scheduleChatBubbleReadPointersPull({ roomKind, roomId: rid, myAppUserId: uid });
      }, 450);
    };

    void (async () => {
      try {
        const rooms = db.get('chat_rooms');
        const roomRows = await rooms.query(Q.where('room_id', rid), Q.where('room_type', roomKind)).fetch();
        const roomModel = roomRows[0] as ChatRoom | undefined;

        const fallbackQuery = db
          .get('chat_messages')
          .query(Q.where('room_id', rid), Q.where('room_type', roomKind), Q.sortBy('created_at_ms', Q.desc), Q.take(take));

        const query =
          roomModel && roomModel.messages
            ? roomModel.messages.extend(Q.sortBy('created_at_ms', Q.desc), Q.take(take))
            : fallbackQuery;

        const sub = query.observeWithColumns([...WM_CHAT_MESSAGE_LIST_OBSERVE_COLUMNS]).subscribe((rows: any[]) => {
          if (cancelled) return;
          const mapped = rows.map(modelRowToSnapshot).filter((m) => m.messageId && m.createdAtMs > 0);
          setMessages(dedupeChatEngineSnapshots(mapped));
          scheduleReadPullFromMessages();
        });
        unsubscribe = () => sub.unsubscribe();
      } catch {
        if (!cancelled) setMessages([]);
      }
    })();

    return () => {
      cancelled = true;
      if (readPullTimer) clearTimeout(readPullTimer);
      unsubscribe?.();
    };
  }, [enabled, meAppUserId, roomId, roomKind, take]);

  const sendMessage = useCallback(
    async (input: ChatEngineSendMessageInput) => {
      const db = database;
      const rid = roomId.trim();
      const uid = meAppUserId.trim();
      if (!db || !rid || !uid) return;

      const clientMutationId = newChatClientMutationId();
      const optimisticMessageId = `local:${clientMutationId}`;
      const now = Date.now();
      const bodyText = sanitizeStoredText(input.bodyText ?? null);
      const imageUrl = sanitizeStoredText(input.imageUrl ?? null);
      const imageAlbumBatchId = sanitizeStoredText(input.imageAlbumBatchId ?? null);
      const senderId = sanitizeStoredText(input.senderId ?? uid) ?? uid;
      const senderName = sanitizeStoredText(input.senderName ?? null);
      const senderAvatarUrl = sanitizeStoredText(input.senderAvatarUrl ?? null);
      const replyToJson = input.replyTo == null ? null : safeJson(input.replyTo);
      const linkPreviewJson = input.linkPreview == null ? null : safeJson(input.linkPreview);
      const replyToMessageId =
        input.replyTo && typeof input.replyTo === 'object' && !Array.isArray(input.replyTo)
          ? sanitizeStoredText(
              typeof (input.replyTo as Record<string, unknown>).messageId === 'string'
                ? String((input.replyTo as Record<string, unknown>).messageId)
                : null,
            )
          : null;
      const searchText = buildSearchText([
        bodyText,
        input.kind === 'image' ? '사진' : '',
        senderName,
      ]);

      const roomRow = await getOrCreateLocalRoom({ roomId: rid, roomType: roomKind });
      if (!roomRow) return;
      const chatRoomFk = typeof (roomRow as { id?: unknown }).id === 'string' ? (roomRow as { id: string }).id : '';

      await db.write(async () => {
        await db.get('chat_messages').create((m: any) => {
          m.roomId = rid;
          m.roomType = roomKind;
          m.chatRoomId = chatRoomFk || null;
          m.messageId = optimisticMessageId;
          m.clientMutationId = clientMutationId;
          m.createdAtMs = now;
          m.updatedAtMs = now;
          m.deletedAtMs = null;
          m.senderId = senderId;
          m.senderName = senderName;
          m.senderAvatarUrl = senderAvatarUrl;
          m.kind = input.kind;
          m.text = bodyText;
          m.imageUrl = imageUrl;
          m.imageAlbumBatchId = imageAlbumBatchId;
          m.replyToMessageId = replyToMessageId;
          m.replyToJson = replyToMessageId ? replyToJson : null;
          m.linkPreviewJson = linkPreviewJson;
          m.rawPayloadJson = safeJson({ optimistic: true, clientMutationId });
          m.searchText = searchText;
          m.isDeleted = null;
          m.serverSeq = null;
        });
      });

      if (roomKind === 'social_dm') {
        const preview =
          localRoomPreviewForMessage({
            kind: input.kind,
            text: bodyText,
            imageUrl,
          }) ?? '';
        await upsertSocialDmListSurfaceAcrossLocalRoomIds(uid, rid, {
          ownerUserId: uid,
          lastMessageId: optimisticMessageId,
          lastMessageAtMs: now,
          lastMessagePreview: preview,
          lastMessageKind: input.kind,
          lastSenderId: senderId,
          touchListSurface: true,
        });
      }

      deferAfterInteractions(() => {
        void (async () => {
          try {
            const res = await chatSendMessageRpc({
              meAppUserId: uid,
              roomKind,
              roomId: rid,
              clientMutationId,
              kind: input.kind,
              bodyText,
              imageUrl,
              imageAlbumBatchId,
              replyTo: input.replyTo ?? null,
              linkPreview: input.linkPreview ?? null,
            });

            if (!res.ok && !res.duplicate) {
              if (__DEV__) console.warn('[useChatEngine] chat_send_message', res.error);
              return;
            }

            const serverId = typeof res.id === 'string' && res.id.trim() ? res.id.trim() : null;
            const serverSeq = typeof res.seq === 'number' && Number.isFinite(res.seq) ? Math.floor(res.seq) : null;

            await db.write(async () => {
              const pending = await db
                .get('chat_messages')
                .query(Q.where('room_id', rid), Q.where('room_type', roomKind), Q.where('client_mutation_id', clientMutationId))
                .fetch();
              const row = pending[0];
              if (row) {
                await row.update((x: any) => {
                  if (serverId) x.messageId = serverId;
                  if (serverSeq != null && serverSeq > 0) x.serverSeq = serverSeq;
                  x.updatedAtMs = Date.now();
                });
              }

              if (serverSeq != null && serverSeq > 0 && chatRoomFk) {
                const roomsCol = db.get('chat_rooms');
                const rr = await roomsCol.query(Q.where('room_id', rid), Q.where('room_type', roomKind)).fetch();
                const r0 = rr[0];
                if (r0) {
                  await r0.update((r: any) => {
                    const cur = typeof r.lastServerSeq === 'number' && Number.isFinite(r.lastServerSeq) ? r.lastServerSeq : 0;
                    if (serverSeq > cur) r.lastServerSeq = serverSeq;
                  });
                }
              }
            });

            /** 전송·seq 확정 2초 후 상대 읽음 맵 1회 pull(Realtime·observe 보조). */
            if (serverId || (serverSeq != null && serverSeq > 0)) {
              schedulePostSendChatBubbleReadPointersPull({ roomKind, roomId: rid, myAppUserId: uid });
            }

            if (roomKind === 'meeting' && input.kind === 'text' && serverId) {
              const senderPhone = normalizePhoneUserId(uid) ?? uid;
              const prof = await getUserProfile(senderPhone).catch(() => null);
              notifyMeetingChatParticipantsRemoteFireAndForget({
                meetingId: rid,
                senderId: senderPhone,
                preview: (bodyText ?? '').slice(0, 500),
                lastMessageId: serverId,
                senderName: prof?.nickname ?? prof?.displayName ?? undefined,
              });
            }
          } catch (e) {
            if (__DEV__) console.warn('[useChatEngine] sendMessage failed', e);
          }
        })();
      });
    },
    [meAppUserId, roomId, roomKind],
  );

  const sendMeetingImageUrisBatch = useCallback(
    async (input: ChatEngineSendMeetingImageBatchInput) => {
      if (roomKind !== 'meeting') return;
      const db = database;
      const rid = roomId.trim();
      const uid = meAppUserId.trim();
      if (!db || !rid || !uid) return;

      const uris = input.uris.map((u) => (typeof u === 'string' ? u.trim() : '')).filter(Boolean);
      if (uris.length === 0) return;

      const batchId =
        uris.length > 1 ? `alb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}` : '';
      const isMulti = uris.length > 1;
      const senderId = sanitizeStoredText(input.senderId ?? uid) ?? uid;
      const senderName = sanitizeStoredText(input.senderName ?? null);
      const senderAvatarUrl = sanitizeStoredText(input.senderAvatarUrl ?? null);
      const baseNow = Date.now();

      const roomRow = await getOrCreateLocalRoom({ roomId: rid, roomType: 'meeting' });
      if (!roomRow) return;
      const chatRoomFk = typeof (roomRow as { id?: unknown }).id === 'string' ? (roomRow as { id: string }).id : '';

      const clientMutationIds: string[] = [];
      await db.write(async () => {
        for (let i = 0; i < uris.length; i++) {
          const cmid = newChatClientMutationId();
          clientMutationIds.push(cmid);
          const optimisticMessageId = `local:${cmid}`;
          const cap = i === 0 ? sanitizeStoredText(input.caption ?? null) : null;
          const searchText = buildSearchText([cap, '사진', senderName]);
          await db.get('chat_messages').create((m: any) => {
            m.roomId = rid;
            m.roomType = 'meeting';
            m.chatRoomId = chatRoomFk || null;
            m.messageId = optimisticMessageId;
            m.clientMutationId = cmid;
            m.createdAtMs = baseNow + i;
            m.updatedAtMs = baseNow + i;
            m.deletedAtMs = null;
            m.senderId = senderId;
            m.senderName = senderName;
            m.senderAvatarUrl = senderAvatarUrl;
            m.kind = 'image';
            m.text = cap;
            m.imageUrl = uris[i]!;
            m.imageAlbumBatchId = batchId || null;
            m.replyToMessageId = null;
            m.replyToJson = null;
            m.linkPreviewJson = null;
            m.rawPayloadJson = safeJson({ optimistic: true, clientMutationId: cmid, albumBatch: batchId });
            m.searchText = searchText;
            m.isDeleted = null;
            m.serverSeq = null;
          });
        }
      });

      deferAfterInteractions(() => {
        void (async () => {
          const senderPhone = normalizePhoneUserId(uid) ?? uid;
          const senderProfile = await getUserProfile(senderPhone).catch(() => null);
          try {
            for (let i = 0; i < uris.length; i++) {
              const cmid = clientMutationIds[i]!;
              try {
                const res = await meetingChatCommitImageFromLocalUri({
                  meetingId: rid,
                  senderPhoneUserId: uid,
                  localImageUri: uris[i]!,
                  extras: {
                    caption: i === 0 ? input.caption : undefined,
                    naturalWidth: typeof input.naturalWidths?.[i] === 'number' ? input.naturalWidths![i] : undefined,
                    imageAlbumBatchId: batchId || undefined,
                    suppressParticipantNotify: isMulti,
                  },
                  clientMutationId: cmid,
                });
                await db.write(async () => {
                  const pending = await db
                    .get('chat_messages')
                    .query(Q.where('room_id', rid), Q.where('room_type', 'meeting'), Q.where('client_mutation_id', cmid))
                    .fetch();
                  const row = pending[0];
                  if (row) {
                    await row.update((x: any) => {
                      if (res.messageId) x.messageId = res.messageId;
                      if (res.seq != null && res.seq > 0) x.serverSeq = res.seq;
                      x.imageUrl = res.imageUrl;
                      x.updatedAtMs = Date.now();
                    });
                  }
                  const seq = res.seq;
                  if (seq != null && seq > 0 && chatRoomFk) {
                    const roomsCol = db.get('chat_rooms');
                    const rr = await roomsCol.query(Q.where('room_id', rid), Q.where('room_type', 'meeting')).fetch();
                    const r0 = rr[0];
                    if (r0) {
                      await r0.update((r: any) => {
                        const cur = typeof r.lastServerSeq === 'number' && Number.isFinite(r.lastServerSeq) ? r.lastServerSeq : 0;
                        if (seq > cur) r.lastServerSeq = seq;
                      });
                    }
                  }
                });
                if (!isMulti) {
                  const cap0 = (input.caption ?? '').trim();
                  const imgPreview = cap0 ? `사진 · ${cap0}` : '사진';
                  notifyMeetingChatParticipantsRemoteFireAndForget({
                    meetingId: rid,
                    senderId: senderPhone,
                    preview: imgPreview,
                    lastMessageId: res.messageId,
                    senderName: senderProfile?.nickname ?? senderProfile?.displayName ?? undefined,
                  });
                }
              } catch (e) {
                if (__DEV__) console.warn('[useChatEngine] sendMeetingImageUrisBatch item failed', e);
              }
            }
            if (isMulti) {
              const cap0 = (input.caption ?? '').trim();
              const preview = cap0 ? `사진 ${uris.length}장 · ${cap0.slice(0, 80)}` : `사진 ${uris.length}장`;
              notifyMeetingChatParticipantsRemoteFireAndForget({
                meetingId: rid,
                senderId: senderPhone,
                preview,
                senderName: senderProfile?.nickname ?? senderProfile?.displayName ?? undefined,
              });
            }
            schedulePostSendChatBubbleReadPointersPull({ roomKind: 'meeting', roomId: rid, myAppUserId: uid });
          } catch (e) {
            if (__DEV__) console.warn('[useChatEngine] sendMeetingImageUrisBatch failed', e);
          }
        })();
      });
    },
    [meAppUserId, roomId, roomKind],
  );

  return { messages, sendMessage, sendMeetingImageUrisBatch, isDatabaseAvailable };
}
