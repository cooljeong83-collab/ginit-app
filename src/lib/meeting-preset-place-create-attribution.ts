import type {
  MeetingPlaceReviewSummaryEntryContext,
  PlaceCandidate,
  PresetPlaceCreateAttribution,
  PresetPlaceCreateEntrySource,
  StorePromoEntryContext,
} from '@/src/lib/meeting-place-bridge';
import { isUuidV4 } from '@/src/lib/generate-uuid-v4';
import { supabase } from '@/src/lib/supabase';

export type PresetPlaceMeetingCreateIntentLogInput = {
  intentId: string;
  entrySource: PresetPlaceCreateEntrySource;
  analyticsPlaceId: string;
  entryContext: MeetingPlaceReviewSummaryEntryContext | StorePromoEntryContext;
  creatorAppUserId: string;
};

export type PresetPlaceSnapshot = {
  placeName: string;
  address: string;
  latitude: number;
  longitude: number;
  category?: string | null;
};

export function buildAnalyticsPlaceIdForStorePromo(ctx: StorePromoEntryContext): string {
  const pk = (ctx.placeKey ?? '').trim();
  if (pk) return pk;
  const cid = (ctx.campaignId ?? '').trim();
  return cid ? `store_promo:${cid}` : '';
}

export function buildMeetingReviewSummaryAttribution(
  intentId: string,
  placeId: string,
  ctx: MeetingPlaceReviewSummaryEntryContext,
): PresetPlaceCreateAttribution {
  return {
    intentId,
    entrySource: 'meeting_place_review_summary',
    analyticsPlaceId: placeId.trim(),
    entryContext: ctx,
  };
}

/** CTA 탭 시 — 실패해도 생성 플로우는 진행 */
export async function logPresetPlaceMeetingCreateIntent(
  input: PresetPlaceMeetingCreateIntentLogInput,
): Promise<void> {
  const intentId = input.intentId.trim();
  const creator = input.creatorAppUserId.trim();
  const analyticsPlaceId = input.analyticsPlaceId.trim();
  if (!intentId || !creator || !analyticsPlaceId || !isUuidV4(intentId)) return;

  const { error } = await supabase.rpc('log_preset_place_meeting_create_intent', {
    p_intent_id: intentId,
    p_entry_source: input.entrySource,
    p_entry_context: input.entryContext,
    p_analytics_place_id: analyticsPlaceId,
    p_creator_app_user_id: creator,
  });

  if (error && __DEV__) {
    console.warn('[logPresetPlaceMeetingCreateIntent]', error.message);
  }
}

export async function convertPresetPlaceMeetingCreateIntent(opts: {
  intentId: string;
  createdMeetingId: string;
  creatorAppUserId: string;
  placeSnapshot: PresetPlaceSnapshot;
}): Promise<void> {
  const intentId = opts.intentId.trim();
  const createdMeetingId = opts.createdMeetingId.trim();
  const creator = opts.creatorAppUserId.trim();
  if (!intentId || !createdMeetingId || !creator || !isUuidV4(intentId)) return;

  const snap = opts.placeSnapshot;
  const { error } = await supabase.rpc('convert_preset_place_meeting_create_intent', {
    p_intent_id: intentId,
    p_created_meeting_id: createdMeetingId,
    p_creator_app_user_id: creator,
    p_place_snapshot: {
      placeName: snap.placeName.trim(),
      address: snap.address.trim(),
      latitude: snap.latitude,
      longitude: snap.longitude,
      ...(snap.category?.trim() ? { category: snap.category.trim() } : {}),
    },
  });

  if (error && __DEV__) {
    console.warn('[convertPresetPlaceMeetingCreateIntent]', error.message);
  }
}

export function placeSnapshotFromCandidate(p: PlaceCandidate): PresetPlaceSnapshot {
  return {
    placeName: p.placeName.trim(),
    address: p.address.trim(),
    latitude: Number(p.latitude),
    longitude: Number(p.longitude),
    category: p.category?.trim() || null,
  };
}
