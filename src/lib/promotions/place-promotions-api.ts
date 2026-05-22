import type {
  FeedSponsoredPlace,
  MeetingPlacePromotion,
  PlacePromotionSummary,
  PromotionMatchVerifyPayload,
} from '@/src/lib/promotions/place-promotion-types';
import { supabase } from '@/src/lib/supabase';

function parseFeedSponsoredPlace(raw: unknown): FeedSponsoredPlace | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const promotionId = typeof o.promotion_id === 'string' ? o.promotion_id.trim() : '';
  const campaignId = typeof o.campaign_id === 'string' ? o.campaign_id.trim() : '';
  const placeId = typeof o.place_id === 'string' ? o.place_id.trim() : '';
  const placeKey = typeof o.place_key === 'string' ? o.place_key.trim() : '';
  const placeName = typeof o.place_name === 'string' ? o.place_name.trim() : '';
  if (!promotionId || !campaignId || !placeId || !placeKey || !placeName) return null;
  const lat = o.latitude != null ? Number(o.latitude) : null;
  const lng = o.longitude != null ? Number(o.longitude) : null;
  return {
    promotionId,
    campaignId,
    benefitLabel:
      typeof o.benefit_label === 'string' && o.benefit_label.trim()
        ? o.benefit_label.trim()
        : '제휴 혜택',
    badgeLabel:
      typeof o.badge_label === 'string' && o.badge_label.trim()
        ? o.badge_label.trim()
        : '지닛 매치 추천',
    placeId,
    placeKey,
    placeName,
    roadAddress: typeof o.road_address === 'string' ? o.road_address : '',
    category: typeof o.category === 'string' && o.category.trim() ? o.category.trim() : null,
    preferredPhotoMediaUrl:
      typeof o.preferred_photo_media_url === 'string' && o.preferred_photo_media_url.trim()
        ? o.preferred_photo_media_url.trim()
        : null,
    naverPlaceLink:
      typeof o.naver_place_link === 'string' && o.naver_place_link.trim()
        ? o.naver_place_link.trim()
        : null,
    latitude: lat != null && Number.isFinite(lat) ? lat : null,
    longitude: lng != null && Number.isFinite(lng) ? lng : null,
    averageRating:
      typeof o.average_rating === 'number' ? o.average_rating : Number(o.average_rating) || 0,
    reviewCount:
      typeof o.review_count === 'number' ? o.review_count : Number(o.review_count) || 0,
  };
}

function parsePlacePromotionSummary(raw: unknown): PlacePromotionSummary | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const placeKey = typeof o.place_key === 'string' ? o.place_key.trim() : '';
  const placeId = typeof o.place_id === 'string' ? o.place_id.trim() : '';
  if (!placeKey || !placeId) return null;
  return {
    placeKey,
    placeId,
    isSponsored: o.is_sponsored === true,
    benefitLabel:
      typeof o.benefit_label === 'string' && o.benefit_label.trim()
        ? o.benefit_label.trim()
        : '제휴 혜택',
    badgeLabel:
      typeof o.badge_label === 'string' && o.badge_label.trim()
        ? o.badge_label.trim()
        : '지닛 매치 추천',
    campaignId: typeof o.campaign_id === 'string' ? o.campaign_id.trim() : '',
    promotionId: typeof o.promotion_id === 'string' ? o.promotion_id.trim() : '',
  };
}

function parseMeetingPlacePromotion(raw: unknown): MeetingPlacePromotion | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.is_sponsored !== true) return null;
  const placeId = typeof o.place_id === 'string' ? o.place_id.trim() : '';
  const placeKey = typeof o.place_key === 'string' ? o.place_key.trim() : '';
  const placeName = typeof o.place_name === 'string' ? o.place_name.trim() : '';
  const campaignId = typeof o.campaign_id === 'string' ? o.campaign_id.trim() : '';
  const promotionId = typeof o.promotion_id === 'string' ? o.promotion_id.trim() : '';
  if (!placeId || !placeKey || !placeName || !campaignId || !promotionId) return null;
  return {
    isSponsored: true,
    promotionId,
    campaignId,
    placeId,
    placeKey,
    placeName,
    benefitLabel:
      typeof o.benefit_label === 'string' && o.benefit_label.trim()
        ? o.benefit_label.trim()
        : '제휴 혜택',
    badgeLabel:
      typeof o.badge_label === 'string' && o.badge_label.trim()
        ? o.badge_label.trim()
        : '지닛 매치 추천',
  };
}

async function fetchSponsoredPlacesFromRpc(
  rpcName: 'list_feed_sponsored_places' | 'list_sponsored_places_for_search',
  regionNorm: string | null | undefined,
  limit: number,
  logTag: string,
): Promise<FeedSponsoredPlace[]> {
  const region = regionNorm?.trim() || null;
  const { data, error } = await supabase.rpc(rpcName, {
    p_region_norm: region,
    p_limit: limit,
  });
  if (error) {
    if (__DEV__) console.warn(`[${logTag}]`, error.message);
    return [];
  }
  const rows = Array.isArray(data) ? data : [];
  const out: FeedSponsoredPlace[] = [];
  for (const raw of rows) {
    const row = parseFeedSponsoredPlace(raw);
    if (row) out.push(row);
  }
  return out;
}

/** 탐색 피드 인라인 카드 — `expose_in_feed` 제휴만 */
export async function fetchFeedSponsoredPlaces(
  regionNorm: string | null | undefined,
  limit = 1,
): Promise<FeedSponsoredPlace[]> {
  return fetchSponsoredPlacesFromRpc(
    'list_feed_sponsored_places',
    regionNorm,
    limit,
    'fetchFeedSponsoredPlaces',
  );
}

/** 장소 후보 검색 상단 부스트 — `boost_in_place_search` 제휴만 */
export async function fetchSponsoredPlacesForSearch(
  regionNorm: string | null | undefined,
  limit = 3,
): Promise<FeedSponsoredPlace[]> {
  return fetchSponsoredPlacesFromRpc(
    'list_sponsored_places_for_search',
    regionNorm,
    limit,
    'fetchSponsoredPlacesForSearch',
  );
}

export async function fetchPlacePromotionsByKeys(
  placeKeys: string[],
): Promise<Map<string, PlacePromotionSummary>> {
  const keys = [...new Set(placeKeys.map((k) => k.trim()).filter(Boolean))];
  const out = new Map<string, PlacePromotionSummary>();
  if (keys.length === 0) return out;

  const { data, error } = await supabase.rpc('get_place_promotions_by_keys', {
    p_place_keys: keys,
  });
  if (error) {
    if (__DEV__) console.warn('[fetchPlacePromotionsByKeys]', error.message);
    return out;
  }
  const rows = Array.isArray(data) ? data : [];
  for (const raw of rows) {
    const row = parsePlacePromotionSummary(raw);
    if (row?.isSponsored) out.set(row.placeKey, row);
  }
  return out;
}

export async function resolveMeetingPlacePromotion(
  meetingId: string,
): Promise<MeetingPlacePromotion | null> {
  const mid = meetingId.trim();
  if (!mid) return null;
  const { data, error } = await supabase.rpc('resolve_meeting_place_promotion', {
    p_meeting_id: mid,
  });
  if (error) {
    if (__DEV__) console.warn('[resolveMeetingPlacePromotion]', error.message);
    return null;
  }
  return parseMeetingPlacePromotion(data);
}

export async function submitPromotionMatchVerify(
  payload: PromotionMatchVerifyPayload,
): Promise<string | null> {
  const meetingId = payload.meetingId.trim();
  const verifier = payload.verifierAppUserId.trim();
  if (!meetingId || !verifier) return null;

  const { data, error } = await supabase.rpc('submit_promotion_match_verify', {
    p_meeting_id: meetingId,
    p_verifier_app_user_id: verifier,
    p_headcount: Math.max(0, Math.floor(payload.headcount)),
    p_total_amount_won: Math.max(0, Math.floor(payload.totalAmountWon)),
    p_benefit_received: payload.benefitReceived,
    p_match_success: payload.matchSuccess ?? payload.benefitReceived,
  });
  if (error) {
    if (__DEV__) console.warn('[submitPromotionMatchVerify]', error.message);
    return null;
  }
  return typeof data === 'string' ? data : null;
}

export function pickPlacePromotion(
  map: Map<string, PlacePromotionSummary> | undefined,
  placeKey: string,
): PlacePromotionSummary | null {
  if (!map || !placeKey.trim()) return null;
  return map.get(placeKey.trim()) ?? null;
}
