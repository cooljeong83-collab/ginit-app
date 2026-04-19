import type { Category } from '@/src/lib/categories';

export type SpecialtyKind = 'movie' | 'food' | 'sports';

/**
 * Firestore 카테고리 `label` 기준으로 Step 2~3 사이 특화 카드 종류를 결정합니다.
 * (우선순위: 영화 → 맛집/카페 → 운동)
 */
export function resolveSpecialtyKind(label: string): SpecialtyKind | null {
  const L = label.trim();
  if (!L) return null;
  if (/영화|무비|시네마|시네|극장|OTT|넷플|왓챠|디즈니/.test(L)) return 'movie';
  if (/맛집|식사|레스토랑|밥|먹거리|고기|회식|식당|카페|커피|디저트|티타임|브런치/.test(L)) {
    return 'food';
  }
  if (/운동|헬스|러닝|런닝|등산|요가|헬창|짐|스포츠|크로스핏|수영/.test(L)) return 'sports';
  return null;
}

export function categoryNeedsSpecialty(category: Category | null): boolean {
  if (!category?.label) return false;
  return resolveSpecialtyKind(category.label) != null;
}

export function specialtyStepBadge(kind: SpecialtyKind): string {
  switch (kind) {
    case 'movie':
      return '3 · 영화 선택';
    case 'food':
      return '3 · 메뉴 성향';
    case 'sports':
      return '3 · 운동 강도';
    default:
      return '3 · 추가 정보';
  }
}
