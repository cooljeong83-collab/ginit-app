import AsyncStorage from '@react-native-async-storage/async-storage';

import { normalizeFeedRegionLabel } from '@/src/lib/feed-display-location';
import { getInterestRegionDisplayLabel } from '@/src/lib/korea-interest-districts';
import { loadFeedLocationCache } from '@/src/lib/feed-location-cache';

const STORAGE_KEY = '@ginit/feed_registered_regions_v1';
const ACTIVE_REGION_KEY = '@ginit/feed_active_region_norm_v1';

/** 탐색에 등록해 둘 수 있는 관심 지역(구) 최대 개수 */
export const FEED_REGISTERED_REGIONS_MAX = 5;

/** 지도 탭이 피드보다 먼저 열려도 직전/저장된 관심지역을 동기적으로 참고하기 위한 메모리 캐시 */
let mapBootMemoryRegions: string[] = [];
let mapBootMemoryActiveNorm: string | null = null;

function setMapBootMemory(regions: string[], activeNorm: string | null) {
  mapBootMemoryRegions = [...regions];
  mapBootMemoryActiveNorm = activeNorm;
}

/** 모임 탭과 동일한 규칙의 «표시 중 관심지역» — 지도 첫 프레임 초기화용 */
export function peekFeedRegionMapSelectionForMapBoot(): { regions: string[]; activeNorm: string | null } {
  return { regions: [...mapBootMemoryRegions], activeNorm: mapBootMemoryActiveNorm };
}

/** 모임 탭에서 선택이 바뀐 직후(저장 전 포함) 지도 탭이 동기 값을 쓰도록 메모리만 맞춥니다. */
export function syncFeedRegionMapBootMemoryFromSelection(regions: string[], activeNorm: string | null) {
  const normalized = normalizeList(regions as unknown[]);
  const active =
    activeNorm && activeNorm.trim() ? normalizeFeedRegionLabel(activeNorm) : null;
  setMapBootMemory(normalized, active);
}

function normalizeList(input: unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of input) {
    if (typeof x !== 'string') continue;
    const n = normalizeFeedRegionLabel(x);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
    if (out.length >= FEED_REGISTERED_REGIONS_MAX) break;
  }
  return out;
}

/**
 * 모임 탭(탐색)용 관심 행정구 — AsyncStorage.
 * 기존 단일 `feed-location-cache` 라벨만 있으면 1개로 마이그레이션합니다.
 */
export async function loadRegisteredFeedRegions(): Promise<string[]> {
  let out: string[] = [];
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) out = normalizeList(parsed);
    }
  } catch {
    /* ignore */
  }
  if (out.length === 0) {
    try {
      const cached = await loadFeedLocationCache();
      const label = cached?.label?.trim();
      if (label) out = normalizeList([normalizeFeedRegionLabel(label)]);
    } catch {
      /* ignore */
    }
  }
  let active: string | null = null;
  try {
    active = await loadActiveFeedRegion();
  } catch {
    /* ignore */
  }
  setMapBootMemory(out, active);
  return out;
}

export async function saveRegisteredFeedRegions(regions: string[]): Promise<void> {
  const normalized = normalizeList(regions as unknown[]);
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    /* ignore */
  }
  let active: string | null = mapBootMemoryActiveNorm;
  try {
    active = await loadActiveFeedRegion();
  } catch {
    /* ignore */
  }
  setMapBootMemory(normalized, active);
}

/** 탐색 목록에 쓰는 «현재 선택» 구 라벨(정규화). 목록에 없으면 무시하고 첫 항목 등으로 맞춥니다. */
export async function loadActiveFeedRegion(): Promise<string | null> {
  try {
    const v = await AsyncStorage.getItem(ACTIVE_REGION_KEY);
    const t = v?.trim();
    return t ? normalizeFeedRegionLabel(t) : null;
  } catch {
    return null;
  }
}

export async function saveActiveFeedRegion(norm: string | null): Promise<void> {
  const n = norm?.trim() ? normalizeFeedRegionLabel(norm) : '';
  try {
    if (!n) await AsyncStorage.removeItem(ACTIVE_REGION_KEY);
    else await AsyncStorage.setItem(ACTIVE_REGION_KEY, n);
  } catch {
    /* ignore */
  }
  setMapBootMemory(mapBootMemoryRegions, n ? n : null);
}

/** 상단 헤더 한 줄 요약 (당근식 다중 관심 지역) */
export function formatRegisteredRegionsHeader(regions: string[]): string {
  if (regions.length === 0) return '관심 지역 등록';
  const disp = regions.map((r) => getInterestRegionDisplayLabel(r));
  if (disp.length === 1) return disp[0]!;
  if (disp.length === 2) return `${disp[0]!}, ${disp[1]!}`;
  return `${disp[0]!} 외 ${regions.length - 1}곳`;
}
