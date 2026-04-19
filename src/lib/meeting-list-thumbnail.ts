import { resolveSpecialtyKind } from '@/src/lib/category-specialty';
import type { MeetingExtraData, SelectedMovieExtra } from '@/src/lib/meeting-extra-data';
import type { Meeting } from '@/src/lib/meetings';

/** 일반 모임(카테고리 불명·기본) */
export const MEETING_LIST_THUMB_DEFAULT =
  'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=400&h=400&fit=crop&q=80';

const THUMB_MOVIE_FALLBACK =
  'https://images.unsplash.com/photo-1489599849927-2ee91cede142?w=400&h=400&fit=crop&q=80';
const THUMB_FOOD =
  'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=400&h=400&fit=crop&q=80';
const THUMB_SPORTS =
  'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=400&h=400&fit=crop&q=80';

function isHttpsImageUrl(s: string): boolean {
  const t = s.trim();
  return /^https:\/\//i.test(t);
}

function firstSelectedMovie(extra: unknown): SelectedMovieExtra | null {
  if (!extra || typeof extra !== 'object') return null;
  const e = extra as MeetingExtraData & { movies?: SelectedMovieExtra[] | null; movie?: SelectedMovieExtra | null };
  const list = Array.isArray(e.movies) ? e.movies.filter(Boolean) : [];
  if (list.length > 0) return list[0] ?? null;
  if (e.movie && typeof e.movie === 'object') return e.movie;
  return null;
}

function posterFromExtra(extra: unknown): string | null {
  const m0 = firstSelectedMovie(extra);
  const u = m0?.posterUrl?.trim();
  if (u && isHttpsImageUrl(u)) return u;
  return null;
}

function specialtyFromMeeting(m: Meeting): 'movie' | 'food' | 'sports' | null {
  const raw = m.extraData;
  if (raw && typeof raw === 'object' && 'specialtyKind' in raw) {
    const sk = (raw as MeetingExtraData).specialtyKind;
    if (sk === 'movie' || sk === 'food' || sk === 'sports') return sk;
  }
  return resolveSpecialtyKind(m.categoryLabel ?? '');
}

/**
 * 피드·그리드 썸네일용 이미지 URL.
 * - 영화: 선택된 첫 영화 `posterUrl`, 없으면 영화 분위기 기본 이미지
 * - 맛집/식사/카페: 식사 톤 이미지
 * - 운동: 스포츠 톤 이미지
 * - 그 외: `imageUrl`이 있으면 사용, 없으면 기본 모임 이미지
 */
export function resolveMeetingListThumbnailUri(m: Meeting): string {
  const poster = posterFromExtra(m.extraData);
  if (poster) return poster;

  const spec = specialtyFromMeeting(m);
  if (spec === 'movie') {
    return THUMB_MOVIE_FALLBACK;
  }
  if (spec === 'food') {
    return THUMB_FOOD;
  }
  if (spec === 'sports') {
    return THUMB_SPORTS;
  }

  const custom = m.imageUrl?.trim();
  if (custom && isHttpsImageUrl(custom)) return custom;

  return MEETING_LIST_THUMB_DEFAULT;
}
