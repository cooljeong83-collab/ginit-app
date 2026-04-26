import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { InAppAlarmsBellButton } from '@/components/in-app-alarms/InAppAlarmsBellButton';
import { FeedSearchFilterModal } from '@/components/feed/FeedSearchFilterModal';
import { GlassCategoryChip } from '@/components/feed/GlassCategoryChip';
import { HomeMeetingListItem } from '@/components/feed/HomeMeetingListItem';
import { ScreenShell } from '@/components/ui';
import { GinitTheme } from '@/constants/ginit-theme';
import type { Category } from '@/src/lib/categories';
import { subscribeCategories } from '@/src/lib/categories';
import { emitTabBarFabDocked } from '@/src/lib/tabbar-fab-scroll';
import {
  FEED_LOCATION_FALLBACK_SHORT,
  extractGuFromKoreanAddressText,
  formatSeoulGuLabel,
  resolveFeedLocationContext,
} from '@/src/lib/feed-display-location';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import {
  buildFeedChips,
  defaultFeedSearchFilters,
  feedMeetingSymbolBox,
  feedSearchFiltersActive,
  listSortModeLabel,
  meetingMatchesCategoryFilter,
  meetingMatchesFeedSearch,
  meetingWithinHomeFeedRadius,
  type FeedSearchFilters,
  type MeetingListSortMode,
  sortMeetingsForFeed,
} from '@/src/lib/feed-meeting-utils';
import { loadFeedLocationCache, saveFeedLocationCache } from '@/src/lib/feed-location-cache';
import type { LatLng } from '@/src/lib/geo-distance';
import { useAppPolicies } from '@/src/context/AppPoliciesContext';
import { useUserSession } from '@/src/context/UserSessionContext';
import { filterJoinedMeetings, isUserJoinedMeeting } from '@/src/lib/joined-meetings';
import { pushProfileOpenRegisterInfo } from '@/src/lib/profile-register-info';
import {
  collectUserConfirmedScheduleSlots,
  getScheduleOverlapBufferHours,
  meetingOverlapsUserConfirmedSlots,
} from '@/src/lib/meeting-schedule-overlap';
import { sweepStalePublicUnconfirmedMeetingsForHost } from '@/src/lib/meeting-expiry-sweep';
import type { Meeting } from '@/src/lib/meetings';
import { getMeetingRecruitmentPhase } from '@/src/lib/meetings';
import {
  ensureUserProfile,
  getUserProfile,
  getUserProfilesForIds,
  isMeetingServiceComplianceComplete,
  type UserProfile,
} from '@/src/lib/user-profile';
import { useMeetingsFeedInfiniteQuery } from '@/src/hooks/use-meetings-feed-infinite-query';

type SeoulGuLabel =
  | '강남구'
  | '강동구'
  | '강북구'
  | '강서구'
  | '관악구'
  | '광진구'
  | '구로구'
  | '금천구'
  | '노원구'
  | '도봉구'
  | '동대문구'
  | '동작구'
  | '마포구'
  | '서대문구'
  | '서초구'
  | '성동구'
  | '성북구'
  | '송파구'
  | '양천구'
  | '영등포구'
  | '용산구'
  | '은평구'
  | '종로구'
  | '중구'
  | '중랑구';

const ALL_SEOUL_GU: SeoulGuLabel[] = [
  '강남구',
  '강동구',
  '강북구',
  '강서구',
  '관악구',
  '광진구',
  '구로구',
  '금천구',
  '노원구',
  '도봉구',
  '동대문구',
  '동작구',
  '마포구',
  '서대문구',
  '서초구',
  '성동구',
  '성북구',
  '송파구',
  '양천구',
  '영등포구',
  '용산구',
  '은평구',
  '종로구',
  '중구',
  '중랑구',
];

const SEOUL_GU_NEIGHBORS: Record<SeoulGuLabel, SeoulGuLabel[]> = {
  강남구: ['서초구', '송파구', '성동구'],
  강동구: ['송파구', '광진구'],
  강북구: ['도봉구', '노원구', '성북구', '종로구', '은평구'],
  강서구: ['양천구', '구로구', '영등포구'],
  관악구: ['동작구', '금천구', '서초구', '구로구'],
  광진구: ['성동구', '중랑구', '강동구', '송파구'],
  구로구: ['금천구', '관악구', '양천구', '강서구', '영등포구'],
  금천구: ['구로구', '관악구'],
  노원구: ['도봉구', '강북구', '성북구', '중랑구'],
  도봉구: ['노원구', '강북구'],
  동대문구: ['성북구', '중랑구', '성동구', '중구', '종로구'],
  동작구: ['관악구', '서초구', '용산구', '영등포구'],
  마포구: ['은평구', '서대문구', '용산구', '영등포구'],
  서대문구: ['은평구', '마포구', '종로구', '중구'],
  서초구: ['강남구', '관악구', '동작구', '송파구', '용산구'],
  성동구: ['중구', '동대문구', '광진구', '강남구', '용산구'],
  성북구: ['강북구', '노원구', '동대문구', '종로구', '중랑구'],
  송파구: ['강남구', '서초구', '강동구', '광진구'],
  양천구: ['강서구', '구로구', '영등포구'],
  영등포구: ['강서구', '양천구', '구로구', '동작구', '용산구', '마포구'],
  용산구: ['중구', '성동구', '서초구', '동작구', '영등포구', '마포구'],
  은평구: ['강북구', '종로구', '서대문구', '마포구'],
  종로구: ['중구', '서대문구', '성북구', '동대문구', '강북구', '은평구'],
  중구: ['종로구', '용산구', '성동구', '동대문구', '서대문구'],
  중랑구: ['노원구', '성북구', '동대문구', '광진구'],
};

function parseSeoulGuFromLabel(label: string): SeoulGuLabel | null {
  const t = label.trim();
  if (!t) return null;
  // '서울시 영등포구' → '영등포구', '영등포구' → '영등포구'
  const last = t.split(/\s+/).pop() ?? t;
  if (ALL_SEOUL_GU.includes(last as SeoulGuLabel)) return last as SeoulGuLabel;
  // '중구' 등은 그대로
  if (ALL_SEOUL_GU.includes(t as SeoulGuLabel)) return t as SeoulGuLabel;
  return null;
}

function meetingMatchesSelectedRegion(m: Meeting, regionLabel: string): boolean {
  const sel = regionLabel.trim();
  if (!sel) return true;
  const selGu = extractGuFromKoreanAddressText(sel) ?? sel;
  const hay = [m.address, m.location, m.placeName]
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .join(' ');
  const mGu = extractGuFromKoreanAddressText(hay);
  // 구 단위로 뽑히면 구 기준 매칭
  if (mGu && selGu.endsWith('구')) return mGu === selGu;
  // 그 외는 문자열 포함(비서울 지역: 현재 접속 지역 1개만 표시이므로 충분)
  return hay.includes(sel) || hay.includes(selGu);
}

export default function FeedScreen() {
  const router = useRouter();
  const { userId } = useUserSession();
  const { version: appPoliciesVersion } = useAppPolicies();
  const { width: windowWidth } = useWindowDimensions();
  /** 탐색·내 모임 칩 — 예전 카테고리 칩과 동일 컴포넌트·유사 maxWidth */
  /** 탐색·내 모임 칩 라벨 폭 — 카테고리 칩과 동일 상한 규칙 */
  const tabChipMaxWidth = useMemo(
    () => Math.min(200, Math.max(100, Math.floor(windowWidth * 0.38))),
    [windowWidth],
  );

  const [regionLabel, setRegionLabel] = useState(FEED_LOCATION_FALLBACK_SHORT);
  /** 실제 접속 위치 기준(인접 구 목록 기준)은 선택과 무관하게 고정 */
  const [actualLocationLabel, setActualLocationLabel] = useState(FEED_LOCATION_FALLBACK_SHORT);
  const regionLabelRef = useRef(FEED_LOCATION_FALLBACK_SHORT);
  const manualRegionPickRef = useRef(false);
  /** 거리·거리순 정렬에 쓰는 기준점: 캐시 좌표 → GPS로 갱신(실패 시 캐시 유지) */
  const userCoordsRef = useRef<LatLng | null>(null);
  const [regionModalOpen, setRegionModalOpen] = useState(false);
  const [feedListSettingsModalOpen, setFeedListSettingsModalOpen] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [userCoords, setUserCoords] = useState<LatLng | null>(null);
  const [listSortMode, setListSortMode] = useState<MeetingListSortMode>('latest');
  /** true면 모집중(정원 미달·미확정) 모임만 표시. 기본값 off */
  const [recruitingOnly, setRecruitingOnly] = useState(false);
  const [feedSearchModalOpen, setFeedSearchModalOpen] = useState(false);
  const [appliedFeedSearch, setAppliedFeedSearch] = useState<FeedSearchFilters>(() => defaultFeedSearchFilters());
  const [draftFeedSearch, setDraftFeedSearch] = useState<FeedSearchFilters>(() => defaultFeedSearchFilters());
  /** 홈 상단 탭: 공개 모임 탐색 vs 호스트/게스트 */
  const [homeTab, setHomeTab] = useState<'explore' | 'guest' | 'host'>('explore');

  const [categories, setCategories] = useState<Category[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const {
    meetings,
    listError,
    refetch: refetchMeetingsFeed,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    showFooterSpinner,
    isInitialListLoading,
  } = useMeetingsFeedInfiniteQuery();
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [feedUserProfile, setFeedUserProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    if (!userId?.trim()) {
      setFeedUserProfile(null);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const p = await getUserProfile(userId.trim());
        if (alive) setFeedUserProfile(p);
      } catch {
        if (alive) setFeedUserProfile(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [userId]);

  const overlapBufferHours = useMemo(
    () => getScheduleOverlapBufferHours(feedUserProfile),
    [feedUserProfile, appPoliciesVersion],
  );

  const myConfirmedScheduleSlots = useMemo(
    () => collectUserConfirmedScheduleSlots(meetings, userId),
    [meetings, userId],
  );

  const feedHostIds = useMemo(() => {
    const set = new Set<string>();
    for (const m of meetings) {
      const r = m.createdBy?.trim();
      if (!r) continue;
      set.add(normalizeParticipantId(r) ?? r);
    }
    return [...set];
  }, [meetings]);

  const [feedHostProfileMap, setFeedHostProfileMap] = useState<Map<string, UserProfile>>(() => new Map());

  useEffect(() => {
    if (feedHostIds.length === 0) {
      setFeedHostProfileMap(new Map());
      return;
    }
    let alive = true;
    void getUserProfilesForIds(feedHostIds).then((map) => {
      if (!alive) return;
      setFeedHostProfileMap(map);
    });
    return () => {
      alive = false;
    };
  }, [feedHostIds]);

  useEffect(() => {
    regionLabelRef.current = regionLabel;
  }, [regionLabel]);

  useEffect(() => {
    // no-op: 인접 구 목록은 actualLocationLabel 기준으로만 계산
  }, [actualLocationLabel]);

  useEffect(() => {
    userCoordsRef.current = userCoords;
  }, [userCoords]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await loadFeedLocationCache();
      if (cancelled) return;

      let coordsForDistance = null as LatLng | null;
      if (cached) {
        setRegionLabel(cached.label);
        setActualLocationLabel(cached.label);
        coordsForDistance = cached.coords;
        setUserCoords(coordsForDistance);
      }

      const ctx = await resolveFeedLocationContext();
      if (cancelled) return;
      // 실제 위치 라벨은 항상 갱신(인접 구 목록 기준)
      setActualLocationLabel(ctx.labelShort);
      if (!manualRegionPickRef.current) {
        setRegionLabel(ctx.labelShort);
      }
      coordsForDistance = ctx.coords ?? coordsForDistance;
      setUserCoords(coordsForDistance);

      const labelToSave = manualRegionPickRef.current ? regionLabelRef.current : ctx.labelShort;
      await saveFeedLocationCache(labelToSave, coordsForDistance);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const unsub = subscribeCategories(
      (list) => setCategories(list),
      () => {
        /* 피드는 카테고리 없이도 동작 */
      },
    );
    return unsub;
  }, []);

  useEffect(() => {
    const uid = userId?.trim();
    if (!uid || meetings.length === 0) return;
    void sweepStalePublicUnconfirmedMeetingsForHost(uid, meetings);
  }, [userId, meetings]);

  useEffect(() => {
    if (selectedCategoryId == null) return;
    if (categories.length > 0 && !categories.some((c) => c.id === selectedCategoryId)) {
      setSelectedCategoryId(null);
    }
  }, [categories, selectedCategoryId]);

  const meetingsWithinRadius = useMemo(
    () => meetings.filter((m) => meetingWithinHomeFeedRadius(m, userCoords)),
    [meetings, userCoords],
  );

  const feedChips = useMemo(
    () => buildFeedChips(meetingsWithinRadius, categories),
    [categories, meetingsWithinRadius],
  );

  const filteredMeetings = useMemo(() => {
    return meetingsWithinRadius.filter((m) => {
      // 탐색 탭은 "선택된 지역"의 모임만 표시합니다.
      if (!meetingMatchesSelectedRegion(m, regionLabel)) return false;
      if (!meetingMatchesCategoryFilter(m, selectedCategoryId, categories)) return false;
      if (recruitingOnly && getMeetingRecruitmentPhase(m) !== 'recruiting') return false;
      if (!meetingMatchesFeedSearch(m, appliedFeedSearch)) return false;
      return true;
    });
  }, [meetingsWithinRadius, regionLabel, selectedCategoryId, categories, recruitingOnly, appliedFeedSearch]);

  const sortedFilteredMeetings = useMemo(
    () => sortMeetingsForFeed(filteredMeetings, listSortMode, userCoords),
    [filteredMeetings, listSortMode, userCoords],
  );

  const exploreFeedMeetings = useMemo(
    () => sortedFilteredMeetings.filter((m) => m.isPublic !== false),
    [sortedFilteredMeetings],
  );

  const joinedFilteredMeetings = useMemo(() => {
    // 내 모임 탭은 “현재 접속 지역”과 무관하게 내가 만든/참여한 모임을 모두 보여줍니다.
    const base = filterJoinedMeetings(meetings, userId);
    return base.filter((m) => {
      if (!meetingMatchesCategoryFilter(m, selectedCategoryId, categories)) return false;
      if (recruitingOnly && getMeetingRecruitmentPhase(m) !== 'recruiting') return false;
      if (!meetingMatchesFeedSearch(m, appliedFeedSearch)) return false;
      return true;
    });
  }, [meetings, userId, selectedCategoryId, categories, recruitingOnly, appliedFeedSearch]);

  const sortedJoinedMeetings = useMemo(
    () => sortMeetingsForFeed(joinedFilteredMeetings, listSortMode, userCoords),
    [joinedFilteredMeetings, listSortMode, userCoords],
  );

  const hostedFilteredMeetings = useMemo(() => {
    const pk = userId?.trim() ?? '';
    const ns = pk ? normalizeParticipantId(pk) : '';
    if (!ns) return [];
    const base = meetings.filter((m) => {
      const c = m.createdBy?.trim() ?? '';
      if (!c) return false;
      return (normalizeParticipantId(c) ?? c) === ns;
    });
    return base.filter((m) => {
      if (!meetingMatchesCategoryFilter(m, selectedCategoryId, categories)) return false;
      if (recruitingOnly && getMeetingRecruitmentPhase(m) !== 'recruiting') return false;
      if (!meetingMatchesFeedSearch(m, appliedFeedSearch)) return false;
      return true;
    });
  }, [meetings, userId, selectedCategoryId, categories, recruitingOnly, appliedFeedSearch]);

  const sortedHostedMeetings = useMemo(
    () => sortMeetingsForFeed(hostedFilteredMeetings, listSortMode, userCoords),
    [hostedFilteredMeetings, listSortMode, userCoords],
  );

  const guestFilteredMeetings = useMemo(() => {
    const pk = userId?.trim() ?? '';
    const ns = pk ? normalizeParticipantId(pk) : '';
    // 게스트: 참여했지만(Joined) 방장은 아닌 모임만
    const base = filterJoinedMeetings(meetings, userId).filter((m) => {
      if (!ns) return true;
      const c = m.createdBy?.trim() ?? '';
      if (!c) return true;
      return (normalizeParticipantId(c) ?? c) !== ns;
    });
    return base.filter((m) => {
      if (!meetingMatchesCategoryFilter(m, selectedCategoryId, categories)) return false;
      if (recruitingOnly && getMeetingRecruitmentPhase(m) !== 'recruiting') return false;
      if (!meetingMatchesFeedSearch(m, appliedFeedSearch)) return false;
      return true;
    });
  }, [meetings, userId, selectedCategoryId, categories, recruitingOnly, appliedFeedSearch]);

  const sortedGuestMeetings = useMemo(
    () => sortMeetingsForFeed(guestFilteredMeetings, listSortMode, userCoords),
    [guestFilteredMeetings, listSortMode, userCoords],
  );

  const homeListData =
    homeTab === 'explore' ? exploreFeedMeetings : homeTab === 'host' ? sortedHostedMeetings : sortedGuestMeetings;

  const openRegionModal = useCallback(() => setRegionModalOpen(true), []);
  const closeRegionModal = useCallback(() => setRegionModalOpen(false), []);
  const pickRegion = useCallback((shortLabel: string) => {
    manualRegionPickRef.current = true;
    regionLabelRef.current = shortLabel;
    setRegionLabel(shortLabel);
    setRegionModalOpen(false);
    void saveFeedLocationCache(shortLabel, userCoordsRef.current);
  }, []);

  const selectedFilterLabel = useMemo(() => {
    if (selectedCategoryId == null) return null;
    return categories.find((c) => c.id === selectedCategoryId)?.label ?? null;
  }, [categories, selectedCategoryId]);

  const categoryDropdownLabel = selectedFilterLabel ?? '전체';

  const sortComboLabel = useMemo(() => listSortModeLabel(listSortMode), [listSortMode]);

  const regionPickerRows = useMemo(() => {
    // 인접 구 목록은 "실제 위치" 기준으로만 계산(선택 지역은 탐색 필터에만 사용)
    const baseLabel = actualLocationLabel.trim() || regionLabel.trim();
    const gu = parseSeoulGuFromLabel(baseLabel);
    if (!gu) {
      // 서울이 아닌 지역은 "현재 접속 지역"만 표시(다른 지역 선택 불가)
      const t = baseLabel.trim();
      return [{ id: t || FEED_LOCATION_FALLBACK_SHORT, label: t || FEED_LOCATION_FALLBACK_SHORT }];
    }
    const neighbors = SEOUL_GU_NEIGHBORS[gu] ?? [];
    const set = new Set<SeoulGuLabel>([gu, ...neighbors]);
    // UX: 항상 현재 구를 최상단, 나머지는 가나다순
    const rest = [...set].filter((x) => x !== gu).sort((a, b) => a.localeCompare(b, 'ko-KR'));
    return [{ id: gu, label: gu }, ...rest.map((label) => ({ id: label, label }))];
  }, [actualLocationLabel, regionLabel]);

  const openFeedListSettingsModal = useCallback(() => setFeedListSettingsModalOpen(true), []);
  const closeFeedListSettingsModal = useCallback(() => setFeedListSettingsModalOpen(false), []);

  const feedListSettingsDotActive = useMemo(
    () => recruitingOnly || feedSearchFiltersActive(appliedFeedSearch) || listSortMode !== 'latest',
    [recruitingOnly, appliedFeedSearch, listSortMode],
  );

  const openCategoryPicker = useCallback(() => setCategoryPickerOpen(true), []);
  const closeCategoryPicker = useCallback(() => setCategoryPickerOpen(false), []);

  const openFeedSearch = useCallback(() => {
    setDraftFeedSearch(appliedFeedSearch);
    setFeedSearchModalOpen(true);
  }, [appliedFeedSearch]);
  const closeFeedSearch = useCallback(() => setFeedSearchModalOpen(false), []);
  const applyFeedSearch = useCallback(() => {
    setAppliedFeedSearch(draftFeedSearch);
    setFeedSearchModalOpen(false);
  }, [draftFeedSearch]);

  const onPullRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetchMeetingsFeed();
    } finally {
      setRefreshing(false);
    }
  }, [refetchMeetingsFeed]);

  const onEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const listFooter = useMemo(
    () =>
      showFooterSpinner && !refreshing ? (
        <View style={styles.listFooterLoading}>
          <ActivityIndicator />
        </View>
      ) : null,
    [showFooterSpinner, refreshing],
  );

  const onMainScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    emitTabBarFabDocked(y > 6);
  }, []);

  const onPressMeetingFromGrid = useCallback(
    (m: Meeting) => {
      const pk = userId?.trim() ?? '';
      if (!pk) {
        Alert.alert('로그인이 필요해요', '모임 상세는 로그인 후 볼 수 있어요.');
        return;
      }
      // feedUserProfile은 탭 진입 직후 null일 수 있어(비동기 로드),
      // 클릭 시점에는 최신 프로필을 한 번 더 조회해서 잘못 막히는 케이스를 방지합니다.
      void (async () => {
        try {
          await ensureUserProfile(pk);
          const p = await getUserProfile(pk);
          const ok = isMeetingServiceComplianceComplete(p, pk);
          if (!ok) {
            Alert.alert(
              '프로필을 완성해 주세요',
              '모임 상세를 보려면 모임 이용을 위한 인증 정보 등록(약관 동의·전화 인증·성별/생년월일)을 먼저 완료해 주세요.',
              [
                { text: '닫기', style: 'cancel' },
                { text: '정보 등록하기', onPress: () => pushProfileOpenRegisterInfo(router) },
              ],
            );
            return;
          }
          router.push(`/meeting/${m.id}`);
        } catch {
          // 네트워크 실패 등으로 프로필을 못 읽어도, "미인증"으로 단정해 막지 않습니다.
          router.push(`/meeting/${m.id}`);
        }
      })();
    },
    [router, userId],
  );

  const renderHomeItem = useCallback(
    ({ item }: { item: Meeting }) => {
      const pk = userId?.trim() ?? '';
      const ns = pk ? normalizeParticipantId(pk) : '';
      const isHost = Boolean(ns) && (normalizeParticipantId(item.createdBy?.trim() ?? '') ?? '') === ns;
      const isJoined = isUserJoinedMeeting(item, userId);
      const ownership: 'hosted' | 'joined' | 'none' = isHost ? 'hosted' : isJoined ? 'joined' : 'none';
      return (
        <HomeMeetingListItem
          meeting={item}
          userCoords={userCoords}
          joined={isJoined}
          ownership={ownership}
          onPress={() => onPressMeetingFromGrid(item)}
          scheduleOverlapWarning={
            Boolean(userId) && meetingOverlapsUserConfirmedSlots(item, myConfirmedScheduleSlots, overlapBufferHours)
          }
          symbolBox={feedMeetingSymbolBox(item, feedHostProfileMap)}
          categories={categories}
        />
      );
    },
    [
      userCoords,
      userId,
      myConfirmedScheduleSlots,
      overlapBufferHours,
      feedHostProfileMap,
      categories,
      onPressMeetingFromGrid,
    ],
  );

  const listHeader = (
    <>
      <View style={styles.feedHeader}>
        <View style={styles.feedHeaderTopRow}>
          <Pressable
            onPress={openRegionModal}
            style={({ pressed }) => [styles.locationClusterPressable, pressed && styles.locationClusterPressed]}
            accessibilityRole="button"
            accessibilityLabel="지역 설정 열기"
            hitSlop={8}>
            <View style={styles.locationCluster}>
              <Text
                style={styles.locationText}
                numberOfLines={1}
                accessibilityLabel={`현재 표시 지역 ${formatSeoulGuLabel(regionLabel)}`}>
                {formatSeoulGuLabel(regionLabel)}
              </Text>
              <Ionicons name="chevron-down" size={20} color={GinitTheme.colors.primary} />
            </View>
          </Pressable>
          <View style={styles.headerActions}>
            <Pressable
              onPress={openFeedSearch}
              accessibilityRole="button"
              accessibilityLabel="검색 및 조건 필터"
              hitSlop={10}
              style={styles.searchIconWrap}>
              <Ionicons name="search-outline" size={24} color="#0f172a" />
              {feedSearchFiltersActive(appliedFeedSearch) ? <View style={styles.searchFilterDot} /> : null}
            </Pressable>
            <InAppAlarmsBellButton />
            <Pressable
              onPress={openFeedListSettingsModal}
              accessibilityRole="button"
              accessibilityLabel="목록 정렬 및 필터 설정"
              hitSlop={10}
              style={styles.settingsIconWrap}>
              <Ionicons name="settings-outline" size={24} color="#0f172a" />
              {feedListSettingsDotActive ? <View style={styles.settingsFilterDot} /> : null}
            </Pressable>
          </View>
        </View>
        <View style={styles.tabCategoryBar}>
          <View style={styles.tabPair}>
            <GlassCategoryChip
              label="탐색"
              active={homeTab === 'explore'}
              onPress={() => setHomeTab('explore')}
              maxLabelWidth={tabChipMaxWidth}
              accessibilityLabel="탐색"
            />
            <GlassCategoryChip
              label="호스트"
              active={homeTab === 'host'}
              onPress={() => setHomeTab('host')}
              maxLabelWidth={tabChipMaxWidth}
              accessibilityLabel="호스트"
            />
            <GlassCategoryChip
              label="게스트"
              active={homeTab === 'guest'}
              onPress={() => setHomeTab('guest')}
              maxLabelWidth={tabChipMaxWidth}
              accessibilityLabel="게스트"
            />
          </View>
          <Pressable
            onPress={openCategoryPicker}
            style={({ pressed }) => [styles.categoryDropdown, pressed && styles.categoryDropdownPressed]}
            accessibilityRole="button"
            accessibilityLabel={`카테고리, 현재 ${categoryDropdownLabel}`}
            accessibilityHint="탭하면 카테고리를 선택할 수 있어요"
            accessibilityState={{ expanded: categoryPickerOpen }}>
            <Text style={styles.categoryDropdownText} numberOfLines={1} ellipsizeMode="tail">
              {categoryDropdownLabel}
            </Text>
            <Ionicons name="chevron-down" size={18} color="#475569" />
          </Pressable>
        </View>
      </View>

      {listError ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorTitle}>목록을 불러오지 못했어요</Text>
          <Text style={styles.errorBody}>{listError}</Text>
        </View>
      ) : null}

      {!isInitialListLoading && !listError && meetings.length === 0 ? (
        <Text style={styles.empty}>등록된 모임이 없습니다. + 버튼으로 첫 모임을 만들어 보세요.</Text>
      ) : null}

      {!isInitialListLoading && !listError && meetings.length > 0 && meetingsWithinRadius.length === 0 && userCoords ? (
        <Text style={styles.empty}>내 위치 기준 반경 5km 안에 등록된 모임이 없어요.</Text>
      ) : null}

      {!isInitialListLoading &&
      !listError &&
      meetingsWithinRadius.length > 0 &&
      filteredMeetings.length === 0 &&
      homeTab === 'explore' ? (
        <Text style={styles.empty}>
          {feedSearchFiltersActive(appliedFeedSearch)
            ? '검색·조건에 맞는 모임이 없어요. 검색을 열어 필터를 바꿔 보세요.'
            : selectedFilterLabel
              ? `「${selectedFilterLabel}」 카테고리 모임이 아직 없어요. 다른 카테고리를 선택해 보세요.`
              : recruitingOnly
                ? '모집중인 모임이 없어요. 모집중만 표시를 끄면 모집 완료·확정 모임도 볼 수 있어요.'
                : '조건에 맞는 모임이 없어요.'}
        </Text>
      ) : null}

      {!isInitialListLoading && !listError && meetingsWithinRadius.length > 0 && joinedFilteredMeetings.length === 0 && homeTab === 'mine' ? (
        <Text style={styles.empty}>조건에 맞는 내 모임이 없어요. 필터를 바꾸거나 탐색에서 모임에 참여해 보세요.</Text>
      ) : null}

      {!isInitialListLoading &&
      !listError &&
      homeTab === 'explore' &&
      meetingsWithinRadius.length > 0 &&
      filteredMeetings.length > 0 &&
      exploreFeedMeetings.length === 0 ? (
        <Text style={styles.empty}>현재 필터에서 보여줄 공개 모임이 없어요.</Text>
      ) : null}
    </>
  );

  return (
    <ScreenShell padded={false} style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <FlatList
          data={homeListData}
          keyExtractor={(m) => m.id}
          extraData={{
            homeTab,
            listSortMode,
            recruitingOnly,
            selectedCategoryId,
            appliedFeedSearch,
            exploreLen: exploreFeedMeetings.length,
          }}
          renderItem={renderHomeItem}
          ListHeaderComponent={listHeader}
          ListFooterComponent={listFooter}
          contentContainerStyle={styles.scroll}
          style={styles.listFlex}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          removeClippedSubviews
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          windowSize={9}
          onScroll={onMainScroll}
          scrollEventThrottle={16}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.6}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onPullRefresh}
              tintColor={GinitTheme.colors.primary}
              colors={[GinitTheme.colors.primary]}
            />
          }
        />

        <Modal
          visible={feedListSettingsModalOpen}
          animationType="fade"
          transparent
          onRequestClose={closeFeedListSettingsModal}>
          <View style={styles.modalRoot}>
            <Pressable
              style={StyleSheet.absoluteFillObject}
              onPress={closeFeedListSettingsModal}
              accessibilityRole="button"
              accessibilityLabel="목록 설정 닫기"
            />
            <View style={[styles.modalCard, styles.modalCardWide]}>
              <Text style={styles.modalTitle}>목록 설정</Text>
              <Text style={styles.modalHint}>
                정렬·모집중만 보기·검색 조건을 한곳에서 바꿀 수 있어요. (카테고리는 상단 드롭다운)
              </Text>
              <Text style={styles.modalCurrentSummary} numberOfLines={2}>
                현재 정렬: {sortComboLabel}
                {recruitingOnly ? ' · 모집중만 표시' : ''}
              </Text>

              <ScrollView style={styles.feedSettingsScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                <Text style={styles.modalSectionTitle}>정렬</Text>
                {(['distance', 'latest', 'soon'] as const).map((mode) => {
                  const selected = listSortMode === mode;
                  const label = listSortModeLabel(mode);
                  return (
                    <Pressable
                      key={mode}
                      onPress={() => setListSortMode(mode)}
                      style={({ pressed }) => [styles.modalRow, pressed && styles.modalRowPressed]}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}>
                      <Text style={styles.modalRowLabel}>{label}</Text>
                      {selected ? (
                        <Ionicons name="checkmark-circle" size={22} color={GinitTheme.colors.primary} />
                      ) : (
                        <Ionicons name="ellipse-outline" size={22} color="#cbd5e1" />
                      )}
                    </Pressable>
                  );
                })}

                <Text style={styles.modalSectionTitle}>표시</Text>
                <Pressable
                  onPress={() => setRecruitingOnly((v) => !v)}
                  style={({ pressed }) => [styles.modalRow, pressed && styles.modalRowPressed]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: recruitingOnly }}
                  accessibilityLabel="모집중만 보기">
                  <View style={styles.modalRowLabelBlock}>
                    <Text style={styles.modalRowLabel}>모집중만 보기</Text>
                    <Text style={styles.modalRowSub}>정원 미달·일정 미확정 모임만</Text>
                  </View>
                  <View style={[styles.recruitTogglePill, recruitingOnly && styles.recruitTogglePillOn]}>
                    <Text style={[styles.recruitTogglePillLabel, recruitingOnly && styles.recruitTogglePillLabelOn]}>
                      {recruitingOnly ? '켜짐' : '꺼짐'}
                    </Text>
                  </View>
                </Pressable>
              </ScrollView>

              <Pressable onPress={closeFeedListSettingsModal} style={styles.modalCloseBtn} accessibilityRole="button">
                <Text style={styles.modalCloseLabel}>닫기</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        <FeedSearchFilterModal
          visible={feedSearchModalOpen}
          filters={draftFeedSearch}
          onChangeFilters={setDraftFeedSearch}
          onClose={closeFeedSearch}
          onApply={applyFeedSearch}
        />

        <Modal
          visible={regionModalOpen}
          animationType="fade"
          transparent
          onRequestClose={closeRegionModal}>
          <View style={styles.modalRoot}>
            <Pressable
              style={StyleSheet.absoluteFillObject}
              onPress={closeRegionModal}
              accessibilityRole="button"
              accessibilityLabel="지역 설정 닫기"
            />
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>지역 설정</Text>
              <Text style={styles.modalHint}>
                서울은 현재 구와 인접한 구만 선택할 수 있어요. 서울 외 지역은 현재 접속 지역만 표시됩니다.
              </Text>
              {regionPickerRows.map((row) => (
                <Pressable
                  key={row.id}
                  onPress={() => pickRegion(row.label)}
                  style={({ pressed }) => [styles.modalRow, pressed && styles.modalRowPressed]}
                  accessibilityRole="button">
                  <Text style={styles.modalRowLabel}>{row.label}</Text>
                  {regionLabel === row.label ? (
                    <Ionicons name="checkmark-circle" size={22} color={GinitTheme.colors.primary} />
                  ) : (
                    <Ionicons name="chevron-forward" size={20} color="#94a3b8" />
                  )}
                </Pressable>
              ))}
              <Pressable onPress={closeRegionModal} style={styles.modalCloseBtn} accessibilityRole="button">
                <Text style={styles.modalCloseLabel}>닫기</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        <Modal
          visible={categoryPickerOpen}
          animationType="fade"
          transparent
          onRequestClose={closeCategoryPicker}>
          <View style={styles.modalRoot}>
            <Pressable
              style={StyleSheet.absoluteFillObject}
              onPress={closeCategoryPicker}
              accessibilityRole="button"
              accessibilityLabel="카테고리 선택 닫기"
            />
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>카테고리</Text>
              <Text style={styles.modalHint}>표시할 모임 종류를 선택하세요.</Text>
              {feedChips.map((chip) => {
                const selected = chip.filterId === selectedCategoryId;
                return (
                  <Pressable
                    key={chip.filterId ?? 'all'}
                    onPress={() => {
                      setSelectedCategoryId(chip.filterId);
                      closeCategoryPicker();
                    }}
                    style={({ pressed }) => [styles.modalRow, pressed && styles.modalRowPressed]}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}>
                    <Text style={styles.modalRowLabel}>{chip.label}</Text>
                    {selected ? (
                      <Ionicons name="checkmark-circle" size={22} color={GinitTheme.colors.primary} />
                    ) : (
                      <Ionicons name="ellipse-outline" size={22} color="#cbd5e1" />
                    )}
                  </Pressable>
                );
              })}
              <Pressable onPress={closeCategoryPicker} style={styles.modalCloseBtn} accessibilityRole="button">
                <Text style={styles.modalCloseLabel}>닫기</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: GinitTheme.colors.bg },
  safe: {
    flex: 1,
  },
  listFlex: {
    flex: 1,
  },
  scroll: {
    paddingHorizontal: 20,
    paddingBottom: 28,
    flexGrow: 1,
  },
  tabCategoryBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 2,
  },
  tabPair: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
    minWidth: 0,
  },
  categoryDropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
    maxWidth: 150,
    minWidth: 96,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.82)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.12)',
  },
  categoryDropdownPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderColor: 'rgba(0, 82, 204, 0.25)',
  },
  categoryDropdownText: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  feedHeader: {
    marginBottom: 16,
    paddingTop: 4,
    gap: 12,
  },
  feedHeaderTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  locationCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
    gap: 4,
  },
  locationClusterPressable: {
    alignSelf: 'flex-start',
    maxWidth: 220,
    borderRadius: 10,
    paddingVertical: 2,
    paddingHorizontal: 2,
  },
  locationClusterPressed: {
    backgroundColor: 'rgba(15, 23, 42, 0.05)',
  },
  locationText: {
    flexShrink: 1,
    fontSize: 20,
    fontWeight: '700',
    color: GinitTheme.trustBlue,
    minWidth: 0,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    flexShrink: 0,
  },
  searchIconWrap: {
    position: 'relative',
    padding: 2,
  },
  searchFilterDot: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#EF4444',
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  settingsIconWrap: {
    position: 'relative',
    padding: 2,
  },
  settingsFilterDot: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#EF4444',
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  /** 정렬 콤보 옆 — 모집중만 표시 토글(기존 pill과 동일 크기·초록 on, 기본 off) */
  recruitTogglePill: {
    flexShrink: 0,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.55)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.1)',
  },
  recruitTogglePillOn: {
    backgroundColor: '#16A34A',
    borderColor: '#16A34A',
  },
  recruitTogglePillLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  recruitTogglePillLabelOn: {
    color: '#FFFFFF',
  },
  listFooterLoading: {
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  muted: {
    fontSize: 14,
    color: '#64748b',
  },
  errorBox: {
    marginBottom: 14,
    padding: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(220, 38, 38, 0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(220, 38, 38, 0.25)',
  },
  errorTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#B91C1C',
    marginBottom: 6,
  },
  errorBody: {
    fontSize: 14,
    color: '#7F1D1D',
    lineHeight: 20,
  },
  empty: {
    fontSize: 14,
    color: '#64748b',
    lineHeight: 20,
    marginBottom: 12,
  },
  modalRoot: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    borderRadius: 20,
    padding: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.6)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 8,
  },
  modalCardWide: {
    maxHeight: '92%',
  },
  feedSettingsScroll: {
    maxHeight: 400,
  },
  modalCurrentSummary: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
    lineHeight: 17,
    marginBottom: 8,
  },
  modalSectionTitle: {
    marginTop: 4,
    marginBottom: 2,
    fontSize: 13,
    fontWeight: '800',
    color: '#475569',
  },
  modalRowLabelBlock: {
    flex: 1,
    minWidth: 0,
    marginRight: 8,
  },
  modalRowSub: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 6,
  },
  modalHint: {
    fontSize: 13,
    lineHeight: 18,
    color: '#64748b',
    marginBottom: 16,
  },
  modalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(15, 23, 42, 0.08)',
  },
  modalRowPressed: {
    backgroundColor: 'rgba(0, 82, 204, 0.06)',
  },
  modalRowLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0f172a',
  },
  modalCloseBtn: {
    marginTop: 16,
    alignSelf: 'center',
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  modalCloseLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: GinitTheme.trustBlue,
  },
});
