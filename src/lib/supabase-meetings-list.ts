/**
 * 공개 모임 목록 — Supabase `public.meetings` + Realtime.
 * `legacy_firestore_id`가 채워져 있어야 채팅·상세(Firestore)와 동일 모임을 가리킵니다.
 *
 * RLS: `0004_hybrid_outbox_ranking_realtime.sql` 의 `meetings_select_public_anon` 필요.
 */
import type { Unsubscribe } from 'firebase/firestore';
import { Timestamp } from 'firebase/firestore';

import { mapFirestoreMeetingDoc, type Meeting } from '@/src/lib/meetings';
import { supabase } from '@/src/lib/supabase';

function parseCreatedAt(v: unknown): Timestamp | null {
  if (v == null) return null;
  if (typeof v === 'string') {
    const d = new Date(v);
    return Number.isFinite(d.getTime()) ? Timestamp.fromDate(d) : null;
  }
  return null;
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
    if (!merged.createdAt && row.created_at != null) {
      const c = parseCreatedAt(row.created_at);
      if (c) return { ...merged, createdAt: c };
    }
    return merged;
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

/** Firestore `subscribeMeetings` 와 동일 시그니처 — 공개 행만 Supabase에서 구독 */
export function subscribeMeetingsFromSupabase(
  onData: (meetings: Meeting[]) => void,
  onError?: (message: string) => void,
): Unsubscribe {
  let cancelled = false;

  const pull = () => {
    if (cancelled) return;
    void fetchPublicMeetingsFromSupabaseOnce().then((res) => {
      if (cancelled) return;
      if (res.ok) onData(res.meetings);
      else onError?.(res.message);
    });
  };

  const channel = supabase
    .channel(`realtime:public-meetings:${Date.now()}:${Math.random().toString(36).slice(2)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'meetings' }, () => {
      pull();
    })
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR') onError?.('Supabase Realtime 연결 오류');
    });

  pull();

  return () => {
    cancelled = true;
    void supabase.removeChannel(channel);
  };
}
