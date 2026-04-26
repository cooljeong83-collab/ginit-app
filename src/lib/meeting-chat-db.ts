import * as SQLite from 'expo-sqlite';

import { Timestamp } from 'firebase/firestore';

import type { MeetingChatMessage, MeetingChatMessageKind } from '@/src/lib/meeting-chat';

export type MeetingChatLocalStatus = 'sent' | 'sending' | 'failed';

export type MeetingChatLocalRow = {
  meetingId: string;
  messageId: string;
  senderId: string | null;
  text: string;
  kind: MeetingChatMessageKind;
  imageUrl: string | null;
  replyToMessageId: string | null;
  replyToSenderId: string | null;
  replyToText: string | null;
  createdAtMs: number;
  isRead: 0 | 1;
  localStatus: MeetingChatLocalStatus;
  failed: 0 | 1;
  /** 실패 이유(표시용이 아니라 디버깅용). */
  lastError: string | null;
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('ginit.sqlite');
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
      `);
      return db;
    })();
  }
  return dbPromise;
}

export async function ensureMeetingChatDbReady(): Promise<void> {
  const db = await getDb();
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS messages (
      meetingId TEXT NOT NULL,
      messageId TEXT NOT NULL,
      senderId TEXT,
      text TEXT NOT NULL,
      kind TEXT NOT NULL,
      imageUrl TEXT,
      replyToMessageId TEXT,
      replyToSenderId TEXT,
      replyToText TEXT,
      createdAtMs INTEGER NOT NULL,
      isRead INTEGER NOT NULL DEFAULT 0,
      localStatus TEXT NOT NULL DEFAULT 'sent',
      failed INTEGER NOT NULL DEFAULT 0,
      lastError TEXT,
      PRIMARY KEY (meetingId, messageId)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_meeting_createdAt
      ON messages(meetingId, createdAtMs DESC);

    CREATE INDEX IF NOT EXISTS idx_messages_meeting_messageId
      ON messages(meetingId, messageId);

    CREATE INDEX IF NOT EXISTS idx_messages_meeting_failed
      ON messages(meetingId, failed, localStatus, createdAtMs DESC);
  `);
}

function asKind(v: unknown): MeetingChatMessageKind {
  return v === 'system' ? 'system' : v === 'image' ? 'image' : 'text';
}

function asStatus(v: unknown): MeetingChatLocalStatus {
  return v === 'sending' ? 'sending' : v === 'failed' ? 'failed' : 'sent';
}

function rowToMessage(r: MeetingChatLocalRow): MeetingChatMessage & { localStatus?: MeetingChatLocalStatus; failed?: boolean } {
  return {
    id: r.messageId,
    senderId: r.senderId,
    text: r.text,
    kind: r.kind,
    imageUrl: r.imageUrl,
    replyTo: r.replyToMessageId
      ? {
          messageId: r.replyToMessageId,
          senderId: r.replyToSenderId,
          text: r.replyToText ?? '',
        }
      : null,
    createdAt: r.createdAtMs ? Timestamp.fromMillis(r.createdAtMs) : null,
    localStatus: r.localStatus,
    failed: r.failed === 1,
  };
}

export async function listMeetingChatMessagesLocal(
  meetingId: string,
  limit: number,
): Promise<(MeetingChatMessage & { localStatus?: MeetingChatLocalStatus; failed?: boolean })[]> {
  const mid = meetingId.trim();
  if (!mid) return [];
  await ensureMeetingChatDbReady();
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    `
    SELECT meetingId, messageId, senderId, text, kind, imageUrl,
           replyToMessageId, replyToSenderId, replyToText,
           createdAtMs, isRead, localStatus, failed, lastError
      FROM messages
     WHERE meetingId = ?
     ORDER BY createdAtMs DESC, messageId DESC
     LIMIT ?;
  `,
    [mid, Math.max(1, Math.min(600, Math.floor(limit || 1)))],
  );

  return rows.map((r) =>
    rowToMessage({
      meetingId: String(r.meetingId ?? mid),
      messageId: String(r.messageId ?? ''),
      senderId: typeof r.senderId === 'string' && r.senderId.trim() ? String(r.senderId) : null,
      text: typeof r.text === 'string' ? String(r.text) : '',
      kind: asKind(r.kind),
      imageUrl: typeof r.imageUrl === 'string' && r.imageUrl.trim() ? String(r.imageUrl) : null,
      replyToMessageId: typeof r.replyToMessageId === 'string' && r.replyToMessageId.trim() ? String(r.replyToMessageId) : null,
      replyToSenderId: typeof r.replyToSenderId === 'string' && r.replyToSenderId.trim() ? String(r.replyToSenderId) : null,
      replyToText: typeof r.replyToText === 'string' ? String(r.replyToText) : null,
      createdAtMs: Number(r.createdAtMs ?? 0) || 0,
      isRead: Number(r.isRead ?? 0) === 1 ? 1 : 0,
      localStatus: asStatus(r.localStatus),
      failed: Number(r.failed ?? 0) === 1 ? 1 : 0,
      lastError: typeof r.lastError === 'string' ? String(r.lastError) : null,
    }),
  );
}

export async function getMeetingChatLatestCreatedAtMs(meetingId: string): Promise<number> {
  const mid = meetingId.trim();
  if (!mid) return 0;
  await ensureMeetingChatDbReady();
  const db = await getDb();
  const row = await db.getFirstAsync<any>(
    `
    SELECT createdAtMs
      FROM messages
     WHERE meetingId = ?
     ORDER BY createdAtMs DESC
     LIMIT 1;
  `,
    [mid],
  );
  const ms = Number(row?.createdAtMs ?? 0);
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

export async function upsertMeetingChatMessagesLocal(
  meetingId: string,
  incoming: MeetingChatMessage[],
): Promise<void> {
  const mid = meetingId.trim();
  if (!mid || !incoming.length) return;
  await ensureMeetingChatDbReady();
  const db = await getDb();

  await db.withTransactionAsync(async () => {
    for (const m of incoming) {
      const messageId = String(m.id ?? '').trim();
      if (!messageId) continue;
      const createdAtMs =
        m.createdAt && typeof m.createdAt.toMillis === 'function' ? m.createdAt.toMillis() : 0;

      const replyTo = m.replyTo?.messageId
        ? {
            messageId: String(m.replyTo.messageId ?? '').trim(),
            senderId:
              m.replyTo.senderId == null
                ? null
                : typeof m.replyTo.senderId === 'string'
                  ? String(m.replyTo.senderId).trim()
                  : String(m.replyTo.senderId),
            text: String(m.replyTo.text ?? '').trim().slice(0, 280),
          }
        : null;

      await db.runAsync(
        `
        INSERT INTO messages (
          meetingId, messageId, senderId, text, kind, imageUrl,
          replyToMessageId, replyToSenderId, replyToText,
          createdAtMs, isRead, localStatus, failed, lastError
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'sent', 0, NULL)
        ON CONFLICT(meetingId, messageId) DO UPDATE SET
          senderId = excluded.senderId,
          text = excluded.text,
          kind = excluded.kind,
          imageUrl = excluded.imageUrl,
          replyToMessageId = excluded.replyToMessageId,
          replyToSenderId = excluded.replyToSenderId,
          replyToText = excluded.replyToText,
          createdAtMs = MAX(messages.createdAtMs, excluded.createdAtMs),
          localStatus = CASE WHEN messages.localStatus = 'sent' THEN 'sent' ELSE messages.localStatus END,
          failed = CASE WHEN messages.localStatus = 'sent' THEN 0 ELSE messages.failed END;
      `,
        [
          mid,
          messageId,
          m.senderId?.trim() ? m.senderId.trim() : null,
          String(m.text ?? ''),
          m.kind ?? 'text',
          m.imageUrl?.trim() ? m.imageUrl.trim() : null,
          replyTo?.messageId ?? null,
          replyTo?.senderId ?? null,
          replyTo?.text ?? null,
          createdAtMs || Date.now(),
        ],
      );
    }
  });
}

export function makeOptimisticLocalMessageId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `local_${Date.now()}_${rand}`;
}

export async function insertOptimisticMeetingChatTextMessageLocal(args: {
  meetingId: string;
  messageId: string;
  senderId: string;
  text: string;
  createdAtMs: number;
  replyTo?: { messageId: string; senderId: string | null; text: string } | null;
}): Promise<void> {
  const mid = args.meetingId.trim();
  const messageId = args.messageId.trim();
  const senderId = args.senderId.trim();
  if (!mid || !messageId || !senderId) return;
  await ensureMeetingChatDbReady();
  const db = await getDb();

  const rt = args.replyTo?.messageId
    ? {
        messageId: String(args.replyTo.messageId).trim(),
        senderId: args.replyTo.senderId?.trim() ? args.replyTo.senderId.trim() : null,
        text: String(args.replyTo.text ?? '').trim().slice(0, 280),
      }
    : null;

  await db.runAsync(
    `
    INSERT INTO messages (
      meetingId, messageId, senderId, text, kind, imageUrl,
      replyToMessageId, replyToSenderId, replyToText,
      createdAtMs, isRead, localStatus, failed, lastError
    )
    VALUES (?, ?, ?, ?, 'text', NULL, ?, ?, ?, ?, 0, 'sending', 0, NULL)
    ON CONFLICT(meetingId, messageId) DO UPDATE SET
      senderId = excluded.senderId,
      text = excluded.text,
      createdAtMs = excluded.createdAtMs,
      localStatus = 'sending',
      failed = 0,
      lastError = NULL;
  `,
    [
      mid,
      messageId,
      senderId,
      args.text,
      rt?.messageId ?? null,
      rt?.senderId ?? null,
      rt?.text ?? null,
      Math.max(1, Math.floor(args.createdAtMs || Date.now())),
    ],
  );
}

export async function markMeetingChatMessageSendFailedLocal(args: {
  meetingId: string;
  messageId: string;
  error: string;
}): Promise<void> {
  const mid = args.meetingId.trim();
  const messageId = args.messageId.trim();
  if (!mid || !messageId) return;
  await ensureMeetingChatDbReady();
  const db = await getDb();
  await db.runAsync(
    `
    UPDATE messages
       SET localStatus = 'failed',
           failed = 1,
           lastError = ?
     WHERE meetingId = ? AND messageId = ?;
  `,
    [String(args.error ?? '').slice(0, 400), mid, messageId],
  );
}

export async function markMeetingChatMessageSentLocal(args: {
  meetingId: string;
  messageId: string;
}): Promise<void> {
  const mid = args.meetingId.trim();
  const messageId = args.messageId.trim();
  if (!mid || !messageId) return;
  await ensureMeetingChatDbReady();
  const db = await getDb();
  await db.runAsync(
    `
    UPDATE messages
       SET localStatus = 'sent',
           failed = 0,
           lastError = NULL
     WHERE meetingId = ? AND messageId = ?;
  `,
    [mid, messageId],
  );
}

export async function replaceLocalMessageIdWithServerId(args: {
  meetingId: string;
  localMessageId: string;
  serverMessageId: string;
}): Promise<void> {
  const mid = args.meetingId.trim();
  const localId = args.localMessageId.trim();
  const serverId = args.serverMessageId.trim();
  if (!mid || !localId || !serverId) return;
  if (localId === serverId) {
    await markMeetingChatMessageSentLocal({ meetingId: mid, messageId: serverId });
    return;
  }

  await ensureMeetingChatDbReady();
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    const row = await db.getFirstAsync<any>(
      `
      SELECT meetingId, messageId, senderId, text, kind, imageUrl,
             replyToMessageId, replyToSenderId, replyToText,
             createdAtMs, isRead
        FROM messages
       WHERE meetingId = ? AND messageId = ?
       LIMIT 1;
    `,
      [mid, localId],
    );
    if (!row) return;

    await db.runAsync(
      `
      INSERT INTO messages (
        meetingId, messageId, senderId, text, kind, imageUrl,
        replyToMessageId, replyToSenderId, replyToText,
        createdAtMs, isRead, localStatus, failed, lastError
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sent', 0, NULL)
      ON CONFLICT(meetingId, messageId) DO UPDATE SET
        senderId = excluded.senderId,
        text = excluded.text,
        kind = excluded.kind,
        imageUrl = excluded.imageUrl,
        replyToMessageId = excluded.replyToMessageId,
        replyToSenderId = excluded.replyToSenderId,
        replyToText = excluded.replyToText,
        createdAtMs = MAX(messages.createdAtMs, excluded.createdAtMs),
        localStatus = 'sent',
        failed = 0,
        lastError = NULL;
    `,
      [
        mid,
        serverId,
        typeof row.senderId === 'string' && row.senderId.trim() ? String(row.senderId) : null,
        typeof row.text === 'string' ? String(row.text) : '',
        asKind(row.kind),
        typeof row.imageUrl === 'string' && row.imageUrl.trim() ? String(row.imageUrl) : null,
        typeof row.replyToMessageId === 'string' && row.replyToMessageId.trim() ? String(row.replyToMessageId) : null,
        typeof row.replyToSenderId === 'string' && row.replyToSenderId.trim() ? String(row.replyToSenderId) : null,
        typeof row.replyToText === 'string' ? String(row.replyToText) : null,
        Number(row.createdAtMs ?? Date.now()),
        Number(row.isRead ?? 0) === 1 ? 1 : 0,
      ],
    );

    await db.runAsync(`DELETE FROM messages WHERE meetingId = ? AND messageId = ?;`, [mid, localId]);
  });
}

export async function listPendingOutgoingMeetingChatMessageIds(meetingId: string): Promise<string[]> {
  const mid = meetingId.trim();
  if (!mid) return [];
  await ensureMeetingChatDbReady();
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    `
    SELECT messageId
      FROM messages
     WHERE meetingId = ?
       AND kind = 'text'
       AND localStatus = 'failed';
  `,
    [mid],
  );
  return rows
    .map((r) => (typeof r.messageId === 'string' ? r.messageId.trim() : String(r.messageId ?? '').trim()))
    .filter(Boolean);
}

export async function getMeetingChatLocalRowById(args: {
  meetingId: string;
  messageId: string;
}): Promise<MeetingChatLocalRow | null> {
  const mid = args.meetingId.trim();
  const messageId = args.messageId.trim();
  if (!mid || !messageId) return null;
  await ensureMeetingChatDbReady();
  const db = await getDb();
  const r = await db.getFirstAsync<any>(
    `
    SELECT meetingId, messageId, senderId, text, kind, imageUrl,
           replyToMessageId, replyToSenderId, replyToText,
           createdAtMs, isRead, localStatus, failed, lastError
      FROM messages
     WHERE meetingId = ? AND messageId = ?
     LIMIT 1;
  `,
    [mid, messageId],
  );
  if (!r) return null;
  return {
    meetingId: String(r.meetingId ?? mid),
    messageId: String(r.messageId ?? messageId),
    senderId: typeof r.senderId === 'string' && r.senderId.trim() ? String(r.senderId) : null,
    text: typeof r.text === 'string' ? String(r.text) : '',
    kind: asKind(r.kind),
    imageUrl: typeof r.imageUrl === 'string' && r.imageUrl.trim() ? String(r.imageUrl) : null,
    replyToMessageId: typeof r.replyToMessageId === 'string' && r.replyToMessageId.trim() ? String(r.replyToMessageId) : null,
    replyToSenderId: typeof r.replyToSenderId === 'string' && r.replyToSenderId.trim() ? String(r.replyToSenderId) : null,
    replyToText: typeof r.replyToText === 'string' ? String(r.replyToText) : null,
    createdAtMs: Number(r.createdAtMs ?? 0) || 0,
    isRead: Number(r.isRead ?? 0) === 1 ? 1 : 0,
    localStatus: asStatus(r.localStatus),
    failed: Number(r.failed ?? 0) === 1 ? 1 : 0,
    lastError: typeof r.lastError === 'string' ? String(r.lastError) : null,
  };
}

