/**
 * TMDB v3 — 제목 검색으로 포스터 URL 조회 (KOBIS 박스오피스 행 보강용)
 * https://developer.themoviedb.org/reference/search-movie
 *
 * 이미지 베이스: `https://image.tmdb.org/t/p/w500` + `poster_path`
 *
 * `EXPO_PUBLIC_TMDB_API_KEY`(또는 `app.config` extra `tmdbApiKey`) 필요.
 */
import { publicEnv } from '@/src/config/public-env';
import type { SelectedMovieExtra } from '@/src/lib/meeting-extra-data';

const TMDB_SEARCH_URL = 'https://api.themoviedb.org/3/search/movie';
export const TMDB_POSTER_W500_BASE = 'https://image.tmdb.org/t/p/w500';

type TmdbMovieHit = {
  poster_path?: string | null;
  original_title?: string | null;
  title?: string | null;
};

type TmdbSearchJson = {
  results?: TmdbMovieHit[];
};

export function getTmdbApiKey(): string {
  return (
    publicEnv.tmdbApiKey?.trim() ||
    process.env.EXPO_PUBLIC_TMDB_API_KEY?.trim() ||
    process.env.TMDB_API_KEY?.trim() ||
    ''
  );
}

export function tmdbPosterUrlFromPath(posterPath: string | null | undefined): string | undefined {
  if (posterPath == null || typeof posterPath !== 'string' || !posterPath.startsWith('/')) return undefined;
  return `${TMDB_POSTER_W500_BASE}${posterPath}`;
}

async function searchTmdbMovies(
  key: string,
  query: string,
  language: string,
  year?: string,
  region?: string,
): Promise<TmdbMovieHit[]> {
  const q = query.trim();
  if (!q) return [];
  const params = new URLSearchParams({
    api_key: key,
    query: q,
    language,
    include_adult: 'false',
  });
  if (region) params.set('region', region);
  if (year && /^\d{4}$/.test(year)) params.set('year', year);

  try {
    const res = await fetch(`${TMDB_SEARCH_URL}?${params.toString()}`, { method: 'GET' });
    const json = (await res.json()) as TmdbSearchJson;
    return Array.isArray(json.results) ? json.results : [];
  } catch {
    return [];
  }
}

/** 결과 배열에서 `poster_path`가 있는 첫 항목 URL (없으면 undefined) */
function firstPosterUrlFromHits(hits: TmdbMovieHit[]): string | undefined {
  for (const h of hits) {
    const u = tmdbPosterUrlFromPath(h.poster_path);
    if (u) return u;
  }
  return undefined;
}

function latinTitleCandidate(title: string): string | undefined {
  const m = title.match(/[A-Za-z0-9][A-Za-z0-9\s:'’.\-]{1,80}/);
  const s = m?.[0]?.trim();
  if (!s || s.length < 2) return undefined;
  if (s === title.trim()) return undefined;
  return s;
}

/**
 * 한국어 검색 → 포스터 없으면 동일 제목 영어권 검색 → 그래도 없으면 `original_title`·라틴 구간으로 재검색.
 */
export async function fetchTmdbPosterUrl(title: string, year?: string): Promise<string | undefined> {
  const key = getTmdbApiKey();
  if (!key || !title.trim()) return undefined;

  const koHits = await searchTmdbMovies(key, title, 'ko-KR', year, 'KR');
  let url = firstPosterUrlFromHits(koHits);
  if (url) return url;

  const enHitsSameQuery = await searchTmdbMovies(key, title, 'en-US', year, undefined);
  url = firstPosterUrlFromHits(enHitsSameQuery);
  if (url) return url;

  const alt =
    koHits[0]?.original_title?.trim() ||
    enHitsSameQuery[0]?.original_title?.trim() ||
    latinTitleCandidate(title);
  if (alt && alt !== title.trim()) {
    const enHitsAlt = await searchTmdbMovies(key, alt, 'en-US', year, undefined);
    url = firstPosterUrlFromHits(enHitsAlt);
    if (url) return url;
  }

  return undefined;
}

export async function enrichMoviesWithTmdbPosters(movies: SelectedMovieExtra[]): Promise<SelectedMovieExtra[]> {
  if (!getTmdbApiKey()) return movies;
  return Promise.all(
    movies.map(async (m) => {
      const posterUrl = await fetchTmdbPosterUrl(m.title, m.year);
      return posterUrl ? { ...m, posterUrl } : m;
    }),
  );
}
