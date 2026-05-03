import { isColdStartForAgentSnapshot } from '@/src/lib/agentic-guide/cold-start';
import type { StepCoachInput } from '@/src/lib/agentic-guide/types';

function submitReadinessFooter(snapshot: NonNullable<StepCoachInput['snapshot']>): string {
  
  return '\n지닛 시작하기를 누르면 등록이 끝나요. \n수정이 필요하면 언제든 위로!';
  
}

export function buildStepCoachMessage(input: StepCoachInput): string {
  const { phase, snapshot, firstScheduleSummary, frequentPlace, meetingHabits } = input;
  const name = snapshot?.displayName?.trim();
  const cold = snapshot ? isColdStartForAgentSnapshot(snapshot) : false;

  switch (phase) {
    case 'details_step3_capacity':
      if (cold) {
        return `모임 이름을 🎤말하거나 ⌨️입력해 주세요. \n입력하지 않아도 AI가 자동 추천해 드려요. \n인원까지 선택 후 확인으로 다음 단계로 가요. `;
      }
      return `${name ? `${name}님 ` : ''}모임 이름과 참가 인원을 선택하세요✨ 아래 확인 눌러 일정으로~🙌`;
    case 'details_step4_schedule':
      if (cold) {
        return `하나 이상의 일정 후보를 ⌨️입력해 선택하거나,\n🎤말하기 또는 📅달력 선택으로 등록해 보세요.`;
      }
      return `하나 이상의 일정 후보를 ⌨️입력해 선택하거나,\n🎤말하기 또는 📅달력 선택으로 바로 등록하자!`;
    case 'details_step5_place_suggest': {
      const q = frequentPlace?.displayQuery?.trim();
      const habitPlace = meetingHabits?.topPlaces?.[0]?.displayQuery?.trim();
      if (habitPlace && (meetingHabits?.topPlaces?.[0]?.score ?? 0) >= 3) {
        return `참여 기록을 보면 ${habitPlace} 쪽이 자주 나와요. 확인을 누르면 검색창에 그 힌트를 넣어 줄게요. 마음에 안 들면 지우고 다른 키워드로 찾아도 돼요.`;
      }
      if (q) {
        return `전에 ${q} 쪽에서 자주 모였던 것 같은데 🤔 거기로 검색해 볼래? 확인 누르면 후보 검색어 채워 줄게 📍`;
      }
      return '고민될 땐 여러 곳을 후보로 담아보세요. \n⌨️입력도, 🎤말하기도 모두 가능해요.';
    }
    case 'details_step6_optional': {
      if (!snapshot) {
        return '상세 조건은 비워도 돼 ✨ 조건 없이 누구나 참여 가능해~ 이제 즐거운 모임 시작해 볼까요? 🙌';
      }
      if (cold) {
        return `상세 조건은 비워도 괜찮아요. \n여기까지 오셨으면 거의 끝이에요.${submitReadinessFooter(snapshot)}`;
      }
      return `상세 조건은 선택하지 않아도 돼요.✨ \n그러면 조건 없이 누구나 참여 가능해요~ \n이제 즐거운 모임 시작해 볼까요? 🙌${submitReadinessFooter(snapshot)}`;
    }
    case 'details_pattern_suggest':
    case 'tab_greeting':
    default:
      return '';
  }
}
