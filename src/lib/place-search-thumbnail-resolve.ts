import { searchNaverPlaceImageThumbnail, type NaverPlaceImageSearchFields } from '@/src/lib/naver-image-search';
import { derivePlaceKeyFromSearchRow } from '@/src/lib/places/place-key';
import {
  getCachedPlaceThumbnail,
  setCachedPlaceThumbnail,
} from '@/src/lib/place-thumbnail-cache';
import type { PlaceSearchRow } from '@/src/lib/place-search-row';

function isUsableHttpsUrl(raw: string | null | undefined): boolean {
  const t = raw?.trim();
  return Boolean(t && t.startsWith('https://'));
}

function rowToImageFields(row: PlaceSearchRow): NaverPlaceImageSearchFields {
  return {
    title: row.title,
    roadAddress: row.roadAddress,
    address: row.address,
    category: row.category,
    preferredPhotoMediaUrl: row.thumbnailUrl,
    kakaoPlaceDetailPageUrl: row.link ?? undefined,
  };
}

/** 행 썸네일: 목록 값 → 디스크 캐시 → 네이버/카카오/이미지 API */
export async function resolvePlaceSearchRowThumbnail(row: PlaceSearchRow): Promise<string | null> {
  const pre = row.thumbnailUrl?.trim() ?? '';
  if (isUsableHttpsUrl(pre)) {
    const pk = derivePlaceKeyFromSearchRow(row);
    void setCachedPlaceThumbnail(pk, pre);
    return pre;
  }

  const placeKey = derivePlaceKeyFromSearchRow(row);
  const cached = await getCachedPlaceThumbnail(placeKey);
  if (cached.hit && cached.url) {
    return cached.url;
  }

  const thumb = await searchNaverPlaceImageThumbnail(rowToImageFields(row));
  await setCachedPlaceThumbnail(placeKey, thumb);
  return thumb;
}

const PLACE_SEARCH_THUMB_CONCURRENCY = 4;

/** 목록 행 썸네일 병렬 해석(동시성 제한) */
export async function resolvePlaceSearchRowThumbnailsParallel(
  rows: readonly PlaceSearchRow[],
  opts?: {
    isCancelled?: () => boolean;
    onRowResolved?: (rowId: string, thumb: string | null) => void;
  },
): Promise<void> {
  if (rows.length === 0) return;

  let cursor = 0;
  const worker = async () => {
    while (cursor < rows.length) {
      if (opts?.isCancelled?.()) return;
      const index = cursor;
      cursor += 1;
      const row = rows[index];
      if (!row) continue;

      try {
        const thumb = await resolvePlaceSearchRowThumbnail(row);
        if (opts?.isCancelled?.()) return;
        opts?.onRowResolved?.(row.id, thumb);
      } catch {
        if (opts?.isCancelled?.()) return;
        opts?.onRowResolved?.(row.id, null);
      }
    }
  };

  const n = Math.min(PLACE_SEARCH_THUMB_CONCURRENCY, rows.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
}
