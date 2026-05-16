import { Q } from '@nozbe/watermelondb';

import { Timestamp } from '@/src/lib/ginit-timestamp';
import type { Meeting } from '@/src/lib/meetings';
import { CachedMeetingDetail } from '@/src/watermelon/models/CachedMeetingDetail';
import { database } from '@/src/watermelon';

const TS_MARKER = '__ginitTs';

function serializeMeetingValue(value: unknown): unknown {
  if (value instanceof Timestamp) {
    return { [TS_MARKER]: value.toMillis() };
  }
  if (Array.isArray(value)) {
    return value.map(serializeMeetingValue);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = serializeMeetingValue(v);
    }
    return out;
  }
  return value;
}

function deserializeMeetingValue(value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    if (typeof o[TS_MARKER] === 'number' && Number.isFinite(o[TS_MARKER])) {
      return Timestamp.fromMillis(o[TS_MARKER] as number);
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      out[k] = deserializeMeetingValue(v);
    }
    return out;
  }
  if (Array.isArray(value)) {
    return value.map(deserializeMeetingValue);
  }
  return value;
}

export function serializeMeetingToJson(meeting: Meeting): string {
  return JSON.stringify(serializeMeetingValue(meeting));
}

export function deserializeMeetingFromJson(json: string): Meeting | null {
  if (!json.trim()) return null;
  try {
    const raw = JSON.parse(json) as unknown;
    const revived = deserializeMeetingValue(raw) as Meeting;
    if (!revived || typeof revived !== 'object' || typeof revived.id !== 'string') return null;
    return revived;
  } catch {
    return null;
  }
}

function meetingRowId(meetingId: string): string {
  return meetingId.trim();
}

/** Watermelon `cached_meeting_details` 단건 읽기. 없으면 `null`. */
export async function readMeetingDetailFromWatermelon(meetingId: string): Promise<Meeting | null> {
  const db = database;
  const mid = meetingRowId(meetingId);
  if (!db || !mid) return null;
  try {
    const row = await db.get<CachedMeetingDetail>('cached_meeting_details').find(mid);
    return deserializeMeetingFromJson(row.meetingJson);
  } catch {
    return null;
  }
}

/** 서버 스냅샷 upsert. `meeting`이 null이면 행 삭제(모임 없음). */
export async function upsertMeetingDetailToWatermelon(
  meetingId: string,
  meeting: Meeting | null,
): Promise<void> {
  const db = database;
  const mid = meetingRowId(meetingId);
  if (!db || !mid) return;
  const now = Date.now();
  try {
    await db.write(async () => {
      const col = db.get<CachedMeetingDetail>('cached_meeting_details');
      try {
        const existing = await col.find(mid);
        if (meeting == null) {
          await existing.destroyPermanently();
          return;
        }
        await existing.update((rec) => {
          rec.meetingJson = serializeMeetingToJson({ ...meeting, id: mid });
          rec.syncedAtMs = now;
        });
        return;
      } catch {
        /* create */
      }
      if (meeting == null) return;
      await col.create((rec: CachedMeetingDetail) => {
        rec._raw.id = mid;
        rec.meetingJson = serializeMeetingToJson({ ...meeting, id: mid });
        rec.syncedAtMs = now;
      });
    });
  } catch {
    /* 로컬 실패는 크래시보다 무시 */
  }
}

export type MeetingDetailOptimisticPatchResult = {
  previous: Meeting | null;
  next: Meeting | null;
};

/** 낙관적 패치 — 이전 스냅샷을 반환(롤백용). 로컬 행이 없으면 `previous: null`. */
export async function patchMeetingDetailInWatermelon(
  meetingId: string,
  updater: (prev: Meeting) => Meeting,
): Promise<MeetingDetailOptimisticPatchResult> {
  const mid = meetingRowId(meetingId);
  if (!mid) return { previous: null, next: null };
  const previous = await readMeetingDetailFromWatermelon(mid);
  if (!previous) return { previous: null, next: null };
  const next = updater(previous);
  await upsertMeetingDetailToWatermelon(mid, next);
  return { previous, next };
}

export async function restoreMeetingDetailInWatermelon(
  meetingId: string,
  snapshot: Meeting | null,
): Promise<void> {
  await upsertMeetingDetailToWatermelon(meetingId, snapshot);
}
