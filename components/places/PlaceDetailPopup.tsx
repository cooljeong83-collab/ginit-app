import { useRef } from 'react';

import { NaverPlaceWebViewModal } from '@/components/NaverPlaceWebViewModal';
import type { PlaceDetailPopupState } from '@/src/lib/places/place-detail-popup-state';

export type PlaceDetailPopupProps = {
  state: PlaceDetailPopupState | null;
  onClose: () => void;
};

/**
 * 장소 「상세 정보」/「카카오」 공통 팝업.
 * - 기본: 네이버·카카오 WebView
 * - 타이틀 우측 💜 평점
 * - 탭: 웹뷰 | 코멘트(지닛 후기)
 *
 * 화면별로 `NaverPlaceWebViewModal`을 직접 쓰지 말고 이 컴포넌트만 마운트합니다.
 */
export function PlaceDetailPopup({ state, onClose }: PlaceDetailPopupProps) {
  /** 닫은 뒤에도 WebView 풀·세션 캐시 유지(동일 가게 재오픈 시 재로드 방지) */
  const retainedRef = useRef<PlaceDetailPopupState | null>(null);
  if (state) retainedRef.current = state;
  const retained = state ?? retainedRef.current;

  return (
    <NaverPlaceWebViewModal
      visible={state != null}
      url={retained?.url}
      pageTitle={retained?.title ?? '상세 정보'}
      placeReviewLookup={retained?.placeReviewLookup ?? null}
      onClose={onClose}
    />
  );
}
