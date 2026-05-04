import type { PublicMeetingDetailsConfig } from '@/src/lib/meetings';

/** Edge `parse-meeting-create-intent` 원본(JSON) — 클라이언트에서 화이트리스트 검증 후 사용 */
export type MeetingCreateNluEdgeUnknown = { field: string; reason?: string | null };

/** 중첩 `inference` 블록을 플랫으로 옮긴 뒤의 메타(선택) */
export type MeetingCreateNluInference = {
  intent_strength?: string | null;
  social_context?: string | null;
  reasoning?: string | null;
};

export type MeetingCreateNluEdgePayload = {
  categoryId?: string | null;
  categoryLabel?: string | null;
  /** `extracted_data.major_code` 등 — 카테고리 id가 없을 때 `major_code`·라벨 매칭 보조 */
  majorCodeHint?: string | null;
  suggestedIsPublic?: boolean | null;
  title?: string | null;
  minParticipants?: number | null;
  maxParticipants?: number | null;
  scheduleYmd?: string | null;
  scheduleHm?: string | null;
  scheduleText?: string | null;
  placeAutoPickQuery?: string | null;
  menuPreferenceLabel?: string | null;
  /** 영화 제목 힌트(복수) — Step2 `MovieSearch` 사전 채움·결손 해소 */
  movieTitleHints?: string[] | null;
  /** 단일 영화 제목 힌트 */
  primaryMovieTitle?: string | null;
  activityKindLabel?: string | null;
  gameKindLabel?: string | null;
  pcGameKindLabel?: string | null;
  focusKnowledgeLabel?: string | null;
  canAutoCompleteThroughStep3?: boolean | null;
  publicMeetingDetails?: Record<string, unknown> | null;
  unknowns?: MeetingCreateNluEdgeUnknown[] | null;
  /** `response.ask_message` — 결손·멀티턴 안내에 우선 사용 */
  nluAskMessage?: string | null;
  /** `response.confirm_message` — 수락 전 요약 말풍선에 우선 사용 */
  nluConfirmMessage?: string | null;
  nluInference?: MeetingCreateNluInference | null;
};

/** 검증·카테고리 매핑 후 오토파일럿 입력 */
export type MeetingCreateNluPlan = {
  categoryId: string;
  categoryLabel: string;
  suggestedIsPublic: boolean | null;
  title: string;
  minParticipants: number;
  maxParticipants: number;
  autoSchedule: { ymd: string; hm: string };
  placeAutoPickQuery: string | null;
  menuPreferenceLabel: string | null;
  movieTitleHints: string[];
  activityKindLabel: string | null;
  gameKindLabel: string | null;
  pcGameKindLabel: string | null;
  focusKnowledgeLabel: string | null;
  canAutoCompleteThroughStep3: boolean;
  publicMeetingDetailsPartial: Partial<PublicMeetingDetailsConfig> | null;
  unknownFields: string[];
  nluAskMessage?: string | null;
  nluConfirmMessage?: string | null;
  nluInference?: MeetingCreateNluInference | null;
};
