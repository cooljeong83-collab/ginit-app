import type { Category } from '@/src/lib/categories';
import { meetingDistanceMetersFromUser, type LatLng } from '@/src/lib/geo-distance';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import type { MeetingExtraData } from '@/src/lib/meeting-extra-data';
import type {
  Meeting,
  PublicMeetingAgeLimit,
  PublicMeetingApprovalType,
  PublicMeetingDetailsConfig,
  PublicMeetingGenderRatio,
  PublicMeetingSettlement,
} from '@/src/lib/meetings';
import { meetingScheduleStartMs } from '@/src/lib/meeting-schedule-times';
import { parsePublicMeetingDetailsConfig } from '@/src/lib/meetings';
import type { UserProfile } from '@/src/lib/user-profile';

export type MeetingListSortMode = 'distance' | 'latest' | 'soon';

/** 홈 탭 모임 목록: 사용자 위치 좌표가 있을 때 이 거리(미터) 안의 모임만 표시 */
export const FEED_HOME_LIST_RADIUS_METERS = 5000;

export type FeedChip = { filterId: string | null; label: string };

/** 좌표가 없으면 필터를 적용하지 않습니다(목록 전체). */
export function meetingWithinHomeFeedRadius(m: Meeting, userCoords: LatLng | null): boolean {
  if (!userCoords) return true;
  const d = meetingDistanceMetersFromUser(m, userCoords);
  return d != null && d <= FEED_HOME_LIST_RADIUS_METERS;
}

export function meetingCreatedAtMs(m: Meeting): number {
  const t = m.createdAt;
  if (t && typeof (t as { toMillis?: () => number }).toMillis === 'function') {
    return (t as { toMillis: () => number }).toMillis();
  }
  return 0;
}

/** 홈 검색 모달 — 글자 검색 + 공개 모임 `meetingConfig` 조건 */
export type FeedSearchFilters = {
  textQuery: string;
  /** 비어 있으면 연령 필터 없음. `NONE`만 있으면 “연령 제한 없음” 모임만 */
  ageInclude: PublicMeetingAgeLimit[];
  genderRatio: PublicMeetingGenderRatio | null;
  settlement: PublicMeetingSettlement | null;
  approvalType: PublicMeetingApprovalType | null;
};

export function defaultFeedSearchFilters(): FeedSearchFilters {
  return {
    textQuery: '',
    ageInclude: [],
    genderRatio: null,
    settlement: null,
    approvalType: null,
  };
}

export function feedSearchFiltersActive(f: FeedSearchFilters): boolean {
  return (
    f.textQuery.trim() !== '' ||
    f.ageInclude.length > 0 ||
    f.genderRatio != null ||
    f.settlement != null ||
    f.approvalType != null
  );
}

function ageIncludeMatchesMeeting(selected: PublicMeetingAgeLimit[], cfg: PublicMeetingDetailsConfig): boolean {
  if (selected.length === 0) return true;
  const m = cfg.ageLimit;
  const onlyNone = selected.length === 1 && selected[0] === 'NONE';
  if (onlyNone) return m.includes('NONE');
  if (m.includes('NONE')) return true;
  return selected.some((s) => s !== 'NONE' && m.includes(s));
}

/**
 * 카테고리·모집중 필터와 별개로 적용. 상세 조건이 하나라도 켜져 있으면 `meetingConfig`가 있는 공개 모임만 통과합니다.
 */
export function meetingMatchesFeedSearch(m: Meeting, f: FeedSearchFilters): boolean {
  const q = f.textQuery.trim().toLowerCase();
  if (q) {
    const hay = [m.title, m.description, m.categoryLabel, m.location, m.placeName, m.address ?? '']
      .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
      .join(' ')
      .toLowerCase();
    if (!hay.includes(q)) return false;
  }

  const detailActive =
    f.ageInclude.length > 0 || f.genderRatio != null || f.settlement != null || f.approvalType != null;
  if (!detailActive) return true;

  const cfg = parsePublicMeetingDetailsConfig(m.meetingConfig);
  if (!cfg || m.isPublic === false) return false;

  if (!ageIncludeMatchesMeeting(f.ageInclude, cfg)) return false;
  if (f.genderRatio != null && cfg.genderRatio !== f.genderRatio) return false;
  if (f.settlement != null && cfg.settlement !== f.settlement) return false;
  if (f.approvalType != null && cfg.approvalType !== f.approvalType) return false;

  return true;
}

export function meetingMatchesCategoryFilter(
  m: Meeting,
  filterId: string | null,
  categories: Category[],
): boolean {
  if (filterId == null) return true;
  const selected = categories.find((c) => c.id === filterId);
  const selectedLabel = selected?.label?.trim() ?? '';
  const mid = m.categoryId?.trim();
  if (mid && mid === filterId) return true;
  const ml = (m.categoryLabel ?? '').trim();
  if (ml && selectedLabel && ml === selectedLabel) return true;
  return false;
}

export function listSortModeLabel(mode: MeetingListSortMode): string {
  switch (mode) {
    case 'distance':
      return '거리순';
    case 'soon':
      return '임박순';
    default:
      return '등록순';
  }
}

export function buildFeedChips(meetings: Meeting[], categories: Category[]): FeedChip[] {
  const countByCategoryId = new Map<string, number>();
  for (const m of meetings) {
    const cid = m.categoryId?.trim();
    if (cid) {
      countByCategoryId.set(cid, (countByCategoryId.get(cid) ?? 0) + 1);
      continue;
    }
    const lab = m.categoryLabel?.trim();
    if (!lab) continue;
    const matched = categories.find((c) => c.label.trim() === lab);
    if (matched) {
      countByCategoryId.set(matched.id, (countByCategoryId.get(matched.id) ?? 0) + 1);
    }
  }

  const sorted = [...categories].sort((a, b) => {
    const na = countByCategoryId.get(a.id) ?? 0;
    const nb = countByCategoryId.get(b.id) ?? 0;
    if (nb !== na) return nb - na;
    if (a.order !== b.order) return a.order - b.order;
    return a.label.localeCompare(b.label, 'ko');
  });

  return [{ filterId: null, label: '전체' }, ...sorted.map((c) => ({ filterId: c.id, label: c.label }))];
}

export function sortMeetingsForFeed(
  filtered: Meeting[],
  listSortMode: MeetingListSortMode,
  userCoords: LatLng | null,
): Meeting[] {
  const list = [...filtered];
  if (listSortMode === 'latest') {
    list.sort((a, b) => {
      const tb = meetingCreatedAtMs(b);
      const ta = meetingCreatedAtMs(a);
      if (tb !== ta) return tb - ta;
      return a.title.localeCompare(b.title, 'ko');
    });
    return list;
  }
  if (listSortMode === 'soon') {
    list.sort((a, b) => {
      const ta = meetingScheduleStartMs(a);
      const tb = meetingScheduleStartMs(b);
      const ia = ta ?? Number.POSITIVE_INFINITY;
      const ib = tb ?? Number.POSITIVE_INFINITY;
      if (ia !== ib) return ia - ib;
      return a.title.localeCompare(b.title, 'ko');
    });
    return list;
  }
  list.sort((a, b) => {
    const da = meetingDistanceMetersFromUser(a, userCoords);
    const db = meetingDistanceMetersFromUser(b, userCoords);
    const sa = da ?? Number.POSITIVE_INFINITY;
    const sb = db ?? Number.POSITIVE_INFINITY;
    if (sa !== sb) return sa - sb;
    return a.title.localeCompare(b.title, 'ko');
  });
  return list;
}

/** 홈 리스트 심볼 박스: 영화 포스터 우선, 없으면 주관자 프로필 사진 */
export type FeedMeetingSymbolBox =
  | { source: 'movie_poster'; url: string }
  | { source: 'host_profile'; url: string };

function firstMoviePosterUrl(extra: MeetingExtraData): string | null {
  const fromMovie = extra.movie?.posterUrl?.trim();
  if (fromMovie) return fromMovie;
  const list = extra.movies;
  if (!Array.isArray(list)) return null;
  for (const mv of list) {
    const u = mv?.posterUrl?.trim();
    if (u) return u;
  }
  return null;
}

export function feedMeetingSymbolBox(
  m: Meeting,
  hostProfiles: ReadonlyMap<string, UserProfile>,
): FeedMeetingSymbolBox | null {
  const raw = m.extraData;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const extra = raw as MeetingExtraData;
    if (extra.specialtyKind === 'movie') {
      const poster = firstMoviePosterUrl(extra);
      if (poster) return { source: 'movie_poster', url: poster };
    }
  }

  const hostRaw = m.createdBy?.trim();
  if (!hostRaw) return null;
  const hostKey = normalizeParticipantId(hostRaw) ?? hostRaw;
  const prof = hostProfiles.get(hostKey) ?? hostProfiles.get(hostRaw);
  const url = prof?.photoUrl?.trim();
  if (url) return { source: 'host_profile', url };
  return null;
}
