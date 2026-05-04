import type { Category } from '@/src/lib/categories';
import type { MeetingCreateNluPlan } from '@/src/lib/meeting-create-nlu/types';

/**
 * 추가 LLM 없이 구조화 plan만으로 확인 말풍선 문자열을 만듭니다.
 */
export function buildMeetingCreateNluConfirmSummary(plan: MeetingCreateNluPlan, categories: Category[]): string {
  const custom = plan.nluConfirmMessage?.trim();
  if (custom) return custom;

  const catLabel = categories.find((c) => c.id.trim() === plan.categoryId.trim())?.label?.trim() ?? plan.categoryLabel;
  const pubLine =
    plan.suggestedIsPublic === true
      ? '공개 모임'
      : plan.suggestedIsPublic === false
        ? '비공개 모임'
        : '공개 여부(선택)';
  const placeLine = (plan.placeAutoPickQuery ?? '').trim() || '(장소 검색어 없음)';

  const lines = [
    '이런 모임을 원하시는군요!',
    '',
    `· 제목: ${plan.title}`,
    `· 성격: ${catLabel}`,
    `· 일시: ${plan.autoSchedule.ymd} ${plan.autoSchedule.hm}`,
    `· 인원: 최소 ${plan.minParticipants}명 · 최대 ${plan.maxParticipants}명`,
    `· 장소 검색: ${placeLine}`,
    `· ${pubLine}`,
    '',
    '모임 생성을 도와드릴까요?',
  ];

  return lines.join('\n');
}
