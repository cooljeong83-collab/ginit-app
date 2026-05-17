/**
 * 전국 행정구(자치구) 단위 관심 지역 검색·표시용 정적 데이터.
 * 광역시·특별시는 cosmosfarm/korea-administrative-district 기준(군 제외),
 * 도 단위 시는 행정구(○○구)가 있는 시만 확장합니다.
 */
import { normalizeFeedRegionLabel } from '@/src/lib/feed-region-match';
import { KOREA_INTEREST_DONG_ROWS } from '@/src/lib/korea-interest-dong-index.generated';
import { ALL_SEOUL_GU, SEOUL_GU_SET, type SeoulGuLabel } from '@/src/lib/seoul-gu-constants';

export type KoreaGuSearchHit = { key: string; label: string };

type FlatRow = { key: string; label: string; hay: string };

/** 광역시·특별시(서울 제외) 자치구 — 군(○○군) 제외 */
const METRO_SIGUNGU: Record<string, readonly string[]> = {
  부산광역시: [
    '중구',
    '서구',
    '동구',
    '영도구',
    '부산진구',
    '동래구',
    '남구',
    '북구',
    '강서구',
    '해운대구',
    '사하구',
    '금정구',
    '연제구',
    '수영구',
    '사상구',
  ],
  인천광역시: ['중구', '동구', '미추홀구', '연수구', '남동구', '부평구', '계양구', '서구'],
  대구광역시: ['중구', '동구', '서구', '남구', '북구', '수성구', '달서구'],
  광주광역시: ['동구', '서구', '남구', '북구', '광산구'],
  대전광역시: ['동구', '중구', '서구', '유성구', '대덕구'],
  울산광역시: ['중구', '남구', '동구', '북구'],
};

/** 시·군·구 하위에 자치구가 있는 시(도 단위) */
const SI_SIGUNGU_GUS: { readonly sido: string; readonly city: string; readonly gus: readonly string[] }[] = [
  { sido: '경기도', city: '수원시', gus: ['장안구', '권선구', '팔달구', '영통구'] },
  { sido: '경기도', city: '성남시', gus: ['수정구', '중원구', '분당구'] },
  { sido: '경기도', city: '고양시', gus: ['덕양구', '일산동구', '일산서구'] },
  { sido: '경기도', city: '용인시', gus: ['처인구', '기흥구', '수지구'] },
  { sido: '경기도', city: '부천시', gus: ['원미구', '소사구', '오정구'] },
  { sido: '경기도', city: '안양시', gus: ['만안구', '동안구'] },
  { sido: '경기도', city: '안산시', gus: ['상록구', '단원구'] },
  { sido: '충청북도', city: '청주시', gus: ['상당구', '서원구', '흥덕구', '청원구'] },
  { sido: '충청남도', city: '천안시', gus: ['동남구', '서북구'] },
  { sido: '경상북도', city: '포항시', gus: ['남구', '북구'] },
  {
    sido: '경상남도',
    city: '창원시',
    gus: ['의창구', '성산구', '마산합포구', '마산회원구', '진해구'],
  },
  { sido: '전북특별자치도', city: '전주시', gus: ['완산구', '덕진구'] },
  { sido: '전라남도', city: '목포시', gus: ['동구', '서구'] },
];

function metroShortToken(sido: string): string {
  return sido.replace(/특별시|광역시|특별자치시|특별자치도/g, '').trim();
}

function buildFlatRows(): FlatRow[] {
  const rows: FlatRow[] = [];
  const seen = new Set<string>();

  const push = (rawKey: string, label: string) => {
    const k = normalizeFeedRegionLabel(rawKey);
    if (!k || seen.has(k)) return;
    seen.add(k);
    const hay = `${label} ${rawKey}`.toLowerCase().replace(/\s+/g, ' ');
    rows.push({ key: k, label, hay });
  };

  for (const gu of ALL_SEOUL_GU) {
    push(gu, `서울특별시 ${gu}`);
  }

  for (const [sido, gus] of Object.entries(METRO_SIGUNGU)) {
    const token = metroShortToken(sido);
    for (const gu of gus) {
      push(`${token} ${gu}`, `${sido} ${gu}`);
    }
  }

  for (const row of SI_SIGUNGU_GUS) {
    const cityShort = row.city.replace(/시$/, '');
    for (const gu of row.gus) {
      push(`${cityShort} ${gu}`, `${row.sido} ${row.city} ${gu}`);
    }
  }

  return rows;
}

const FLAT: readonly FlatRow[] = buildFlatRows();

const FLAT_BY_KEY: ReadonlyMap<string, FlatRow> = (() => {
  const m = new Map<string, FlatRow>();
  for (const r of FLAT) m.set(r.key, r);
  return m;
})();

const LABEL_BY_KEY: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const r of FLAT) m.set(r.key, r.label);
  return m;
})();

export function getInterestRegionDisplayLabel(regionKey: string): string {
  const k = normalizeFeedRegionLabel(regionKey);
  if (LABEL_BY_KEY.has(k)) return LABEL_BY_KEY.get(k)!;
  if (SEOUL_GU_SET.has(k as SeoulGuLabel)) return `서울특별시 ${k}`;
  return regionKey.trim();
}

function searchDongRowsForInterestDistricts(
  compactQ: string,
  parts: string[],
  exclude: ReadonlySet<string>,
  tryPush: (row: FlatRow) => void,
  cap: () => boolean,
): void {
  if (compactQ.length < 2 || compactQ === '동') return;

  for (const d of KOREA_INTEREST_DONG_ROWS) {
    if (cap()) break;
    if (exclude.has(d.key)) continue;
    const dn = d.dong.replace(/\s/g, '');
    const hn = d.hay.replace(/\s/g, '');
    const direct =
      compactQ.length >= 1 && (dn.includes(compactQ) || hn.includes(compactQ));
    const token =
      parts.length > 0 &&
      parts.every((w) => w.length > 0 && (d.hay.includes(w) || d.dong.includes(w) || d.key.includes(w)));
    if (!direct && !token) continue;
    const row = FLAT_BY_KEY.get(d.key);
    if (row) tryPush(row);
  }
}

/**
 * 전국 구 단위 검색. 동·읍·면 이름으로 검색해도 해당 행정구가 나옵니다.
 * 이미 등록된 key(정규화)는 제외합니다.
 */
export function searchKoreaInterestDistricts(queryRaw: string, excludeRegions: readonly string[]): KoreaGuSearchHit[] {
  const exclude = new Set(excludeRegions.map((x) => normalizeFeedRegionLabel(x)));
  const q = queryRaw.trim();
  if (!q || q === '구') return [];

  const compactQ = q.replace(/\s+/g, '').toLowerCase();
  const parts = q.split(/\s+/).filter(Boolean);
  const hits: KoreaGuSearchHit[] = [];
  const seenHit = new Set<string>();

  const tryPush = (row: FlatRow) => {
    if (exclude.has(row.key) || seenHit.has(row.key)) return;
    seenHit.add(row.key);
    hits.push({ key: row.key, label: row.label });
  };

  const atCap = () => hits.length >= 80;

  for (const row of FLAT) {
    if (exclude.has(row.key)) continue;
    const hn = row.hay.replace(/\s/g, '');
    const kn = row.key.replace(/\s/g, '');
    const ln = row.label.replace(/\s/g, '').toLowerCase();
    if (compactQ.length >= 1 && (hn.includes(compactQ) || kn.includes(compactQ) || ln.includes(compactQ))) {
      tryPush(row);
      if (atCap()) return hits;
    }
  }

  searchDongRowsForInterestDistricts(compactQ, parts, exclude, tryPush, atCap);
  if (atCap()) return hits;

  if (hits.length === 0 && q.length >= 1) {
    for (const row of FLAT) {
      if (exclude.has(row.key)) continue;
      if (parts.every((w) => w.length > 0 && (row.label.includes(w) || row.key.includes(w)))) tryPush(row);
      if (atCap()) break;
    }
    if (!atCap()) searchDongRowsForInterestDistricts(compactQ, parts, exclude, tryPush, atCap);
  }

  return hits;
}
