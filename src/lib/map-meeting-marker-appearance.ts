import type { Category } from '@/src/lib/categories';
import type { Meeting } from '@/src/lib/meetings';
import { meetingCategoryDisplayLabel } from '@/src/lib/meetings';

type MapPinPaletteRow = {
  keys: readonly string[];
  accent: string;
  gradient: [string, string];
};

export const MIXED_MEETING_CLUSTER_PIN_ACCENT = '#7C3AED';

const CATEGORY_PIN_PALETTE: readonly MapPinPaletteRow[] = [
  {
    keys: ['영화', '무비', '시네마', '시네', '극장', 'ott', '넷플', '왓챠', '디즈니', 'movie', 'film'],
    accent: '#E11D48',
    gradient: ['#FB7185', '#E11D48'],
  },
  {
    keys: ['맛집', '식사', '밥', '레스토랑', '다이닝', '고기', '브런치', 'food', 'meal', 'dining'],
    accent: '#F97316',
    gradient: ['#FDBA74', '#F97316'],
  },
  {
    keys: ['카페', '커피', '디저트', '티타임', 'cafe', 'coffee', 'dessert'],
    accent: '#D97706',
    gradient: ['#FBBF24', '#D97706'],
  },
  {
    keys: ['술', '맥주', '와인', '바', '펍', 'drink', 'beer', 'wine', 'pub'],
    accent: '#B45309',
    gradient: ['#F59E0B', '#B45309'],
  },
  {
    keys: ['운동', '헬스', '짐', '피트니스', '크로스핏', '요가', '필라테스', 'fitness', 'gym', 'workout'],
    accent: '#10B981',
    gradient: ['#34D399', '#10B981'],
  },
  {
    keys: ['러닝', '런닝', '산책', '등산', '아웃도어', '하이킹', '트레킹', 'running', 'walk', 'outdoor', 'hiking'],
    accent: '#059669',
    gradient: ['#4ADE80', '#059669'],
  },
  {
    keys: ['스터디', '공부', '학습', '자격증', '회화', 'study', 'learning'],
    accent: '#2563EB',
    gradient: ['#60A5FA', '#2563EB'],
  },
  {
    keys: ['독서', '북', '북클럽', '북카페', 'book', 'reading'],
    accent: '#0F766E',
    gradient: ['#2DD4BF', '#0F766E'],
  },
  {
    keys: ['코딩', '개발', '프로그래밍', '해커톤', 'coding', 'dev', 'developer', 'programming'],
    accent: '#7C3AED',
    gradient: ['#A78BFA', '#7C3AED'],
  },
  {
    keys: ['미팅', '밋업', '네트워킹', 'meetup', 'meeting', 'networking'],
    accent: '#EC4899',
    gradient: ['#F472B6', '#EC4899'],
  },
  {
    keys: ['음악', '콘서트', '공연', '전시', '아트', '미술', 'music', 'concert', 'art', 'exhibit'],
    accent: '#A855F7',
    gradient: ['#C084FC', '#A855F7'],
  },
  {
    keys: ['게임', 'pc방', 'pcgame', '보드게임', 'e스포츠', '롤', '배그', 'game', 'esports'],
    accent: '#4F46E5',
    gradient: ['#818CF8', '#4F46E5'],
  },
  {
    keys: ['토론', '강연', '세미나', '워크숍', 'seminar', 'workshop'],
    accent: '#6366F1',
    gradient: ['#818CF8', '#6366F1'],
  },
  {
    keys: ['여행', '드라이브', '투어', '캠핑', 'travel', 'trip', 'camping'],
    accent: '#0EA5E9',
    gradient: ['#38BDF8', '#0EA5E9'],
  },
];

const FALLBACK_PIN_PALETTE: readonly [string, [string, string]][] = [
  ['#0052CC', ['#60A5FA', '#0052CC']],
  ['#FF8A00', ['#FDBA74', '#FF8A00']],
  ['#10B981', ['#34D399', '#10B981']],
  ['#A855F7', ['#C084FC', '#A855F7']],
  ['#EC4899', ['#F472B6', '#EC4899']],
  ['#0EA5E9', ['#38BDF8', '#0EA5E9']],
  ['#EAB308', ['#FACC15', '#EAB308']],
  ['#F97316', ['#FDBA74', '#F97316']],
  ['#14B8A6', ['#5EEAD4', '#14B8A6']],
  ['#6366F1', ['#818CF8', '#6366F1']],
];

function normalizePinColorText(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, '');
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function resolveCategoryPinPalette(seed: string): readonly [string, [string, string]] {
  const normalized = normalizePinColorText(seed);
  for (const row of CATEGORY_PIN_PALETTE) {
    if (row.keys.some((key) => normalized.includes(normalizePinColorText(key)))) {
      return [row.accent, row.gradient];
    }
  }
  return FALLBACK_PIN_PALETTE[hashString(normalized) % FALLBACK_PIN_PALETTE.length] ?? FALLBACK_PIN_PALETTE[0]!;
}

/**
 * 탐색 지도 모임 핀 색 — 대분류가 아니라 카테고리 자체의 라벨·id로 톤을 세분화합니다.
 */
export function getMeetingMapPinAccentColor(
  m: Meeting,
  categories: readonly Category[] | null | undefined,
): string {
  const id = (m.categoryId ?? '').trim();
  const cat = categories?.length ? categories.find((c) => String(c.id).trim() === id) ?? null : null;
  const displayLabel = meetingCategoryDisplayLabel(m, categories ?? []) ?? '';
  const seed = cat
    ? `${cat.label} ${cat.id} ${cat.emoji}`
    : `${displayLabel} ${(m.categoryLabel ?? '').trim()} ${id} ${(m.title ?? '').trim()}`;
  return resolveCategoryPinPalette(seed)[0];
}

const MAP_PIN_GRADIENT_COLORS: Record<string, [string, string]> = Object.fromEntries(
  [
    ...CATEGORY_PIN_PALETTE.map((row) => [row.accent, row.gradient] as const),
    ...FALLBACK_PIN_PALETTE,
    [MIXED_MEETING_CLUSTER_PIN_ACCENT, ['#A78BFA', MIXED_MEETING_CLUSTER_PIN_ACCENT]],
  ],
);

export function getMapPinGradientColors(accentColor: string): [string, string] {
  return MAP_PIN_GRADIENT_COLORS[accentColor] ?? [accentColor, accentColor];
}
