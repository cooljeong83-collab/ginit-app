import {
  isHttpRemoteImageUrl,
  resolveHttpImageDisplayUri,
} from '@/src/lib/supabase-public-image-thumbnail';

type PlaceChipPhotoFields = {
  preferredPhotoMediaUrl?: string | null;
};

/**
 * 장소 칩 썸네일: 비동기 해석 결과 → 칩에 저장된 `preferredPhotoMediaUrl` 순.
 * `thumbByChipId[id]`가 `undefined`일 때도 즉시 표시할 수 있게 합니다.
 */
export function resolvePlaceChipDisplayThumb(
  chip: PlaceChipPhotoFields,
  thumbByChipId: Record<string, string | null | undefined>,
  chipId: string,
  width = 320,
): string | null {
  const cached = thumbByChipId[chipId];
  if (isHttpRemoteImageUrl(cached)) {
    return resolveHttpImageDisplayUri(cached, width);
  }
  if (isHttpRemoteImageUrl(chip.preferredPhotoMediaUrl)) {
    return resolveHttpImageDisplayUri(chip.preferredPhotoMediaUrl, width);
  }
  return null;
}
