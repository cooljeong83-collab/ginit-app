/**
 * 공개 모임 목록 — Supabase `public.meetings` + Realtime.
 * `legacy_firestore_id`가 채워져 있어야 채팅·상세(Firestore)와 동일 모임을 가리킵니다.
 *
 * RLS: `0004_hybrid_outbox_ranking_realtime.sql` 의 `meetings_select_public_anon` 필요.
 */
import type { Unsubscribe } from 'firebase/firestore';
import { Timestamp } from 'firebase/firestore';

import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { mapFirestoreMeetingDoc, meetingParticipantCount, type Meeting } from '@/src/lib/meetings';
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
    const merged = mapFirestoreMeetingDoc(docId, { ...(fs as Record<string, unknown>), id: docId });
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

export type MeetingChangeSummary = {
  meetingId: string;
  rowId: string;
  updatedAtMs: number;
  participantCount: number;
  createdAtMs: number;
};

export type MeetingSummaryDiff = {
  changedIds: string[];
  deletedIds: string[];
};

function mapMeetingChangeSummaryRow(row: Record<string, unknown>): MeetingChangeSummary | null {
  const meetingId = typeof row.meeting_id === 'string' ? row.meeting_id.trim() : '';
  if (!meetingId) return null;
  const rowId = typeof row.row_id === 'string' ? row.row_id.trim() : '';
  const updatedAt = parseCreatedAt(row.updated_at);
  const createdAt = parseCreatedAt(row.created_at);
  const pc = row.participant_count;
  return {
    meetingId,
    rowId,
    updatedAtMs: timestampMs(updatedAt),
    participantCount: typeof pc === 'number' && Number.isFinite(pc) ? Math.trunc(pc) : 0,
    createdAtMs: timestampMs(createdAt),
  };
}

function summaryFromMeeting(m: Meeting): MeetingChangeSummary {
  return {
    meetingId: m.id,
    rowId: m.id,
    updatedAtMs: timestampMs(m.updatedAt),
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
  const cachedById = new Map(cachedMeetings.map((m) => [m.id, m]));
  const changedById = new Map(changedMeetings.map((m) => [m.id, m]));
  const next: Meeting[] = [];
  const seen = new Set<string>();

  for (const summary of remoteSummaries) {
    const m = changedById.get(summary.meetingId) ?? cachedById.get(summary.meetingId);
    if (!m || seen.has(m.id)) continue;
    seen.add(m.id);
    next.push(m);
  }

  return next;
}

export function replaceMeetingsById(cachedMeetings: readonly Meeting[], changedMeetings: readonly Meeting[]): Meeting[] {
  if (changedMeetings.length === 0) return [...cachedMeetings];
  const changedById = new Map(changedMeetings.map((m) => [m.id, m]));
  return cachedMeetings.map((m) => changedById.get(m.id) ?? m);
}

export async function fetchPublicMeetingChangeSummaries(
  limit = 400,
): Promise<{ ok: true; summaries: MeetingChangeSummary[] } | { ok: false; message: string }> {
  const { data, error } = await supabase.rpc('list_public_meeting_change_summaries', {
    p_limit: Math.max(1, Math.min(400, Math.trunc(limit))),
  });
  if (error) return { ok: false, message: error.message };
  const summaries = ((data ?? []) as unknown[])
    .map((r) => (r && typeof r === 'object' && !Array.isArray(r) ? mapMeetingChangeSummaryRow(r as Record<string, unknown>) : null))
    .filter((r): r is MeetingChangeSummary => Boolean(r));
  return { ok: true, summaries };
}

export async function fetchMyMeetingChangeSummaries(
  appUserId: string,
): Promise<{ ok: true; summaries: MeetingChangeSummary[] } | { ok: false; message: string }> {
  const uid = normalizeParticipantId(appUserId);
  if (!uid) return { ok: true, summaries: [] };
  const { data, error } = await supabase.rpc('list_my_meeting_change_summaries', {
    p_app_user_id: uid,
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
  const summariesRes = await fetchPublicMeetingChangeSummaries(opts?.limit ?? 400);
  if (!summariesRes.ok) return summariesRes;
  const summaries = summariesRes.summaries;
  const { changedIds, deletedIds } = diffMeetingSummaries(cachedMeetings, summaries);
  if (changedIds.length === 0 && deletedIds.length === 0) {
    return { ok: true, meetings: [...cachedMeetings], changed: false };
  }
  const changedRes = await fetchMeetingsForSyncByIds(changedIds);
  if (!changedRes.ok) return changedRes;
  return {
    ok: true,
    meetings: mergeMeetingsBySummaries(cachedMeetings, summaries, changedRes.meetings),
    changed: true,
  };
}

export async function syncMyMeetingsFromSummaries(
  cachedMeetings: readonly Meeting[],
  appUserId: string,
): Promise<{ ok: true; meetings: Meeting[]; changed: boolean } | { ok: false; message: string }> {
  const summariesRes = await fetchMyMeetingChangeSummaries(appUserId);
  if (!summariesRes.ok) return summariesRes;
  const summaries = summariesRes.summaries;
  const { changedIds, deletedIds } = diffMeetingSummaries(cachedMeetings, summaries);
  if (changedIds.length === 0 && deletedIds.length === 0) {
    return { ok: true, meetings: [...cachedMeetings], changed: false };
  }
  const changedRes = await fetchMeetingsForSyncByIds(changedIds, appUserId);
  if (!changedRes.ok) return changedRes;
  return {
    ok: true,
    meetings: mergeMeetingsBySummaries(cachedMeetings, summaries, changedRes.meetings),
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

/** 공개 모임 10건 페이지 — `.range(pageParam * size, (pageParam + 1) * size - 1)` */
export async function fetchPublicMeetingsPageFromSupabase(
  pageParam: number,
): Promise<{ ok: true; meetings: Meeting[]; hasMore: boolean } | { ok: false; message: string }> {
  const from = pageParam * PUBLIC_MEETINGS_PAGE_SIZE;
  const to = (pageParam + 1) * PUBLIC_MEETINGS_PAGE_SIZE - 1;
  const { data, error } = await supabase
    .from('meetings')
    .select('*')
    .eq('is_public', true)
    .order('created_at', { ascending: false })
    .range(from, to);
  if (error) return { ok: false, message: error.message };
  const rows = data ?? [];
  const meetings = rows.map((r) => mapSupabaseMeetingRow(r as Record<string, unknown>));
  const hasMore = rows.length === PUBLIC_MEETINGS_PAGE_SIZE;
  return { ok: true, meetings, hasMore };
}

/** `postgres_changes` 페이로드 — 로컬 캐시 패치·지연 동기화 분기용 */
export type MeetingsTableRealtimePayload = {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  newRecord: Record<string, unknown> | null;
  oldRecord: Record<string, unknown> | null;
};

/**
 * 공개 `meetings` 테이블 전체 Realtime 구독은 Realtime 메시지 폭증·비용 이슈로 비활성화했습니다.
 * 피드는 `list_public_meeting_change_summaries` RPC + 화면 포커스/당김 동기화 경로를 사용합니다.
 *
 * 타입·캐시 패치 헬퍼(`meetings-feed-realtime-cache-patch`)는 하위 호환용으로 유지합니다.
 */
export function subscribeMeetingsTableRealtimeHub(
  _onPayload: (payload: MeetingsTableRealtimePayload) => void,
  _onError?: (message: string) => void,
): Unsubscribe {
  return () => {};
}

/** `subscribeMeetingsTableRealtimeHub`와 동일(하위 호환 별칭). */
export function subscribePublicMeetingsListInvalidate(
  onInvalidate: (payload: MeetingsTableRealtimePayload) => void,
  onError?: (message: string) => void,
): Unsubscribe {
  return subscribeMeetingsTableRealtimeHub(onInvalidate, onError);
}

/** Firestore `subscribeMeetings` 와 동일 시그니처 — 공개 행만 Supabase에서 주기 요약 동기화(Realtime 미사용) */
export function subscribeMeetingsFromSupabase(
  onData: (meetings: Meeting[]) => void,
  onError?: (message: string) => void,
): Unsubscribe {
  let cancelled = false;
  let lastMeetings: Meeting[] = [];

  const pullFull = () => {
    if (cancelled) return;
    void fetchPublicMeetingsFromSupabaseOnce().then((res) => {
      if (cancelled) return;
      if (res.ok) {
        lastMeetings = res.meetings;
        onData(res.meetings);
      } else onError?.(res.message);
    });
  };

  const syncChanged = () => {
    if (cancelled) return;
    if (lastMeetings.length === 0) {
      pullFull();
      return;
    }
    void syncPublicMeetingsFromSummaries(lastMeetings).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        lastMeetings = res.meetings;
        onData(res.meetings);
      } else {
        onError?.(res.message);
      }
    });
  };

  pullFull();
  const pollId = setInterval(syncChanged, 60_000);

  return () => {
    cancelled = true;
    clearInterval(pollId);
  };
}
