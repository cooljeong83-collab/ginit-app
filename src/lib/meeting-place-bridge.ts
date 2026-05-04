/**
 * 장소 검색 화면 → 모임 등록 화면으로 전달하는 인메모리 브리지 (라우터 back 시 사용).
 * 지도 탭 FAB는 동일 객체를 **initialLocation**으로 쓰며, `applyNearbySearchBiasFromMapNavigation`과 함께
 * 모임 등록 단계의 주변 장소 검색 기준 좌표로 소비됩니다.
 */
export type MeetingPlaceSelection = {
  placeName: string;
  address: string;
  latitude: number;
  longitude: number;
  /** 네이버 지역 검색 `link` — 플레이스 상세(WebView) */
  naverPlaceLink?: string | null;
  /** 검색 행·OG 등에서 온 대표 사진(https) — 모임 목록 첫 장소 썸네일용 */
  preferredPhotoMediaUrl?: string | null;
};

let pending: MeetingPlaceSelection | null = null;

export function setPendingMeetingPlace(selection: MeetingPlaceSelection) {
  pending = selection;
}

export function consumePendingMeetingPlace(): MeetingPlaceSelection | null {
  const v = pending;
  pending = null;
  return v;
}

/** `VoteCandidatesForm` 행별 장소 검색(`/place-search`) → 돌아온 뒤 해당 행에만 반영 */
export type VotePlaceRowSelection = MeetingPlaceSelection & { rowId: string };

let pendingVotePlaceRow: VotePlaceRowSelection | null = null;

export function setPendingVotePlaceRow(selection: VotePlaceRowSelection) {
  pendingVotePlaceRow = selection;
}

export function consumePendingVotePlaceRow(): VotePlaceRowSelection | null {
  const v = pendingVotePlaceRow;
  pendingVotePlaceRow = null;
  return v;
}

/** `/create/details` 다이나믹 후보 폼 → 모임 등록 2단계 */
export type PlaceCandidate = {
  id: string;
  placeName: string;
  address: string;
  latitude: number;
  longitude: number;
  /** 네이버 지역 검색 `link` — 플레이스 상세(WebView) */
  naverPlaceLink?: string | null;
  preferredPhotoMediaUrl?: string | null;
};

export type DateCandidateType =
  | 'point'
  | 'date-range'
  | 'datetime-range'
  | 'recurring'
  | 'multi'
  | 'flexible'
  | 'tbd'
  | 'deadline';

export type DateCandidate = {
  id: string;
  type: DateCandidateType;
  subType?: 'daily' | 'weekly' | 'monthly';
  startDate: string;
  startTime?: string;
  endDate?: string;
  endTime?: string;
  textLabel?: string;
  isDeadlineSet?: boolean;
};

export type VoteCandidatesPayload = {
  placeCandidates: PlaceCandidate[];
  dateCandidates: DateCandidate[];
};

let pendingVote: VoteCandidatesPayload | null = null;

export function setPendingVoteCandidates(payload: VoteCandidatesPayload) {
  pendingVote = payload;
}

export function consumePendingVoteCandidates(): VoteCandidatesPayload | null {
  const v = pendingVote;
  pendingVote = null;
  return v;
}
