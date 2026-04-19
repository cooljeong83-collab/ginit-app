import type { SpecialtyKind } from '@/src/lib/category-specialty';

export type SportIntensityLevel = 'easy' | 'normal' | 'hard';

export type SelectedMovieExtra = {
  id: string;
  title: string;
  year?: string;
  info?: string;
  /** 포스터(표시용, TMDB 등 HTTPS URL) */
  posterUrl?: string;
  /** 평점·관객수 등 짧은 뱃지 텍스트 */
  rating?: string;
  /** KOBIS 일별 박스오피스 `rank` (1~10 등) */
  kobisRank?: string;
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
