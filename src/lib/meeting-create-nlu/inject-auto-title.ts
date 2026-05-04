import { mergeMeetingCreateNluAccumulated } from '@/src/lib/meeting-create-agent-chat/session';
import { generateSuggestedMeetingTitle, type MeetingTitleSuggestionContext } from '@/src/lib/meeting-title-suggestion';

export type MeetingCreateNluAutoTitleInput = {
  accumulated: Record<string, unknown>;
  now: Date;
  manualTitle: string;
  aiTitleSuggestionFirst: string;
  categoryLabelForTitle: string;
  titleSuggestionCtx: MeetingTitleSuggestionContext;
};

/** 누적에 `title`이 없으면 `effectiveMeetingTitle`과 동일한 우선순위로 채움. */
export function mergeMeetingCreateNluAccumulatedWithAutoTitle(input: MeetingCreateNluAutoTitleInput): Record<string, unknown> {
  const cur = String((input.accumulated as { title?: unknown }).title ?? '').trim();
  if (cur.length > 0) return input.accumulated;
  const manual = input.manualTitle.trim();
  let resolved = '';
  if (manual.length > 0) {
    resolved = manual;
  } else {
    const ai = input.aiTitleSuggestionFirst.trim();
    if (ai.length > 0) {
      resolved = ai;
    } else {
      const label = input.categoryLabelForTitle.trim() || '모임';
      resolved = generateSuggestedMeetingTitle(label, input.now, 0, input.titleSuggestionCtx);
    }
  }
  return mergeMeetingCreateNluAccumulated(input.accumulated, { title: resolved });
}
