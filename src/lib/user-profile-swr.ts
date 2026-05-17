import { Image } from 'expo-image';
import type { QueryClient } from '@tanstack/react-query';

import { userProfileQueryKey } from '@/src/lib/user-profile-query-keys';
import type { UserProfile } from '@/src/lib/user-profile';
import {
  readUserProfileSyncedAtMsFromWatermelon,
  upsertUserProfileToWatermelon,
} from '@/src/lib/user-profile-watermelon-cache';

/** 타인 프로필 TanStack `staleTime` / 백그라운드 revalidate 간격 */
export const PEER_PROFILE_STALE_MS = 5 * 60 * 1000;

function normPhotoUrl(v: string | null | undefined): string {
  return typeof v === 'string' ? v.trim() : '';
}

function normBio(v: string | null | undefined): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** UI에 바로 보이는 타인 프로필 필드(사진·소개) 변경 여부 */
export function profilePeerDisplayFieldsChanged(prev: UserProfile | null | undefined, next: UserProfile | null | undefined): boolean {
  if (!prev && !next) return false;
  if (!prev || !next) return true;
  return normPhotoUrl(prev.photoUrl) !== normPhotoUrl(next.photoUrl) || normBio(prev.bio) !== normBio(next.bio);
}

/** 마지막으로 신선하다고 본 시각(ms). TanStack `dataUpdatedAt` 우선, 없으면 Watermelon `synced_at_ms`. */
export async function getPeerProfileStaleAtMs(
  appUserId: string,
  queryClient?: QueryClient,
): Promise<number | null> {
  const id = appUserId.trim();
  if (!id) return null;
  const qState = queryClient?.getQueryState<UserProfile | null>(userProfileQueryKey(id));
  const dataUpdatedAt = qState?.dataUpdatedAt;
  if (typeof dataUpdatedAt === 'number' && Number.isFinite(dataUpdatedAt)) return dataUpdatedAt;
  return readUserProfileSyncedAtMsFromWatermelon(id);
}

export async function isPeerProfileStale(appUserId: string, queryClient?: QueryClient): Promise<boolean> {
  const id = appUserId.trim();
  if (!id) return false;
  const at = await getPeerProfileStaleAtMs(id, queryClient);
  if (at == null) return true;
  return Date.now() - at > PEER_PROFILE_STALE_MS;
}

export function prefetchPeerProfilePhotoUrls(urls: readonly string[]): void {
  const uniq = [...new Set(urls.map((u) => u.trim()).filter(Boolean))];
  if (uniq.length === 0) return;
  void Image.prefetch(uniq, 'disk').catch(() => {});
}

export async function persistPeerProfileFromServer(
  appUserId: string,
  profile: UserProfile,
  queryClient: QueryClient | undefined,
  previous: UserProfile | null | undefined,
): Promise<boolean> {
  const id = appUserId.trim();
  if (!id) return false;
  await upsertUserProfileToWatermelon(id, profile);
  queryClient?.setQueryData(userProfileQueryKey(id), profile);
  const nextPhoto = normPhotoUrl(profile.photoUrl);
  if (normPhotoUrl(previous?.photoUrl) !== nextPhoto && nextPhoto) {
    prefetchPeerProfilePhotoUrls([nextPhoto]);
  }
  return profilePeerDisplayFieldsChanged(previous, profile);
}
