/** Step2 칩과 동일한 문자열 — NLU 검증·Edge 힌트용 단일 소스 */

export const WIZARD_MENU_PREFERENCE_LABELS = [
  '한식',
  '일식',
  '중식',
  '양식',
  '분식',
  '퓨전',
  '카페',
  '브런치',
  '주점·호프',
  '이자카야',
  '와인.바',
  '포차',
  '오마카세',
] as const;

/** `components/create/ActivityKindPreference.tsx` OPTIONS 와 동일 */
export const WIZARD_ACTIVITY_KIND_LABELS = [
  '러닝·조깅',
  '등산·트레킹',
  '헬스·근력',
  '요가·필라테스',
  '수영',
  '클라이밍',
  '풋살·축구',
  '배드민턴·테니스',
  '자전거·라이딩',
  '산책·워킹',
  '크로스핏',
  '댄스·에어로빅',
] as const;

export const WIZARD_GAME_KIND_LABELS = [
  '보드게임',
  '방탈출',
  '볼링',
  '노래방',
  'e스포츠',
  '콘솔',
  '당구',
  'VR체험',
  '카드게임',
  '오락실',
] as const;

export const WIZARD_PC_GAME_KIND_LABELS = [
  '델타포스',
  '발로란트',
  '리그 오브 레전드',
  '오버워치 2',
  '배틀그라운드',
  '로스트아크',
  '메이플스토리',
  '몬스터헌터 와일즈',
  '엘든 링',
  '디아블로 IV',
  'FC 온라인',
  '마인크래프트',
  '스타크래프트',
  '기타',
] as const;

export const WIZARD_FOCUS_KNOWLEDGE_LABELS = [
  '독서·스터디',
  '카공·코워킹',
  '강연·세미나',
  '워크숍·실습',
  '자격증·시험',
  '언어·회화',
  '재테크·투자',
  '커리어·멘토링',
  '글쓰기·기획',
  '취미클래스',
] as const;

export type WizardMenuPreferenceLabel = (typeof WIZARD_MENU_PREFERENCE_LABELS)[number];
export type WizardActivityKindLabel = (typeof WIZARD_ACTIVITY_KIND_LABELS)[number];
export type WizardGameKindLabel = (typeof WIZARD_GAME_KIND_LABELS)[number];
export type WizardPcGameKindLabel = (typeof WIZARD_PC_GAME_KIND_LABELS)[number];
export type WizardFocusKnowledgeLabel = (typeof WIZARD_FOCUS_KNOWLEDGE_LABELS)[number];

function norm(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

const MIDDLE_DOT = '\u00B7';

function haystackHasWizardPart(haystackNorm: string, partNorm: string): boolean {
  if (!partNorm) return false;
  if (haystackNorm === partNorm) return true;
  if (partNorm.length < 2) return haystackNorm === partNorm;
  return haystackNorm.includes(partNorm);
}

/**
 * `·`로 잇는 칩 라벨: 전체 문구 일치·포함 또는 **분절(· 기준) 토큰**이 입력/발화에 포함되면 해당 칩으로 정규화.
 * 복합 라벨에 대해 `opt.includes(입력)`만 쓰면 `재테크·투자`에 `테크`가 걸리는 등 오탐이 나므로, `·`가 있을 때는 분절 매칭만 사용합니다.
 */
export function matchesWizardOptionPhrase(inputNorm: string, optionNorm: string): boolean {
  if (!inputNorm || !optionNorm) return false;
  if (inputNorm === optionNorm) return true;
  if (inputNorm.includes(optionNorm)) return true;
  if (optionNorm.includes(MIDDLE_DOT)) {
    const parts = optionNorm.split(MIDDLE_DOT).map((p) => norm(p)).filter(Boolean);
    for (const part of parts) {
      if (haystackHasWizardPart(inputNorm, part)) return true;
    }
    return false;
  }
  return optionNorm.includes(inputNorm);
}

function coerceWizardLabelList<T extends string>(raw: string | null | undefined, options: readonly T[]): T | null {
  const t = norm(String(raw ?? ''));
  if (!t) return null;
  for (const opt of options) {
    const o = norm(opt);
    if (!o) continue;
    if (matchesWizardOptionPhrase(t, o)) return opt;
  }
  return null;
}

/** 정확 일치 또는 부분 일치로 칩 라벨 하나로 정규화(엣지·로컬 NLU 관용) */
export function coerceWizardMenuPreferenceLabel(raw: string | null | undefined): WizardMenuPreferenceLabel | null {
  return coerceWizardLabelList(raw, WIZARD_MENU_PREFERENCE_LABELS);
}

export function coerceWizardActivityKindLabel(raw: string | null | undefined): WizardActivityKindLabel | null {
  return coerceWizardLabelList(raw, WIZARD_ACTIVITY_KIND_LABELS);
}

/**
 * 제목·장소·일정 문구 등에서 활동 칩 추론(모델이 `activityKindLabel` 을 비울 때 `peek`/`parse` 보완).
 * 키워드 순서는 더 구체적인 활동을 우선합니다.
 */
export function inferWizardActivityKindFromHaystack(raw: string | null | undefined): WizardActivityKindLabel | null {
  const t = norm(String(raw ?? ''));
  if (!t) return null;
  if (/(러닝|런닝|조깅|마라톤|조그)/.test(t)) return '러닝·조깅';
  if (/(등산|트레킹|하이킹)/.test(t)) return '등산·트레킹';
  if (/(헬스|근력|웨이트)/.test(t)) return '헬스·근력';
  if (/(요가|필라테스)/.test(t)) return '요가·필라테스';
  if (/수영/.test(t)) return '수영';
  if (/(클라이밍|볼더)/.test(t)) return '클라이밍';
  if (/(풋살|축구)/.test(t)) return '풋살·축구';
  if (/(배드민턴|테니스)/.test(t)) return '배드민턴·테니스';
  if (/(자전거|라이딩|사이클)/.test(t)) return '자전거·라이딩';
  if (/(산책|워킹)/.test(t)) return '산책·워킹';
  if (/크로스핏/.test(t)) return '크로스핏';
  if (/(댄스|에어로빅)/.test(t)) return '댄스·에어로빅';
  for (const opt of WIZARD_ACTIVITY_KIND_LABELS) {
    if (matchesWizardOptionPhrase(t, norm(opt))) return opt;
  }
  return null;
}

/** Edge `activityKindLabel` 우선, 없으면 제목·장소·일정 문구에서 추론 */
export function resolveWizardActivityKindLabel(
  activityKindLabelField: string | null | undefined,
  haystack: string,
): WizardActivityKindLabel | null {
  return coerceWizardActivityKindLabel(activityKindLabelField) ?? inferWizardActivityKindFromHaystack(haystack);
}

export function coerceWizardGameKindLabel(raw: string | null | undefined): WizardGameKindLabel | null {
  return coerceWizardLabelList(raw, WIZARD_GAME_KIND_LABELS);
}

export function coerceWizardPcGameKindLabel(raw: string | null | undefined): WizardPcGameKindLabel | null {
  return coerceWizardLabelList(raw, WIZARD_PC_GAME_KIND_LABELS);
}

export function coerceWizardFocusKnowledgeLabel(raw: string | null | undefined): WizardFocusKnowledgeLabel | null {
  return coerceWizardLabelList(raw, WIZARD_FOCUS_KNOWLEDGE_LABELS);
}
