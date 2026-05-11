import type { Meeting } from '@/src/lib/meetings';

function placeCandidateStableChipId(p: { id?: string }, index: number): string {
  const pid = typeof p.id === 'string' ? p.id.trim() : '';
  return pid || `pc-${index}`;
}

/**
 * 확정 일정 기준으로 `confirmedPlaceChipId`에 해당하는 위경도를 반환합니다.
 * `app/meeting/[id].tsx`에 있던 `confirmedPlaceCoords` useMemo와 동일한 규칙입니다.
 */
export function resolveConfirmedPlaceCoordsForMeeting(
  meeting: Meeting | null | undefined,
): { latitude: number; longitude: number } | null {
  if (!meeting || meeting.scheduleConfirmed !== true) return null;
  const rawId = meeting.confirmedPlaceChipId?.trim();
  if (!rawId) return null;
  const cands = meeting.placeCandidates ?? [];
  for (let i = 0; i < cands.length; i++) {
    if (placeCandidateStableChipId(cands[i], i) === rawId) {
      const lat = cands[i].latitude;
      const lng = cands[i].longitude;
      if (Number.isFinite(lat) && Number.isFinite(lng)) return { latitude: lat, longitude: lng };
      return null;
    }
  }
  if (rawId === 'legacy-place') {
    const lat = meeting.latitude;
    const lng = meeting.longitude;
    if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
      return { latitude: lat, longitude: lng };
    }
  }
  return null;
}
