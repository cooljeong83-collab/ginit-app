import type { Category } from '@/src/lib/categories';
import { resolveSpecialtyKindForCategory } from '@/src/lib/category-specialty';
import type { AgentWelcomeSnapshot, AgentWeatherMood } from '@/src/lib/agentic-guide/types';
import type { MeetingTitleSuggestionContext } from '@/src/lib/meeting-title-suggestion';

function agentWeatherMoodToTitlePhrase(m: AgentWeatherMood): string | null {
  switch (m) {
    case 'clear':
      return '맑은';
    case 'cloudy':
      return '흐린';
    case 'rain':
      return '비 오는';
    case 'wind':
      return '바람 부는';
    case 'snow':
      return '눈 오는';
    default:
      return null;
  }
}

/**
 * 모임 생성 화면 `titleSuggestionCtx`와 맞추기 위한 최소 컨텍스트 —
 * FAB 위저드 수락 시점에는 Step2 세부(영화 제목 등)가 없을 수 있어 생략 가능 필드는 비웁니다.
 */
export function buildWizardTitleSuggestionContextFromSnapshot(
  s: AgentWelcomeSnapshot,
  cat: Category,
  opts?: { menuPreferenceLabel?: string | null },
): MeetingTitleSuggestionContext {
  const specialtyKind = resolveSpecialtyKindForCategory(cat);
  const menuPref = (opts?.menuPreferenceLabel ?? '').trim();
  const menuPreferences =
    specialtyKind === 'food' && menuPref.length > 0 ? [menuPref] : undefined;
  const hint = (s.locationHint ?? '').trim();

  return {
    regionLabel: hint.length > 0 ? hint : null,
    weatherMood: agentWeatherMoodToTitlePhrase(s.weatherMood),
    majorCode: cat.majorCode ?? null,
    specialtyKind,
    menuPreferences,
  };
}
