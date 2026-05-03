import type { PublicMeetingDetailsConfig } from '@/src/lib/meetings';

/** Edge `parse-meeting-create-intent` 원본(JSON) — 클라이언트에서 화이트리스트 검증 후 사용 */
export type MeetingCreateNluEdgeUnknown = { field: string; reason?: string | null };

export type MeetingCreateNluEdgePayload = {
  categoryId?: string | null;
  categoryLabel?: string | null;
  suggestedIsPublic?: boolean | null;
  title?: string | null;
  minParticipants?: number | null;
  maxParticipants?: number | null;
  scheduleYmd?: string | null;
  scheduleHm?: string | null;
  scheduleText?: string | null;
  placeAutoPickQuery?: string | null;
  menuPreferenceLabel?: string | null;
  canAutoCompleteThroughStep3?: boolean | null;
  publicMeetingDetails?: Record<string, unknown> | null;
  unknowns?: MeetingCreateNluEdgeUnknown[] | null;
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
  canAutoCompleteThroughStep3: boolean;
  publicMeetingDetailsPartial: Partial<PublicMeetingDetailsConfig> | null;
  unknownFields: string[];
};
