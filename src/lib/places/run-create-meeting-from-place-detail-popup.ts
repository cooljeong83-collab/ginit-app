import { showTransientBottomMessage } from '@/components/ui/TransientBottomMessage';
import { presentAppDialogAlert } from '@/src/lib/app-dialog-present';
import { loadRegisteredFeedRegions } from '@/src/lib/feed-registered-regions';
import { generateUuidV4 } from '@/src/lib/generate-uuid-v4';
import { setPendingPresetPlaceCandidate } from '@/src/lib/meeting-place-bridge';
import { gatePlaceAgainstRegisteredInterestRegions } from '@/src/lib/meeting-create-place-region';
import { logPresetPlaceMeetingCreateIntent } from '@/src/lib/meeting-preset-place-create-attribution';
import { buildPresetPlaceCandidateFromPlaceDetailPopup } from '@/src/lib/places/build-preset-from-place-detail-popup';
import type { PlaceLookupInput } from '@/src/lib/places/place-lookup-keys';
import type { PlaceDetailPopupPlaceSnapshotHint } from '@/src/lib/places/place-detail-popup-state';
import { pushProfileOpenRegisterInfo } from '@/src/lib/profile-register-info';
import {
  getUserProfile,
  isMeetingServiceComplianceComplete,
} from '@/src/lib/user-profile';
import type { Router } from 'expo-router';

export type RunCreateMeetingFromPlaceDetailPopupOpts = {
  lookup: PlaceLookupInput;
  placeSnapshotHint?: PlaceDetailPopupPlaceSnapshotHint | null;
  userId: string | null | undefined;
  router: Router;
  onClose?: () => void;
};

export async function runCreateMeetingFromPlaceDetailPopup(
  opts: RunCreateMeetingFromPlaceDetailPopupOpts,
): Promise<void> {
  const lookup = opts.lookup;
  if (!lookup.placeKey.trim()) return;

  const pk = opts.userId?.trim();
  if (pk) {
    try {
      const p = await getUserProfile(pk);
      if (!isMeetingServiceComplianceComplete(p, pk)) {
        presentAppDialogAlert({
          title: '인증 정보 등록',
          body: '모임을 이용하시려면 약관 동의와 필요한 프로필 정보를 입력해 주세요.',
          onPrimary: () => pushProfileOpenRegisterInfo(opts.router),
        });
        return;
      }
    } catch {
      /* 등록 시 재검증 */
    }
  }

  const intentId = generateUuidV4();
  const preset = await buildPresetPlaceCandidateFromPlaceDetailPopup(
    lookup,
    intentId,
    opts.placeSnapshotHint,
  );
  if (!preset) {
    showTransientBottomMessage('이 장소의 위치 정보가 없어 모임을 만들 수 없어요.', 2600);
    return;
  }

  const regions = await loadRegisteredFeedRegions();
  const regionGate = gatePlaceAgainstRegisteredInterestRegions(
    {
      placeName: preset.placeName,
      address: preset.address,
      latitude: preset.latitude,
      longitude: preset.longitude,
    },
    regions,
  );
  if (!regionGate.ok) {
    presentAppDialogAlert({ title: regionGate.title, body: regionGate.message });
    return;
  }

  if (pk) {
    void logPresetPlaceMeetingCreateIntent({
      intentId,
      entrySource: preset.attribution.entrySource,
      analyticsPlaceId: preset.attribution.analyticsPlaceId,
      entryContext: preset.attribution.entryContext,
      creatorAppUserId: pk,
    });
  }

  setPendingPresetPlaceCandidate(preset);
  opts.onClose?.();

  const d = new Date();
  const scheduleDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  opts.router.push({
    pathname: '/create/details',
    params: { scheduleDate, scheduleTime: '15:00' },
  });
}
