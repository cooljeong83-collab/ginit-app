import type { Category } from '@/src/lib/categories';
import {
  isActiveLifeMajorCode,
  isPcGameMajorCode,
  isPlayAndVibeMajorCode,
  resolveSpecialtyKindForCategory,
  type SpecialtyKind,
} from '@/src/lib/category-specialty';

const WARM_TAIL = '아래 확인을 누르신 뒤 다음 단계로 넘어가실 수 있어요 ✨';
const COLD_TAIL = '선택 후 아래 확인을 누르시면 다음 단계로 이동해요.';

function linesForSpecialty(category: Category, sk: SpecialtyKind): { cold: string; warm: string } {
  const mc = category.majorCode ?? '';
  if (sk === 'movie') {
    return {
      cold: `이 단계에서는 보고 싶은 영화 후보를 한 개 이상 선택해 주세요. \n${COLD_TAIL}`,
      warm: `보고 싶은 영화 후보를 골라 주시면, ${WARM_TAIL}`,
    };
  }
  if (sk === 'food') {
    return {
      cold: `이 단계에서는 메뉴 성향을 한 가지 이상 선택해 주세요. \n${COLD_TAIL}`,
      warm: `메뉴 성향을 한 가지 골라 주시면, ${WARM_TAIL}`,
    };
  }
  if (sk === 'sports') {
    if (isPcGameMajorCode(mc)) {
      return {
        cold: `이 단계에서는 PC 게임을 한 가지 선택해 주세요. \n${COLD_TAIL}`,
        warm: `PC 게임을 골라 주시면, ${WARM_TAIL}`,
      };
    }
    if (isPlayAndVibeMajorCode(mc)) {
      return {
        cold: `이 단계에서는 게임 종류를 한 가지 선택해 주세요. \n${COLD_TAIL}`,
        warm: `게임 종류를 골라 주시면, ${WARM_TAIL}`,
      };
    }
    if (isActiveLifeMajorCode(mc)) {
      return {
        cold: `이 단계에서는 활동 종류를 한 가지 선택해 주세요. \n${COLD_TAIL}`,
        warm: `활동 종류를 골라 주시면, ${WARM_TAIL}`,
      };
    }
  }
  if (sk === 'knowledge') {
    return {
      cold: `이 단계에서는 모임 성격을 한 가지 선택해 주세요. \n${COLD_TAIL}`,
      warm: `모임 성격을 골라 주시면, ${WARM_TAIL}`,
    };
  }
  return {
    cold: `이 단계에서는 안내에 따라 옵션을 선택해 주세요. \n${COLD_TAIL}`,
    warm: `옵션을 골라 주시면, ${WARM_TAIL}`,
  };
}

/** Step 2 특화 카드 — `major_code`·특화 종류별 안내(콜드스타트 여부로 톤만 나눔). */
export function buildStep2SpecialtyCoachMessage(selectedCategory: Category | null, cold: boolean): string {
  if (!selectedCategory) {
    return cold
      ? `이 단계에서는 안내에 따라 옵션을 선택해 주세요. \n${COLD_TAIL}`
      : `옵션을 골라 주시면, ${WARM_TAIL}`;
  }
  const sk = resolveSpecialtyKindForCategory(selectedCategory);
  if (sk == null) {
    return cold
      ? `이 단계에서는 안내에 따라 옵션을 선택해 주세요. \n${COLD_TAIL}`
      : `옵션을 골라 주시면, ${WARM_TAIL}`;
  }
  const { cold: coldLine, warm: warmLine } = linesForSpecialty(selectedCategory, sk);
  return cold ? coldLine : warmLine;
}
