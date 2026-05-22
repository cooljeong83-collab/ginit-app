import { useCallback, useEffect, useMemo, useState } from 'react';

import type { NaverPlaceWebViewModalFooterAction } from '@/components/NaverPlaceWebViewModal';
import { useUserSession } from '@/src/context/UserSessionContext';
import type { PlaceDetailPopupState } from '@/src/lib/places/place-detail-popup-state';
import { PLACE_DETAIL_CREATE_MEETING_LABEL } from '@/src/lib/places/place-detail-create-meeting-label';
import { fetchPlaceMasterByLookup } from '@/src/lib/places/place-master-api';
import { runCreateMeetingFromPlaceDetailPopup } from '@/src/lib/places/run-create-meeting-from-place-detail-popup';
import { useTransitionRouter } from '@/src/lib/screen-transition-navigation';

/** `places` 마스터에 등록된 장소만 하단 CTA 노출 */
export function usePlaceDetailCreateMeetingFooter(
  state: PlaceDetailPopupState | null,
  onClose: () => void,
): NaverPlaceWebViewModalFooterAction | null {
  const router = useTransitionRouter();
  const { userId } = useUserSession();
  const [hasRegisteredPlace, setHasRegisteredPlace] = useState(false);

  const lookup = state?.placeReviewLookup;
  const placeKey = lookup?.placeKey.trim() ?? '';
  const suppressFooter = state?.suppressCreateMeetingFooter === true;

  useEffect(() => {
    if (suppressFooter || !lookup || !placeKey) {
      setHasRegisteredPlace(false);
      return;
    }
    let alive = true;
    setHasRegisteredPlace(false);
    void (async () => {
      const master = await fetchPlaceMasterByLookup(lookup);
      if (!alive) return;
      setHasRegisteredPlace(master != null);
    })();
    return () => {
      alive = false;
    };
  }, [lookup, placeKey, suppressFooter]);

  const onPress = useCallback(() => {
    if (!lookup || !placeKey || !hasRegisteredPlace) return;
    void runCreateMeetingFromPlaceDetailPopup({
      lookup,
      placeSnapshotHint: state?.placeSnapshotHint,
      userId,
      router,
      onClose,
    });
  }, [hasRegisteredPlace, lookup, onClose, placeKey, router, state?.placeSnapshotHint, userId]);

  return useMemo(() => {
    if (suppressFooter || !hasRegisteredPlace || !placeKey || !lookup) return null;
    return {
      label: PLACE_DETAIL_CREATE_MEETING_LABEL,
      onPress,
    };
  }, [hasRegisteredPlace, lookup, onPress, placeKey, suppressFooter]);
}
