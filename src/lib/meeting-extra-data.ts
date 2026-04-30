import type { SpecialtyKind } from '@/src/lib/category-specialty';

export type SportIntensityLevel = 'easy' | 'normal' | 'hard';

export type SelectedMovieExtra = {
  id: string;
  title: string;
  year?: string;
  info?: string;
  /**
   * 영화 API(KOBIS/TMDB 등)에서 확보한 원본 메타.
   * - Firestore에 그대로 저장되어, 모임 상세에서 "가진 정보 전부"를 펼쳐 보여줄 때 사용합니다.
   */
  apiMeta?: Record<string, string>;
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
  /** 첫 번째 후보(이전 단일 선택 필드와의 호환) */
  movie?: SelectedMovieExtra | null;
  /** 영화 모임 후보 전체 */
  movies?: SelectedMovieExtra[] | null;
  menuPreferences?: string[] | null;
  sportIntensity?: SportIntensityLevel | null;
};

/** Firestore에 undefined가 들어가지 않도록 영화 후보만 정제 */
function sanitizeMovieForFirestore(m: SelectedMovieExtra): SelectedMovieExtra {
  const id = String(m.id ?? '').trim() || 'movie';
  const title = String(m.title ?? '').trim() || '제목 미정';
  const out: SelectedMovieExtra = { id, title };
  if (m.year != null && String(m.year).trim() !== '') out.year = String(m.year).trim();
  if (m.info != null && String(m.info).trim() !== '') out.info = String(m.info).trim();
  if (m.apiMeta && typeof m.apiMeta === 'object' && !Array.isArray(m.apiMeta)) {
    const entries = Object.entries(m.apiMeta)
      .map(([k, v]) => [String(k).trim(), String(v ?? '').trim()] as const)
      .filter(([k, v]) => Boolean(k) && Boolean(v));
    if (entries.length > 0) out.apiMeta = Object.fromEntries(entries);
  }
  if (m.posterUrl != null && String(m.posterUrl).trim() !== '') out.posterUrl = String(m.posterUrl).trim();
  if (m.rating != null && String(m.rating).trim() !== '') out.rating = String(m.rating).trim();
  if (m.kobisRank != null && String(m.kobisRank).trim() !== '') out.kobisRank = String(m.kobisRank).trim();
  return out;
}

export function buildMeetingExtraData(params: {
  kind: SpecialtyKind;
  /** 영화 카테고리일 때 후보 목록(순서 유지) */
  movies?: SelectedMovieExtra[];
  menuPreferences: string[];
  sportIntensity: SportIntensityLevel;
}): MeetingExtraData {
  const { kind, movies, menuPreferences, sportIntensity } = params;
  if (kind === 'movie') {
    const raw = movies?.filter((x) => x != null && String(x.id ?? '').trim() !== '') ?? [];
    const list = raw.map(sanitizeMovieForFirestore);
    const first = list[0] ?? null;
    return {
      specialtyKind: 'movie',
      movie: first,
      movies: list.length > 0 ? list : null,
    };
  }
  if (kind === 'food') {
    return { specialtyKind: 'food', menuPreferences: menuPreferences.length ? [...menuPreferences] : null };
  }
  return { specialtyKind: 'sports', sportIntensity: sportIntensity ?? 'normal' };
}
