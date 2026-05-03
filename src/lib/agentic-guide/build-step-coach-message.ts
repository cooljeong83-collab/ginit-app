import type { StepCoachInput } from '@/src/lib/agentic-guide/types';

export function buildStepCoachMessage(input: StepCoachInput): string {
  const { phase, snapshot, firstScheduleSummary, frequentPlace } = input;
  const name = snapshot?.displayName?.trim();

  switch (phase) {
    case 'details_step3_capacity':
      return `${name ? `${name}님 ` : ''}참가 인원 휠 돌려서 맞추고 ✨ 아래 확인 눌러 일정으로 가보자 🙌`;
    case 'details_step4_schedule':
      return `일정은 ${firstScheduleSummary?.trim() || '지금 시드로 한 줄 잡혀 있어'} 📅 음성으로 후보도 넣을 수 있어 말로 툭 던져봐 🎤`;
    case 'details_step5_place_suggest': {
      const q = frequentPlace?.displayQuery?.trim();
      if (q) {
        return `전에 ${q} 쪽에서 자주 모였던 것 같은데 🤔 거기로 검색해 볼래? 확인 누르면 후보 검색어 채워 줄게 📍`;
      }
      return '장소 후보는 아래 검색으로 골라줘 ✨ 맛집·역 근처 키워드도 좋아 📍';
    }
    case 'details_step6_optional':
      return '상세 조건은 비워도 돼 ✨ 조건 없이 누구나 참여 가능해~ 이제 즐거운 모임 시작해 볼까? 🙌';
    case 'details_pattern_suggest':
    case 'tab_greeting':
    default:
      return '';
  }
}
