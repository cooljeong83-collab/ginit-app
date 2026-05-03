import { isColdStartForAgentSnapshot } from '@/src/lib/agentic-guide/cold-start';
import type { StepCoachInput } from '@/src/lib/agentic-guide/types';

function submitReadinessFooter(snapshot: NonNullable<StepCoachInput['snapshot']>): string {
  return '\n지닛 시작하기를 누르시면 등록이 완료돼요. \n수정이 필요하시면 언제든 위에서 다시 편집하실 수 있어요.';
}

export function buildStepCoachMessage(input: StepCoachInput): string {
  const { phase, snapshot, firstScheduleSummary, frequentPlace, meetingHabits } = input;
  const name = snapshot?.displayName?.trim();
  const cold = snapshot ? isColdStartForAgentSnapshot(snapshot) : false;

  switch (phase) {
    case 'details_step3_capacity':
      if (cold) {
        return `모임 이름을 🎤말씀하시거나 ⌨️입력해 주세요. \n입력하지 않으셔도 AI가 자동으로 추천해 드려요. \n인원까지 선택하신 뒤 확인을 누르시면 다음 단계로 이동해요.`;
      }
      return `${name ? `${name}님, ` : ''}모임 이름과 참가 인원을 선택해 주세요✨ 아래 확인을 누르시면 일정 단계로 이동하실 수 있어요 🙌`;
    case 'details_step4_schedule':
      if (cold) {
        return `하나 이상의 일정 후보를 ⌨️입력해 선택하시거나,\n🎤말씀하시거나 📅달력에서 선택해 등록해 보세요.`;
      }
      return `하나 이상의 일정 후보를 ⌨️입력해 선택하시거나,\n🎤말씀하시거나 📅달력에서 선택해 바로 등록해 보세요.`;
    case 'details_step5_place_suggest': {
      const q = frequentPlace?.displayQuery?.trim();
      const habitPlace = meetingHabits?.topPlaces?.[0]?.displayQuery?.trim();
      if (habitPlace && (meetingHabits?.topPlaces?.[0]?.score ?? 0) >= 3) {
        return `참여 기록을 보면 ${habitPlace} 쪽이 자주 나와요. 확인을 누르시면 검색창에 그 힌트를 넣어 드릴게요. 마음에 안 드시면 지우시고 다른 키워드로 검색하셔도 돼요.`;
      }
      if (q) {
        return `전에 ${q} 쪽에서 자주 모이셨던 것 같아요 🤔 그곳으로 검색해 보시겠어요? 확인을 누르시면 후보 검색어를 채워 드릴게요 📍`;
      }
      return '고민되실 때는 여러 곳을 후보로 담아 보세요. \n⌨️입력도, 🎤말씀도 모두 가능해요.';
    }
    case 'details_step6_optional': {
      if (!snapshot) {
        return '상세 조건은 비우셔도 돼요 ✨ 조건 없이 누구나 참여 가능해요. 이제 즐거운 모임을 시작해 보시겠어요? 🙌';
      }
      if (cold) {
        return `상세 조건은 비우셔도 괜찮아요. \n여기까지 오셨으면 거의 끝이에요.${submitReadinessFooter(snapshot)}`;
      }
      return `상세 조건은 선택하지 않으셔도 돼요.✨ \n그러면 조건 없이 누구나 참여 가능해요. \n이제 즐거운 모임을 시작해 보시겠어요? 🙌${submitReadinessFooter(snapshot)}`;
    }
    case 'details_pattern_suggest':
    case 'tab_greeting':
    default:
      return '';
  }
}
