/** 장소 검색 화면 → 모임 등록 화면으로 전달하는 인메모리 브리지 (라우터 back 시 사용). */
export type MeetingPlaceSelection = {
  placeName: string;
  address: string;
  latitude: number;
  longitude: number;
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
};

export type DateCandidate = {
  id: string;
  scheduleDate: string;
  scheduleTime: string;
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
