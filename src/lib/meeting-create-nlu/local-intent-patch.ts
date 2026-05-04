import type { Category } from '@/src/lib/categories';
import {
  categoryNeedsSpecialty,
  isActiveLifeMajorCode,
  resolveSpecialtyKindForCategory,
} from '@/src/lib/category-specialty';
import {
  fallbackMeetingCreateCategoryFromRegistryKeywords,
  inferMeetingCreateCategoryFromUtterance,
} from '@/src/lib/meeting-create-nlu/category-from-utterance';
import {
  MEETING_CREATE_COFFEE_CATEGORY_ID,
} from '@/src/lib/meeting-create-nlu/meeting-create-category-registry';
import { inferMeetingCreateHeadcountFromKoreanText } from '@/src/lib/meeting-create-nlu/infer-headcount-from-korean-text';
import {
  coerceWizardMenuPreferenceLabel,
  inferWizardActivityKindFromHaystack,
} from '@/src/lib/meeting-create-nlu/wizard-specialty-chip-options';
import { inferSuggestedIsPublicFromMeetingCreateText } from '@/src/lib/meeting-create-nlu/public-private-guide';
import { parseSmartNaturalSchedule } from '@/src/lib/natural-language-schedule';

export const LOCAL_MEETING_CREATE_NLU_MAX_CHARS = 80;
/** 과거 스킵 임계값(호환용 export). */
export const LOCAL_MEETING_CREATE_NLU_MIN_CHARS_FOR_EDGE = 10;

export type BuildLocalMeetingCreateNluPatchParams = {
  text: string;
  categories: Category[];
  now: Date;
};

export function normalizeLocalMeetingCreateTextForLength(raw: string): string {
  return raw.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

const MENU_TOKEN_RE =
  /^(한식|일식|중식|양식|카페|주점|호프|주점·호프)(?:\s|이랑|으로|만)?$/u;
const MENU_PREFIX_RE = /^(한식|일식|중식|양식|카페|주점|호프)\b/u;

function normalizeMenuPreferenceLabel(raw: string): string | null {
  const t = raw.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const exact = MENU_TOKEN_RE.exec(t);
  if (exact) {
    const m = exact[1] ?? '';
    if (m === '주점' || m === '호프') return '주점·호프';
    return m;
  }
  const pre = MENU_PREFIX_RE.exec(t);
  if (pre) {
    const m = pre[1] ?? '';
    if (m === '주점' || m === '호프') return '주점·호프';
    return m;
  }
  return null;
}

function firstFoodCategory(categories: Category[]): Category | null {
  for (const c of categories) {
    if (resolveSpecialtyKindForCategory(c) === 'food' && categoryNeedsSpecialty(c)) {
      return c;
    }
  }
  for (const c of categories) {
    if (resolveSpecialtyKindForCategory(c) === 'food') {
      return c;
    }
  }
  return null;
}

function extractPlaceAutoPickQuery(text: string): string | null {
  const t = text.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const station = /([가-힣]{2,10}역)(?=\s|$|[0-9]|에서|으로|과|와|근처|앞|뒤|입구)/.exec(t);
  if (station) return station[1]!.trim();
  const dong = /([가-힣]{3,10}(?:동|구))(?=\s|$)/.exec(t);
  if (dong) return dong[1]!.trim();
  if (
    /(?:카페|포차|이자카야|바\b|키즈|브런치|루프탑|한강뷰|분위기|조용한|넓은|룸)/.test(t)
  ) {
    return t;
  }
  const pcBang = /(피시방|피씨방|PC\s*방|pc\s*방|오락실|인터넷\s*카페)/i.exec(t);
  if (pcBang) {
    return pcBang[1]!.replace(/\s+/g, ' ').trim();
  }
  const cinema = /(영화관|멀티플렉스|CGV|cgv|메가박스|롯데시네마|극장)/i.exec(t);
  if (cinema) {
    return cinema[1]!.replace(/\s+/g, ' ').trim();
  }
  return null;
}

/**
 * 짧은 발화용 로컬 패치. 비어 있으면 Edge 호출로 폴백.
 */
export function buildLocalMeetingCreateNluPatch(params: BuildLocalMeetingCreateNluPatchParams): Record<string, unknown> {
  const acc: Record<string, unknown> = {};
  const raw = params.text;
  const norm = normalizeLocalMeetingCreateTextForLength(raw);
  const { categories, now } = params;

  const hc = inferMeetingCreateHeadcountFromKoreanText(raw);
  if (hc) {
    acc.minParticipants = hc.minParticipants;
    acc.maxParticipants = hc.maxParticipants;
  }

  const sched = parseSmartNaturalSchedule(raw, now);
  if (sched?.candidate?.type === 'point') {
    const sd = String(sched.candidate.startDate ?? '').trim();
    const st = String(sched.candidate.startTime ?? '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(sd)) {
      acc.scheduleYmd = sd;
      acc.scheduleHm = /^\d{2}:\d{2}$/.test(st) ? st : '19:00';
    }
  }

  const placeQ = extractPlaceAutoPickQuery(raw);
  if (placeQ) {
    acc.placeAutoPickQuery = placeQ;
  }

  const fromUtterance =
    inferMeetingCreateCategoryFromUtterance(raw, categories) ??
    fallbackMeetingCreateCategoryFromRegistryKeywords(raw, categories);
  if (fromUtterance) {
    acc.categoryId = fromUtterance.id.trim();
    acc.categoryLabel = fromUtterance.label.trim();
  }

  const bungaeLike = /(?:번개|벙개|술번개|소개팅|미팅|첫\s*만남)/.test(norm);
  const ratioLike = /\d\s*[대:]\s*\d/.test(norm);
  if (bungaeLike && ratioLike) {
    const curId = typeof acc.categoryId === 'string' ? acc.categoryId.trim() : '';
    const curCat = curId ? categories.find((c) => c.id.trim() === curId) ?? null : null;
    const curFood = curCat != null && resolveSpecialtyKindForCategory(curCat) === 'food';
    if (curFood && (acc.menuPreferenceLabel == null || String(acc.menuPreferenceLabel).trim() === '')) {
      acc.menuPreferenceLabel = '주점·호프';
    }
  }

  const coffeeCat = categories.find((c) => c.id.trim() === MEETING_CREATE_COFFEE_CATEGORY_ID) ?? null;
  const hasCoffeeIntent = /(?:커피|라떼|아메리카노|바닐라|디저트|티타임|차\s*마실)/.test(norm);
  const hasStrongMealIntent = /(?:밥|식사|회식|맛집|한식|중식|일식|양식|고기|뷔페|저녁\s*먹|점심\s*먹)/.test(norm);
  if (coffeeCat && hasCoffeeIntent && !hasStrongMealIntent) {
    acc.categoryId = coffeeCat.id.trim();
    acc.categoryLabel = coffeeCat.label.trim();
    if (acc.menuPreferenceLabel == null || String(acc.menuPreferenceLabel).trim() === '') {
      acc.menuPreferenceLabel = '카페';
    }
  }

  const menu = normalizeMenuPreferenceLabel(norm);
  if (menu) {
    acc.menuPreferenceLabel = menu;
    const curId = typeof acc.categoryId === 'string' ? acc.categoryId.trim() : '';
    const curCat = curId ? categories.find((c) => c.id.trim() === curId) ?? null : null;
    const curIsFood = curCat != null && resolveSpecialtyKindForCategory(curCat) === 'food';
    if (!curIsFood) {
      const food = firstFoodCategory(categories);
      if (food) {
        acc.categoryId = food.id.trim();
        acc.categoryLabel = food.label.trim();
      }
    }
  }

  const menuFromPhrase = coerceWizardMenuPreferenceLabel(raw);
  if (menuFromPhrase && (acc.menuPreferenceLabel == null || String(acc.menuPreferenceLabel).trim() === '')) {
    acc.menuPreferenceLabel = menuFromPhrase;
    const curId2 = typeof acc.categoryId === 'string' ? acc.categoryId.trim() : '';
    const curCat2 = curId2 ? categories.find((c) => c.id.trim() === curId2) ?? null : null;
    const curIsFood2 = curCat2 != null && resolveSpecialtyKindForCategory(curCat2) === 'food';
    if (!curIsFood2) {
      const food = firstFoodCategory(categories);
      if (food) {
        acc.categoryId = food.id.trim();
        acc.categoryLabel = food.label.trim();
      }
    }
  }

  const pub = inferSuggestedIsPublicFromMeetingCreateText(raw);
  if (pub !== null) {
    acc.suggestedIsPublic = pub;
  }

  const catForActivity =
    typeof acc.categoryId === 'string' ? categories.find((c) => c.id.trim() === acc.categoryId.trim()) : null;
  if (
    catForActivity &&
    categoryNeedsSpecialty(catForActivity) &&
    resolveSpecialtyKindForCategory(catForActivity) === 'sports' &&
    isActiveLifeMajorCode(catForActivity.majorCode)
  ) {
    const inferredAct = inferWizardActivityKindFromHaystack(norm);
    const curAct = typeof acc.activityKindLabel === 'string' ? acc.activityKindLabel.trim() : '';
    if (inferredAct && curAct === '') {
      acc.activityKindLabel = inferredAct;
    }
  }

  return acc;
}

function isEmptyNluMergeValue(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string' && v.trim() === '') return true;
  if (typeof v === 'number' && !Number.isFinite(v)) return true;
  return false;
}

/**
 * Edge 응답을 우선하되, 값이 비어 있으면 로컬 휴리스틱(`buildLocalMeetingCreateNluPatch`)으로 보강.
 * Edge만 쓰면 "내일 영등포역 …" 같은 로컬 추출이 버려져 결손 안내가 잘못 뜨는 문제를 막는다.
 */
export function fillMeetingCreateNluPatchFromLocalEdge(
  edge: Record<string, unknown>,
  local: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...edge };
  for (const [k, v] of Object.entries(local)) {
    if (isEmptyNluMergeValue(v)) continue;
    if (isEmptyNluMergeValue(out[k])) out[k] = v;
  }
  return out;
}

/** 항상 Edge(Groq Llama) 의도 분석을 호출한다(문자·숫자·짧은 발화와 무관). */
export function shouldSkipEdgeNluForMeetingCreate(_rawText: string, _patch: Record<string, unknown>): boolean {
  return false;
}
