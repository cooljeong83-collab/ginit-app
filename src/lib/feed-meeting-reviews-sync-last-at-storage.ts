import AsyncStorage from '@react-native-async-storage/async-storage';

import { normalizeFeedRegionLabel } from '@/src/lib/feed-display-location';

function storageKey(regionNorm: string): string {
  return `ginit_feed_meeting_reviews_last_sync_at:${normalizeFeedRegionLabel(regionNorm)}`;
}

export async function getFeedMeetingReviewsLastSyncIso(regionNorm: string): Promise<string | null> {
  const region = normalizeFeedRegionLabel(regionNorm);
  if (!region) return null;
  try {
    const raw = await AsyncStorage.getItem(storageKey(region));
    const s = typeof raw === 'string' ? raw.trim() : '';
    return s.length > 0 ? s : null;
  } catch {
    return null;
  }
}

export async function setFeedMeetingReviewsLastSyncIso(regionNorm: string, iso: string): Promise<void> {
  const region = normalizeFeedRegionLabel(regionNorm);
  if (!region) return;
  try {
    await AsyncStorage.setItem(storageKey(region), iso);
  } catch {
    /* ignore */
  }
}

export async function clearFeedMeetingReviewsLastSyncIso(regionNorm: string): Promise<void> {
  const region = normalizeFeedRegionLabel(regionNorm);
  if (!region) return;
  try {
    await AsyncStorage.removeItem(storageKey(region));
  } catch {
    /* ignore */
  }
}
