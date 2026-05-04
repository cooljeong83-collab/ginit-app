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
  /** 직전 턴 누적 — area-only 장소 + 이번 턴 venue 답을 합칠 때 사용 */
  accumulated?: Record<string, unknown>;
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

/** 업종·시설 키워드 — 지역 토큰만 있는 검색어와 구분 */
export const MEETING_CREATE_VENUE_OR_MOOD_RE =
  /(?:카페|커피숍|식당|맛집|술집|호프|포차|이자카야|와인바|루프탑|브런치|디저트|베이커리|뷔페|돈가스|스시|초밥|라멘|우동|분식|삼겹살|곱창|소갈비|돼지|한우|고기집|돈까스|파스타|피자|중식당|일식당|한식당|양식당|레스토랑|노래방|볼링|보드게임|방탈출|PC\s*방|피시방|피씨방|오락실|인터넷\s*카페|영화관|멀티플렉스|CGV|메가박스|롯데시네마|극장|시네마|공연장|콘서트홀|체육관|헬스장|풋살장|구장|골프장|연습장|스터디카페|코워킹|도서관|북카페|키즈카페|포차|이자카야|바\b|키즈|한강뷰|분위기|조용한|넓은|룸|집\b)/i;

/**
 * 누적/검색어가 역·동·구·시 등 지역만인지(업종·시설 표현 없음).
 * `영등포역`, `영등포역 근처`, `영등포구` 등.
 */
export function isAreaOnlyPlaceQuery(s: string): boolean {
  const t = s.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (MEETING_CREATE_VENUE_OR_MOOD_RE.test(t)) return false;
  return /^(?:[가-힣]{2,12}역(?:\s*(?:근처|앞|뒤|입구))?|[가-힣]{2,12}(?:동|구)|[가-힣]{2,10}(?:시|도)|[가-힣]{2,12}\s+일대|[가-힣]{2,12}\s+거리)$/.test(
    t,
  );
}

/**
 * 이전 턴 지역만 + 이번 턴 업종/가게 표현 → 하나의 검색어로 합침.
 * 이전이 지역만이 아니면 이번 값으로 덮어쓴다.
 */
export function combineMeetingCreatePlaceQuery(prev: string, next: string): string {
  const p = prev.normalize('NFKC').replace(/\s+/g, ' ').trim();
  const n = next.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!n) return p;
  if (!p) return n;
  if (!isAreaOnlyPlaceQuery(p)) return n;
  if (isAreaOnlyPlaceQuery(n)) return n;
  if (n.includes(p)) return n;
  return `${p} ${n}`.trim();
}

/**
 * Edge 패치 수신 직후: 누적에 area-only가 있으면 이번 패치의 장소와 결합.
 */
export function mergeMeetingCreatePlacePatchWithAccumulated(
  acc: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const prev = String(acc.placeAutoPickQuery ?? acc['장소'] ?? '').trim();
  const next = String(patch.placeAutoPickQuery ?? patch['장소'] ?? '').trim();
  if (!prev || !next) return patch;
  const combined = combineMeetingCreatePlaceQuery(prev, next);
  if (combined === next) return patch;
  return { ...patch, placeAutoPickQuery: combined, 장소: combined };
}

function extractPlaceAutoPickQuery(text: string): string | null {
  const t = text.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const station = /([가-힣]{2,10}역)(?=\s|$|[0-9]|에서|으로|과|와|근처|앞|뒤|입구)/.exec(t);
  if (station) {
    const rest = t.slice(station.index! + station[1]!.length).trim();
    if (rest && MEETING_CREATE_VENUE_OR_MOOD_RE.test(rest)) {
      return `${station[1]!.trim()} ${rest}`.replace(/\s+/g, ' ').trim();
    }
    return station[1]!.trim();
  }
  const dong = /([가-힣]{3,10}(?:동|구))(?=\s|$)/.exec(t);
  if (dong) {
    const rest = t.slice(dong.index! + dong[1]!.length).trim();
    if (rest && MEETING_CREATE_VENUE_OR_MOOD_RE.test(rest)) {
      return `${dong[1]!.trim()} ${rest}`.replace(/\s+/g, ' ').trim();
    }
    return dong[1]!.trim();
  }
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
  const accPrev = params.accumulated;
  if (accPrev && typeof accPrev === 'object' && !Array.isArray(accPrev)) {
    const prevPlace = String(accPrev.placeAutoPickQuery ?? accPrev['장소'] ?? '').trim();
    if (prevPlace && isAreaOnlyPlaceQuery(prevPlace)) {
      const nextCandidate = String(acc.placeAutoPickQuery ?? '').trim() || norm;
      if (nextCandidate) {
        acc.placeAutoPickQuery = combineMeetingCreatePlaceQuery(prevPlace, nextCandidate);
      }
    }
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
