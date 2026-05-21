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
  return (
    <NaverPlaceWebViewModal
      visible={state != null}
      url={state?.url}
      pageTitle={state?.title ?? '상세 정보'}
      placeReviewLookup={state?.placeReviewLookup ?? null}
      onClose={onClose}
    />
  );
}
