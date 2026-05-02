import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  FlatList,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  ToastAndroid,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { FeedSearchFilterModal } from '@/components/feed/FeedSearchFilterModal';
import { HomeMeetingListItem } from '@/components/feed/HomeMeetingListItem';
import { InAppAlarmsBellButton } from '@/components/in-app-alarms/InAppAlarmsBellButton';
import { ScreenShell } from '@/components/ui';
import { GinitSymbolicIcon, type SymbolicIconName } from '@/components/ui/GinitSymbolicIcon';
import { GinitTheme } from '@/constants/ginit-theme';
import { useAppPolicies } from '@/src/context/AppPoliciesContext';
import { useUserSession } from '@/src/context/UserSessionContext';
import { useMeetingsFeedInfiniteQuery } from '@/src/hooks/use-meetings-feed-infinite-query';
import { normalizeParticipantId, normalizeUserId } from '@/src/lib/app-user-id';
import type { Category } from '@/src/lib/categories';
import { subscribeCategories } from '@/src/lib/categories';
import {
  haystackMatchesFeedRegion,
  normalizeFeedRegionLabel,
  resolveFeedLocationContextWithoutPermissionPrompt,
} from '@/src/lib/feed-display-location';
import {
  defaultFeedSearchFilters,
  feedMeetingSymbolBox,
  feedSearchFiltersActive,
  listSortModeLabel,
  meetingMatchesCategoryFilter,
  meetingMatchesFeedSearch,
  meetingWithinHomeFeedRadius,
  sortMeetingsForFeed,
  type FeedSearchFilters,
  type MeetingListSortMode,
} from '@/src/lib/feed-meeting-utils';
import { loadFeedCategoryBarVisibleIds, persistFeedCategoryBarVisibleIds } from '@/src/lib/feed-category-bar-preference';
import {
  FEED_REGISTERED_REGIONS_MAX,
  loadActiveFeedRegion,
  loadRegisteredFeedRegions,
  saveActiveFeedRegion,
  saveRegisteredFeedRegions,
} from '@/src/lib/feed-registered-regions';
import { meetingListSource } from '@/src/lib/hybrid-data-source';
import { filterJoinedMeetings, isUserJoinedMeeting } from '@/src/lib/joined-meetings';
import { getInterestRegionDisplayLabel, searchKoreaInterestDistricts } from '@/src/lib/korea-interest-districts';
import { sweepStalePublicUnconfirmedMeetingsForHost } from '@/src/lib/meeting-expiry-sweep';
import { fetchMeetingAreaNotifyMatrix } from '@/src/lib/meeting-area-notify-rules';
import {
  collectUserConfirmedScheduleSlots,
  getScheduleOverlapBufferHours,
  meetingOverlapsUserConfirmedSlots,
} from '@/src/lib/meeting-schedule-overlap';
import type { Meeting } from '@/src/lib/meetings';
import { getMeetingRecruitmentPhase } from '@/src/lib/meetings';
import { pushProfileOpenRegisterInfo } from '@/src/lib/profile-register-info';
import { fetchMyMeetingsForFeedFromSupabase } from '@/src/lib/supabase-meetings-list';
import { emitTabBarFabDocked } from '@/src/lib/tabbar-fab-scroll';
import {
  ensureUserProfile,
  getUserProfile,
  getUserProfilesForIds,
  isMeetingServiceComplianceComplete,
  type UserProfile,
} from '@/src/lib/user-profile';

/** `app/profile/settings` 공개 모임 생성 알림 스위치 트랙과 동일 */
const meetingCreateSwitchTrack = { false: '#cbd5e1', true: GinitTheme.themeMainColor } as const;

function meetingMatchesSelectedRegion(m: Meeting, regionLabel: string): boolean {
  const hay = [m.address, m.location, m.placeName]
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .join(' ');
  return haystackMatchesFeedRegion(hay, regionLabel);
}

export default function FeedScreen() {
  const router = useRouter();
  const { userId, authProfile } = useUserSession();
  const { version: appPoliciesVersion } = useAppPolicies();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const safeInsets = useSafeAreaInsets();
  /** 탐색·내 모임 칩 — 우측 카테고리 드롭다운(maxWidth 150)과 폭 기준을 맞춤 */
  const tabChipMaxWidth = 150;
  /** 전역 모임 없음 안내를 리스트 영역 세로 중앙에 두기 위한 최소 높이 */
  const globalEmptyMinHeight = useMemo(
    () => Math.max(300, windowHeight - safeInsets.top - safeInsets.bottom - 200),
    [windowHeight, safeInsets.top, safeInsets.bottom],
  );

  /** 탐색 탭: 등록된 서울 구 최대 5곳 + 그중 표시용 1곳(active). GPS 없음. */
  const [registeredRegions, setRegisteredRegions] = useState<string[]>([]);
  const registeredRegionsRef = useRef<string[]>([]);
  /** 탐색 필터에 쓰는 «현재 선택» 구(등록 목록에 포함된 정규화 라벨) */
  const [activeRegionNorm, setActiveRegionNorm] = useState<string | null>(null);
  const [draftRegisteredRegions, setDraftRegisteredRegions] = useState<string[]>([]);
  /** 관심 지역 목록 로드 완료 전에는 탐색 지역 필터를 적용하지 않음 */
  const [feedLocationReady, setFeedLocationReady] = useState(false);
  const [regionModalOpen, setRegionModalOpen] = useState(false);
  const [regionDropdownOpen, setRegionDropdownOpen] = useState(false);
  const [regionSearchModalOpen, setRegionSearchModalOpen] = useState(false);
  const [regionSearchQuery, setRegionSearchQuery] = useState('');
  const [regionSearchKeyboardVisible, setRegionSearchKeyboardVisible] = useState(false);
  const [feedListSettingsModalOpen, setFeedListSettingsModalOpen] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [listSortMode, setListSortMode] = useState<MeetingListSortMode>('soon');
  /** true면 모집중(정원 미달·미확정) 모임만 표시. 기본값 off */
  const [recruitingOnly, setRecruitingOnly] = useState(false);
  const [feedSearchModalOpen, setFeedSearchModalOpen] = useState(false);
  const [appliedFeedSearch, setAppliedFeedSearch] = useState<FeedSearchFilters>(() => defaultFeedSearchFilters());
  const [draftFeedSearch, setDraftFeedSearch] = useState<FeedSearchFilters>(() => defaultFeedSearchFilters());
  /** 홈 상단 탭: 공개 모임 탐색 vs 호스트/게스트 */
  const [homeTab, setHomeTab] = useState<'explore' | 'my'>('explore');
  const tabPagerRef = useRef<ScrollView | null>(null);
  const homeTabRef = useRef(homeTab);
  homeTabRef.current = homeTab;
  /** Android: 모임 탭 포커스 시 하드웨어 뒤로가기 이중 탭으로만 종료 */
  const homeExitBackPressRef = useRef(0);

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
  } = useMeetingsFeedInfiniteQuery({ enabled: feedLocationReady });

  const [myMeetings, setMyMeetings] = useState<Meeting[]>([]);
  const loadMyMeetings = useCallback(async () => {
    const uid = userId?.trim() ?? '';
    if (!feedLocationReady || !uid) {
      setMyMeetings([]);
      return;
    }
    if (meetingListSource() !== 'supabase') {
      setMyMeetings([]);
      return;
    }
    const res = await fetchMyMeetingsForFeedFromSupabase(uid);
    if (!res.ok) {
      setMyMeetings([]);
      return;
    }
    setMyMeetings(res.meetings);
  }, [feedLocationReady, userId]);
  const shouldLoadMyMeetings = useMemo(() => {
    if (!feedLocationReady) return false;
    if (!userId?.trim()) return false;
    return meetingListSource() === 'supabase';
  }, [feedLocationReady, userId]);
  useEffect(() => {
    let cancelled = false;
    if (!shouldLoadMyMeetings) {
      setMyMeetings([]);
      return;
    }
    void (async () => {
      const res = await fetchMyMeetingsForFeedFromSupabase(userId!.trim());
      if (cancelled) return;
      if (!res.ok) {
        setMyMeetings([]);
        return;
      }
      setMyMeetings(res.meetings);
    })();
    return () => {
      cancelled = true;
    };
  }, [shouldLoadMyMeetings, userId]);
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  /** 피드 카테고리 모달 초안: 표시할 마스터 id + 현재 필터(null=전체) */
  const [categoryPickerDraft, setCategoryPickerDraft] = useState<{
    visibility: string[];
    filter: string | null;
  }>({ visibility: [], filter: null });
  /** `null`이면 드롭다운에 카테고리 마스터 전부 표시 */
  const [feedBarVisibleCategoryIds, setFeedBarVisibleCategoryIds] = useState<string[] | null>(null);
  const [feedUserProfile, setFeedUserProfile] = useState<UserProfile | null>(null);
  const [feedCoords, setFeedCoords] = useState<{ latitude: number; longitude: number } | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return undefined;
      const anyOverlayOpen =
        regionSearchModalOpen ||
        regionDropdownOpen ||
        regionModalOpen ||
        feedListSettingsModalOpen ||
        feedSearchModalOpen ||
        categoryPickerOpen;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (anyOverlayOpen) return false;
        const now = Date.now();
        if (now - homeExitBackPressRef.current < 2200) {
          BackHandler.exitApp();
          return true;
        }
        homeExitBackPressRef.current = now;
        ToastAndroid.show('한 번 더 누르면 앱이 종료돼요.', ToastAndroid.SHORT);
        return true;
      });
      return () => {
        homeExitBackPressRef.current = 0;
        sub.remove();
      };
    }, [
      regionSearchModalOpen,
      regionDropdownOpen,
      regionModalOpen,
      feedListSettingsModalOpen,
      feedSearchModalOpen,
      categoryPickerOpen,
    ]),
  );

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
    registeredRegionsRef.current = registeredRegions;
  }, [registeredRegions]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const regions = await loadRegisteredFeedRegions();
        if (cancelled) return;
        registeredRegionsRef.current = regions;
        setRegisteredRegions(regions);
        const activeRaw = await loadActiveFeedRegion();
        if (cancelled) return;
        let nextActive: string | null = null;
        if (regions.length > 0) {
          const set = new Set(regions.map((r) => normalizeFeedRegionLabel(r)));
          const candidate = activeRaw && set.has(activeRaw) ? activeRaw : normalizeFeedRegionLabel(regions[0]!);
          nextActive = candidate;
          if (activeRaw !== candidate) void saveActiveFeedRegion(candidate);
        } else {
          void saveActiveFeedRegion(null);
        }
        if (!cancelled) setActiveRegionNorm(nextActive);
      } finally {
        if (!cancelled) setFeedLocationReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!feedLocationReady) return;
    let alive = true;
    void (async () => {
      // 위치 권한이 이미 허용된 경우에만 GPS 좌표를 읽습니다(미동의 시 요청·검색 없음).
      const ctx = await resolveFeedLocationContextWithoutPermissionPrompt();
      if (!alive) return;
      setFeedCoords(ctx.coords);
    })();
    return () => {
      alive = false;
    };
  }, [feedLocationReady]);

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
    let cancelled = false;
    void loadFeedCategoryBarVisibleIds().then((v) => {
      if (!cancelled) setFeedBarVisibleCategoryIds(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!categories.length || feedBarVisibleCategoryIds == null) return;
    const idSet = new Set(categories.map((c) => c.id));
    const valid = feedBarVisibleCategoryIds.filter((id) => idSet.has(id));
    if (valid.length === feedBarVisibleCategoryIds.length) return;
    const next =
      valid.length === 0 || valid.length === categories.length ? null : valid;
    setFeedBarVisibleCategoryIds(next);
    void persistFeedCategoryBarVisibleIds(next);
  }, [categories, feedBarVisibleCategoryIds]);

  useEffect(() => {
    if (selectedCategoryId == null) return;
    const id = selectedCategoryId;
    if (categories.length > 0 && !categories.some((c) => c.id === id)) {
      setSelectedCategoryId(null);
      return;
    }
    if (feedBarVisibleCategoryIds != null && !feedBarVisibleCategoryIds.includes(id)) {
      setSelectedCategoryId(null);
    }
  }, [categories, feedBarVisibleCategoryIds, selectedCategoryId]);

  const meetingsWithinRadius = useMemo(() => {
    // 탐색 목록은 좌측 상단 선택 구(문자열)로 거르고, GPS 5km 반경은 쓰지 않습니다.
    // (로드된 페이지 안에서만 필터 — 서버는 전역 페이지네이션)
    return meetings.filter((m) => meetingWithinHomeFeedRadius(m, null));
  }, [meetings]);

  const sortedFeedCategoryMaster = useMemo(
    () =>
      [...categories].sort((a, b) =>
        a.order !== b.order ? a.order - b.order : a.label.localeCompare(b.label, 'ko'),
      ),
    [categories],
  );

  /** 탐색에 적용할 단일 구(등록 목록·active 동기화) */
  const exploreActiveRegionNorm = useMemo(() => {
    if (!feedLocationReady || registeredRegions.length === 0) return '';
    const set = new Set(registeredRegions.map((r) => normalizeFeedRegionLabel(r)));
    const a = activeRegionNorm ? normalizeFeedRegionLabel(activeRegionNorm) : '';
    if (a && set.has(a)) return a;
    return normalizeFeedRegionLabel(registeredRegions[0]!);
  }, [feedLocationReady, registeredRegions, activeRegionNorm]);

  const filteredMeetings = useMemo(() => {
    return meetingsWithinRadius.filter((m) => {
      if (feedLocationReady) {
        if (registeredRegions.length === 0 || !exploreActiveRegionNorm) return false;
        if (!meetingMatchesSelectedRegion(m, exploreActiveRegionNorm)) return false;
      }
      if (!meetingMatchesCategoryFilter(m, selectedCategoryId, categories)) return false;
      if (recruitingOnly && getMeetingRecruitmentPhase(m) !== 'recruiting') return false;
      if (!meetingMatchesFeedSearch(m, appliedFeedSearch)) return false;
      return true;
    });
  }, [
    meetingsWithinRadius,
    registeredRegions,
    exploreActiveRegionNorm,
    feedLocationReady,
    selectedCategoryId,
    categories,
    recruitingOnly,
    appliedFeedSearch,
  ]);

  const sortedFilteredMeetings = useMemo(() => {
    return sortMeetingsForFeed(filteredMeetings, listSortMode, feedCoords);
  }, [filteredMeetings, listSortMode, feedCoords]);

  /** 탐색 탭: 비공개(`false`)뿐 아니라 플래그 미설정(`null`/`undefined`)도 목록에서 제외 */
  const exploreFeedMeetings = useMemo(
    () => sortedFilteredMeetings.filter((m) => m.isPublic === true),
    [sortedFilteredMeetings],
  );

  const myTabsMeetings = useMemo(() => {
    if (meetingListSource() !== 'supabase') return meetings;
    if (myMeetings.length === 0) return meetings;
    const seen = new Set<string>();
    const out: Meeting[] = [];
    for (const m of meetings) {
      if (!m?.id) continue;
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      out.push(m);
    }
    for (const m of myMeetings) {
      if (!m?.id) continue;
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      out.push(m);
    }
    return out;
  }, [meetings, myMeetings]);

  const joinedFilteredMeetings = useMemo(() => {
    // 내 모임 탭은 “현재 접속 지역”과 무관하게 내가 만든/참여한 모임을 모두 보여줍니다.
    const base = filterJoinedMeetings(myTabsMeetings, userId);
    return base.filter((m) => {
      if (!meetingMatchesCategoryFilter(m, selectedCategoryId, categories)) return false;
      if (recruitingOnly && getMeetingRecruitmentPhase(m) !== 'recruiting') return false;
      if (!meetingMatchesFeedSearch(m, appliedFeedSearch)) return false;
      return true;
    });
  }, [myTabsMeetings, userId, selectedCategoryId, categories, recruitingOnly, appliedFeedSearch]);

  const sortedJoinedMeetings = useMemo(
    () => sortMeetingsForFeed(joinedFilteredMeetings, listSortMode, feedCoords),
    [joinedFilteredMeetings, listSortMode, feedCoords],
  );

  const goToHomeTab = useCallback(
    (t: 'explore' | 'my') => {
      setHomeTab(t);
      const idx = t === 'explore' ? 0 : 1;
      requestAnimationFrame(() => {
        tabPagerRef.current?.scrollTo({ x: idx * windowWidth, animated: true });
      });
    },
    [windowWidth],
  );

  const onTabPagerMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const x = e.nativeEvent.contentOffset.x;
      const w = Math.max(1, windowWidth);
      const idx = Math.round(x / w);
      const next: 'explore' | 'my' = idx <= 0 ? 'explore' : 'my';
      setHomeTab(next);
    },
    [windowWidth],
  );

  const handleEndReachedForTab = useCallback(
    (tab: 'explore' | 'my') => {
      if (homeTab !== tab) return;
      if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
    },
    [homeTab, hasNextPage, isFetchingNextPage, fetchNextPage],
  );

  const openRegionModal = useCallback(() => {
    setDraftRegisteredRegions([...registeredRegionsRef.current]);
    setRegionSearchModalOpen(false);
    setRegionSearchQuery('');
    setRegionModalOpen(true);
  }, []);
  const closeRegionModal = useCallback(() => {
    if (registeredRegionsRef.current.length === 0) {
      Alert.alert('관심 지역 필요', '탐색을 사용하려면 관심 지역을 한 곳 이상 추가한 뒤 「적용」을 눌러 주세요.');
      return;
    }
    setRegionSearchModalOpen(false);
    setRegionSearchQuery('');
    setRegionDropdownOpen(false);
    setRegionModalOpen(false);
  }, []);

  const openRegionDropdownModal = useCallback(() => {
    setRegionDropdownOpen(true);
  }, []);
  const closeRegionDropdownModal = useCallback(() => setRegionDropdownOpen(false), []);

  const pickActiveRegionFromDropdown = useCallback((normRaw: string) => {
    const norm = normalizeFeedRegionLabel(normRaw);
    setActiveRegionNorm(norm);
    void saveActiveFeedRegion(norm);
    setRegionDropdownOpen(false);
  }, []);

  const openRegionSearchModal = useCallback(() => {
    if (draftRegisteredRegions.length >= FEED_REGISTERED_REGIONS_MAX) {
      Alert.alert('알림', `관심 지역은 최대 ${FEED_REGISTERED_REGIONS_MAX}곳까지 등록할 수 있어요.`);
      return;
    }
    setRegionSearchQuery('');
    setRegionSearchModalOpen(true);
  }, [draftRegisteredRegions.length]);

  const closeRegionSearchModal = useCallback(() => {
    setRegionSearchKeyboardVisible(false);
    setRegionSearchModalOpen(false);
    setRegionSearchQuery('');
  }, []);

  useEffect(() => {
    if (!regionSearchModalOpen) {
      setRegionSearchKeyboardVisible(false);
      return;
    }
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const subShow = Keyboard.addListener(showEvt, () => setRegionSearchKeyboardVisible(true));
    const subHide = Keyboard.addListener(hideEvt, () => setRegionSearchKeyboardVisible(false));
    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, [regionSearchModalOpen]);

  const removeDraftRegion = useCallback((regionRaw: string) => {
    const norm = normalizeFeedRegionLabel(regionRaw);
    setDraftRegisteredRegions((prev) => {
      if (registeredRegionsRef.current.length >= 1 && prev.length <= 1) return prev;
      return prev.filter((x) => normalizeFeedRegionLabel(x) !== norm);
    });
  }, []);

  const pickSearchResultDistrict = useCallback((districtKey: string) => {
    const norm = normalizeFeedRegionLabel(districtKey);
    setDraftRegisteredRegions((prev) => {
      if (prev.some((x) => normalizeFeedRegionLabel(x) === norm)) return prev;
      if (prev.length >= FEED_REGISTERED_REGIONS_MAX) {
        Alert.alert('알림', `관심 지역은 최대 ${FEED_REGISTERED_REGIONS_MAX}곳까지 등록할 수 있어요.`);
        return prev;
      }
      return [...prev, norm];
    });
    setRegionSearchQuery('');
    setRegionSearchModalOpen(false);
  }, []);

  const regionSearchResults = useMemo(
    () => searchKoreaInterestDistricts(regionSearchQuery, draftRegisteredRegions),
    [regionSearchQuery, draftRegisteredRegions],
  );

  const applyDraftRegisteredRegions = useCallback(() => {
    const next = draftRegisteredRegions.map((x) => normalizeFeedRegionLabel(x)).filter(Boolean);
    const dedup: string[] = [];
    const seen = new Set<string>();
    for (const r of next) {
      if (seen.has(r)) continue;
      seen.add(r);
      dedup.push(r);
      if (dedup.length >= FEED_REGISTERED_REGIONS_MAX) break;
    }
    if (dedup.length < 1) {
      Alert.alert('관심 지역 필요', '한 곳 이상 추가해 주세요.');
      return;
    }
    registeredRegionsRef.current = dedup;
    setRegisteredRegions(dedup);
    void saveRegisteredFeedRegions(dedup);
    const setNorms = new Set(dedup.map((r) => normalizeFeedRegionLabel(r)));
    const prevA = activeRegionNorm ? normalizeFeedRegionLabel(activeRegionNorm) : '';
    const nextActive =
      dedup.length === 0 ? null : prevA && setNorms.has(prevA) ? prevA : normalizeFeedRegionLabel(dedup[0]!);
    setActiveRegionNorm(nextActive);
    void saveActiveFeedRegion(nextActive);
    setRegionModalOpen(false);
  }, [draftRegisteredRegions, activeRegionNorm]);

  const selectedFilterLabel = useMemo(() => {
    if (selectedCategoryId == null) return null;
    return categories.find((c) => c.id === selectedCategoryId)?.label ?? null;
  }, [categories, selectedCategoryId]);

  const categoryDropdownLabel = selectedFilterLabel ?? '전체';

  const sortComboLabel = useMemo(() => listSortModeLabel(listSortMode), [listSortMode]);

  const openFeedListSettingsModal = useCallback(() => setFeedListSettingsModalOpen(true), []);
  const closeFeedListSettingsModal = useCallback(() => setFeedListSettingsModalOpen(false), []);

  const profilePk = useMemo(() => {
    const u = userId?.trim();
    if (u) return u;
    const em = authProfile?.email?.trim();
    if (em) return normalizeUserId(em) ?? '';
    return '';
  }, [userId, authProfile?.email]);

  const isSignedIn = useMemo(
    () => Boolean(userId?.trim() || authProfile?.firebaseUid?.trim()),
    [userId, authProfile?.firebaseUid],
  );

  const [meetingNotifyLoaded, setMeetingNotifyLoaded] = useState(false);
  const [meetingNotifyEffectiveOn, setMeetingNotifyEffectiveOn] = useState(false);

  const refreshMeetingNotify = useCallback(async () => {
    if (Platform.OS === 'web') {
      setMeetingNotifyLoaded(true);
      setMeetingNotifyEffectiveOn(false);
      return;
    }
    const pk = profilePk.trim();
    if (!pk) {
      setMeetingNotifyLoaded(true);
      setMeetingNotifyEffectiveOn(false);
      return;
    }
    setMeetingNotifyLoaded(false);
    try {
      const m = await fetchMeetingAreaNotifyMatrix(pk);
      const rn = (m.region_norms ?? []).filter((x) => String(x ?? '').trim() !== '');
      const ci = (m.category_ids ?? []).filter((x) => String(x ?? '').trim() !== '');
      setMeetingNotifyEffectiveOn(rn.length > 0 && ci.length > 0);
    } catch {
      setMeetingNotifyEffectiveOn(false);
    } finally {
      setMeetingNotifyLoaded(true);
    }
  }, [profilePk]);

  useEffect(() => {
    if (!feedListSettingsModalOpen) return;
    void refreshMeetingNotify();
  }, [feedListSettingsModalOpen, refreshMeetingNotify]);

  const openMeetingNotifySettings = useCallback(() => {
    closeFeedListSettingsModal();
    router.push('/profile/meeting-notify-settings');
  }, [closeFeedListSettingsModal, router]);

  const feedListSettingsDotActive = useMemo(
    () => recruitingOnly || feedSearchFiltersActive(appliedFeedSearch) || listSortMode !== 'soon',
    [recruitingOnly, appliedFeedSearch, listSortMode],
  );

  const closeCategoryPicker = useCallback(() => setCategoryPickerOpen(false), []);

  const openCategoryPicker = useCallback(() => {
    const ordered = sortedFeedCategoryMaster.map((c) => c.id);
    const vis =
      feedBarVisibleCategoryIds == null
        ? [...ordered]
        : ordered.filter((id) => feedBarVisibleCategoryIds.includes(id));
    setCategoryPickerDraft({ visibility: vis, filter: selectedCategoryId });
    setCategoryPickerOpen(true);
  }, [sortedFeedCategoryMaster, feedBarVisibleCategoryIds, selectedCategoryId]);

  const toggleFeedCategoryPickerVisibilityDraft = useCallback((id: string) => {
    setCategoryPickerDraft((d) => {
      const ordered = sortedFeedCategoryMaster.map((c) => c.id);
      const set = new Set(d.visibility);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      const nextVis = ordered.filter((oid) => set.has(oid));
      const nextFilter =
        d.filter != null && !nextVis.includes(d.filter) ? null : d.filter;
      return { visibility: nextVis, filter: nextFilter };
    });
  }, [sortedFeedCategoryMaster]);

  const toggleFeedCategoryPickerSelectAll = useCallback(() => {
    setCategoryPickerDraft((d) => {
      const ordered = sortedFeedCategoryMaster.map((c) => c.id);
      if (ordered.length === 0) return d;
      const allOn =
        d.visibility.length === ordered.length &&
        ordered.every((oid) => d.visibility.includes(oid));
      return allOn ? { visibility: [], filter: null } : { visibility: [...ordered], filter: d.filter };
    });
  }, [sortedFeedCategoryMaster]);

  const categoryPickerSelectAllChecked = useMemo(() => {
    const ordered = sortedFeedCategoryMaster.map((c) => c.id);
    if (ordered.length === 0) return false;
    return (
      categoryPickerDraft.visibility.length === ordered.length &&
      ordered.every((id) => categoryPickerDraft.visibility.includes(id))
    );
  }, [sortedFeedCategoryMaster, categoryPickerDraft.visibility]);

  const saveCategoryPickerModal = useCallback(async () => {
    const ordered = sortedFeedCategoryMaster.map((c) => c.id);
    if (ordered.length > 0 && categoryPickerDraft.visibility.length === 0) {
      Alert.alert(
        '선택 필요',
        '피드에서 고를 카테고리를 최소 하나 이상 선택해 주세요.',
      );
      return;
    }
    const nextVisible =
      ordered.length === 0 || categoryPickerDraft.visibility.length === ordered.length
        ? null
        : [...categoryPickerDraft.visibility];
    let nextFilter = categoryPickerDraft.filter;
    if (nextFilter != null) {
      if (!ordered.includes(nextFilter)) nextFilter = null;
      else if (nextVisible != null && !nextVisible.includes(nextFilter)) nextFilter = null;
    }
    setFeedBarVisibleCategoryIds(nextVisible);
    await persistFeedCategoryBarVisibleIds(nextVisible);
    setSelectedCategoryId(nextFilter);
    setCategoryPickerOpen(false);
  }, [sortedFeedCategoryMaster, categoryPickerDraft]);

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
    if (!feedLocationReady) return;
    setRefreshing(true);
    try {
      await Promise.all([refetchMeetingsFeed(), loadMyMeetings()]);
    } finally {
      setRefreshing(false);
    }
  }, [feedLocationReady, refetchMeetingsFeed, loadMyMeetings]);

  useEffect(() => {
    if (!feedLocationReady) return;
    if (registeredRegions.length > 0) return;
    setRegionSearchModalOpen(false);
    setRegionSearchQuery('');
    setDraftRegisteredRegions([]);
    setRegionModalOpen(true);
  }, [feedLocationReady, registeredRegions.length]);

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

  const renderHomeMeetingListSeparator = useCallback(
    () => <View style={styles.homeMeetingListSeparator} />,
    [],
  );

  const renderHomeItemForList = useCallback(
    (item: Meeting, tab: 'explore' | 'my') => {
      const pk = userId?.trim() ?? '';
      const ns = pk ? normalizeParticipantId(pk) : '';
      const isHost = Boolean(ns) && (normalizeParticipantId(item.createdBy?.trim() ?? '') ?? '') === ns;
      const isJoined = isUserJoinedMeeting(item, userId);
      const ownership: 'hosted' | 'joined' | 'none' = isHost ? 'hosted' : isJoined ? 'joined' : 'none';
      return (
        <HomeMeetingListItem
          meeting={item}
          userCoords={feedCoords}
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
      userId,
      feedCoords,
      myConfirmedScheduleSlots,
      overlapBufferHours,
      feedHostProfileMap,
      categories,
      onPressMeetingFromGrid,
    ],
  );

  const feedListEmptyCentered = useCallback(
    (icon: SymbolicIconName, title: string, body: string): ReactElement => (
      <View style={[styles.feedGlobalEmptyFill, { minHeight: globalEmptyMinHeight }]}>
        <View style={styles.feedGlobalEmptyInner}>
          <View style={styles.feedGlobalEmptyIconCircle}>
            <GinitSymbolicIcon name={icon} size={34} color={GinitTheme.colors.primary} />
          </View>
          <Text style={styles.feedGlobalEmptyTitle}>{title}</Text>
          <Text style={styles.feedGlobalEmptyBody}>{body}</Text>
        </View>
      </View>
    ),
    [globalEmptyMinHeight],
  );

  const exploreFilteredEmptyCopy = useMemo(():
    | {
        icon: SymbolicIconName;
        title: string;
        body: string;
      }
    | null => {
    if (!feedLocationReady || isInitialListLoading || listError) return null;
    if (!(meetingsWithinRadius.length > 0 && filteredMeetings.length === 0)) return null;

    if (registeredRegions.length === 0) {
      return {
        icon: 'location-outline',
        title: '관심 지역을 먼저 등록해 주세요',
        body: '관심 지역을 이름에서 등록한 뒤, 오른쪽 ▼에서 표시할 지역을 고르면 해당 구 모임을 볼 수 있어요.',
      };
    }
    if (feedSearchFiltersActive(appliedFeedSearch)) {
      return {
        icon: 'search-outline',
        title: '검색·조건에 맞는 모임이 없어요',
        body: '검색을 열어 필터를 바꿔 보세요.',
      };
    }
    if (selectedFilterLabel) {
      return {
        icon: 'pricetags-outline',
        title: `「${selectedFilterLabel}」 카테고리 모임이 아직 없어요`,
        body: '다른 카테고리를 선택해 보세요.',
      };
    }
    if (recruitingOnly) {
      return {
        icon: 'hourglass-outline',
        title: '모집중인 모임이 없어요',
        body: '모집중만 표시를 끄면 모집 완료·확정 모임도 볼 수 있어요.',
      };
    }
    // 여기까지면 검색 필터는 꺼져 있음(위에서 `feedSearchFiltersActive`면 이미 반환).
    return {
      icon: 'people-outline',
      title: '등록된 모임이 없습니다.',
      body: '+ 버튼으로 첫 모임을 만들어 보세요.',
    };
  }, [
    feedLocationReady,
    isInitialListLoading,
    listError,
    meetingsWithinRadius.length,
    filteredMeetings.length,
    registeredRegions.length,
    appliedFeedSearch,
    selectedFilterLabel,
    recruitingOnly,
  ]);

  const fixedFeedHeader = (
    <View style={styles.feedHeader}>
      <View style={styles.feedHeaderTopRow}>
        <View style={styles.locationCluster}>
          <Pressable
            onPress={openRegionModal}
            style={({ pressed }) => [styles.locationClusterPressable, pressed && styles.locationClusterPressed]}
            accessibilityRole="button"
            accessibilityLabel="관심 지역 등록·편집"
            hitSlop={8}>
            <Text
              style={styles.locationText}
              numberOfLines={1}
              accessibilityLabel={
                feedLocationReady
                  ? registeredRegions.length === 0
                    ? '관심 지역 등록'
                    : `표시 중인 지역 ${getInterestRegionDisplayLabel(exploreActiveRegionNorm)}`
                  : '관심 지역, 불러오는 중'
              }>
              {feedLocationReady
                ? registeredRegions.length === 0
                  ? '관심 지역 등록'
                  : getInterestRegionDisplayLabel(exploreActiveRegionNorm)
                : '불러오는 중…'}
            </Text>
          </Pressable>
          <Pressable
            onPress={openRegionDropdownModal}
            style={({ pressed }) => [styles.locationChevronPressable, pressed && styles.locationClusterPressed]}
            accessibilityRole="button"
            accessibilityLabel="등록된 관심 지역 중 표시 지역 선택"
            hitSlop={{ top: 20, bottom: 20, left: 16, right: 20 }}>
            <GinitSymbolicIcon name="chevron-down" size={20} color={GinitTheme.colors.primary} />
          </Pressable>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            onPress={openFeedSearch}
            accessibilityRole="button"
            accessibilityLabel="검색 및 조건 필터"
            hitSlop={10}
            style={styles.searchIconWrap}>
            <GinitSymbolicIcon name="search-outline" size={22} color="#0f172a" />
            {feedSearchFiltersActive(appliedFeedSearch) ? <View style={styles.searchFilterDot} /> : null}
          </Pressable>
          <InAppAlarmsBellButton />
          <Pressable
            onPress={openFeedListSettingsModal}
            accessibilityRole="button"
            accessibilityLabel="목록 정렬 및 필터 설정"
            hitSlop={10}
            style={styles.settingsIconWrap}>
            <GinitSymbolicIcon name="settings-outline" size={22} color="#0f172a" />
            {feedListSettingsDotActive ? <View style={styles.settingsFilterDot} /> : null}
          </Pressable>
        </View>
      </View>
      <View style={styles.tabCategoryBar}>
        <View style={styles.tabPair}>
          <Pressable
            onPress={() => goToHomeTab('explore')}
            style={({ pressed }) => [
              styles.homeTopChip,
              homeTab === 'explore' && styles.homeTopChipActive,
              pressed && styles.homeTopChipPressed,
              { maxWidth: tabChipMaxWidth },
            ]}
            accessibilityRole="tab"
            accessibilityState={{ selected: homeTab === 'explore' }}
            accessibilityLabel="탐색">
            <Text style={[styles.homeTopChipLabel, homeTab === 'explore' && styles.homeTopChipLabelActive]} numberOfLines={1}>
              탐색
            </Text>
          </Pressable>
          <Pressable
            onPress={() => goToHomeTab('my')}
            style={({ pressed }) => [
              styles.homeTopChip,
              homeTab === 'my' && styles.homeTopChipActive,
              pressed && styles.homeTopChipPressed,
              { maxWidth: tabChipMaxWidth },
            ]}
            accessibilityRole="tab"
            accessibilityState={{ selected: homeTab === 'my' }}
            accessibilityLabel="내 모임">
            <Text style={[styles.homeTopChipLabel, homeTab === 'my' && styles.homeTopChipLabelActive]} numberOfLines={1}>
              내 모임
            </Text>
          </Pressable>
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
          <GinitSymbolicIcon name="chevron-down" size={18} color="#475569" />
        </Pressable>
      </View>
    </View>
  );

  const tabListAlerts = (tab: 'explore' | 'my'): ReactElement => (
    <>
      {listError ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorTitle}>목록을 불러오지 못했어요</Text>
          <Text style={styles.errorBody}>{listError}</Text>
        </View>
      ) : null}

      {feedLocationReady && !isInitialListLoading && !listError && meetings.length === 0 ? (
        <View style={[styles.feedGlobalEmptyFill, { minHeight: globalEmptyMinHeight }]}>
          <View style={styles.feedGlobalEmptyInner}>
            <View style={styles.feedGlobalEmptyIconCircle}>
              <GinitSymbolicIcon name="people-outline" size={34} color={GinitTheme.colors.primary} />
            </View>
            <Text style={styles.feedGlobalEmptyTitle}>
              {!feedSearchFiltersActive(appliedFeedSearch) ? '등록된 모임이 없습니다.' : '등록된 모임이 아직 없어요'}
            </Text>
            <Text style={styles.feedGlobalEmptyBody}>
              {!feedSearchFiltersActive(appliedFeedSearch)
                ? '+ 버튼으로 첫 모임을 만들어 보세요.'
                : '하단 + 버튼으로 시작해 보세요.'}
            </Text>
          </View>
        </View>
      ) : null}

      {tab === 'explore' && exploreFilteredEmptyCopy
        ? feedListEmptyCentered(
            exploreFilteredEmptyCopy.icon,
            exploreFilteredEmptyCopy.title,
            exploreFilteredEmptyCopy.body,
          )
        : null}

      {feedLocationReady &&
      !isInitialListLoading &&
      !listError &&
      meetings.length > 0 &&
      tab === 'my' &&
      sortedJoinedMeetings.length === 0
        ? feedListEmptyCentered(
            'albums-outline',
            '조건에 맞는 내 모임이 없어요',
            '필터를 바꾸거나 탐색에서 모임에 참여해 보세요.',
          )
        : null}

      {feedLocationReady &&
      !isInitialListLoading &&
      !listError &&
      tab === 'explore' &&
      meetingsWithinRadius.length > 0 &&
      filteredMeetings.length > 0 &&
      exploreFeedMeetings.length === 0
        ? feedListEmptyCentered(
            'eye-off-outline',
            '현재 필터에서 보여줄 공개 모임이 없어요',
            '필터를 조정하면 더 많은 모임을 볼 수 있어요.',
          )
        : null}
    </>
  );

  useEffect(() => {
    const t = homeTabRef.current;
    const idx = t === 'explore' ? 0 : 1;
    tabPagerRef.current?.scrollTo({ x: idx * windowWidth, animated: false });
  }, [windowWidth]);

  return (
    <ScreenShell padded={false} style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.feedColumn}>
          {fixedFeedHeader}
          <View style={styles.tabPagerWrap}>
            <ScrollView
              ref={tabPagerRef}
              horizontal
              pagingEnabled
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={onTabPagerMomentumEnd}
              style={styles.tabPager}>
              {(['explore', 'my'] as const).map((tab) => {
              const tabData = tab === 'explore' ? exploreFeedMeetings : sortedJoinedMeetings;
              return (
                <View key={tab} style={[styles.tabPage, { width: windowWidth }]}>
                  <FlatList
                    data={tabData}
                    keyExtractor={(m) => m.id}
                    extraData={{
                      homeTab,
                      tab,
                      listSortMode,
                      recruitingOnly,
                      selectedCategoryId,
                      appliedFeedSearch,
                      exploreLen: exploreFeedMeetings.length,
                      feedLocationReady,
                      registeredRegionsLen: registeredRegions.length,
                      exploreActiveRegionNorm,
                    }}
                    renderItem={({ item }) => renderHomeItemForList(item, tab)}
                    ItemSeparatorComponent={renderHomeMeetingListSeparator}
                    ListHeaderComponent={tabListAlerts(tab)}
                    ListFooterComponent={homeTab === tab ? listFooter : null}
                    contentContainerStyle={styles.scroll}
                    style={styles.listFlex}
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                    nestedScrollEnabled
                    removeClippedSubviews={false}
                    initialNumToRender={8}
                    maxToRenderPerBatch={8}
                    windowSize={9}
                    onScroll={onMainScroll}
                    scrollEventThrottle={16}
                    onEndReached={() => handleEndReachedForTab(tab)}
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
                </View>
              );
              })}
            </ScrollView>
            {!feedLocationReady ? (
              <View style={styles.locationBootstrapOverlay} accessibilityLabel="불러오는 중">
                <ActivityIndicator size="large" color={GinitTheme.colors.primary} />
                <Text style={styles.locationBootstrapLabel}>불러오는 중…</Text>
              </View>
            ) : null}
          </View>
        </View>

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
                        <GinitSymbolicIcon name="checkmark-circle" size={22} color={GinitTheme.colors.primary} />
                      ) : (
                        <GinitSymbolicIcon name="ellipse-outline" size={22} color="#cbd5e1" />
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

                {isSignedIn && Platform.OS !== 'web' ? (
                  <>
                    <Text style={styles.modalSectionTitle}>알림</Text>
                    <Pressable
                      onPress={openMeetingNotifySettings}
                      style={({ pressed }) => [styles.modalRow, pressed && styles.modalRowPressed]}
                      accessibilityRole="button"
                      accessibilityLabel="모임 생성 알림 설정">
                      <View style={styles.modalRowLabelBlock}>
                        <Text style={styles.modalRowLabel}>공개 모임 생성 알림</Text>
                        <Text style={styles.modalRowSub}>관심 지역·카테고리별로 새 공개 모임만 알려요.</Text>
                      </View>
                      <Pressable
                        onPress={openMeetingNotifySettings}
                        hitSlop={10}
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants">
                        {meetingNotifyLoaded ? (
                          <Switch
                            value={meetingNotifyEffectiveOn}
                            disabled
                            trackColor={meetingCreateSwitchTrack}
                            thumbColor={meetingNotifyEffectiveOn ? '#FFFFFF' : '#f1f5f9'}
                            ios_backgroundColor="#cbd5e1"
                            accessibilityElementsHidden
                            importantForAccessibility="no-hide-descendants"
                          />
                        ) : (
                          <ActivityIndicator color={GinitTheme.colors.primary} />
                        )}
                      </Pressable>
                    </Pressable>
                  </>
                ) : null}
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
              accessibilityLabel="관심 지역 설정 닫기"
            />
            <View style={[styles.modalCard, styles.modalCardWide]}>
              <Text style={styles.modalTitle}>관심 지역 설정</Text>
              <Text style={styles.modalHint}>
                {registeredRegions.length === 0
                  ? `탐색을 쓰려면 관심 지역을 최소 한 곳 등록한 뒤 「적용」을 눌러 주세요. `
                  : ''}
                + 로 전국 행정구(자치구) 단위로 검색해 추가해요. 최대 {FEED_REGISTERED_REGIONS_MAX}곳까지예요. 탐색에 보일 구는 상단 오른쪽 ▼에서 골라요.
              </Text>
              <Text style={styles.modalCurrentSummary} numberOfLines={1}>
                등록 {draftRegisteredRegions.length}/{FEED_REGISTERED_REGIONS_MAX}곳
              </Text>
              <ScrollView style={styles.feedSettingsScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                {draftRegisteredRegions.length === 0 ? (
                  <Text style={styles.interestRegionEmptyDraft}>추가된 관심 지역이 없어요.</Text>
                ) : (
                  draftRegisteredRegions.map((r) => {
                    const norm = normalizeFeedRegionLabel(r);
                    const blockLastDraftRemove =
                      registeredRegions.length >= 1 && draftRegisteredRegions.length <= 1;
                    return (
                      <View key={norm} style={styles.modalRow}>
                        <Text style={styles.modalRowLabel}>{getInterestRegionDisplayLabel(r)}</Text>
                        {blockLastDraftRemove ? (
                          <View style={{ width: 22 }} accessibilityElementsHidden />
                        ) : (
                          <Pressable
                            onPress={() => removeDraftRegion(r)}
                            accessibilityRole="button"
                            accessibilityLabel={`${getInterestRegionDisplayLabel(r)} 삭제`}
                            hitSlop={8}>
                            <GinitSymbolicIcon name="trash-outline" size={22} color="#94a3b8" />
                          </Pressable>
                        )}
                      </View>
                    );
                  })
                )}
                {draftRegisteredRegions.length < FEED_REGISTERED_REGIONS_MAX ? (
                  <Pressable
                    onPress={openRegionSearchModal}
                    style={({ pressed }) => [styles.modalRow, pressed && styles.modalRowPressed]}
                    accessibilityRole="button"
                    accessibilityLabel="관심 지역 추가">
                    <GinitSymbolicIcon name="add-circle-outline" size={24} color={GinitTheme.colors.primary} />
                    <Text style={[styles.modalRowLabel, styles.interestRegionAddLabel]}>관심 지역 추가</Text>
                    <GinitSymbolicIcon name="chevron-forward" size={20} color="#94a3b8" />
                  </Pressable>
                ) : (
                  <Text style={styles.interestRegionEmptyDraft}>최대 {FEED_REGISTERED_REGIONS_MAX}곳까지 등록할 수 있어요.</Text>
                )}
              </ScrollView>
              <Pressable onPress={applyDraftRegisteredRegions} style={styles.modalPrimaryBtn} accessibilityRole="button">
                <Text style={styles.modalPrimaryLabel}>적용</Text>
              </Pressable>
              {registeredRegions.length > 0 ? (
                <Pressable onPress={closeRegionModal} style={styles.modalCloseBtn} accessibilityRole="button">
                  <Text style={styles.modalCloseLabel}>닫기</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </Modal>

        <Modal
          visible={regionDropdownOpen}
          animationType="fade"
          transparent
          onRequestClose={closeRegionDropdownModal}>
          <View style={styles.modalRoot}>
            <Pressable
              style={StyleSheet.absoluteFillObject}
              onPress={closeRegionDropdownModal}
              accessibilityRole="button"
              accessibilityLabel="표시 지역 선택 닫기"
            />
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>표시 지역</Text>
              {registeredRegions.length === 0 ? (
                <>
                  <Text style={styles.modalHint}>등록된 관심 지역이 없어요. 지역 이름을 눌러 등록해 주세요.</Text>
                  <Pressable
                    onPress={() => {
                      closeRegionDropdownModal();
                      openRegionModal();
                    }}
                    style={styles.modalPrimaryBtn}
                    accessibilityRole="button">
                    <Text style={styles.modalPrimaryLabel}>관심 지역 등록하기</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <Text style={styles.modalHint}>탐색에 보일 구를 골라 주세요.</Text>
                  {registeredRegions.map((r) => {
                    const norm = normalizeFeedRegionLabel(r);
                    const active = norm === exploreActiveRegionNorm;
                    return (
                      <Pressable
                        key={norm}
                        onPress={() => pickActiveRegionFromDropdown(norm)}
                        style={({ pressed }) => [styles.modalRow, pressed && styles.modalRowPressed]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}>
                        <Text style={styles.modalRowLabel}>{getInterestRegionDisplayLabel(r)}</Text>
                        {active ? (
                          <GinitSymbolicIcon name="checkmark-circle" size={22} color={GinitTheme.colors.primary} />
                        ) : (
                          <GinitSymbolicIcon name="ellipse-outline" size={22} color="#cbd5e1" />
                        )}
                      </Pressable>
                    );
                  })}
                </>
              )}
              <Pressable onPress={closeRegionDropdownModal} style={styles.modalCloseBtn} accessibilityRole="button">
                <Text style={styles.modalCloseLabel}>닫기</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        <Modal
          visible={regionSearchModalOpen}
          animationType="fade"
          transparent
          onRequestClose={closeRegionSearchModal}>
          <View
            style={[
              styles.modalRoot,
              styles.regionSearchModalRoot,
              regionSearchKeyboardVisible && styles.regionSearchModalRootKeyboardOpen,
              regionSearchKeyboardVisible && { paddingTop: safeInsets.top + GinitTheme.spacing.sm },
            ]}>
            <Pressable
              style={StyleSheet.absoluteFillObject}
              onPress={closeRegionSearchModal}
              accessibilityRole="button"
              accessibilityLabel="지역 검색 닫기"
            />
            <View style={[styles.modalCard, styles.modalCardWide]}>
              <Text style={styles.modalTitle}>지역 검색</Text>
              <Text style={styles.modalHint}>
                시·도·시 이름 또는 구 이름으로 검색한 뒤, 목록에서 누르면 관심 지역에 추가돼요.
              </Text>
              <TextInput
                value={regionSearchQuery}
                onChangeText={setRegionSearchQuery}
                placeholder="예: 영등포구, 해운대구, 경기 수원"
                placeholderTextColor="#94a3b8"
                style={styles.regionSearchInput}
                autoCorrect={false}
                autoCapitalize="none"
                accessibilityLabel="구 이름 검색"
              />
              <ScrollView style={styles.regionSearchScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                {regionSearchQuery.trim().length === 0 ? (
                  <Text style={styles.interestRegionSearchEmpty}>검색어를 입력해 주세요.</Text>
                ) : regionSearchResults.length === 0 ? (
                  <Text style={styles.interestRegionSearchEmpty}>검색 결과가 없어요.</Text>
                ) : (
                  regionSearchResults.map((hit) => (
                    <Pressable
                      key={hit.key}
                      onPress={() => pickSearchResultDistrict(hit.key)}
                      style={({ pressed }) => [styles.modalRow, pressed && styles.modalRowPressed]}
                      accessibilityRole="button">
                      <Text style={styles.modalRowLabel}>{hit.label}</Text>
                      <GinitSymbolicIcon name="chevron-forward" size={20} color="#94a3b8" />
                    </Pressable>
                  ))
                )}
              </ScrollView>
              <Pressable onPress={closeRegionSearchModal} style={styles.modalCloseBtn} accessibilityRole="button">
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
            <View style={[styles.modalCard, styles.categoryPickerCard]}>
              <Text style={[styles.modalTitle, styles.categoryPickerTitle]}>카테고리</Text>
              <Text style={[styles.modalHint, styles.categoryPickerHint]}>
                드롭다운에 나올 모임 종류를 고른 뒤, 아래에서 지금 볼 종류를 선택해 주세요. «전체»는 항상 고를 수 있어요.
              </Text>
              <ScrollView
                style={styles.categoryPickerScroll}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                nestedScrollEnabled>
                <Pressable
                  onPress={toggleFeedCategoryPickerSelectAll}
                  style={({ pressed }) => [
                    styles.categoryPickerItemRow,
                    pressed && styles.modalRowPressed,
                  ]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: categoryPickerSelectAllChecked }}
                  accessibilityLabel="모든 카테고리 표시">
                  <Text style={styles.modalRowLabel}>모두 표시</Text>
                  {categoryPickerSelectAllChecked ? (
                    <GinitSymbolicIcon name="checkmark-circle" size={22} color={GinitTheme.colors.primary} />
                  ) : (
                    <GinitSymbolicIcon name="ellipse-outline" size={22} color="#cbd5e1" />
                  )}
                </Pressable>
                {sortedFeedCategoryMaster.map((c) => {
                  const on = categoryPickerDraft.visibility.includes(c.id);
                  return (
                    <Pressable
                      key={c.id}
                      onPress={() => toggleFeedCategoryPickerVisibilityDraft(c.id)}
                      style={({ pressed }) => [
                        styles.categoryPickerItemRow,
                        pressed && styles.modalRowPressed,
                      ]}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}>
                      <Text style={styles.modalRowLabel}>{c.label}</Text>
                      {on ? (
                        <GinitSymbolicIcon name="checkmark-circle" size={22} color={GinitTheme.colors.primary} />
                      ) : (
                        <GinitSymbolicIcon name="ellipse-outline" size={22} color="#cbd5e1" />
                      )}
                    </Pressable>
                  );
                })}
                <Text style={styles.categoryPickerSectionTitle}>지금 보기</Text>
                <Pressable
                  onPress={() => setCategoryPickerDraft((d) => ({ ...d, filter: null }))}
                  style={({ pressed }) => [
                    styles.categoryPickerItemRow,
                    pressed && styles.modalRowPressed,
                  ]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: categoryPickerDraft.filter == null }}>
                  <Text style={styles.modalRowLabel}>전체</Text>
                  {categoryPickerDraft.filter == null ? (
                    <GinitSymbolicIcon name="checkmark-circle" size={22} color={GinitTheme.colors.primary} />
                  ) : (
                    <GinitSymbolicIcon name="ellipse-outline" size={22} color="#cbd5e1" />
                  )}
                </Pressable>
                {sortedFeedCategoryMaster
                  .filter((c) => categoryPickerDraft.visibility.includes(c.id))
                  .map((c) => {
                    const selected = categoryPickerDraft.filter === c.id;
                    return (
                      <Pressable
                        key={`f-${c.id}`}
                        onPress={() => setCategoryPickerDraft((d) => ({ ...d, filter: c.id }))}
                        style={({ pressed }) => [
                          styles.categoryPickerItemRow,
                          pressed && styles.modalRowPressed,
                        ]}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}>
                        <Text style={styles.modalRowLabel}>{c.label}</Text>
                        {selected ? (
                          <GinitSymbolicIcon name="checkmark-circle" size={22} color={GinitTheme.colors.primary} />
                        ) : (
                          <GinitSymbolicIcon name="ellipse-outline" size={22} color="#cbd5e1" />
                        )}
                      </Pressable>
                    );
                  })}
              </ScrollView>
              <View style={styles.categoryPickerModalActions}>
                <Pressable
                  onPress={closeCategoryPicker}
                  style={({ pressed }) => [styles.categoryPickerActionGhost, pressed && { opacity: 0.85 }]}
                  accessibilityRole="button">
                  <Text style={styles.categoryPickerActionGhostLabel}>취소</Text>
                </Pressable>
                <Pressable
                  onPress={() => void saveCategoryPickerModal()}
                  style={({ pressed }) => [styles.categoryPickerActionPrimary, pressed && { opacity: 0.9 }]}
                  accessibilityRole="button">
                  <Text style={styles.modalCloseLabel}>저장</Text>
                </Pressable>
              </View>
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
  feedColumn: {
    flex: 1,
  },
  tabPagerWrap: {
    flex: 1,
    position: 'relative',
  },
  tabPager: {
    flex: 1,
  },
  locationBootstrapOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: GinitTheme.colors.bg,
    justifyContent: 'center',
    alignItems: 'center',
    gap: GinitTheme.spacing.md,
    zIndex: 20,
  },
  locationBootstrapLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: GinitTheme.colors.textMuted,
  },
  tabPage: {
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
  homeMeetingListSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: GinitTheme.colors.border,
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
  homeTopChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.75)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.34)',
    flexShrink: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeTopChipActive: {
    backgroundColor: GinitTheme.themeMainColor,
    borderColor: GinitTheme.themeMainColor,
  },
  homeTopChipPressed: {
    opacity: 0.88,
  },
  homeTopChipLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#475569',
  },
  homeTopChipLabelActive: {
    color: '#fff',
  },
  categoryDropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
    maxWidth: 150,
    minWidth: 96,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.75)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.34)',
  },
  categoryDropdownPressed: {
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderColor: 'rgba(15, 23, 42, 0.14)',
  },
  categoryDropdownText: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  feedHeader: {
    marginBottom: 16,
    paddingTop: 12,
    paddingHorizontal: 20,
    gap: 12,
  },
  feedHeaderTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  locationCluster: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    minWidth: 0,
    gap: 0,
  },
  locationChevronPressable: {
    paddingVertical: 4,
    paddingLeft: 0,
    paddingRight: 4,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  locationClusterPressable: {
    alignSelf: 'flex-start',
    flexShrink: 1,
    minWidth: 0,
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
    color: GinitTheme.colors.text,
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
    backgroundColor: GinitTheme.themeMainColor,
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
    backgroundColor: GinitTheme.themeMainColor,
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
    borderColor: 'rgba(15, 23, 42, 0.34)',
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
    fontWeight: '600',
    color: '#B91C1C',
    marginBottom: 6,
  },
  errorBody: {
    fontSize: 14,
    color: '#7F1D1D',
    lineHeight: 20,
  },
  feedGlobalEmptyFill: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: GinitTheme.spacing.xl,
    paddingVertical: GinitTheme.spacing.lg,
  },
  feedGlobalEmptyInner: {
    alignItems: 'center',
    maxWidth: 300,
  },
  feedGlobalEmptyIconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: GinitTheme.colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: GinitTheme.spacing.lg,
  },
  feedGlobalEmptyTitle: {
    ...GinitTheme.typography.title,
    color: GinitTheme.colors.text,
    textAlign: 'center',
    marginBottom: GinitTheme.spacing.sm,
  },
  feedGlobalEmptyBody: {
    ...GinitTheme.typography.body,
    lineHeight: 22,
    color: GinitTheme.colors.textSub,
    textAlign: 'center',
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
  /** 홈 피드 — 카테고리 선택 모달만 */
  categoryPickerCard: {
    maxHeight: '82%',
    paddingVertical: 16,
  },
  categoryPickerTitle: {
    marginBottom: 4,
  },
  categoryPickerHint: {
    marginBottom: 8,
  },
  categoryPickerScroll: {
    maxHeight: 520,
  },
  /** 카테고리 모달 전용: 구분선 없음(다른 모달의 modalRow는 유지) */
  categoryPickerItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 9,
    paddingHorizontal: 4,
  },
  categoryPickerSectionTitle: {
    marginTop: 8,
    marginBottom: 0,
    paddingVertical: 2,
    paddingHorizontal: 4,
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  categoryPickerModalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 20,
    marginTop: 14,
    paddingTop: 4,
  },
  categoryPickerActionGhost: {
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  categoryPickerActionGhostLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#64748b',
  },
  categoryPickerActionPrimary: {
    paddingVertical: 10,
    paddingHorizontal: 8,
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
    fontWeight: '600',
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
    fontWeight: '600',
    color: '#0f172a',
    marginBottom: 6,
  },
  modalHint: {
    fontSize: 13,
    lineHeight: 18,
    color: '#64748b',
    marginBottom: 16,
  },
  interestRegionEmptyDraft: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748b',
    paddingVertical: 14,
    paddingHorizontal: 4,
  },
  interestRegionAddLabel: {
    flex: 1,
    marginLeft: 10,
  },
  regionSearchModalRoot: {
    zIndex: 50,
  },
  regionSearchModalRootKeyboardOpen: {
    justifyContent: 'flex-start',
  },
  regionSearchInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.12)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontWeight: '600',
    color: '#0f172a',
    marginBottom: 10,
    backgroundColor: 'rgba(248, 250, 252, 0.95)',
  },
  regionSearchScroll: {
    maxHeight: 640,
  },
  interestRegionSearchEmpty: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748b',
    textAlign: 'center',
    paddingVertical: 24,
    paddingHorizontal: 8,
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
  modalPrimaryBtn: {
    marginTop: 12,
    alignSelf: 'stretch',
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: GinitTheme.colors.primary,
    alignItems: 'center',
  },
  modalPrimaryLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#ffffff',
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
    color: GinitTheme.themeMainColor,
  },
});
