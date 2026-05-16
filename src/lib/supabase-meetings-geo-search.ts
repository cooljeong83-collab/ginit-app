import {
  diffMeetingSummaries,
  fetchMeetingsForSyncByIds,
  mapSupabaseMeetingRow,
  meetingUpdatedFingerprintMd5FromMillis,
  mergeMeetingsBySummaries,
  type MeetingChangeSummary,
} from '@/src/lib/supabase-meetings-list';
import type { Meeting } from '@/src/lib/meetings';
import { supabase } from '@/src/lib/supabase';
import { haversineDistanceMeters } from '@/src/lib/geo-distance';

function summaryTimestampMs(v: unknown): number {
  if (typeof v !== 'string') return 0;
  const d = new Date(v);
  const t = d.getTime();
  return Number.isFinite(t) ? t : 0;
}

function mapGeoSummaryRow(row: Record<string, unknown>): MeetingChangeSummary | null {
  const meetingId = typeof row.meeting_id === 'string' ? row.meeting_id.trim() : '';
  if (!meetingId) return null;
  const pc = row.participant_count;
  const rowIdRaw = row.row_id;
  const rowId =
    typeof rowIdRaw === 'string'
      ? rowIdRaw.trim()
      : rowIdRaw != null
        ? String(rowIdRaw).trim()
        : '';
  const updatedAtMs = summaryTimestampMs(row.updated_at);
  const createdAtMs = summaryTimestampMs(row.created_at);
  return {
    meetingId,
    rowId: rowId || meetingId,
    updatedFp: meetingUpdatedFingerprintMd5FromMillis(updatedAtMs),
    updatedAtMs,
    participantCount: typeof pc === 'number' && Number.isFinite(pc) ? Math.trunc(pc) : 0,
    createdAtMs,
  };
}

export async function fetchMeetingGeoChangeSummariesFromSupabase(
  latitude: number,
  longitude: number,
  radiusKm: number,
  categoryId: string | null,
): Promise<{ ok: true; summaries: MeetingChangeSummary[] } | { ok: false; message: string }> {
  const rpc = await supabase.rpc('list_public_meeting_geo_change_summaries', {
    p_lat: latitude,
    p_lng: longitude,
    p_radius_km: radiusKm,
    p_category_id: categoryId?.trim() ? categoryId.trim() : null,
  });
  if (rpc.error) return { ok: false, message: rpc.error.message };
  const summaries = ((rpc.data ?? []) as unknown[])
    .map((r) => (r && typeof r === 'object' && !Array.isArray(r) ? mapGeoSummaryRow(r as Record<string, unknown>) : null))
    .filter((r): r is MeetingChangeSummary => Boolean(r));
  return { ok: true, summaries };
}

export async function syncMeetingsWithinRadiusFromSupabase(
  cachedMeetings: readonly Meeting[],
  latitude: number,
  longitude: number,
  radiusKm: number,
  categoryId: string | null,
): Promise<{ ok: true; meetings: Meeting[]; changed: boolean } | { ok: false; message: string }> {
  if (cachedMeetings.length === 0) {
    const full = await fetchMeetingsWithinRadiusFromSupabase(latitude, longitude, radiusKm, categoryId);
    return full.ok ? { ok: true, meetings: full.meetings, changed: true } : full;
  }
  const summariesRes = await fetchMeetingGeoChangeSummariesFromSupabase(latitude, longitude, radiusKm, categoryId);
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

export async function fetchMeetingsWithinRadiusFromSupabase(
  latitude: number,
  longitude: number,
  radiusKm: number,
  categoryId: string | null,
): Promise<{ ok: true; meetings: Meeting[] } | { ok: false; message: string }> {
  const rpc = await supabase.rpc('search_public_meetings_within_km', {
    p_lat: latitude,
    // 서버에서 `p_lng`/`p_ing` 둘 중 어떤 이름으로 배포됐는지에 따라 동작이 달라서 둘 다 보냅니다.
    // (PostgREST는 RPC 파라미터 이름을 엄격히 매칭하지만, 추가 파라미터는 무시되지 않고 실패할 수 있어
    //  배포 상태에 따라 아래 폴백 쿼리가 동작합니다.)
    p_lng: longitude,
    p_ing: longitude,
    p_radius_km: radiusKm,
    p_category_id: categoryId?.trim() ? categoryId.trim() : null,
  });

  if (!rpc.error) {
    const rows = Array.isArray(rpc.data) ? rpc.data : [];
    const meetings = rows.map((r) => mapSupabaseMeetingRow(r as Record<string, unknown>));
    return { ok: true, meetings };
  }

  // 서버에 RPC가 아직 없거나(schema cache), 파라미터명이 달라 호출이 실패해도
  // 지도 화면이 막히지 않도록 클라이언트에서 bbox + haversine로 폴백합니다.
  const msg = rpc.error.message ?? '';
  const shouldFallback =
    msg.includes('schema cache') ||
    msg.includes('Could not find the function') ||
    msg.includes('search_public_meetings_within_km');

  if (!shouldFallback) return { ok: false, message: msg || 'RPC error' };

  const rKm = Math.max(0.1, Math.min(200, radiusKm));
  const latDelta = rKm / 111.32;
  const cosLat = Math.cos((latitude * Math.PI) / 180);
  const lngDelta = rKm / (111.32 * Math.max(0.2, Math.abs(cosLat)));

  let q = supabase
    .from('meetings')
    .select('*')
    .eq('is_public', true)
    .not('latitude', 'is', null)
    .not('longitude', 'is', null)
    .gte('latitude', latitude - latDelta)
    .lte('latitude', latitude + latDelta)
    .gte('longitude', longitude - lngDelta)
    .lte('longitude', longitude + lngDelta)
    .order('created_at', { ascending: false })
    .limit(400);

  const cat = categoryId?.trim();
  if (cat) q = q.eq('category_id', cat);

  const { data, error } = await q;
  if (error) return { ok: false, message: error.message };

  const rows = Array.isArray(data) ? data : [];
  const within = rows.filter((r: any) => {
    const lat = r?.latitude;
    const lng = r?.longitude;
    if (typeof lat !== 'number' || typeof lng !== 'number') return false;
    const m = haversineDistanceMeters({ latitude, longitude }, { latitude: lat, longitude: lng });
    return m <= rKm * 1000;
  });
  const meetings = within.map((r) => mapSupabaseMeetingRow(r as Record<string, unknown>));
  return { ok: true, meetings };
}
