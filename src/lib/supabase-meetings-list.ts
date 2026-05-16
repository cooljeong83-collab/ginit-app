/**
 * 공개 모임 목록 — Supabase `public.meetings` (REST/RPC).
 * 전체 공개 목록은 **Pull**(화면 진입·새로고침·증분 요약 RPC·무한 스크롤)이 기본이며,
 * `subscribeMeetingsFromSupabase`는 마운트 시 **전량 Pull 1회**만 수행합니다(Postgres Realtime 없음).
 * `legacy_firestore_id`가 채워져 있어야 레거시 id와 동일 모임을 가리킬 수 있습니다.
 *
 * RLS: `0004_hybrid_outbox_ranking_realtime.sql` 의 `meetings_select_public_anon` 필요.
 */
import { Timestamp } from '@/src/lib/ginit-timestamp';
import md5 from 'md5';

import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { mapMeetingLedgerDoc, meetingParticipantCount, type Meeting } from '@/src/lib/meetings';
import { supabase } from '@/src/lib/supabase';

function parseCreatedAt(v: unknown): Timestamp | null {
  if (v == null) return null;
  if (typeof v === 'string') {
    const d = new Date(v);
    return Number.isFinite(d.getTime()) ? Timestamp.fromDate(d) : null;
  }
  return null;
}

function timestampMs(v: Timestamp | null | undefined): number {
  if (!v) return 0;
  try {
    return v.toMillis();
  } catch {
    return 0;
  }
}

export function mapSupabaseMeetingRow(row: Record<string, unknown>): Meeting {
  const legacy =
    typeof row.legacy_firestore_id === 'string' && row.legacy_firestore_id.trim()
      ? row.legacy_firestore_id.trim()
      : '';
  const rowId = (typeof row.id === 'string' ? row.id : String(row.id ?? '')).trim();
  const id = legacy || rowId;
  const extra = row.extra_data;
  const fs =
    extra && typeof extra === 'object' && !Array.isArray(extra) && 'fs' in extra
      ? (extra as { fs?: unknown }).fs
      : null;
  if (fs && typeof fs === 'object' && !Array.isArray(fs) && Object.keys(fs as object).length > 0) {
    const docId = legacy || rowId;
    const merged = mapMeetingLedgerDoc(docId, { ...(fs as Record<string, unknown>), id: docId });
    const sqlCategoryId = typeof row.category_id === 'string' && row.category_id.trim() ? row.category_id.trim() : null;
    const sqlCategoryLabel =
      typeof row.category_label === 'string' && row.category_label.trim() ? row.category_label.trim() : null;
    const sqlIsPublic = row.is_public === true ? true : row.is_public === false ? false : null;
    const withSqlCategories = {
      ...merged,
      categoryId: sqlCategoryId ?? merged.categoryId ?? null,
      categoryLabel: sqlCategoryLabel ?? merged.categoryLabel ?? null,
      isPublic: sqlIsPublic,
    };
    const sqlPlaceKey =
      typeof row.place_key === 'string' && row.place_key.trim() ? row.place_key.trim() : null;
    const withPlaceKey =
      sqlPlaceKey && !withSqlCategories.placeKey?.trim()
        ? { ...withSqlCategories, placeKey: sqlPlaceKey }
        : withSqlCategories;
    const createdAt = withPlaceKey.createdAt ?? parseCreatedAt(row.created_at);
    const updatedAt = parseCreatedAt(row.updated_at);
    return {
      ...withPlaceKey,
      ...(createdAt ? { createdAt } : {}),
      ...(updatedAt ? { updatedAt } : {}),
    };
  }

  return {
    id,
    title: typeof row.title === 'string' ? row.title : '',
    location:
      (typeof row.address === 'string' && row.address.trim()) ||
      (typeof row.place_name === 'string' && row.place_name.trim()) ||
      '',
    description: typeof row.description === 'string' ? row.description : '',
    capacity: typeof row.capacity === 'number' && Number.isFinite(row.capacity) ? Math.trunc(row.capacity) : 0,
    minParticipants:
      typeof row.min_participants === 'number' && Number.isFinite(row.min_participants)
        ? Math.trunc(row.min_participants)
        : null,
    createdAt: parseCreatedAt(row.created_at),
    createdBy: null,
    imageUrl: typeof row.image_url === 'string' && row.image_url.trim() ? row.image_url.trim() : null,
    categoryId: typeof row.category_id === 'string' ? row.category_id : null,
    categoryLabel: typeof row.category_label === 'string' ? row.category_label : null,
    isPublic: row.is_public === true ? true : row.is_public === false ? false : null,
    scheduleDate: typeof row.schedule_date === 'string' ? row.schedule_date : null,
    scheduleTime: typeof row.schedule_time === 'string' ? row.schedule_time : null,
    scheduledAt: parseCreatedAt(row.scheduled_at),
    placeName: typeof row.place_name === 'string' ? row.place_name : null,
    address: typeof row.address === 'string' ? row.address : null,
    latitude: typeof row.latitude === 'number' ? row.latitude : null,
    longitude: typeof row.longitude === 'number' ? row.longitude : null,
    extraData: typeof row.extra_data === 'object' && row.extra_data != null ? (row.extra_data as Meeting['extraData']) : null,
    dateCandidates: null,
    placeCandidates: null,
    participantIds: [],
    voteTallies: null,
    participantVoteLog: null,
    scheduleConfirmed: row.schedule_confirmed === true ? true : row.schedule_confirmed === false ? false : null,
    confirmedDateChipId: typeof row.confirmed_date_chip_id === 'string' ? row.confirmed_date_chip_id : null,
    confirmedPlaceChipId: typeof row.confirmed_place_chip_id === 'string' ? row.confirmed_place_chip_id : null,
    confirmedMovieChipId: typeof row.confirmed_movie_chip_id === 'string' ? row.confirmed_movie_chip_id : null,
    meetingConfig: null,
    placeKey: typeof row.place_key === 'string' && row.place_key.trim() ? row.place_key.trim() : null,
    updatedAt: parseCreatedAt(row.updated_at),
  };
}

export const PUBLIC_MEETINGS_PAGE_SIZE = 10;

/** 공개 피드 커서 — `meetings.created_at` + PK `id`(타임스탬프 동률 시 정렬 고정) */
export type PublicMeetingsFeedCursor = {
  /** `meetings.created_at` ISO 8601 (UTC) */
  lastCreatedAt: string;
  /** `meetings.id` (DB row UUID) */
  lastRowId: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidStringForMeetingsFeed(v: string | null | undefined): boolean {
  const s = typeof v === 'string' ? v.trim() : '';
  return s.length > 0 && UUID_RE.test(s);
}

function createdAtIsoFromSupabaseCell(createdAt: unknown): string | null {
  if (createdAt == null) return null;
  if (typeof createdAt === 'string') {
    const d = new Date(createdAt);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }
  if (createdAt instanceof Date && Number.isFinite(createdAt.getTime())) {
    return createdAt.toISOString();
  }
  return null;
}

/** Supabase `meetings` 행에서 다음 페이지 커서(현재 페이지 마지막 행 기준)를 만듭니다. */
export function publicMeetingsTailCursorFromSupabaseRow(row: Record<string, unknown>): PublicMeetingsFeedCursor | null {
  const iso = createdAtIsoFromSupabaseCell(row.created_at);
  const rid = row.id != null ? String(row.id).trim() : '';
  if (!iso || !rid) return null;
  return { lastCreatedAt: iso, lastRowId: rid };
}

export function publicMeetingsFeedTailCursorFromSummary(
  meeting: Meeting,
  summary: MeetingChangeSummary | undefined,
): PublicMeetingsFeedCursor | null {
  if (!meeting.createdAt || !summary?.rowId?.trim()) return null;
  try {
    return { lastCreatedAt: meeting.createdAt.toDate().toISOString(), lastRowId: summary.rowId.trim() };
  } catch {
    return null;
  }
}

/** `MeetingChangeSummary` 없이 커서를 추정 — `id`가 DB UUID일 때만 안전합니다. */
export function publicMeetingsFeedTailCursorGuess(meeting: Meeting): PublicMeetingsFeedCursor | null {
  if (!meeting.createdAt || !isUuidStringForMeetingsFeed(meeting.id)) return null;
  try {
    return { lastCreatedAt: meeting.createdAt.toDate().toISOString(), lastRowId: meeting.id.trim() };
  } catch {
    return null;
  }
}

export type MeetingChangeSummary = {
  meetingId: string;
  rowId: string;
  /** `md5(String(floor(updated_at epoch ms))))` — `list_meeting_change_summaries`와 동일 규칙 */
  updatedFp: string;
  updatedAtMs: number;
  participantCount: number;
  createdAtMs: number;
};

/** 서버 `list_meeting_change_summaries.updated_fp` 생성 규칙과 동일해야 합니다. */
export function meetingUpdatedFingerprintMd5FromMillis(ms: number): string {
  if (!Number.isFinite(ms)) return md5('0');
  return md5(String(Math.trunc(ms)));
}

/** 캐시된 모임들 중 가장 최근 `updated_at` (밀리초) — 증분 RPC `p_last_sync_at` 워터마크 */
export function maxMeetingUpdatedAtIso(cachedMeetings: readonly Meeting[]): string | null {
  let maxMs = -Infinity;
  for (const m of cachedMeetings) {
    const ms = timestampMs(m.updatedAt);
    if (Number.isFinite(ms) && ms > maxMs) maxMs = ms;
  }
  if (!Number.isFinite(maxMs) || maxMs < 0) return null;
  return new Date(maxMs).toISOString();
}

export type MeetingSummaryDiff = {
  changedIds: string[];
  deletedIds: string[];
};

function mapMeetingChangeSummaryRow(row: Record<string, unknown>): MeetingChangeSummary | null {
  const meetingId = typeof row.meeting_id === 'string' ? row.meeting_id.trim() : '';
  if (!meetingId) return null;
  const rowIdRaw = row.row_id;
  const rowId =
    typeof rowIdRaw === 'string'
      ? rowIdRaw.trim()
      : rowIdRaw != null
        ? String(rowIdRaw).trim()
        : '';
  const updatedAt = parseCreatedAt(row.updated_at);
  const createdAt = parseCreatedAt(row.created_at);
  const pc = row.participant_count;
  const updatedAtMs = timestampMs(updatedAt);
  let updatedFp = typeof row.updated_fp === 'string' ? row.updated_fp.trim().toLowerCase() : '';
  if (!updatedFp) {
    updatedFp = meetingUpdatedFingerprintMd5FromMillis(updatedAtMs);
  }
  return {
    meetingId,
    rowId: rowId || meetingId,
    updatedFp,
    updatedAtMs,
    participantCount: typeof pc === 'number' && Number.isFinite(pc) ? Math.trunc(pc) : 0,
    createdAtMs: timestampMs(createdAt),
  };
}

export function summaryFromMeeting(m: Meeting): MeetingChangeSummary {
  const updatedAtMs = timestampMs(m.updatedAt);
  return {
    meetingId: m.id,
    rowId: m.id,
    updatedFp: meetingUpdatedFingerprintMd5FromMillis(updatedAtMs),
    updatedAtMs,
    participantCount: meetingParticipantCount(m),
    createdAtMs: timestampMs(m.createdAt),
  };
}

export function diffMeetingSummaries(
  cachedMeetings: readonly Meeting[],
  remoteSummaries: readonly MeetingChangeSummary[],
): MeetingSummaryDiff {
  const remoteById = new Map(remoteSummaries.map((s) => [s.meetingId, s]));
  const cachedById = new Map(cachedMeetings.map((m) => [m.id, summaryFromMeeting(m)]));
  const changedIds: string[] = [];
  const deletedIds: string[] = [];

  for (const remote of remoteSummaries) {
    const cached = cachedById.get(remote.meetingId);
    if (!cached) {
      changedIds.push(remote.meetingId);
      continue;
    }
    const fpRemote = remote.updatedFp?.trim();
    const fpCached = cached.updatedFp?.trim();
    if (fpRemote && fpCached && fpRemote === fpCached) continue;
    if (fpRemote && fpCached && fpRemote !== fpCached) {
      changedIds.push(remote.meetingId);
      continue;
    }
    if (cached.updatedAtMs !== remote.updatedAtMs || cached.participantCount !== remote.participantCount) {
      changedIds.push(remote.meetingId);
    }
  }

  for (const cached of cachedMeetings) {
    if (!remoteById.has(cached.id)) deletedIds.push(cached.id);
  }

  return { changedIds, deletedIds };
}

export function mergeMeetingsBySummaries(
  cachedMeetings: readonly Meeting[],
  remoteSummaries: readonly MeetingChangeSummary[],
  changedMeetings: readonly Meeting[],
): Meeting[] {
  const cachedById = new Map<string, Meeting>();
  for (const m of cachedMeetings) {
    const id = typeof m.id === 'string' ? m.id.trim() : '';
    if (!id) continue;
    cachedById.set(id, m);
  }
  const changedById = new Map<string, Meeting>();
  for (const m of changedMeetings) {
    const id = typeof m.id === 'string' ? m.id.trim() : '';
    if (!id) continue;
    changedById.set(id, m);
  }
  const next: Meeting[] = [];
  const seen = new Set<string>();
  const seenSummaryMeetingIds = new Set<string>();

  for (const summary of remoteSummaries) {
    const mid = typeof summary.meetingId === 'string' ? summary.meetingId.trim() : '';
    if (!mid || seenSummaryMeetingIds.has(mid)) continue;
    seenSummaryMeetingIds.add(mid);
    const m = changedById.get(mid) ?? cachedById.get(mid);
    if (!m) continue;
    const id = typeof m.id === 'string' ? m.id.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    next.push(m);
  }

  return next;
}

/**
 * 증분 요약(변경 행만)용: 원격에 없는 캐시 항목은 삭제로 보지 않습니다.
 */
export function diffMeetingSummariesDelta(
  cachedMeetings: readonly Meeting[],
  remoteDelta: readonly MeetingChangeSummary[],
): MeetingSummaryDiff {
  const cachedById = new Map(cachedMeetings.map((m) => [typeof m.id === 'string' ? m.id.trim() : '', m]));
  const changedIds: string[] = [];
  const seen = new Set<string>();
  for (const remote of remoteDelta) {
    const mid = remote.meetingId.trim();
    if (!mid || seen.has(mid)) continue;
    seen.add(mid);
    const cached = cachedById.get(mid);
    if (!cached) {
      changedIds.push(mid);
      continue;
    }
    const local = summaryFromMeeting(cached);
    if (local.updatedFp !== remote.updatedFp) changedIds.push(mid);
  }
  return { changedIds, deletedIds: [] };
}

/** 변경분 fetch 결과를 기존 캐시 순서에 끼워 넣고, 캐시에 없던 id는 앞에 붙입니다. */
export function mergeDeltaMeetingsIntoCached(
  cachedMeetings: readonly Meeting[],
  changedIds: readonly string[],
  fetched: readonly Meeting[],
): Meeting[] {
  const fetchedById = new Map<string, Meeting>();
  for (const m of fetched) {
    const id = typeof m.id === 'string' ? m.id.trim() : '';
    if (id) fetchedById.set(id, m);
  }
  const cachedIdSet = new Set(
    cachedMeetings.map((m) => (typeof m.id === 'string' ? m.id.trim() : '')).filter(Boolean),
  );
  const prepended: Meeting[] = [];
  const seenNew = new Set<string>();
  for (const raw of changedIds) {
    const id = raw.trim();
    if (!id || cachedIdSet.has(id) || seenNew.has(id)) continue;
    const nm = fetchedById.get(id);
    if (nm) {
      prepended.push(nm);
      seenNew.add(id);
    }
  }
  const replaced = cachedMeetings.map((m) => fetchedById.get(typeof m.id === 'string' ? m.id.trim() : '') ?? m);
  return [...prepended, ...replaced];
}

export function replaceMeetingsById(cachedMeetings: readonly Meeting[], changedMeetings: readonly Meeting[]): Meeting[] {
  if (changedMeetings.length === 0) return [...cachedMeetings];
  const changedById = new Map(changedMeetings.map((m) => [m.id, m]));
  return cachedMeetings.map((m) => changedById.get(m.id) ?? m);
}

export async function fetchMeetingChangeSummariesSince(
  lastSyncAtIso: string,
  limit = 500,
): Promise<{ ok: true; summaries: MeetingChangeSummary[] } | { ok: false; message: string }> {
  const { data, error } = await supabase.rpc('list_meeting_change_summaries', {
    p_last_sync_at: lastSyncAtIso,
    p_limit: Math.max(1, Math.min(500, Math.trunc(limit))),
  });
  if (error) return { ok: false, message: error.message };
  const summaries = ((data ?? []) as unknown[])
    .map((r) => (r && typeof r === 'object' && !Array.isArray(r) ? mapMeetingChangeSummaryRow(r as Record<string, unknown>) : null))
    .filter((r): r is MeetingChangeSummary => Boolean(r));
  return { ok: true, summaries };
}

export async function fetchMyMeetingChangeSummariesSince(
  appUserId: string,
  lastSyncAtIso: string,
  limit = 500,
): Promise<{ ok: true; summaries: MeetingChangeSummary[] } | { ok: false; message: string }> {
  const uid = normalizeParticipantId(appUserId);
  if (!uid) return { ok: true, summaries: [] };
  const { data, error } = await supabase.rpc('list_my_meeting_change_summaries', {
    p_app_user_id: uid,
    p_last_sync_at: lastSyncAtIso,
    p_limit: Math.max(1, Math.min(500, Math.trunc(limit))),
  });
  if (error) return { ok: false, message: error.message };
  const summaries = ((data ?? []) as unknown[])
    .map((r) => (r && typeof r === 'object' && !Array.isArray(r) ? mapMeetingChangeSummaryRow(r as Record<string, unknown>) : null))
    .filter((r): r is MeetingChangeSummary => Boolean(r));
  return { ok: true, summaries };
}

export async function fetchMeetingsForSyncByIds(
  meetingIds: readonly string[],
  viewerAppUserId?: string | null,
): Promise<{ ok: true; meetings: Meeting[] } | { ok: false; message: string }> {
  const ids = [...new Set(meetingIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return { ok: true, meetings: [] };
  const { data, error } = await supabase.rpc('get_meetings_for_sync_by_ids', {
    p_meeting_ids: ids,
    p_viewer_app_user_id: viewerAppUserId?.trim() || null,
  });
  if (error) return { ok: false, message: error.message };
  const rows = (data ?? []) as unknown[];
  const meetings = rows
    .map((r) => (r && typeof r === 'object' && !Array.isArray(r) ? (r as Record<string, unknown>) : null))
    .filter((r): r is Record<string, unknown> => Boolean(r))
    .map((r) => mapSupabaseMeetingRow(r));
  return { ok: true, meetings };
}

export async function syncPublicMeetingsFromSummaries(
  cachedMeetings: readonly Meeting[],
  opts?: { limit?: number },
): Promise<{ ok: true; meetings: Meeting[]; changed: boolean } | { ok: false; message: string }> {
  const lastIso = maxMeetingUpdatedAtIso(cachedMeetings);
  if (!lastIso) {
    return { ok: true, meetings: [...cachedMeetings], changed: false };
  }
  const summariesRes = await fetchMeetingChangeSummariesSince(lastIso, opts?.limit ?? 500);
  if (!summariesRes.ok) return summariesRes;
  const summaries = summariesRes.summaries;
  if (summaries.length === 0) {
    return { ok: true, meetings: [...cachedMeetings], changed: false };
  }
  const { changedIds, deletedIds } = diffMeetingSummariesDelta(cachedMeetings, summaries);
  if (changedIds.length === 0 && deletedIds.length === 0) {
    return { ok: true, meetings: [...cachedMeetings], changed: false };
  }
  const changedRes = await fetchMeetingsForSyncByIds(changedIds);
  if (!changedRes.ok) return changedRes;
  return {
    ok: true,
    meetings: mergeDeltaMeetingsIntoCached(cachedMeetings, changedIds, changedRes.meetings),
    changed: true,
  };
}

export async function syncMyMeetingsFromSummaries(
  cachedMeetings: readonly Meeting[],
  appUserId: string,
  opts?: { limit?: number },
): Promise<{ ok: true; meetings: Meeting[]; changed: boolean } | { ok: false; message: string }> {
  const lastIso = maxMeetingUpdatedAtIso(cachedMeetings);
  if (!lastIso) {
    return { ok: true, meetings: [...cachedMeetings], changed: false };
  }
  const summariesRes = await fetchMyMeetingChangeSummariesSince(appUserId, lastIso, opts?.limit ?? 500);
  if (!summariesRes.ok) return summariesRes;
  const summaries = summariesRes.summaries;
  if (summaries.length === 0) {
    return { ok: true, meetings: [...cachedMeetings], changed: false };
  }
  const { changedIds, deletedIds } = diffMeetingSummariesDelta(cachedMeetings, summaries);
  if (changedIds.length === 0 && deletedIds.length === 0) {
    return { ok: true, meetings: [...cachedMeetings], changed: false };
  }
  const changedRes = await fetchMeetingsForSyncByIds(changedIds, appUserId);
  if (!changedRes.ok) return changedRes;
  return {
    ok: true,
    meetings: mergeDeltaMeetingsIntoCached(cachedMeetings, changedIds, changedRes.meetings),
    changed: true,
  };
}

export async function fetchPublicMeetingsFromSupabaseOnce(): Promise<
  { ok: true; meetings: Meeting[] } | { ok: false; message: string }
> {
  const { data, error } = await supabase
    .from('meetings')
    .select('*')
    .eq('is_public', true)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(400);
  if (error) return { ok: false, message: error.message };
  const meetings = (data ?? []).map((r) => mapSupabaseMeetingRow(r as Record<string, unknown>));
  return { ok: true, meetings };
}

export async function fetchMyMeetingsForFeedFromSupabase(
  appUserId: string,
): Promise<{ ok: true; meetings: Meeting[] } | { ok: false; message: string }> {
  const uid = normalizeParticipantId(appUserId);
  if (!uid) return { ok: true, meetings: [] };
  const { data, error } = await supabase.rpc('ledger_list_my_meetings_for_feed', {
    p_app_user_id: uid,
  });
  if (error) return { ok: false, message: error.message };
  const rows = (data ?? []) as unknown[];
  const meetings = rows
    .map((r) => (r && typeof r === 'object' && !Array.isArray(r) ? (r as Record<string, unknown>) : null))
    .filter((r): r is Record<string, unknown> => Boolean(r))
    .map((r) => mapSupabaseMeetingRow(r));
  return { ok: true, meetings };
}

/**
 * 공개 모임 커서 페이지 — `created_at` 내림차순, 동률 시 `id` 내림차순.
 * `cursor`가 없으면 첫 페이지; 있으면 그 경계보다 **엄격히 이전** 행만 조회합니다.
 */
export async function fetchPublicMeetingsPageFromSupabase(
  cursor: PublicMeetingsFeedCursor | null | undefined,
): Promise<
  { ok: true; meetings: Meeting[]; hasMore: boolean; tailCursor: PublicMeetingsFeedCursor | undefined } | {
    ok: false;
    message: string;
  }
> {
  let q = supabase
    .from('meetings')
    .select('*')
    .eq('is_public', true)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(PUBLIC_MEETINGS_PAGE_SIZE);

  if (cursor) {
    const iso = cursor.lastCreatedAt.trim();
    const rid = cursor.lastRowId.trim();
    if (isUuidStringForMeetingsFeed(rid)) {
      const qIso = `"${iso}"`;
      const qRid = `"${rid}"`;
      q = q.or(`created_at.lt.${qIso},and(created_at.eq.${qIso},id.lt.${qRid})`);
    } else {
      q = q.lt('created_at', iso);
    }
  }

  const { data, error } = await q;
  if (error) return { ok: false, message: error.message };
  const rows = (data ?? []) as Record<string, unknown>[];
  const meetings = rows.map((r) => mapSupabaseMeetingRow(r));
  const hasMore = rows.length === PUBLIC_MEETINGS_PAGE_SIZE;
  const lastRow = rows.length > 0 ? rows[rows.length - 1] : null;
  const tail = lastRow ? publicMeetingsTailCursorFromSupabaseRow(lastRow) : null;
  const tailCursor = hasMore && tail ? tail : undefined;
  return { ok: true, meetings, hasMore, tailCursor };
}

export function subscribeMeetingsFromSupabase(
  onData: (meetings: Meeting[]) => void,
  onError?: (message: string) => void,
): () => void {
  let cancelled = false;

  const pullFull = () => {
    if (cancelled) return;
    void fetchPublicMeetingsFromSupabaseOnce().then((res) => {
      if (cancelled) return;
      if (res.ok) {
        onData(res.meetings);
      } else onError?.(res.message);
    });
  };

  pullFull();

  return () => {
    cancelled = true;
  };
}
