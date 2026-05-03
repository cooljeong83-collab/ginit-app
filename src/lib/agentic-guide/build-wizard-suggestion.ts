import type { Category } from '@/src/lib/categories';
import { categoryNeedsSpecialty, resolveSpecialtyKindForCategory } from '@/src/lib/category-specialty';

import type { AgentWelcomeSnapshot, WizardSuggestion } from '@/src/lib/agentic-guide/types';
import { isColdStartForAgentSnapshot } from '@/src/lib/agentic-guide/cold-start';
import { summarizeRecentMeetings } from '@/src/lib/agentic-guide/summarize-recent-meetings';

function pickMenuLabelForFood(topLabel: string | null): string {
  const L = (topLabel ?? '').toLowerCase();
  if (/카페|커피|디저트|티타임|브런치/.test(L)) return '카페';
  if (/일식|스시|라멘|돈까스/.test(L)) return '일식';
  if (/중식|마라|짜장/.test(L)) return '중식';
  if (/양식|파스타|스테이크/.test(L)) return '양식';
  if (/술|호프|포차|이자카야|바/.test(L)) return '주점·호프';
  return '한식';
}

function findCategoryIdForLabel(categories: Category[], label: string): Category | null {
  const t = label.trim();
  if (!t) return null;
  const exact = categories.find((c) => c.label.trim() === t);
  if (exact) return exact;
  return categories.find((c) => c.label.includes(t) || t.includes(c.label.trim())) ?? null;
}

function pickCategoryFromSnapshot(categories: Category[], s: AgentWelcomeSnapshot): Category | null {
  if (categories.length === 0) return null;
  const h = s.meetingHabits;
  if (
    h?.weekendTopCategoryLabel &&
    h.weekendTopCategoryCount >= 2 &&
    (h.weekendDayPortion ?? 0) >= 0.35
  ) {
    const hit = findCategoryIdForLabel(categories, h.weekendTopCategoryLabel);
    if (hit) return hit;
  }
  for (const m of s.recentMeetings.slice(0, 15)) {
    const cid = (m.categoryId ?? '').trim();
    if (cid) {
      const hit = categories.find((c) => c.id === cid);
      if (hit) return hit;
    }
  }
  const sum = s.recentSummary ?? summarizeRecentMeetings(s.recentMeetings);
  const top = sum?.topCategoryLabels?.[0];
  if (top) {
    const hit = findCategoryIdForLabel(categories, top);
    if (hit) return hit;
  }
  return categories[0] ?? null;
}

/**
 * 수락 시 적용할 카테고리·메뉴 추천.
 */
export function buildWizardSuggestion(categories: Category[], s: AgentWelcomeSnapshot): WizardSuggestion | null {
  if (isColdStartForAgentSnapshot(s)) return null;
  if ((s.recentMeetings?.length ?? 0) === 0) return null;
  const cat = pickCategoryFromSnapshot(categories, s);
  if (!cat) return null;
  const sk = resolveSpecialtyKindForCategory(cat);
  const needs = categoryNeedsSpecialty(cat);
  const food = sk === 'food';
  const menu = food ? pickMenuLabelForFood(sumTopLabel(s)) : null;
  const canAuto = !needs || (food && Boolean(menu));
  const topP = s.meetingHabits?.topPlaces?.[0];
  const placeSearchHint =
    topP && (topP.score ?? 0) >= 2 && topP.searchQuery.trim().length > 0 ? topP.searchQuery.trim() : null;
  return {
    categoryId: cat.id,
    categoryLabel: cat.label,
    menuPreferenceLabel: menu,
    canAutoCompleteThroughStep3: canAuto,
    placeSearchHint: placeSearchHint,
  };
}

function sumTopLabel(s: AgentWelcomeSnapshot): string | null {
  return s.recentSummary?.topCategoryLabels?.[0] ?? null;
}
