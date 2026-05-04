import type { Category } from '@/src/lib/categories';
import { getUtteranceKeywordHintsForSpecialty, resolveSpecialtyKindForCategory } from '@/src/lib/category-specialty';

import {
  findMeetingCreateNluRegistryRow,
  MEETING_CREATE_NLU_REGISTRY,
  registryUtteranceKeywordBonus,
} from '@/src/lib/meeting-create-nlu/meeting-create-category-registry';

function normalizeUtteranceForMatch(raw: string): string {
  return raw.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

/** 라벨을 `·/&|,` 및 공백으로 쪼갠 토큰 + 연속 공백 제거한 전체(2자 이상만). */
function labelKeywordTokens(label: string): string[] {
  const L = label.normalize('NFKC').trim();
  if (!L) return [];
  const set = new Set<string>();
  for (const part of L.split(/[·•/&|,]+|\s+/u)) {
    const p = part.trim();
    if (p.length >= 2) set.add(p);
  }
  const compact = L.replace(/\s+/g, '');
  if (compact.length >= 2) set.add(compact);
  return [...set];
}

type CatScore = {
  category: Category;
  score: number;
  maxKwLen: number;
  /** 레지스트리 동점 시 낮을수록 우선 */
  registryTie: number;
};

function uniqueKeywordsForCategory(category: Category): string[] {
  const set = new Set<string>();
  for (const kw of labelKeywordTokens(category.label)) {
    if (kw.length >= 2) set.add(kw);
  }
  const sk = resolveSpecialtyKindForCategory(category);
  if (sk) {
    for (const kw of getUtteranceKeywordHintsForSpecialty(sk)) {
      if (kw.length >= 2) set.add(kw);
    }
  }
  return [...set];
}

function scoreCategory(textNorm: string, category: Category): CatScore {
  let score = 0;
  let maxKwLen = 0;
  for (const kw of uniqueKeywordsForCategory(category)) {
    if (textNorm.includes(kw)) {
      score += kw.length;
      maxKwLen = Math.max(maxKwLen, kw.length);
    }
  }
  score += registryUtteranceKeywordBonus(textNorm, category);
  const reg = findMeetingCreateNluRegistryRow(category);
  if (reg) {
    for (const kw of reg.utteranceKeywords) {
      const k = kw.normalize('NFKC').trim();
      if (k.length >= 2 && textNorm.includes(k)) maxKwLen = Math.max(maxKwLen, k.length);
    }
  }
  return { category, score, maxKwLen, registryTie: reg?.tieBreakOrder ?? 999 };
}

/**
 * 현재 로드된 카테고리 화이트리스트에서 발화와 가장 잘 맞는 한 행.
 * 동점: 총점 → 더 긴 일치 키워드 → 레지스트리 tieBreak → `order` 오름차순 → `label` ko 로케일 비교.
 */
export function inferMeetingCreateCategoryFromUtterance(text: string, categories: Category[]): Category | null {
  const textNorm = normalizeUtteranceForMatch(text);
  if (!textNorm) return null;

  const rows: CatScore[] = [];
  for (const c of categories) {
    const row = scoreCategory(textNorm, c);
    if (row.score > 0) rows.push(row);
  }
  if (rows.length === 0) return null;

  rows.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.maxKwLen !== a.maxKwLen) return b.maxKwLen - a.maxKwLen;
    if (a.registryTie !== b.registryTie) return a.registryTie - b.registryTie;
    if (a.category.order !== b.category.order) return a.category.order - b.category.order;
    return a.category.label.localeCompare(b.category.label, 'ko');
  });

  return rows[0]!.category;
}

/** 점수가 안 나와도 레지스트리 키워드(번개·소개팅 등)로 id가 있으면 해당 카테고리를 고른다 */
export function fallbackMeetingCreateCategoryFromRegistryKeywords(
  text: string,
  categories: Category[],
): Category | null {
  const textNorm = normalizeUtteranceForMatch(text);
  if (!textNorm) return null;
  for (const row of MEETING_CREATE_NLU_REGISTRY) {
    const hit = row.utteranceKeywords.some((kw) => {
      const k = kw.normalize('NFKC').trim();
      return k.length >= 2 && textNorm.includes(k);
    });
    if (!hit) continue;
    for (const id of row.categoryIds) {
      const idt = id.trim();
      if (!idt) continue;
      const c = categories.find((x) => x.id.trim() === idt);
      if (c) return c;
    }
  }
  return null;
}
