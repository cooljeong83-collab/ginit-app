import { normalizeParticipantId } from '@/src/lib/app-user-id';
import type { Category } from '@/src/lib/categories';
import { isCoordinatingMeeting, isUserJoinedMeeting } from '@/src/lib/joined-meetings';
import {
  buildMeetingVoteChipLists,
  meetingCategoryDisplayLabel,
  type Meeting,
} from '@/src/lib/meetings';
import type { UserProfile } from '@/src/lib/user-profile';

export type FriendMeetingPhase = 'idle' | 'coordinating' | 'confirmed';

/** 중앙 영역(Line 2) 분기용 — UI에서 색·아이콘 보조에 사용 가능 */
export type FriendActivityKind =
  | 'idle'
  | 'confirmed_schedule'
  | 'vote_movie'
  | 'vote_place'
  | 'vote_date'
  | 'coordinating_generic';

export type FriendActivityResolution = {
  kind: FriendActivityKind;
  /** 리스트 중앙: 디스코드 스타일 한 줄 활동 */
  secondaryLine: string;
  /** 프리즌스 링 아래 소제목 */
  presenceSubtitle: string;
};

function shortTitle(t: string, max = 20): string {
  const s = t.trim();
  if (!s) return '모임';
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function shortPlaceLabel(m: Meeting): string {
  const p = m.placeName?.trim() || m.location?.trim() || '';
  return p.length > 30 ? `${p.slice(0, 28)}…` : p;
}

/** 지역 힌트: 후보 장소·주소·상대 baseRegion 순 */
function regionHint(m: Meeting, peerBaseRegion: string | null | undefined): string {
  const pc0 = m.placeCandidates?.[0]?.placeName?.trim();
  if (pc0) {
    const bit = pc0.split(/\s|·|\//)[0]?.trim();
    if (bit && bit.length <= 10) return bit;
  }
  const addr = m.address?.trim();
  if (addr) {
    const bit = addr.split(/\s|,/).find((x) => x.length >= 2 && x.length <= 10);
    if (bit) return bit;
  }
  const br = peerBaseRegion?.trim();
  return br ? br.replace(/역$/, '') : '';
}

function meetingMillis(m: Meeting): number {
  const ts = m.createdAt as { toMillis?: () => number } | null | undefined;
  if (ts && typeof ts.toMillis === 'function') return ts.toMillis();
  return 0;
}

/**
 * 피드/하이브리드 모임 목록에서, 해당 친구가 **참여 중으로 보이는** 대표 모임 1건.
 * 우선순위: 조율 중 > 확정됨, 동률이면 최근 생성.
 */
export function pickPrimaryMeetingForPeer(peerAppUserId: string, meetings: Meeting[]): Meeting | null {
  const uid = peerAppUserId.trim();
  if (!uid) return null;
  const joined = meetings.filter((m) => isUserJoinedMeeting(m, uid));
  if (joined.length === 0) return null;
  joined.sort((a, b) => {
    const ac = isCoordinatingMeeting(a) ? 0 : 1;
    const bc = isCoordinatingMeeting(b) ? 0 : 1;
    if (ac !== bc) return ac - bc;
    return meetingMillis(b) - meetingMillis(a);
  });
  return joined[0] ?? null;
}

export function meetingPhaseForFriend(m: Meeting | null): FriendMeetingPhase {
  if (!m) return 'idle';
  if (m.scheduleConfirmed === true) return 'confirmed';
  return 'coordinating';
}

export function categoryEmojiForMeeting(m: Meeting, categories?: readonly Category[] | null): string {
  const id = (m.categoryId ?? '').trim();
  if (id && categories?.length) {
    const hit = categories.find((c) => String(c.id).trim() === id);
    const em = hit?.emoji?.trim();
    if (em) return em;
  }
  const label = `${meetingCategoryDisplayLabel(m, categories) ?? ''} ${m.title ?? ''}`.toLowerCase();
  if (/영화|movie|cinema/.test(label)) return '🎬';
  if (/카페|커피|브런치|tea|디저트/.test(label)) return '☕';
  if (/맛집|식사|음식|dinner|lunch|저녁|점심/.test(label)) return '🍽️';
  if (/운동|헬스|running|등산|hiking|요가/.test(label)) return '🏃';
  if (/스터디|study|독서/.test(label)) return '📚';
  if (/술|bar|와인|주말/.test(label)) return '🍷';
  return '✨';
}

/**
 * 실시간 모임 스냅샷 + 프로필을 바탕으로 중앙 활동 문구를 분기합니다.
 * 분기 순서: 확정 → 영화 투표 → 장소 투표 → 일정 투표 → 장소/일정 단일 후보 → 일반 조율 → 오프라인
 */
export function resolveFriendActivity(
  meeting: Meeting | null,
  peerProfile: Pick<UserProfile, 'baseRegion' | 'nickname'>,
  categories?: readonly Category[] | null,
): FriendActivityResolution {
  const region = meeting ? regionHint(meeting, peerProfile.baseRegion) : '';
  const regionInfix = region ? `${region}에서 ` : '';

  if (!meeting) {
    const r = peerProfile.baseRegion?.trim();
    return {
      kind: 'idle',
      secondaryLine: r ? `${r} 근처 · 새 지닛을 기다리는 중` : '지닛에 참여하면 여기에 활동이 표시돼요',
      presenceSubtitle: '대기 중',
    };
  }

  if (meeting.scheduleConfirmed === true) {
    const spot = shortPlaceLabel(meeting);
    return {
      kind: 'confirmed_schedule',
      secondaryLine: spot ? `${regionInfix}일정 확정 · ${spot}` : `${regionInfix}일정 확정됨`,
      presenceSubtitle: '확정됨',
    };
  }

  const { dateChipIds, placeChipIds, movieChipIds } = buildMeetingVoteChipLists(meeting);
  const catLabel = `${meetingCategoryDisplayLabel(meeting, categories) ?? ''} ${meeting.title ?? ''}`;
  const movieish = movieChipIds.length > 0 && /영화|movie|cinema|film|🎬/.test(catLabel.toLowerCase());

  if (movieish) {
    return {
      kind: 'vote_movie',
      secondaryLine: `${regionInfix}영화 시간·작품 투표 중`,
      presenceSubtitle: '조율 중',
    };
  }

  const placeVotes =
    (meeting.voteTallies?.places && Object.keys(meeting.voteTallies.places).length > 0) ||
    placeChipIds.length >= 2;
  if (placeChipIds.length > 0 && placeVotes) {
    return {
      kind: 'vote_place',
      secondaryLine: `${regionInfix}맛집·장소 투표 중`,
      presenceSubtitle: '조율 중',
    };
  }

  const dateVotes =
    (meeting.voteTallies?.dates && Object.keys(meeting.voteTallies.dates).length > 0) || dateChipIds.length >= 2;
  if (dateChipIds.length > 0 && dateVotes) {
    return {
      kind: 'vote_date',
      secondaryLine: `${regionInfix}일정·시간 투표 중`,
      presenceSubtitle: '조율 중',
    };
  }

  if (placeChipIds.length > 0) {
    return {
      kind: 'vote_place',
      secondaryLine: `${regionInfix}장소 정하는 중`,
      presenceSubtitle: '조율 중',
    };
  }

  if (dateChipIds.length > 0) {
    return {
      kind: 'vote_date',
      secondaryLine: `${regionInfix}일정 잡는 중`,
      presenceSubtitle: '조율 중',
    };
  }

  if (movieChipIds.length > 0) {
    return {
      kind: 'vote_movie',
      secondaryLine: `${regionInfix}영화 관련 조율 중`,
      presenceSubtitle: '조율 중',
    };
  }

  return {
    kind: 'coordinating_generic',
    secondaryLine: `${regionInfix}「${shortTitle(meeting.title)}」준비 중`,
    presenceSubtitle: '조율 중',
  };
}

function parseGeo(u: unknown): { lat: number; lng: number } | null {
  if (!u || typeof u !== 'object') return null;
  const o = u as Record<string, unknown>;
  if (typeof o.latitude === 'number' && Number.isFinite(o.latitude) && typeof o.longitude === 'number' && Number.isFinite(o.longitude)) {
    return { lat: o.latitude, lng: o.longitude };
  }
  if (typeof o.lat === 'number' && typeof o.lng === 'number' && Number.isFinite(o.lat) && Number.isFinite(o.lng)) {
    return { lat: o.lat, lng: o.lng };
  }
  const lat = (o as { _latitude?: number })._latitude;
  const lng = (o as { _longitude?: number })._longitude;
  if (typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)) {
    return { lat, lng };
  }
  return null;
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(lat2 - lat1);
  const dLon = toR(lon2 - lon1);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLon / 2);
  const h = s1 * s1 + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * s2 * s2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function distanceMetersBetweenProfiles(
  a: UserProfile | null | undefined,
  b: UserProfile | null | undefined,
): number | null {
  const ga = parseGeo(a?.lastLocation ?? null);
  const gb = parseGeo(b?.lastLocation ?? null);
  if (!ga || !gb) return null;
  return haversineMeters(ga.lat, ga.lng, gb.lat, gb.lng);
}

export function formatDistanceCompact(meters: number | null): string | null {
  if (meters == null || !Number.isFinite(meters)) return null;
  if (meters < 1000) return `${Math.max(1, Math.round(meters / 50) * 50)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

export function mutualJoinedMeetingsCount(meAppUserId: string, peerAppUserId: string, meetings: Meeting[]): number {
  const me = normalizeParticipantId(meAppUserId);
  const peer = normalizeParticipantId(peerAppUserId);
  if (!me || !peer) return 0;
  let n = 0;
  for (const m of meetings) {
    if (isUserJoinedMeeting(m, me) && isUserJoinedMeeting(m, peer)) n += 1;
  }
  return n;
}

export function splitGDnaChips(gDna: string | null | undefined, max: number): string[] {
  const t = (gDna ?? '').trim();
  if (!t) return [];
  const parts = t.split(/[,|·/]/).map((x) => x.trim()).filter(Boolean);
  const out = parts.length ? parts : [t];
  return out.slice(0, max);
}

export type FriendSortSignals = {
  inMeeting: boolean;
  distanceM: number | null;
  gTrust: number;
};

export function computeFriendSortSignals(
  peerProfile: UserProfile | undefined,
  meeting: Meeting | null,
  meProfile: UserProfile | null | undefined,
): FriendSortSignals {
  const inMeeting = meeting != null;
  const distanceM = peerProfile ? distanceMetersBetweenProfiles(meProfile, peerProfile) : null;
  const gTrust = typeof peerProfile?.gTrust === 'number' && Number.isFinite(peerProfile.gTrust) ? peerProfile.gTrust : 0;
  return { inMeeting, distanceM, gTrust };
}

/** 정렬: 모임 참여 > 거리 가까움 > gTrust */
export function compareFriendsByPresenceDistanceTrust(a: FriendSortSignals, b: FriendSortSignals): number {
  if (a.inMeeting !== b.inMeeting) return (b.inMeeting ? 1 : 0) - (a.inMeeting ? 1 : 0);
  const da = a.distanceM ?? Number.POSITIVE_INFINITY;
  const db = b.distanceM ?? Number.POSITIVE_INFINITY;
  if (da !== db) return da - db;
  return b.gTrust - a.gTrust;
}
