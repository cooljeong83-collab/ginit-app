import { GinitPressable } from '@/components/ui/GinitPressable';
import Feather from '@expo/vector-icons/Feather';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  DeviceEventEmitter,
  FlatList,
  InteractionManager,
  Keyboard,
  Modal,
  Platform,
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
import { FlashList } from '@shopify/flash-list';

import { FeedSearchFilterModal } from '@/components/feed/FeedSearchFilterModal';
import { HomeMeetingListItem } from '@/components/feed/HomeMeetingListItem';
import { InAppAlarmsBellButton } from '@/components/in-app-alarms/InAppAlarmsBellButton';
import { MeetingArrivalVerifyTopBanner } from '@/components/meeting/MeetingArrivalVerifyTopBanner';
import {
  MeetingDetailStaticNoticeRow,
  MeetingDetailTopNoticesPager,
  type MeetingDetailTopNoticeSlide,
} from '@/components/meeting/MeetingDetailTopNoticesPager';
import { SettlementHostBanner } from '@/components/meeting/SettlementHostBanner';
import { ScreenShell, ScreenTransitionSkeleton } from '@/components/ui';
import { GinitSymbolicIcon, type SymbolicIconName } from '@/components/ui/GinitSymbolicIcon';
import { GinitTheme } from '@/constants/ginit-theme';
import { useAppPolicies } from '@/src/context/AppPoliciesContext';
import { useMeetingCategories } from '@/src/context/MeetingCategoriesContext';
import { useUserSession } from '@/src/context/UserSessionContext';
import { useMeetingsFeedInfiniteQuery } from '@/src/hooks/use-meetings-feed-infinite-query';
import { useMeetingsTableRealtimeDeferred } from '@/src/hooks/use-meetings-table-realtime-deferred';
import { useMyMeetingsFeedSync } from '@/src/hooks/use-my-meetings-feed-sync';
import { isAndroidTabHomeHardwareExitSuppressed } from '@/src/lib/android-tab-home-hardware-exit-suppress';
import { normalizeParticipantId, normalizeUserId } from '@/src/lib/app-user-id';
import { useTransitionRouter } from '@/src/lib/screen-transition-navigation';
import type { Category } from '@/src/lib/categories';
import { loadFeedCategoryBarVisibleIds, persistFeedCategoryBarVisibleIds } from '@/src/lib/feed-category-bar-preference';
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
  meetingMatchesFeedCategoryBarAndFilter,
  meetingMatchesFeedSearch,
  meetingWithinHomeFeedRadius,
  sortMeetingsForFeed,
  type FeedSearchFilters,
  type MeetingListSortMode,
} from '@/src/lib/feed-meeting-utils';
import { getPolicyNumeric } from '@/src/lib/app-policies-store';
import {
  FEED_REGISTERED_REGIONS_MAX,
  loadActiveFeedRegion,
  loadRegisteredFeedRegions,
  saveActiveFeedRegion,
  saveRegisteredFeedRegions,
  syncFeedRegionMapBootMemoryFromSelection,
} from '@/src/lib/feed-registered-regions';
import { ledgerWritesToSupabase } from '@/src/lib/hybrid-data-source';
import { runMeetingsUserActionDeltaSync } from '@/src/lib/meeting-sync-service';
import { isUserJoinedMeeting } from '@/src/lib/joined-meetings';
import { getInterestRegionDisplayLabel, searchKoreaInterestDistricts } from '@/src/lib/korea-interest-districts';
import { fetchMeetingAreaNotifyMatrix } from '@/src/lib/meeting-area-notify-rules';
import { getMeetingArrivalVerifyPolicy } from '@/src/lib/meeting-arrival-verify';
import {
  isMeetingArrivalNoticeBannerTimeEligible,
  shouldShowMeetingArrivalVerifyTopBanner,
} from '@/src/lib/meeting-arrival-verify-banner';
import { fetchLedgerArrivalVerifiedMeetingIdSet } from '@/src/lib/meeting-arrival-verify-reminders';
import { GINIT_MEETING_ARRIVAL_VERIFIED_EVENT } from '@/src/lib/meeting-arrival-verify-rpc-ui';
import { sweepStalePublicUnconfirmedMeetingsForHost } from '@/src/lib/meeting-expiry-sweep';
import { MEETING_PHONE_VERIFICATION_UI_ENABLED } from '@/src/lib/meeting-phone-verification-ui';
import {
  collectUserConfirmedScheduleSlots,
  getScheduleOverlapBufferHours,
  meetingOverlapsUserConfirmedSlots,
} from '@/src/lib/meeting-schedule-overlap';
import { meetingScheduleStartMs } from '@/src/lib/meeting-schedule-times';
import type { Meeting } from '@/src/lib/meetings';
import {
  buildConfirmedScheduleNoticeAccessibilityLabel,
  buildConfirmedScheduleNoticeTimeRight,
  buildConfirmedScheduleNoticeTitleLeft,
  buildMeetingTopNoticeTitleLeft,
  getMeetingRecruitmentPhase,
  isConfirmedMeetingPastListEndWindow,
  shouldShowConfirmedScheduleNoticeBar,
} from '@/src/lib/meetings';
import { isLedgerMeetingId } from '@/src/lib/meetings-ledger';
import { pushProfileOpenRegisterInfo } from '@/src/lib/profile-register-info';
import { isMeetingHost, isMeetingSettlementCtaEligibleForHost } from '@/src/lib/settlement-eligibility';
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

type HomeMeetingTopTab = 'explore' | 'my' | 'private';

/** 홈 상단 공지 모달 행 — `homeTopNoticeSlides`와 동일 순서·조건 */
type HomeFeedNoticeRow =
  | { key: string; kind: 'settlement'; meetingId: string; meetingTitle: string }
  | { key: string; kind: 'arrival'; meetingId: string; meetingTitle: string }
  | { key: string; kind: 'schedule'; meetingId: string; titleLeft: string; timeRight: string };

function homeFeedNoticeRowSubtitle(row: HomeFeedNoticeRow): string {
  if (row.kind === 'settlement') return '정산하기';
  if (row.kind === 'arrival') return '장소 인증';
  return row.timeRight;
}

function homeFeedNoticeRowIcon(kind: HomeFeedNoticeRow['kind']): SymbolicIconName {
  if (kind === 'settlement') return 'wallet-outline';
  if (kind === 'arrival') return 'location-outline';
  return 'megaphone-outline';
}

const HOME_MEETING_TOP_TABS = ['explore', 'my', 'private'] as const satisfies readonly HomeMeetingTopTab[];

function homeMeetingTopTabIndex(t: HomeMeetingTopTab): number {
  if (t === 'explore') return 0;
  if (t === 'my') return 1;
  return 2;
}

function homeMeetingOngoingWindowMs(): number {
  const hours = getPolicyNumeric('meeting', 'list_ongoing_duration_hours', 6);
  return Math.max(1, hours) * 60 * 60 * 1000;
}

function isEndedForHomeEndedTab(m: Meeting, nowMs: number, windowMs: number): boolean {
  const startMs = meetingScheduleStartMs(m);
  if (startMs == null || !Number.isFinite(startMs)) return false;
  return startMs < nowMs - windowMs;
}

function sortHomeEndedMeetingsLatestFirst(meetings: Meeting[]): Meeting[] {
  return [...meetings].sort((a, b) => {
    const tb = meetingScheduleStartMs(b) ?? Number.NEGATIVE_INFINITY;
    const ta = meetingScheduleStartMs(a) ?? Number.NEGATIVE_INFINITY;
    if (tb !== ta) return tb - ta;
    return a.title.localeCompare(b.title, 'ko');
  });
}

export default function FeedScreen() {
  const router = useTransitionRouter();
  const queryClient = useQueryClient();
  const { userId, authProfile } = useUserSession();
  const { version: appPoliciesVersion } = useAppPolicies();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const safeInsets = useSafeAreaInsets();
  /** 탐색·참여중 칩 — 우측 카테고리 드롭다운(maxWidth 150)과 폭 기준을 맞춤 */
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
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [listSortMode, setListSortMode] = useState<MeetingListSortMode>('soon');
  /** true면 모집중(정원 미달·미확정) 모임만 표시. 기본값 off */
  const [recruitingOnly, setRecruitingOnly] = useState(false);
  /** 목록·카테고리 통합 모달 초안 — 저장 시 recruitingOnly에 반영 */
  const [recruitingOnlyDraft, setRecruitingOnlyDraft] = useState(false);
  const [feedSearchModalOpen, setFeedSearchModalOpen] = useState(false);
  const [homeNoticesModalOpen, setHomeNoticesModalOpen] = useState(false);
  const [appliedFeedSearch, setAppliedFeedSearch] = useState<FeedSearchFilters>(() => defaultFeedSearchFilters());
  const [draftFeedSearch, setDraftFeedSearch] = useState<FeedSearchFilters>(() => defaultFeedSearchFilters());
  /** 홈 상단 탭: 공개 탐색 · 참여중(공개+비공개) · 종료 */
  const [homeTab, setHomeTab] = useState<HomeMeetingTopTab>('explore');
  const tabPagerRef = useRef<ScrollView | null>(null);
  const [tabPagerWidth, setTabPagerWidth] = useState(() => Math.max(1, Math.floor(windowWidth)));
  const homeTabRef = useRef(homeTab);
  homeTabRef.current = homeTab;
  /** Android: 모임 탭 포커스 시 하드웨어 뒤로가기 이중 탭으로만 종료 */
  const homeExitBackPressRef = useRef(0);
  /** 모임 상세 중복 진입 방지(더블 탭 등) */
  const meetingOpenLockRef = useRef(false);
  /** 피드 blur·재탭 시 이전 `router.push` 비동기가 늦게 끝나 상세로 다시 열리는 것을 막음 */
  const cancelPendingMeetingOpenFromFeedRef = useRef<(() => void) | null>(null);

  const { categories: categoriesRaw } = useMeetingCategories();
  const categories: Category[] = Array.isArray(categoriesRaw) ? categoriesRaw : [];
  const [refreshing, setRefreshing] = useState(false);
  const {
    meetings,
    listError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    showFooterSpinner,
    isInitialListLoading,
  } = useMeetingsFeedInfiniteQuery({ enabled: feedLocationReady });

  const {
    meetings: myMeetings,
  } = useMyMeetingsFeedSync({
    enabled: feedLocationReady,
    userId,
  });

  useMeetingsTableRealtimeDeferred({ enabled: feedLocationReady, viewerUserId: userId });

  useFocusEffect(
    useCallback(() => {
      if (!feedLocationReady || !userId) return;
      void runMeetingsUserActionDeltaSync(queryClient, userId, 'foreground').catch((err) =>
        console.log('Meetings focus sync failed:', err),
      );
    }, [queryClient, userId, feedLocationReady]),
  );

  useFocusEffect(
    useCallback(() => {
      return () => {
        cancelPendingMeetingOpenFromFeedRef.current?.();
        cancelPendingMeetingOpenFromFeedRef.current = null;
      };
    }, []),
  );

  /** 피드 통합 모달 초안: 표시할 마스터 id + 현재 필터(null=전체) */
  const [categoryPickerDraft, setCategoryPickerDraft] = useState<{ visibility: string[] }>({ visibility: [] });
  const feedCategoryModalCategoryListScrollRef = useRef<ScrollView | null>(null);
  const feedCategoryModalListLayHRef = useRef(0);
  const feedCategoryModalListContHRef = useRef(0);
  const feedCategoryModalListScrollYRef = useRef(0);
  const [feedCategoryModalListShowMoreBelow, setFeedCategoryModalListShowMoreBelow] = useState(false);
  /** `null`이면 드롭다운에 카테고리 마스터 전부 표시 */
  const [feedBarVisibleCategoryIds, setFeedBarVisibleCategoryIds] = useState<string[] | null>(null);
  const [feedUserProfile, setFeedUserProfile] = useState<UserProfile | null>(null);
  const [feedCoords, setFeedCoords] = useState<{ latitude: number; longitude: number } | null>(null);

  const isHomeMeetingsScreenFocused = useIsFocused();
  const [homeArrivalNoticeUiTick, setHomeArrivalNoticeUiTick] = useState(0);
  const [homeArrivalVerifiedCheckNonce, setHomeArrivalVerifiedCheckNonce] = useState(0);
  const [homeArrivalVerifiedMap, setHomeArrivalVerifiedMap] = useState<Record<string, boolean>>({});
  const homeArrivalVerifiedLookupKeyRef = useRef('');

  /** 장소 인증 화면 등에서 돌아올 때 상단 공지의 인증 맵을 다시 읽습니다(`arrivalBannerCandidates` 참조가 같을 수 있음). */
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS === 'web') return undefined;
      setHomeArrivalNoticeUiTick((n) => n + 1);
      setHomeArrivalVerifiedCheckNonce((n) => n + 1);
      return undefined;
    }, []),
  );

  useEffect(() => {
    if (!isHomeMeetingsScreenFocused || Platform.OS === 'web') return undefined;
    const iv = setInterval(() => setHomeArrivalNoticeUiTick((n) => n + 1), 60_000);
    return () => clearInterval(iv);
  }, [isHomeMeetingsScreenFocused]);

  /** `useFocusEffect`만으로는 일부 기기(예: 구형 갤럭시)에서 모임 상세로 올라간 뒤에도 리스너가 남아 뒤로가기를 가로채는 경우가 있어 `isFocused`로 게이트합니다. */
  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    if (!isHomeMeetingsScreenFocused) {
      homeExitBackPressRef.current = 0;
      return undefined;
    }
    const anyOverlayOpen =
      regionSearchModalOpen ||
      regionDropdownOpen ||
      regionModalOpen ||
      feedListSettingsModalOpen ||
      feedSearchModalOpen ||
      sortDropdownOpen;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (isAndroidTabHomeHardwareExitSuppressed()) return false;
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
    isHomeMeetingsScreenFocused,
    regionSearchModalOpen,
    regionDropdownOpen,
    regionModalOpen,
    feedListSettingsModalOpen,
    feedSearchModalOpen,
    sortDropdownOpen,
  ]);

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
    const collect = (list: readonly Meeting[]) => {
      for (const m of list) {
        const r = m.createdBy?.trim();
        if (!r) continue;
        set.add(normalizeParticipantId(r) ?? r);
      }
    }
    collect(meetings);
    collect(myMeetings);
    return [...set];
  }, [meetings, myMeetings]);

  const [feedHostProfileMap, setFeedHostProfileMap] = useState<Map<string, UserProfile>>(() => new Map());

  useEffect(() => {
    if (feedHostIds.length === 0) {
      setFeedHostProfileMap((prev) => (prev.size === 0 ? prev : new Map()));
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
    if (!feedLocationReady) return;
    syncFeedRegionMapBootMemoryFromSelection(registeredRegions, activeRegionNorm);
  }, [feedLocationReady, registeredRegions, activeRegionNorm]);

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
        // `cancelled`와 무관하게 피드를 연다 — cleanup(언마운트·StrictMode 등) 직전에 완료되면
        // `if (!cancelled)`만 쓰면 이후 리마운트 없이 `feedLocationReady`가 영구 false → 목록 무한 스켈레톤.
        setFeedLocationReady(true);
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
      if (!meetingMatchesFeedCategoryBarAndFilter(m, selectedCategoryId, feedBarVisibleCategoryIds, categories))
        return false;
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
    feedBarVisibleCategoryIds,
    categories,
    recruitingOnly,
    appliedFeedSearch,
  ]);

  const sortedFilteredMeetings = useMemo(() => {
    return sortMeetingsForFeed(filteredMeetings, listSortMode, feedCoords);
  }, [filteredMeetings, listSortMode, feedCoords]);

  /** 탐색 탭: 비공개(`false`)뿐 아니라 플래그 미설정(`null`/`undefined`)도 목록에서 제외. 일정 시작이 지난 공개 모임도 제외 */
  const exploreFeedMeetings = useMemo(
    () =>
      sortedFilteredMeetings.filter((m) => {
        if (m.isPublic !== true) return false;
        const startMs = meetingScheduleStartMs(m);
        if (startMs != null && startMs < Date.now()) return false;
        return true;
      }),
    [sortedFilteredMeetings],
  );

  const myTabsMeetings = useMemo(() => {
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

  /** Supabase RPC `ledger_list_my_meetings_for_feed` 결과 ID — 서버가 이미 호스트·참여로 거름 */
  const rpcMyMeetingIdSet = useMemo(() => {
    const s = new Set<string>();
    for (const m of myMeetings) {
      const id = typeof m?.id === 'string' ? m.id.trim() : '';
      if (id) s.add(id);
    }
    return s;
  }, [myMeetings]);

  const joinedFilteredMeetings = useMemo(() => {
    // 참여중·종료 탭은 “현재 접속 지역”과 무관하게 내가 만든/참여한 모임을 모두 보여줍니다.
    const base = myTabsMeetings.filter((m) => {
      const id = typeof m?.id === 'string' ? m.id.trim() : '';
      if (!id) return false;
      if (rpcMyMeetingIdSet?.has(id)) return true;
      return isUserJoinedMeeting(m, userId);
    });
    return base.filter((m) => {
      if (!meetingMatchesFeedCategoryBarAndFilter(m, selectedCategoryId, feedBarVisibleCategoryIds, categories))
        return false;
      if (!meetingMatchesFeedSearch(m, appliedFeedSearch)) return false;
      return true;
    });
  }, [
    myTabsMeetings,
    rpcMyMeetingIdSet,
    userId,
    selectedCategoryId,
    feedBarVisibleCategoryIds,
    categories,
    appliedFeedSearch,
  ]);

  const activeJoinedFilteredMeetings = useMemo(() => {
    void appPoliciesVersion;
    void homeArrivalNoticeUiTick;
    const now = Date.now();
    const windowMs = homeMeetingOngoingWindowMs();
    return joinedFilteredMeetings.filter((m) => !isEndedForHomeEndedTab(m, now, windowMs));
  }, [joinedFilteredMeetings, appPoliciesVersion, homeArrivalNoticeUiTick]);

  const endedJoinedFilteredMeetings = useMemo(() => {
    void appPoliciesVersion;
    void homeArrivalNoticeUiTick;
    const now = Date.now();
    const windowMs = homeMeetingOngoingWindowMs();
    return joinedFilteredMeetings.filter((m) => isEndedForHomeEndedTab(m, now, windowMs));
  }, [joinedFilteredMeetings, appPoliciesVersion, homeArrivalNoticeUiTick]);

  const sortedJoinedMeetings = useMemo(
    () => sortMeetingsForFeed(activeJoinedFilteredMeetings, listSortMode, feedCoords),
    [activeJoinedFilteredMeetings, listSortMode, feedCoords],
  );

  const sortedEndedMeetings = useMemo(
    () => sortHomeEndedMeetingsLatestFirst(endedJoinedFilteredMeetings),
    [endedJoinedFilteredMeetings],
  );

  const settlementBannerMeetings = useMemo(() => {
    const uid = userId?.trim() ?? '';
    if (!uid) return [] as Meeting[];
    void appPoliciesVersion;
    const now = Date.now();
    const seen = new Set<string>();
    const out: Meeting[] = [];
    for (const m of myTabsMeetings) {
      const id = typeof m?.id === 'string' ? m.id.trim() : '';
      if (!id || seen.has(id)) continue;
      if (!isMeetingSettlementCtaEligibleForHost(m, uid, now)) continue;
      seen.add(id);
      out.push(m);
    }
    out.sort((a, b) => {
      const ta = meetingScheduleStartMs(a) ?? 0;
      const tb = meetingScheduleStartMs(b) ?? 0;
      return ta - tb;
    });
    return out;
  }, [myTabsMeetings, userId, appPoliciesVersion]);

  const arrivalVerifyPol = useMemo(() => getMeetingArrivalVerifyPolicy(), [appPoliciesVersion]);

  const arrivalBannerCandidates = useMemo(() => {
    void homeArrivalNoticeUiTick;
    if (Platform.OS === 'web') return [] as Meeting[];
    const uid = userId?.trim() ?? '';
    if (!uid) return [] as Meeting[];
    void appPoliciesVersion;
    const now = Date.now();
    const pol = arrivalVerifyPol;
    const seen = new Set<string>();
    const out: Meeting[] = [];
    for (const m of myTabsMeetings) {
      const id = typeof m?.id === 'string' ? m.id.trim() : '';
      if (!id || seen.has(id)) continue;
      if (!ledgerWritesToSupabase() || !isLedgerMeetingId(id)) continue;
      if (m.scheduleConfirmed !== true) continue;
      if (isConfirmedMeetingPastListEndWindow(m, now)) continue;
      if (!isUserJoinedMeeting(m, uid) && !isMeetingHost(m, uid)) continue;
      if (!isMeetingArrivalNoticeBannerTimeEligible(m, now, pol)) continue;
      seen.add(id);
      out.push(m);
    }
    return out;
  }, [myTabsMeetings, userId, appPoliciesVersion, arrivalVerifyPol, homeArrivalNoticeUiTick]);

  const arrivalBannerCandidateIdsKey = useMemo(
    () => arrivalBannerCandidates.map((m) => m.id.trim()).filter(Boolean).join('\u0001'),
    [arrivalBannerCandidates],
  );

  useEffect(() => {
    void homeArrivalVerifiedCheckNonce;
    if (Platform.OS === 'web') return;
    const uid = userId?.trim();
    if (!uid) {
      setHomeArrivalVerifiedMap({});
      homeArrivalVerifiedLookupKeyRef.current = '';
      return;
    }
    const candidateIds = arrivalBannerCandidateIdsKey.split('\u0001').filter(Boolean);
    if (candidateIds.length === 0) {
      setHomeArrivalVerifiedMap({});
      homeArrivalVerifiedLookupKeyRef.current = `${uid}\u0002`;
      return;
    }
    const lookupKey = `${uid}\u0002${arrivalBannerCandidateIdsKey}`;
    if (homeArrivalVerifiedLookupKeyRef.current === lookupKey) return;
    homeArrivalVerifiedLookupKeyRef.current = lookupKey;
    let cancelled = false;
    void (async () => {
      const verifiedIds = await fetchLedgerArrivalVerifiedMeetingIdSet(candidateIds, uid);
      if (cancelled) return;
      setHomeArrivalVerifiedMap((prev) => {
        const next: Record<string, boolean> = {};
        for (const id of candidateIds) next[id] = verifiedIds.has(id) || prev[id] === true;
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [arrivalBannerCandidateIdsKey, userId, homeArrivalVerifiedCheckNonce]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(
      GINIT_MEETING_ARRIVAL_VERIFIED_EVENT,
      (e: { meetingId?: string }) => {
        const id = typeof e?.meetingId === 'string' ? e.meetingId.trim() : '';
        if (!id) return;
        setHomeArrivalVerifiedMap((prev) => ({ ...prev, [id]: true }));
      },
    );
    return () => sub.remove();
  }, []);

  const arrivalEligibleMeetings = useMemo(() => {
    void homeArrivalNoticeUiTick;
    const uid = userId?.trim() ?? '';
    if (!uid) return [] as Meeting[];
    return arrivalBannerCandidates.filter((m) =>
      shouldShowMeetingArrivalVerifyTopBanner({
        platformOs: Platform.OS,
        meeting: m,
        userId,
        verifiedByMe: Boolean(homeArrivalVerifiedMap[m.id.trim()]),
        nowMs: Date.now(),
        pol: arrivalVerifyPol,
        isMeetingEndedForArrivalUi: isConfirmedMeetingPastListEndWindow(m, Date.now()),
        canAccessArrivalFlow: isUserJoinedMeeting(m, uid) || isMeetingHost(m, uid),
        ledgerArrivalSupported: Boolean(ledgerWritesToSupabase() && isLedgerMeetingId(m.id)),
      }),
    );
  }, [
    arrivalBannerCandidates,
    homeArrivalVerifiedMap,
    userId,
    arrivalVerifyPol,
    homeArrivalNoticeUiTick,
  ]);

  const settlementNoticeIdSet = useMemo(
    () =>
      new Set(
        settlementBannerMeetings
          .map((m) => (typeof m.id === 'string' ? m.id.trim() : ''))
          .filter((id) => id.length > 0),
      ),
    [settlementBannerMeetings],
  );

  const arrivalNoticeIdSet = useMemo(
    () =>
      new Set(
        arrivalEligibleMeetings
          .map((m) => (typeof m.id === 'string' ? m.id.trim() : ''))
          .filter((id) => id.length > 0),
      ),
    [arrivalEligibleMeetings],
  );

  const homeNoticeOrderedMeetings = useMemo(() => {
    void homeArrivalNoticeUiTick;
    const seen = new Set<string>();
    const out: Meeting[] = [];
    for (const m of myTabsMeetings) {
      const id = typeof m?.id === 'string' ? m.id.trim() : '';
      if (!id || seen.has(id)) continue;
      const hasSettlement = settlementNoticeIdSet.has(id);
      const hasArrival = arrivalNoticeIdSet.has(id);
      const hasScheduleLine = shouldShowConfirmedScheduleNoticeBar(m, Date.now(), {
        showArrivalVerifyBanner: hasArrival,
        showSettlementHostBanner: hasSettlement,
      });
      if (!hasSettlement && !hasArrival && !hasScheduleLine) continue;
      seen.add(id);
      out.push(m);
    }
    out.sort((a, b) => (meetingScheduleStartMs(a) ?? 0) - (meetingScheduleStartMs(b) ?? 0));
    return out;
  }, [myTabsMeetings, settlementNoticeIdSet, arrivalNoticeIdSet, homeArrivalNoticeUiTick]);

  const homeTopNoticeSlides = useMemo((): MeetingDetailTopNoticeSlide[] => {
    void homeArrivalNoticeUiTick;
    const slides: MeetingDetailTopNoticeSlide[] = [];
    const now = Date.now();
    for (const m of homeNoticeOrderedMeetings) {
      const id = m.id.trim();
      if (settlementNoticeIdSet.has(id)) {
        slides.push({
          key: `settlement-${id}`,
          element: (
            <SettlementHostBanner
              hideTopBorder
              pillCapsule
              slideTrackFullBleed
              quotedMeetingTitle={buildMeetingTopNoticeTitleLeft(m, categories)}
              ctaSuffix="정산하기"
              onPress={() => router.push(`/settlement/${encodeURIComponent(id)}`)}
            />
          ),
        });
      }
      if (arrivalNoticeIdSet.has(id)) {
        slides.push({
          key: `arrival-${id}`,
          element: (
            <MeetingArrivalVerifyTopBanner
              hideTopBorder
              pillCapsule
              slideTrackFullBleed
              quotedMeetingTitle={buildMeetingTopNoticeTitleLeft(m, categories)}
              ctaSuffix="장소 인증"
              onPress={() => router.push(`/arrival-verify/${encodeURIComponent(id)}`)}
            />
          ),
        });
      }
      const scheduleOk = shouldShowConfirmedScheduleNoticeBar(m, now, {
        showArrivalVerifyBanner: arrivalNoticeIdSet.has(id),
        showSettlementHostBanner: settlementNoticeIdSet.has(id),
      });
      const titleLeft = scheduleOk ? buildConfirmedScheduleNoticeTitleLeft(m, categories) : '';
      const timeRight = scheduleOk ? buildConfirmedScheduleNoticeTimeRight(m) : '';
      const scheduleA11y = scheduleOk ? buildConfirmedScheduleNoticeAccessibilityLabel(m, categories) : '';
      if (scheduleOk && titleLeft.trim() !== '' && timeRight.trim() !== '') {
        slides.push({
          key: `schedule-${id}`,
          element: (
            <GinitPressable
              onPress={() => router.push(`/meeting/${encodeURIComponent(id)}`)}
              accessibilityRole="link"
              accessibilityLabel={scheduleA11y.trim() || '모임 상세'}
              style={({ pressed }) => [pressed && { opacity: 0.88 }]}>
              <MeetingDetailStaticNoticeRow
                titleLeft={titleLeft}
                timeRight={timeRight}
                accessibilityLabel={scheduleA11y}
                slideTrackFullBleed
              />
            </GinitPressable>
          ),
        });
      }
    }
    return slides;
  }, [
    homeNoticeOrderedMeetings,
    settlementNoticeIdSet,
    arrivalNoticeIdSet,
    router,
    homeArrivalNoticeUiTick,
    categories,
  ]);

  const homeFeedNoticeRows = useMemo((): HomeFeedNoticeRow[] => {
    void homeArrivalNoticeUiTick;
    const rows: HomeFeedNoticeRow[] = [];
    const now = Date.now();
    for (const m of homeNoticeOrderedMeetings) {
      const id = m.id.trim();
      const titleLine = buildMeetingTopNoticeTitleLeft(m, categories);
      if (settlementNoticeIdSet.has(id)) {
        rows.push({ key: `settlement-${id}`, kind: 'settlement', meetingId: id, meetingTitle: titleLine });
      }
      if (arrivalNoticeIdSet.has(id)) {
        rows.push({ key: `arrival-${id}`, kind: 'arrival', meetingId: id, meetingTitle: titleLine });
      }
      const scheduleOk = shouldShowConfirmedScheduleNoticeBar(m, now, {
        showArrivalVerifyBanner: arrivalNoticeIdSet.has(id),
        showSettlementHostBanner: settlementNoticeIdSet.has(id),
      });
      const schedTitleLeft = scheduleOk ? buildConfirmedScheduleNoticeTitleLeft(m, categories) : '';
      const schedTimeRight = scheduleOk ? buildConfirmedScheduleNoticeTimeRight(m) : '';
      if (scheduleOk && schedTitleLeft.trim() !== '' && schedTimeRight.trim() !== '') {
        rows.push({
          key: `schedule-${id}`,
          kind: 'schedule',
          meetingId: id,
          titleLeft: schedTitleLeft,
          timeRight: schedTimeRight,
        });
      }
    }
    return rows;
  }, [homeNoticeOrderedMeetings, settlementNoticeIdSet, arrivalNoticeIdSet, homeArrivalNoticeUiTick, categories]);

  const homeNoticesModalLayout = useMemo(() => {
    const topUsed = safeInsets.top + 8;
    const bottomPad = safeInsets.bottom + 12;
    const cardMaxHeight = Math.max(200, Math.floor(windowHeight - topUsed - bottomPad));
    const headerBlock = 56;
    const rowEstimate = 100;
    const listContentPaddingV = 18;
    const n = homeFeedNoticeRows.length;
    const intrinsicListHeight = n > 0 ? listContentPaddingV + n * rowEstimate : 0;
    const listScrollMax = Math.max(0, cardMaxHeight - headerBlock);
    const listHeight =
      n > 0 ? (listScrollMax > 0 ? Math.min(intrinsicListHeight, listScrollMax) : Math.min(intrinsicListHeight, 120)) : 0;
    const listOverflow = n > 0 && intrinsicListHeight > listHeight;
    return { cardMaxHeight, listHeight, listOverflow };
  }, [windowHeight, safeInsets.top, safeInsets.bottom, homeFeedNoticeRows.length]);

  const onPressHomeFeedNoticeRow = useCallback(
    (row: HomeFeedNoticeRow) => {
      setHomeNoticesModalOpen(false);
      const mid = row.meetingId.trim();
      InteractionManager.runAfterInteractions(() => {
        if (row.kind === 'settlement') {
          router.push(`/settlement/${encodeURIComponent(mid)}`);
          return;
        }
        if (row.kind === 'arrival') {
          router.push(`/arrival-verify/${encodeURIComponent(mid)}`);
          return;
        }
        router.push(`/meeting/${encodeURIComponent(mid)}`);
      });
    },
    [router],
  );

  const goToHomeTab = useCallback(
    (t: HomeMeetingTopTab) => {
      setHomeTab(t);
      const idx = homeMeetingTopTabIndex(t);
      requestAnimationFrame(() => {
        tabPagerRef.current?.scrollTo({ x: idx * tabPagerWidth, animated: true });
      });
    },
    [tabPagerWidth],
  );

  const onTabPagerMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const x = e.nativeEvent.contentOffset.x;
      const w = Math.max(1, tabPagerWidth);
      const idx = Math.round(x / w);
      const next: HomeMeetingTopTab = idx <= 0 ? 'explore' : idx === 1 ? 'my' : 'private';
      setHomeTab(next);
    },
    [tabPagerWidth],
  );

  const onTabPagerLayout = useCallback((e: LayoutChangeEvent) => {
    const next = Math.floor(e.nativeEvent.layout.width);
    if (next <= 1) return;
    setTabPagerWidth((prev) => (Math.abs(prev - next) < 1 ? prev : next));
  }, []);

  const handleEndReachedForTab = useCallback(
    (tab: HomeMeetingTopTab) => {
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

  const sortComboLabel = useMemo(() => listSortModeLabel(listSortMode), [listSortMode]);

  /** 모임 탭 통합 모달(카테고리+목록) — MapScreen 상단 카테고리 모달과 동일한 카드·스크롤 높이 규칙 */
  const feedMeetingOptionsModalCardMaxH = useMemo(
    () => Math.min(640, Math.floor(windowHeight * 0.88)),
    [windowHeight],
  );
  const feedMeetingOptionsModalCategoryListMaxH = useMemo(
    () => Math.max(120, feedMeetingOptionsModalCardMaxH - 500),
    [feedMeetingOptionsModalCardMaxH],
  );

  const syncFeedCategoryModalListMoreBelow = useCallback(() => {
    const lh = feedCategoryModalListLayHRef.current;
    const ch = feedCategoryModalListContHRef.current;
    const y = feedCategoryModalListScrollYRef.current;
    if (lh <= 0 || ch <= lh + 8) {
      setFeedCategoryModalListShowMoreBelow(false);
      return;
    }
    const remaining = ch - y - lh;
    setFeedCategoryModalListShowMoreBelow(remaining > 10);
  }, []);

  useEffect(() => {
    if (feedListSettingsModalOpen) return;
    feedCategoryModalListScrollYRef.current = 0;
    feedCategoryModalListLayHRef.current = 0;
    feedCategoryModalListContHRef.current = 0;
    setFeedCategoryModalListShowMoreBelow(false);
  }, [feedListSettingsModalOpen]);

  useEffect(() => {
    if (!feedListSettingsModalOpen) return;
    feedCategoryModalListScrollYRef.current = 0;
    requestAnimationFrame(() => {
      try {
        feedCategoryModalCategoryListScrollRef.current?.scrollTo({ y: 0, animated: false });
      } catch {
        /* ignore */
      }
      syncFeedCategoryModalListMoreBelow();
    });
  }, [feedListSettingsModalOpen, syncFeedCategoryModalListMoreBelow]);

  const openFeedMeetingOptionsModal = useCallback(() => {
    const ordered = sortedFeedCategoryMaster.map((c) => c.id);
    const vis =
      feedBarVisibleCategoryIds == null
        ? [...ordered]
        : ordered.filter((id) => feedBarVisibleCategoryIds.includes(id));
    setCategoryPickerDraft({ visibility: vis });
    setRecruitingOnlyDraft(recruitingOnly);
    setFeedListSettingsModalOpen(true);
  }, [sortedFeedCategoryMaster, feedBarVisibleCategoryIds, recruitingOnly]);

  const openCategoryPicker = openFeedMeetingOptionsModal;

  const closeFeedListSettingsModal = useCallback(() => setFeedListSettingsModalOpen(false), []);

  const openSortDropdown = useCallback(() => setSortDropdownOpen(true), []);
  const closeSortDropdown = useCallback(() => setSortDropdownOpen(false), []);

  const profilePk = useMemo(() => {
    const u = userId?.trim();
    if (u) return u;
    const em = authProfile?.email?.trim();
    if (em) return normalizeUserId(em) ?? '';
    return '';
  }, [userId, authProfile?.email]);

  const isSignedIn = useMemo(
    () => Boolean(userId?.trim() || authProfile?.supabaseUserId?.trim()),
    [userId, authProfile?.supabaseUserId],
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

  useFocusEffect(
    useCallback(() => {
      void refreshMeetingNotify();
    }, [refreshMeetingNotify]),
  );

  const openMeetingNotifySettings = useCallback(() => {
    closeFeedListSettingsModal();
    router.push('/profile/meeting-notify-settings');
  }, [closeFeedListSettingsModal, router]);

  /** 슬라이더 버튼 점 — 모집중·표시 카테고리·단일 종류 필터 또는 공개 모임 생성 알림이 켜진 경우 */
  const feedCategorySlidersDotActive = useMemo(
    () =>
      recruitingOnly ||
      (meetingNotifyLoaded && meetingNotifyEffectiveOn) ||
      selectedCategoryId != null ||
      (categories.length > 0 &&
        feedBarVisibleCategoryIds != null &&
        feedBarVisibleCategoryIds.length < categories.length),
    [
      categories.length,
      feedBarVisibleCategoryIds,
      selectedCategoryId,
      recruitingOnly,
      meetingNotifyLoaded,
      meetingNotifyEffectiveOn,
    ],
  );

  const toggleFeedCategoryPickerVisibilityDraft = useCallback((id: string) => {
    setCategoryPickerDraft((d) => {
      const ordered = sortedFeedCategoryMaster.map((c) => c.id);
      const set = new Set(d.visibility);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      const nextVis = ordered.filter((oid) => set.has(oid));
      return { visibility: nextVis };
    });
  }, [sortedFeedCategoryMaster]);

  const toggleFeedCategoryPickerSelectAll = useCallback(() => {
    setCategoryPickerDraft((d) => {
      const ordered = sortedFeedCategoryMaster.map((c) => c.id);
      if (ordered.length === 0) return d;
      const allOn =
        d.visibility.length === ordered.length &&
        ordered.every((oid) => d.visibility.includes(oid));
      return allOn ? { visibility: [] } : { visibility: [...ordered] };
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
    let nextFilter = selectedCategoryId;
    if (nextFilter != null) {
      if (!ordered.includes(nextFilter)) nextFilter = null;
      else if (nextVisible != null && !nextVisible.includes(nextFilter)) nextFilter = null;
    }
    setFeedBarVisibleCategoryIds(nextVisible);
    await persistFeedCategoryBarVisibleIds(nextVisible);
    setSelectedCategoryId(nextFilter);
    setRecruitingOnly(recruitingOnlyDraft);
    setFeedListSettingsModalOpen(false);
  }, [sortedFeedCategoryMaster, categoryPickerDraft, recruitingOnlyDraft, selectedCategoryId]);

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
      await runMeetingsUserActionDeltaSync(queryClient, userId?.trim() ?? null, 'pull_refresh');
    } finally {
      setRefreshing(false);
    }
  }, [feedLocationReady, queryClient, userId]);

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
      if (meetingOpenLockRef.current) return;
      meetingOpenLockRef.current = true;
      const lockRelease = () => {
        meetingOpenLockRef.current = false;
      };
      // 네비게이션이 끝나기 전 더블탭으로 push가 2번 호출되는 케이스 방지
      const tRelease = setTimeout(lockRelease, 900);

      cancelPendingMeetingOpenFromFeedRef.current?.();
      let cancelled = false;
      const cancelThisOpen = () => {
        cancelled = true;
      };
      cancelPendingMeetingOpenFromFeedRef.current = cancelThisOpen;

      const pk = userId?.trim() ?? '';
      if (!pk) {
        Alert.alert('로그인이 필요해요', '모임 상세는 로그인 후 볼 수 있어요.');
        clearTimeout(tRelease);
        lockRelease();
        if (cancelPendingMeetingOpenFromFeedRef.current === cancelThisOpen) {
          cancelPendingMeetingOpenFromFeedRef.current = null;
        }
        return;
      }
      // feedUserProfile은 탭 진입 직후 null일 수 있어(비동기 로드),
      // 클릭 시점에는 최신 프로필을 한 번 더 조회해서 잘못 막히는 케이스를 방지합니다.
      void (async () => {
        try {
          await ensureUserProfile(pk);
          if (cancelled) return;
          const p = await getUserProfile(pk);
          if (cancelled) return;
          const ok = isMeetingServiceComplianceComplete(p, pk);
          if (!ok) {
            const detailMsg = MEETING_PHONE_VERIFICATION_UI_ENABLED
              ? '모임 상세를 보려면 모임 이용을 위한 인증 정보 등록(약관 동의·전화 인증·성별/생년월일)을 먼저 완료해 주세요.'
              : '모임 상세를 보려면 모임 이용을 위한 인증 정보 등록(약관 동의·성별/생년월일)을 먼저 완료해 주세요.';
            Alert.alert('프로필을 완성해 주세요', detailMsg, [
              { text: '닫기', style: 'cancel' },
              { text: '정보 등록하기', onPress: () => pushProfileOpenRegisterInfo(router) },
            ]);
            return;
          }
          if (cancelled) return;
          router.push(`/meeting/${m.id}`);
        } catch {
          // 네트워크 실패 등으로 프로필을 못 읽어도, "미인증"으로 단정해 막지 않습니다.
          if (cancelled) return;
          router.push(`/meeting/${m.id}`);
        } finally {
          clearTimeout(tRelease);
          lockRelease();
          if (cancelPendingMeetingOpenFromFeedRef.current === cancelThisOpen) {
            cancelPendingMeetingOpenFromFeedRef.current = null;
          }
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
    (item: Meeting, tab: HomeMeetingTopTab) => {
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
          statusBadgeListKind={tab === 'explore' ? 'explore' : 'my_private'}
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
    if (feedBarVisibleCategoryIds != null && feedBarVisibleCategoryIds.length > 0 && selectedCategoryId == null) {
      return {
        icon: 'pricetags-outline',
        title: '선택한 모임 종류에 맞는 모임이 없어요',
        body: '카테고리 설정에서 표시할 종류를 바꿔 보세요.',
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
    feedBarVisibleCategoryIds,
    selectedCategoryId,
  ]);

  const fixedFeedHeader = (
    <View
      style={[
        styles.feedHeader,
        homeTopNoticeSlides.length > 0 && styles.feedHeaderWhenNoticePager,
      ]}>
      <View style={styles.feedHeaderTopRow}>
        <View style={styles.locationCluster}>
          <GinitPressable
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
          </GinitPressable>
          <GinitPressable
            onPress={openRegionDropdownModal}
            style={({ pressed }) => [styles.locationChevronPressable, pressed && styles.locationClusterPressed]}
            accessibilityRole="button"
            accessibilityLabel="등록된 관심 지역 중 표시 지역 선택"
            hitSlop={{ top: 20, bottom: 20, left: 16, right: 20 }}>
            <GinitSymbolicIcon name="chevron-down" size={20} color={GinitTheme.colors.primary} />
          </GinitPressable>
        </View>
        <View style={styles.headerActions}>
          <GinitPressable
            onPress={openFeedSearch}
            accessibilityRole="button"
            accessibilityLabel="검색 및 조건 필터"
            hitSlop={10}
            style={styles.searchIconWrap}>
            <GinitSymbolicIcon name="search-outline" size={22} color="#0f172a" />
            {feedSearchFiltersActive(appliedFeedSearch) ? <View style={styles.searchFilterDot} /> : null}
          </GinitPressable>
          <GinitPressable
            onPress={() => setHomeNoticesModalOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={
              homeFeedNoticeRows.length > 0
                ? `모임 공지 모아보기, 공지 ${homeFeedNoticeRows.length}건`
                : '모임 공지 모아보기'
            }
            hitSlop={10}
            style={styles.searchIconWrap}>
            <GinitSymbolicIcon name="megaphone-outline" size={22} color="#0f172a" />
            {homeFeedNoticeRows.length > 0 ? <View style={styles.homeNoticesIconBadge} /> : null}
          </GinitPressable>
          <InAppAlarmsBellButton />
          <GinitPressable
            onPress={openCategoryPicker}
            accessibilityRole="button"
            accessibilityLabel="모임 목록·카테고리 설정"
            hitSlop={10}
            style={styles.settingsIconWrap}>
            <GinitSymbolicIcon name="settings-outline" size={22} color="#0f172a" />
            {feedCategorySlidersDotActive ? <View style={styles.settingsFilterDot} /> : null}
          </GinitPressable>
        </View>
      </View>
      <View style={styles.tabCategoryBar}>
        <View style={styles.tabPair}>
          <GinitPressable
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
          </GinitPressable>
          <GinitPressable
            onPress={() => goToHomeTab('my')}
            style={({ pressed }) => [
              styles.homeTopChip,
              homeTab === 'my' && styles.homeTopChipActive,
              pressed && styles.homeTopChipPressed,
              { maxWidth: tabChipMaxWidth },
            ]}
            accessibilityRole="tab"
            accessibilityState={{ selected: homeTab === 'my' }}
            accessibilityLabel="참여중 모임">
            <Text style={[styles.homeTopChipLabel, homeTab === 'my' && styles.homeTopChipLabelActive]} numberOfLines={1}>
              참여중
            </Text>
          </GinitPressable>
          <GinitPressable
            onPress={() => goToHomeTab('private')}
            style={({ pressed }) => [
              styles.homeTopChip,
              homeTab === 'private' && styles.homeTopChipActive,
              pressed && styles.homeTopChipPressed,
              { maxWidth: tabChipMaxWidth },
            ]}
            accessibilityRole="tab"
            accessibilityState={{ selected: homeTab === 'private' }}
            accessibilityLabel="종료 모임">
            <Text style={[styles.homeTopChipLabel, homeTab === 'private' && styles.homeTopChipLabelActive]} numberOfLines={1}>
              종료
            </Text>
          </GinitPressable>
        </View>
        <GinitPressable
          onPress={openSortDropdown}
          style={({ pressed }) => [styles.categoryDropdown, pressed && styles.categoryDropdownPressed]}
          accessibilityRole="button"
          accessibilityLabel={`정렬, 현재 ${sortComboLabel}`}
          accessibilityHint="탭하면 정렬 순서를 바꿀 수 있어요"
          accessibilityState={{ expanded: sortDropdownOpen }}>
          <Text style={styles.categoryDropdownText} numberOfLines={1} ellipsizeMode="tail">
            {sortComboLabel}
          </Text>
          <GinitSymbolicIcon name="chevron-down" size={18} color="#475569" />
        </GinitPressable>
      </View>
      {homeTopNoticeSlides.length > 0 ? (
        <MeetingDetailTopNoticesPager slides={homeTopNoticeSlides} hideTopTrackDivider />
      ) : null}
    </View>
  );

  const tabListAlerts = (tab: HomeMeetingTopTab): ReactElement => (
    <>
      {(tab === 'explore' && (!feedLocationReady || (isInitialListLoading && exploreFeedMeetings.length === 0))) ||
      (tab !== 'explore' && !feedLocationReady) ? (
        <ScreenTransitionSkeleton variant="list" rows={6} />
      ) : null}

      {listError ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorTitle}>목록을 불러오지 못했어요</Text>
          <Text style={styles.errorBody}>{listError}</Text>
        </View>
      ) : null}

      {tab === 'explore' && feedLocationReady && !isInitialListLoading && !listError && meetings.length === 0 ? (
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
      tab === 'my' &&
      sortedJoinedMeetings.length === 0
        ? feedListEmptyCentered(
            'albums-outline',
            '참여중인 모임이 없습니다.',
            '+ 버튼으로 첫 모임을 만들어 보세요.',
          )
        : null}

      {feedLocationReady &&
      !isInitialListLoading &&
      !listError &&
      tab === 'private' &&
      sortedEndedMeetings.length === 0
        ? feedListEmptyCentered(
            'checkmark-done-outline',
            '종료된 모임이 없습니다.',
            '모임 시간이 지난 참여 모임이 여기에 표시됩니다.',
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
    const idx = homeMeetingTopTabIndex(t);
    tabPagerRef.current?.scrollTo({ x: idx * tabPagerWidth, animated: false });
  }, [tabPagerWidth]);

  return (
    <ScreenShell padded={false} style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.feedColumn}>
          {fixedFeedHeader}
          <View style={styles.tabPagerWrap} onLayout={onTabPagerLayout}>
            <ScrollView
              ref={tabPagerRef}
              horizontal
              pagingEnabled
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={onTabPagerMomentumEnd}
              style={styles.tabPager}>
              {HOME_MEETING_TOP_TABS.map((tab) => {
              const tabData =
                tab === 'explore'
                  ? exploreFeedMeetings
                  : tab === 'my'
                    ? sortedJoinedMeetings
                    : sortedEndedMeetings;
              return (
                <View key={tab} style={[styles.tabPage, { width: tabPagerWidth }]}>
                  <FlashList<Meeting>
                    data={tabData}
                    keyExtractor={(m) => m.id}
                    extraData={{
                      homeTab,
                      tab,
                      listSortMode,
                      recruitingOnly,
                      selectedCategoryId,
                      feedBarVisibleCategoryIds,
                      appliedFeedSearch,
                      exploreLen: exploreFeedMeetings.length,
                      endedLen: sortedEndedMeetings.length,
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
                    maintainVisibleContentPosition={{ disabled: true }}
                    nestedScrollEnabled
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
            <GinitPressable
              style={StyleSheet.absoluteFillObject}
              onPress={closeFeedListSettingsModal}
              accessibilityRole="button"
              accessibilityLabel="모임 목록 설정 닫기"
            />
            <View style={[styles.modalCard, { maxHeight: feedMeetingOptionsModalCardMaxH, overflow: 'hidden' }]}>
              <Text style={styles.modalTitle}>모임 목록</Text>
              <Text style={[styles.modalHint, styles.feedMeetingOptionsModalHint]}>
                목록에 쓸 모임 종류는 «저장»할 때 반영돼요. 모집중만 보기는 탐색 탭에만 적용돼요. 정렬·검색 조건은 상단에서 바꿀 수 있어요.
              </Text>
              <View style={styles.mapCategoryBarModalDivider} />
              <GinitPressable
                onPress={toggleFeedCategoryPickerSelectAll}
                style={({ pressed }) => [
                  styles.mapCategoryBarModalRow,
                  pressed && styles.modalRowPressed,
                ]}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: categoryPickerSelectAllChecked }}
                accessibilityLabel="모든 카테고리 표시">
                <Text style={styles.modalRowLabel}>모두 표시</Text>
                {categoryPickerSelectAllChecked ? (
                  <GinitSymbolicIcon name="checkmark-circle" size={22} color={GinitTheme.themeMainColor} />
                ) : (
                  <GinitSymbolicIcon name="ellipse-outline" size={22} color="#cbd5e1" />
                )}
              </GinitPressable>
              <View style={styles.mapCategoryBarModalDivider} />
              <View style={styles.categoryBarModalScrollWrap}>
                <ScrollView
                  ref={feedCategoryModalCategoryListScrollRef}
                  style={[styles.categoryBarModalScroll, { maxHeight: feedMeetingOptionsModalCategoryListMaxH }]}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  nestedScrollEnabled
                  scrollEventThrottle={16}
                  onLayout={(e) => {
                    feedCategoryModalListLayHRef.current = e.nativeEvent.layout.height;
                    syncFeedCategoryModalListMoreBelow();
                  }}
                  onContentSizeChange={(_, h) => {
                    feedCategoryModalListContHRef.current = h;
                    syncFeedCategoryModalListMoreBelow();
                  }}
                  onScroll={(e) => {
                    feedCategoryModalListScrollYRef.current = e.nativeEvent.contentOffset.y;
                    syncFeedCategoryModalListMoreBelow();
                  }}>
                  {sortedFeedCategoryMaster.map((c) => {
                    const on = categoryPickerDraft.visibility.includes(c.id);
                    return (
                      <GinitPressable
                        key={c.id}
                        onPress={() => toggleFeedCategoryPickerVisibilityDraft(c.id)}
                        style={({ pressed }) => [
                          styles.mapCategoryBarModalRow,
                          pressed && styles.modalRowPressed,
                        ]}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on }}>
                        <View style={styles.feedCategoryModalCategoryNameRow}>
                          <Text style={styles.feedCategoryModalCategoryEmoji} allowFontScaling={false}>
                            {c.emoji}
                          </Text>
                          <Text style={[styles.modalRowLabel, styles.feedCategoryModalCategoryLabel]} numberOfLines={1}>
                            {c.label}
                          </Text>
                        </View>
                        {on ? (
                          <GinitSymbolicIcon name="checkmark-circle" size={22} color={GinitTheme.themeMainColor} />
                        ) : (
                          <GinitSymbolicIcon name="ellipse-outline" size={22} color="#cbd5e1" />
                        )}
                      </GinitPressable>
                    );
                  })}
                </ScrollView>
                {feedCategoryModalListShowMoreBelow ? (
                  <View
                    pointerEvents="none"
                    style={styles.categoryBarModalScrollMoreCue}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants">
                    <LinearGradient
                      colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.96)']}
                      locations={[0.2, 1]}
                      start={{ x: 0.5, y: 0 }}
                      end={{ x: 0.5, y: 1 }}
                      style={StyleSheet.absoluteFillObject}
                    />
                    <Feather name="chevron-down" size={18} color="#64748b" style={styles.categoryBarModalScrollMoreIcon} />
                  </View>
                ) : null}
              </View>
              <View style={[styles.mapCategoryBarModalDivider, styles.mapCategoryBarModalDividerBeforeToday]} />
              <Text style={styles.modalSectionTitle}>표시</Text>
              <GinitPressable
                onPress={() => setRecruitingOnlyDraft((v) => !v)}
                style={({ pressed }) => [
                  styles.mapCategoryBarModalRow,
                  styles.mapCategoryBarModalRowTall,
                  pressed && styles.modalRowPressed,
                ]}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: recruitingOnlyDraft }}
                accessibilityLabel="모집중만 보기">
                <View style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                  <Text style={styles.modalRowLabel}>모집중만 보기</Text>
                  <Text style={styles.mapCategoryBarModalSubHint} numberOfLines={2}>
                    탐색 탭에서만 정원 미달·일정 미확정 모임만 표시합니다. 참여중·종료 탭에는 적용되지 않아요.
                  </Text>
                </View>
                <View style={styles.mapCategoryBarModalCheckCol}>
                  {recruitingOnlyDraft ? (
                    <GinitSymbolicIcon name="checkmark-circle" size={22} color={GinitTheme.themeMainColor} />
                  ) : (
                    <GinitSymbolicIcon name="ellipse-outline" size={22} color="#cbd5e1" />
                  )}
                </View>
              </GinitPressable>
              {isSignedIn && Platform.OS !== 'web' ? (
                <>
                  <View style={styles.mapCategoryBarModalDivider} />
                  <Text style={styles.modalSectionTitle}>알림</Text>
                  <GinitPressable
                    onPress={openMeetingNotifySettings}
                    style={({ pressed }) => [
                      styles.mapCategoryBarModalRow,
                      styles.mapCategoryBarModalRowTall,
                      pressed && styles.modalRowPressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="모임 생성 알림 설정">
                    <View style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                      <Text style={styles.modalRowLabel}>공개 모임 생성 알림</Text>
                      <Text style={styles.mapCategoryBarModalSubHint} numberOfLines={2}>
                        관심 지역·카테고리별로 새 공개 모임만 알려요.
                      </Text>
                    </View>
                    <GinitPressable
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
                    </GinitPressable>
                  </GinitPressable>
                </>
              ) : null}
              <View style={styles.categoryBarModalActions}>
                <GinitPressable
                  onPress={closeFeedListSettingsModal}
                  style={({ pressed }) => [styles.categoryBarActionGhost, pressed && { opacity: 0.85 }]}
                  accessibilityRole="button">
                  <Text style={styles.categoryBarActionGhostLabel}>취소</Text>
                </GinitPressable>
                <GinitPressable
                  onPress={() => void saveCategoryPickerModal()}
                  style={({ pressed }) => [styles.categoryBarActionPrimary, pressed && { opacity: 0.9 }]}
                  accessibilityRole="button">
                  <Text style={styles.modalCloseLabel}>저장</Text>
                </GinitPressable>
              </View>
            </View>
          </View>
        </Modal>

        <Modal
          visible={homeNoticesModalOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setHomeNoticesModalOpen(false)}>
          <GinitPressable style={styles.homeNoticesModalBackdrop} onPress={() => setHomeNoticesModalOpen(false)}>
            <GinitPressable
              style={[
                styles.homeNoticesModalCard,
                { marginTop: safeInsets.top + 8, maxHeight: homeNoticesModalLayout.cardMaxHeight },
              ]}
              onPress={(e) => e.stopPropagation()}>
              <View style={styles.homeNoticesModalHeader}>
                <Text style={styles.homeNoticesModalTitle}>모임 공지</Text>
                <GinitPressable
                  hitSlop={12}
                  onPress={() => setHomeNoticesModalOpen(false)}
                  accessibilityRole="button"
                  accessibilityLabel="닫기">
                  <GinitSymbolicIcon name="close" size={26} color="#475569" />
                </GinitPressable>
              </View>
              {homeFeedNoticeRows.length === 0 ? (
                <View style={styles.homeNoticesModalEmpty}>
                  <Text style={styles.homeNoticesModalEmptyText}>상단에 표시할 모임 공지가 없어요.</Text>
                </View>
              ) : (
                <FlatList
                  data={homeFeedNoticeRows}
                  keyExtractor={(item) => item.key}
                  style={{ height: homeNoticesModalLayout.listHeight, flexGrow: 0 }}
                  removeClippedSubviews={false}
                  contentContainerStyle={styles.homeNoticesModalListContent}
                  keyboardShouldPersistTaps="handled"
                  scrollEnabled={homeNoticesModalLayout.listOverflow}
                  nestedScrollEnabled
                  renderItem={({ item }) => (
                    <GinitPressable
                      style={({ pressed }) => [
                        styles.homeNoticesModalRow,
                        pressed && styles.homeNoticesModalRowPressed,
                      ]}
                      onPress={() => onPressHomeFeedNoticeRow(item)}>
                      <View style={styles.homeNoticesModalIconWrap}>
                        <GinitSymbolicIcon
                          name={homeFeedNoticeRowIcon(item.kind)}
                          size={22}
                          color={
                            item.kind === 'schedule'
                              ? GinitTheme.colors.deepPurple
                              : GinitTheme.themeMainColor
                          }
                        />
                      </View>
                      <View style={styles.homeNoticesModalTextCol}>
                        <Text style={styles.homeNoticesModalRowTitle} numberOfLines={1}>
                          {item.kind === 'schedule' ? item.titleLeft : item.meetingTitle}
                        </Text>
                        <Text
                          style={[
                            styles.homeNoticesModalRowSub,
                            (item.kind === 'settlement' || item.kind === 'arrival') &&
                              styles.homeNoticesModalRowSubCta,
                          ]}
                          {...(item.kind === 'schedule' ? {} : { numberOfLines: 3 as const })}>
                          {homeFeedNoticeRowSubtitle(item)}
                        </Text>
                      </View>
                      <GinitSymbolicIcon name="chevron-forward" size={20} color="#94a3b8" />
                    </GinitPressable>
                  )}
                />
              )}
            </GinitPressable>
          </GinitPressable>
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
            <GinitPressable
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
                          <GinitPressable
                            onPress={() => removeDraftRegion(r)}
                            accessibilityRole="button"
                            accessibilityLabel={`${getInterestRegionDisplayLabel(r)} 삭제`}
                            hitSlop={8}>
                            <GinitSymbolicIcon name="trash-outline" size={22} color="#94a3b8" />
                          </GinitPressable>
                        )}
                      </View>
                    );
                  })
                )}
                {draftRegisteredRegions.length < FEED_REGISTERED_REGIONS_MAX ? (
                  <GinitPressable
                    onPress={openRegionSearchModal}
                    style={({ pressed }) => [styles.modalRow, pressed && styles.modalRowPressed]}
                    accessibilityRole="button"
                    accessibilityLabel="관심 지역 추가">
                    <GinitSymbolicIcon name="add-circle-outline" size={24} color={GinitTheme.colors.primary} />
                    <Text style={[styles.modalRowLabel, styles.interestRegionAddLabel]}>관심 지역 추가</Text>
                    <GinitSymbolicIcon name="chevron-forward" size={20} color="#94a3b8" />
                  </GinitPressable>
                ) : (
                  <Text style={styles.interestRegionEmptyDraft}>최대 {FEED_REGISTERED_REGIONS_MAX}곳까지 등록할 수 있어요.</Text>
                )}
              </ScrollView>
              <GinitPressable onPress={applyDraftRegisteredRegions} style={styles.modalPrimaryBtn} accessibilityRole="button">
                <Text style={styles.modalPrimaryLabel}>적용</Text>
              </GinitPressable>
              {registeredRegions.length > 0 ? (
                <GinitPressable onPress={closeRegionModal} style={styles.modalCloseBtn} accessibilityRole="button">
                  <Text style={styles.modalCloseLabel}>닫기</Text>
                </GinitPressable>
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
            <GinitPressable
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
                  <GinitPressable
                    onPress={() => {
                      closeRegionDropdownModal();
                      openRegionModal();
                    }}
                    style={styles.modalPrimaryBtn}
                    accessibilityRole="button">
                    <Text style={styles.modalPrimaryLabel}>관심 지역 등록하기</Text>
                  </GinitPressable>
                </>
              ) : (
                <>
                  <Text style={styles.modalHint}>탐색에 보일 구를 골라 주세요.</Text>
                  {registeredRegions.map((r) => {
                    const norm = normalizeFeedRegionLabel(r);
                    const active = norm === exploreActiveRegionNorm;
                    return (
                      <GinitPressable
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
                      </GinitPressable>
                    );
                  })}
                </>
              )}
              <GinitPressable onPress={closeRegionDropdownModal} style={styles.modalCloseBtn} accessibilityRole="button">
                <Text style={styles.modalCloseLabel}>닫기</Text>
              </GinitPressable>
            </View>
          </View>
        </Modal>

        <Modal
          visible={sortDropdownOpen}
          animationType="fade"
          transparent
          onRequestClose={closeSortDropdown}>
          <View style={styles.modalRoot}>
            <GinitPressable
              style={StyleSheet.absoluteFillObject}
              onPress={closeSortDropdown}
              accessibilityRole="button"
              accessibilityLabel="정렬 선택 닫기"
            />
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>정렬</Text>
              <Text style={styles.modalHint}>목록에 나올 모임의 순서를 골라 주세요.</Text>
              {(['distance', 'latest', 'soon'] as const).map((mode) => {
                const selected = listSortMode === mode;
                const label = listSortModeLabel(mode);
                return (
                  <GinitPressable
                    key={mode}
                    onPress={() => {
                      setListSortMode(mode);
                      closeSortDropdown();
                    }}
                    style={({ pressed }) => [styles.modalRow, pressed && styles.modalRowPressed]}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}>
                    <Text style={styles.modalRowLabel}>{label}</Text>
                    {selected ? (
                      <GinitSymbolicIcon name="checkmark-circle" size={22} color={GinitTheme.colors.primary} />
                    ) : (
                      <GinitSymbolicIcon name="ellipse-outline" size={22} color="#cbd5e1" />
                    )}
                  </GinitPressable>
                );
              })}
              <GinitPressable onPress={closeSortDropdown} style={styles.modalCloseBtn} accessibilityRole="button">
                <Text style={styles.modalCloseLabel}>닫기</Text>
              </GinitPressable>
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
            <GinitPressable
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
                    <GinitPressable
                      key={hit.key}
                      onPress={() => pickSearchResultDistrict(hit.key)}
                      style={({ pressed }) => [styles.modalRow, pressed && styles.modalRowPressed]}
                      accessibilityRole="button">
                      <Text style={styles.modalRowLabel}>{hit.label}</Text>
                      <GinitSymbolicIcon name="chevron-forward" size={20} color="#94a3b8" />
                    </GinitPressable>
                  ))
                )}
              </ScrollView>
              <GinitPressable onPress={closeRegionSearchModal} style={styles.modalCloseBtn} accessibilityRole="button">
                <Text style={styles.modalCloseLabel}>닫기</Text>
              </GinitPressable>
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
  /** 슬라이드 공지가 있을 때: 헤더 하단 여백 없이 목록과 맞닿음 */
  feedHeaderWhenNoticePager: {
    marginBottom: 0,
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
    gap: 10,
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
  homeNoticesIconBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: GinitTheme.colors.deepPurple,
    borderWidth: 1,
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
  /** 새 소식 모달과 동일 레이아웃 — 홈 상단 공지 모아보기 */
  homeNoticesModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingHorizontal: 18,
  },
  homeNoticesModalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.35)',
  },
  homeNoticesModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(148, 163, 184, 0.4)',
  },
  homeNoticesModalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#0f172a',
  },
  homeNoticesModalListContent: {
    paddingVertical: 6,
    paddingBottom: 12,
  },
  homeNoticesModalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  homeNoticesModalRowPressed: {
    backgroundColor: 'rgba(241, 245, 249, 0.9)',
  },
  homeNoticesModalIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(59, 130, 246, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeNoticesModalTextCol: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  homeNoticesModalRowTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },
  homeNoticesModalRowSub: {
    fontSize: 13,
    color: '#475569',
    lineHeight: 18,
  },
  homeNoticesModalRowSubCta: {
    color: GinitTheme.colors.deepPurple,
    fontWeight: '700',
  },
  homeNoticesModalEmpty: {
    paddingVertical: 28,
    paddingHorizontal: 16,
  },
  homeNoticesModalEmptyText: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
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
  /** MapScreen 상단 카테고리 모달과 동일 계열 — 모임 탭 통합 모달 */
  feedMeetingOptionsModalHint: {
    marginBottom: 0,
  },
  feedCategoryModalCategoryNameRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
    marginRight: 8,
  },
  feedCategoryModalCategoryEmoji: {
    fontSize: 18,
    lineHeight: 22,
  },
  feedCategoryModalCategoryLabel: {
    flexShrink: 1,
  },
  mapCategoryBarModalDivider: {
    height: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    backgroundColor: GinitTheme.colors.border,
    marginHorizontal: 4,
    marginTop: 4,
    marginBottom: 8,
  },
  mapCategoryBarModalDividerBeforeToday: {
    marginTop: 10,
    marginBottom: 6,
  },
  mapCategoryBarModalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 9,
    paddingHorizontal: 4,
  },
  mapCategoryBarModalRowTall: {
    alignItems: 'flex-start',
    paddingVertical: 12,
  },
  mapCategoryBarModalCheckCol: {
    paddingTop: 2,
  },
  mapCategoryBarModalSubHint: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    color: '#64748b',
  },
  categoryBarModalScrollWrap: {
    position: 'relative',
    alignSelf: 'stretch',
    flexGrow: 0,
  },
  categoryBarModalScroll: {
    flexGrow: 0,
  },
  categoryBarModalScrollMoreCue: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 40,
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
    overflow: 'hidden',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: 2,
  },
  categoryBarModalScrollMoreIcon: {
    zIndex: 1,
  },
  categoryBarModalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 20,
    marginTop: 14,
    paddingTop: 4,
  },
  categoryBarActionGhost: {
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  categoryBarActionGhostLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#64748b',
  },
  categoryBarActionPrimary: {
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
