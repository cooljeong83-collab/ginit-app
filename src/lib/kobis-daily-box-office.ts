/**
 * 영화진흥위원회(KOBIS) 오픈API — 일별 박스오피스
 * https://www.kobis.or.kr/kobisopenapi/home/main/apis/visit.do?searchAPI=searchDailyBoxOfficeList
 *
 * `EXPO_PUBLIC_KOBIS_KEY`(또는 `env/.env`의 `KOBIS_KEY` → app.config `kobisKey`) 발급 필요.
 */
import type { SelectedMovieExtra } from '@/src/lib/meeting-extra-data';

import { publicEnv } from '@/src/config/public-env';

const KOBIS_BOXOFFICE_URL =
  'https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchDailyBoxOfficeList.json';

export type KobisDailyBoxOfficeRow = {
  movieCd: string;
  movieNm: string;
  openDt: string;
  rank: string;
  salesShare: string;
  audiCnt: string;
  audiAcc: string;
  scrnCnt?: string;
  showCnt?: string;
};

type KobisSuccessJson = {
  boxOfficeResult?: {
    dailyBoxOfficeList?: KobisDailyBoxOfficeRow[];
  };
};

type KobisFaultJson = {
  faultCode?: string;
  faultString?: string;
};

/** 특정 시각을 서울 타임존 기준 `YYYYMMDD`로 표현 */
export function formatYmdInSeoul(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const m = parts.find((p) => p.type === 'month')?.value ?? '01';
  const day = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${y}${m}${day}`;
}

/** 현재 시각 기준 N일 전 시각을 서울 달력으로 `YYYYMMDD` */
export function seoulYmdDaysAgo(daysAgo: number): string {
  return formatYmdInSeoul(new Date(Date.now() - daysAgo * 86400000));
}

function intString(n: string | undefined): string {
  if (n == null || n.trim() === '') return '0';
  const v = Number.parseInt(n.replace(/,/g, ''), 10);
  if (!Number.isFinite(v)) return n;
  return v.toLocaleString('ko-KR');
}

function mapRowToMovie(row: KobisDailyBoxOfficeRow): SelectedMovieExtra {
  const open = row.openDt?.trim() ?? '';
  const year = open.length >= 4 ? open.slice(0, 4) : undefined;
  const share = row.salesShare?.trim() ?? '';
  const shareNum = Number.parseFloat(share.replace('%', ''));
  const ratingLabel = Number.isFinite(shareNum) ? `${shareNum.toFixed(1)}%` : share || '—';
  const rk = row.rank?.trim() ?? '';

  return {
    id: row.movieCd,
    title: row.movieNm.trim(),
    year,
    rating: ratingLabel,
    posterUrl: undefined,
    kobisRank: rk || undefined,
    info: `일일 관객 ${intString(row.audiCnt)}명 · 누적 ${intString(row.audiAcc)}명 · 스크린 ${intString(row.scrnCnt)}`,
  };
}

export function getKobisApiKey(): string {
  return (
    publicEnv.kobisKey?.trim() ||
    process.env.EXPO_PUBLIC_KOBIS_KEY?.trim() ||
    process.env.KOBIS_KEY?.trim() ||
    ''
  );
}

export type FetchDailyBoxOfficeResult =
  | { ok: true; movies: SelectedMovieExtra[]; targetDt: string }
  | { ok: false; error: string };

/**
 * 일별 박스오피스(searchDailyBoxOfficeList) 1~10위를 `SelectedMovieExtra[]`로 반환.
 * `targetDt` 미지정 시: 서울 달력 **어제**(`seoulYmdDaysAgo(1)`)를 먼저 쓰고, 빈 목록·오류 시 최대 이틀 더 거슬러 시도합니다.
 */
export async function fetchDailyBoxOfficeTop10(targetDt?: string): Promise<FetchDailyBoxOfficeResult> {
  const key = getKobisApiKey();
  if (!key) {
    return { ok: false, error: 'KOBIS API 키가 설정되지 않았습니다. (EXPO_PUBLIC_KOBIS_KEY)' };
  }

  const tryDates =
    targetDt != null && /^\d{8}$/.test(targetDt)
      ? [targetDt]
      : [seoulYmdDaysAgo(1), seoulYmdDaysAgo(2), seoulYmdDaysAgo(3)];

  let lastError = '일별 박스오피스를 불러오지 못했습니다.';

  for (const dt of tryDates) {
    const url = `${KOBIS_BOXOFFICE_URL}?${new URLSearchParams({ key, targetDt: dt }).toString()}`;
    try {
      const res = await fetch(url, { method: 'GET' });
      const text = await res.text();
      let json: KobisSuccessJson & KobisFaultJson;
      try {
        json = JSON.parse(text) as KobisSuccessJson & KobisFaultJson;
      } catch {
        lastError = '응답 파싱 오류';
        continue;
      }
      if (json.faultString) {
        lastError = json.faultString;
        continue;
      }
      const list = json.boxOfficeResult?.dailyBoxOfficeList;
      if (!Array.isArray(list) || list.length === 0) {
        lastError = '박스오피스 목록이 비어 있습니다.';
        continue;
      }
      const sorted = [...list].sort((a, b) => Number.parseInt(a.rank, 10) - Number.parseInt(b.rank, 10));
      const top = sorted.slice(0, 10).map(mapRowToMovie);
      return { ok: true, movies: top, targetDt: dt };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }

  return { ok: false, error: lastError };
}
