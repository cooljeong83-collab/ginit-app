import { useEffect, useState } from 'react';

import { fetchKakaoPlacePageThumbnailUrl, isKakaoMapPlacePageUrl } from '@/src/lib/kakao-place-page-image';

const thumbCache = new Map<string, string | null>();

export type KakaoPlaceListThumbState = {
  /** 카카오 장소 HTML `og:image` — https 만 */
  uri: string | null;
  loading: boolean;
};

/**
 * 모임 목록 등: 카카오맵 `place_url`이 있으면 HTML에서 대표 이미지 URL을 한 번 가져와 캐시합니다.
 */
export function useKakaoPlaceListThumbnail(pageUrl: string | null | undefined): KakaoPlaceListThumbState {
  const key = (pageUrl ?? '').trim();
  const [state, setState] = useState<KakaoPlaceListThumbState>({ uri: null, loading: false });

  useEffect(() => {
    if (!key || !isKakaoMapPlacePageUrl(key)) {
      setState({ uri: null, loading: false });
      return;
    }
    if (thumbCache.has(key)) {
      setState({ uri: thumbCache.get(key) ?? null, loading: false });
      return;
    }
    let alive = true;
    setState({ uri: null, loading: true });
    void fetchKakaoPlacePageThumbnailUrl(key).then((u) => {
      thumbCache.set(key, u);
      if (!alive) return;
      setState({ uri: u, loading: false });
    });
    return () => {
      alive = false;
    };
  }, [key]);

  return state;
}
