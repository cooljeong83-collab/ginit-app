import { mapSupabaseMeetingRow } from '@/src/lib/supabase-meetings-list';
import type { Meeting } from '@/src/lib/meetings';
import { supabase } from '@/src/lib/supabase';
import { haversineDistanceMeters } from '@/src/lib/geo-distance';

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
