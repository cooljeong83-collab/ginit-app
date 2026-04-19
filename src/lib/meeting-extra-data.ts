import type { SpecialtyKind } from '@/src/lib/category-specialty';

export type SportIntensityLevel = 'easy' | 'normal' | 'hard';

export type SelectedMovieExtra = {
  id: string;
  title: string;
  year?: string;
  info?: string;
};

/**
 * 모임 등록 시 Firestore에 함께 저장하는 카테고리 특화 필드.
 */
export type MeetingExtraData = {
  specialtyKind: SpecialtyKind;
  movie?: SelectedMovieExtra | null;
  menuPreferences?: string[] | null;
  sportIntensity?: SportIntensityLevel | null;
};

export function buildMeetingExtraData(params: {
  kind: SpecialtyKind;
  movie: SelectedMovieExtra | null;
  menuPreferences: string[];
  sportIntensity: SportIntensityLevel;
}): MeetingExtraData {
  const { kind, movie, menuPreferences, sportIntensity } = params;
  if (kind === 'movie') {
    return { specialtyKind: 'movie', movie: movie ?? null };
  }
  if (kind === 'food') {
    return { specialtyKind: 'food', menuPreferences: menuPreferences.length ? [...menuPreferences] : null };
  }
  return { specialtyKind: 'sports', sportIntensity };
}
