import { GinitTheme } from '@/constants/ginit-theme';
import type { Category } from '@/src/lib/categories';
import { resolveSpecialtyKind, resolveSpecialtyKindForCategory } from '@/src/lib/category-specialty';
import type { Meeting } from '@/src/lib/meetings';
import { meetingCategoryDisplayLabel } from '@/src/lib/meetings';

/**
 * 탐색 지도 모임 핀 색 — `major_code`·라벨로 특화를 추정해 톤을 맞춥니다.
 */
export function getMeetingMapPinAccentColor(
  m: Meeting,
  categories: readonly Category[] | null | undefined,
): string {
  const id = (m.categoryId ?? '').trim();
  const cat = categories?.length ? categories.find((c) => String(c.id).trim() === id) ?? null : null;
  const labelHint =
    meetingCategoryDisplayLabel(m, categories ?? []) ?? (m.categoryLabel ?? '').trim() ?? (m.title ?? '').trim();
  const kind =
    resolveSpecialtyKindForCategory(cat) ??
    resolveSpecialtyKind(labelHint) ??
    resolveSpecialtyKind((m.categoryLabel ?? '').trim()) ??
    resolveSpecialtyKind((m.title ?? '').trim());
  switch (kind) {
    case 'movie':
      return GinitTheme.colors.danger;
    case 'food':
      return GinitTheme.colors.warning;
    case 'sports':
      return GinitTheme.colors.genderSymbolMale;
    case 'knowledge':
      return GinitTheme.themeMainColor;
    default:
      return GinitTheme.colors.success;
  }
}

const MAP_PIN_GRADIENT_COLORS: Record<string, [string, string]> = {
  [GinitTheme.colors.danger]: ['#F87171', GinitTheme.colors.danger],
  [GinitTheme.colors.warning]: ['#FBBF24', GinitTheme.colors.warning],
  [GinitTheme.colors.genderSymbolMale]: ['#60A5FA', GinitTheme.colors.genderSymbolMale],
  [GinitTheme.themeMainColor]: ['#8B5CF6', GinitTheme.themeMainColor],
  [GinitTheme.colors.success]: ['#4ADE80', GinitTheme.colors.success],
};

export function getMapPinGradientColors(accentColor: string): [string, string] {
  return MAP_PIN_GRADIENT_COLORS[accentColor] ?? [accentColor, accentColor];
}
