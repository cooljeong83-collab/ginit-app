import { supabase } from '@/src/lib/supabase';

export type PlaceRatingSummary = {
  averageRating: number;
  totalReviews: number;
};

export async function fetchPlaceRatingSummary(placeKey: string): Promise<
  { ok: true; summary: PlaceRatingSummary } | { ok: false; message: string }
> {
  const k = placeKey.trim();
  if (!k) return { ok: false, message: 'placeKey가 비어 있습니다.' };

  const { data, error } = await supabase.rpc('get_place_rating_summary', { p_place_key: k });
  if (error) return { ok: false, message: error.message };

  const row = Array.isArray(data) ? (data[0] as { average_rating?: unknown; total_reviews?: unknown } | undefined) : null;
  const avgRaw = row?.average_rating;
  const totalRaw = row?.total_reviews;
  const averageRating = typeof avgRaw === 'number' && Number.isFinite(avgRaw) ? avgRaw : Number(avgRaw) || 0;
  const totalReviews = typeof totalRaw === 'number' && Number.isFinite(totalRaw) ? Math.trunc(totalRaw) : Number(totalRaw) || 0;

  return { ok: true, summary: { averageRating, totalReviews } };
}

export async function upsertMyPlaceReview(input: {
  appUserId: string;
  placeKey: string;
  meetingId: string;
  rating: number;
  vibeTags: string[];
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const uid = input.appUserId.trim();
  const pk = input.placeKey.trim();
  const mid = input.meetingId.trim();
  if (!uid || !pk || !mid) return { ok: false, message: '필수 값이 비어 있습니다.' };

  const { error } = await supabase.rpc('upsert_my_place_review', {
    p_app_user_id: uid,
    p_place_key: pk,
    p_meeting_id: mid,
    p_rating: input.rating,
    p_vibe_tags: input.vibeTags.length ? input.vibeTags : [],
  });

  if (error) return { ok: false, message: error.message };
  return { ok: true };
}
