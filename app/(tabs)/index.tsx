import { GinitPressable } from '@/components/ui/GinitPressable';
import Feather from '@expo/vector-icons/Feather';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { useRootNavigationState } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { ActivityIndicator, BackHandler, DeviceEventEmitter, FlatList, InteractionManager, Keyboard, Modal, Platform, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, ToastAndroid, useWindowDimensions, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';

import { FeedSearchFilterModal } from '@/components/feed/FeedSearchFilterModal';
import { FeedMeetingReviewSection } from '@/components/feed/meeting-review-carousel/FeedMeetingReviewSection';
import { HomeMeetingListItem } from '@/components/feed/HomeMeetingListItem';
import { InterestRegionHeaderCluster } from '@/components/feed/InterestRegionHeaderCluster';
import {
  FeedMeetingListSettingsModal,
  computeFeedMeetingListSettingsDotActive,
  useMeetingCreateNotifyEffective,
} from '@/components/feed/FeedMeetingListSettingsModal';
import { InterestRegionModals } from '@/components/feed/InterestRegionModals';
import { InAppAlarmsBellButton } from '@/components/in-app-alarms/InAppAlarmsBellButton';
import { MeetingArrivalVerifyTopBanner } from '@/components/meeting/MeetingArrivalVerifyTopBanner';
import {
  MeetingDetailStaticNoticeRow,
  MeetingDetailTopNoticesPager,
  type MeetingDetailTopNoticeSlide,
} from '@/components/meeting/MeetingDetailTopNoticesPager';
import { MeetingPlaceReviewBanner } from '@/components/meeting/MeetingPlaceReviewBanner';
import { SettlementHostBanner } from '@/components/meeting/SettlementHostBanner';
import { ScreenShell, ScreenTransitionSkeleton } from '@/components/ui';
import { GinitSymbolicIcon, type SymbolicIconName } from '@/components/ui/GinitSymbolicIcon';
import { GinitTheme } from '@/constants/ginit-theme';
import { useAppPolicies } from '@/src/context/AppPoliciesContext';
import { usePendingMeetingPlaceReviewIds } from '@/src/hooks/use-pending-meeting-place-review-ids';
import { useMeetingCategories } from '@/src/context/MeetingCategoriesContext';
import { useUserSession } from '@/src/context/UserSessionContext';
import { useFeedInterestRegionControls } from '@/src/hooks/use-feed-interest-region-controls';
import { useFeedMeetingReviewsForRegion } from '@/src/hooks/use-feed-meeting-reviews-for-region';
import { FEED_INTEREST_REGION_SELECTION_CHANGED } from '@/src/lib/feed-interest-region-events';
import { useMeetingsFeedInfiniteQuery } from '@/src/hooks/use-meetings-feed-infinite-query';
import { useMeetingsTableRealtimeDeferred } from '@/src/hooks/use-meetings-table-realtime-deferred';
import { useMyMeetingsFeedSync } from '@/src/hooks/use-my-meetings-feed-sync';
import { isAndroidTabHomeHardwareExitSuppressed } from '@/src/lib/android-tab-home-hardware-exit-suppress';
import { normalizeParticipantId, normalizeUserId } from '@/src/lib/app-user-id';
import { useTransitionRouter } from '@/src/lib/screen-transition-navigation';
import type { Category } from '@/src/lib/categories';
import {
  loadFeedCategoryBarVisibleIds,
  loadFeedExploreTodayOnly,
  persistFeedCategoryBarVisibleIds,
  persistFeedExploreTodayOnly,
} from '@/src/lib/feed-category-bar-preference';
import {
  resolveFeedLocationContextWithoutPermissionPrompt,
  resolveFeedLocationForDistanceSort,
} from '@/src/lib/feed-display-location';
import {
  defaultFeedSearchFilters,
  feedMeetingSymbolBox,
  feedSearchFiltersActive,
  listSortModeLabel,
  applyHomeExploreFeedVisibility,
  filterMeetingsForHomeExploreList,
  meetingMatchesFeedCategoryBarAndFilter,
  meetingMatchesFeedSearch,
  meetingWithinHomeFeedRadius,
  sortMeetingsForFeed,
  type FeedSearchFilters,
  type MeetingListSortMode,
} from '@/src/lib/feed-meeting-utils';
import {
  homeMeetingListOngoingWindowMs,
  isMeetingEndedForHomeList,
} from '@/src/lib/feed-home-visual';
import {
  buildExploreFeedRows,
  homeFeedRowKey,
  type HomeFeedRow,
} from '@/src/lib/feed-home-list-rows';
import { ledgerWritesToSupabase } from '@/src/lib/hybrid-data-source';
import { runMeetingsUserActionDeltaSync } from '@/src/lib/meeting-sync-service';
import { isUserJoinedMeeting } from '@/src/lib/joined-meetings';
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
  buildUnconfirmedAutoCancelWarningNoticeAccessibilityLabel,
  buildUnconfirmedAutoCancelWarningNoticeTimeRight,
  buildUnconfirmedAutoCancelWarningNoticeTitleLeft,
  shouldShowConfirmedScheduleNoticeBar,
  shouldShowUnconfirmedAutoCancelWarningNotice,
} from '@/src/lib/meetings';
import { isLedgerMeetingId } from '@/src/lib/meetings-ledger';
import { pushProfileOpenRegisterInfo } from '@/src/lib/profile-register-info';
import {
  isMeetingHost,
  isMeetingSettlementCollaborationEligible,
  isMeetingSettlementCtaEligibleForHost,
} from '@/src/lib/settlement-eligibility';
import { GINIT_MEETING_PLACE_REVIEW_SUBMITTED_EVENT } from '@/src/lib/meeting-place-review-dismiss';
import { isMeetingPlaceReviewEligible } from '@/src/lib/meeting-place-review-notice';
import { emitTabBarFabDocked } from '@/src/lib/tabbar-fab-scroll';
import { presentAppDialogAlert, presentAppDialogConfirm } from '@/src/lib/app-dialog-present';
import {
  ensureUserProfile,
  getUserProfile,
  getUserProfilesForIds,
  isMeetingServiceComplianceComplete,
  type UserProfile,
} from '@/src/lib/user-profile';

type HomeMeetingTopTab = 'explore' | 'my' | 'private';

/** 홈 상단 공지 모달 행 — `homeTopNoticeSlides`와 동일 순서·조건 */
type HomeFeedNoticeRow =
  | { key: string; kind: 'settlement'; meetingId: string; meetingTitle: string }
  | { key: string; kind: 'settlement_collab'; meetingId: string; meetingTitle: string }
  | { key: string; kind: 'meeting_review'; meetingId: string; meetingTitle: string }
  | { key: string; kind: 'arrival'; meetingId: string; meetingTitle: string }
  | { key: string; kind: 'schedule'; meetingId: string; titleLeft: string; timeRight: string }
  | { key: string; kind: 'unconfirmed_auto_cancel'; meetingId: string; titleLeft: string; timeRight: string };

function homeFeedNoticeRowSubtitle(row: HomeFeedNoticeRow): string {
  if (row.kind === 'settlement') return '정산하기';
  if (row.kind === 'settlement_collab') return '함께 정산하기';
  if (row.kind === 'meeting_review') return '후기 남기기';
  if (row.kind === 'arrival') return '장소 인증';
  return row.timeRight;
}

function homeFeedNoticeRowIcon(kind: HomeFeedNoticeRow['kind']): SymbolicIconName {
  if (kind === 'settlement' || kind === 'settlement_collab') return 'wallet-outline';
  if (kind === 'meeting_review') return 'pencil';
  if (kind === 'arrival') return 'location-outline';
  return 'megaphone-outline';
}

const HOME_MEETING_TOP_TABS = ['explore', 'my', 'private'] as const satisfies readonly HomeMeetingTopTab[];

function homeMeetingTopTabIndex(t: HomeMeetingTopTab): number {
  if (t === 'explore') return 0;
  if (t === 'my') return 1;
  return 2;
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

  const interestRegion = useFeedInterestRegionControls();
  const {
    registeredRegions,
    exploreActiveRegionNorm,
    feedLocationReady,
    regionModalOpen,
    regionSearchModalOpen,
    openRegionModal,
    refreshFromStorage,
  } = interestRegion;
  const [feedListSettingsModalOpen, setFeedListSettingsModalOpen] = useState(false);
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);
  const [distanceSortLocating, setDistanceSortLocating] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [listSortMode, setListSortMode] = useState<MeetingListSortMode>('soon');
  /** true면 모집중(정원 미달·미확정) 모임만 표시. 기본값 off */
  const [recruitingOnly, setRecruitingOnly] = useState(false);
  const [exploreTodayOnly, setExploreTodayOnly] = useState(false);
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
      if (exploreActiveRegionNorm.trim()) {
        void feedMeetingReviews.runDeltaSync('foreground').catch((err) =>
          console.log('Feed reviews focus sync failed:', err),
        );
      }
    }, [queryClient, userId, feedLocationReady, exploreActiveRegionNorm, feedMeetingReviews]),
  );

  useFocusEffect(
    useCallback(() => {
      return () => {
        cancelPendingMeetingOpenFromFeedRef.current?.();
        cancelPendingMeetingOpenFromFeedRef.current = null;
      };
    }, []),
  );

  /** `null`이면 드롭다운에 카테고리 마스터 전부 표시 */
  const [feedBarVisibleCategoryIds, setFeedBarVisibleCategoryIds] = useState<string[] | null>(null);
  const [feedUserProfile, setFeedUserProfile] = useState<UserProfile | null>(null);
  const [feedCoords, setFeedCoords] = useState<{ latitude: number; longitude: number } | null>(null);

  const isHomeMeetingsScreenFocused = useIsFocused();
  const rootNavigationState = useRootNavigationState();
  const isRootStackAtTabsHome = useMemo(() => {
    const routes = rootNavigationState?.routes;
    if (!routes?.length) return false;
    return routes.length <= 1;
  }, [rootNavigationState]);
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
    if (!isHomeMeetingsScreenFocused || !isRootStackAtTabsHome) {
      homeExitBackPressRef.current = 0;
      return undefined;
    }
    const anyOverlayOpen =
      regionSearchModalOpen ||
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
    isRootStackAtTabsHome,
    regionSearchModalOpen,
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
    void (async () => {
      const [categoryIds, todayOnly] = await Promise.all([
        loadFeedCategoryBarVisibleIds(),
        loadFeedExploreTodayOnly(),
      ]);
      if (cancelled) return;
      setFeedBarVisibleCategoryIds(categoryIds);
      setExploreTodayOnly(todayOnly);
    })();
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

  const homeExploreListFilterParams = useMemo(
    () => ({
      meetings: meetingsWithinRadius,
      feedLocationReady,
      registeredRegions,
      exploreActiveRegionNorm,
      selectedCategoryId,
      barVisibleCategoryIds: feedBarVisibleCategoryIds,
      categories,
      recruitingOnly,
      exploreTodayOnly,
      feedSearch: appliedFeedSearch,
    }),
    [
      meetingsWithinRadius,
      feedLocationReady,
      registeredRegions,
      exploreActiveRegionNorm,
      selectedCategoryId,
      feedBarVisibleCategoryIds,
      categories,
      recruitingOnly,
      exploreTodayOnly,
      appliedFeedSearch,
    ],
  );

  const filteredMeetings = useMemo(
    () => filterMeetingsForHomeExploreList(homeExploreListFilterParams),
    [homeExploreListFilterParams],
  );

  const sortedFilteredMeetings = useMemo(() => {
    return sortMeetingsForFeed(filteredMeetings, listSortMode, feedCoords);
  }, [filteredMeetings, listSortMode, feedCoords]);

  /** 탐색 탭: 비공개(`false`)뿐 아니라 플래그 미설정(`null`/`undefined`)도 목록에서 제외. 일정 시작이 지난 공개 모임도 제외 */
  const exploreFeedMeetings = useMemo(
    () => applyHomeExploreFeedVisibility(sortedFilteredMeetings),
    [sortedFilteredMeetings],
  );

  const feedMeetingReviews = useFeedMeetingReviewsForRegion(exploreActiveRegionNorm, {
    enabled: feedLocationReady && Boolean(exploreActiveRegionNorm.trim()),
  });

  const exploreFeedRows = useMemo(
    () => buildExploreFeedRows(exploreFeedMeetings, feedMeetingReviews.reviews),
    [exploreFeedMeetings, feedMeetingReviews.reviews],
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

  const joinedFilteredMeetings = useMemo(() => {
    // 참여중·종료 탭은 “현재 접속 지역”과 무관하게 내가 만든/참여한 모임을 모두 보여줍니다.
    const base = myTabsMeetings.filter((m) => {
      const id = typeof m?.id === 'string' ? m.id.trim() : '';
      if (!id) return false;
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
    const windowMs = homeMeetingListOngoingWindowMs();
    return joinedFilteredMeetings.filter((m) => !isMeetingEndedForHomeList(m, now, windowMs));
  }, [joinedFilteredMeetings, appPoliciesVersion, homeArrivalNoticeUiTick]);

  const endedJoinedFilteredMeetings = useMemo(() => {
    void appPoliciesVersion;
    void homeArrivalNoticeUiTick;
    const now = Date.now();
    const windowMs = homeMeetingListOngoingWindowMs();
    return joinedFilteredMeetings.filter((m) => isMeetingEndedForHomeList(m, now, windowMs));
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

  const settlementCollabBannerMeetings = useMemo(() => {
    const uid = userId?.trim() ?? '';
    if (!uid) return [] as Meeting[];
    void appPoliciesVersion;
    const now = Date.now();
    const seen = new Set<string>();
    const out: Meeting[] = [];
    for (const m of myTabsMeetings) {
      const id = typeof m?.id === 'string' ? m.id.trim() : '';
      if (!id || seen.has(id)) continue;
      if (isMeetingHost(m, uid)) continue;
      if (!isMeetingSettlementCollaborationEligible(m, uid, now)) continue;
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

  const settledReviewBannerMeetings = useMemo(() => {
    const uid = userId?.trim() ?? '';
    if (!uid) return [] as Meeting[];
    const seen = new Set<string>();
    const out: Meeting[] = [];
    for (const m of myTabsMeetings) {
      const id = typeof m?.id === 'string' ? m.id.trim() : '';
      if (!id || seen.has(id)) continue;
      if (!isMeetingPlaceReviewEligible(m, uid)) continue;
      seen.add(id);
      out.push(m);
    }
    out.sort((a, b) => {
      const ta = meetingScheduleStartMs(a) ?? 0;
      const tb = meetingScheduleStartMs(b) ?? 0;
      return ta - tb;
    });
    return out;
  }, [myTabsMeetings, userId]);

  const { pendingIds: placeReviewPendingIdSet } = usePendingMeetingPlaceReviewIds(
    settledReviewBannerMeetings,
    userId,
  );

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

  const settlementCollabNoticeIdSet = useMemo(
    () =>
      new Set(
        settlementCollabBannerMeetings
          .map((m) => (typeof m.id === 'string' ? m.id.trim() : ''))
          .filter((id) => id.length > 0),
      ),
    [settlementCollabBannerMeetings],
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
      const hasSettlementCollab = settlementCollabNoticeIdSet.has(id);
      const hasPlaceReview = placeReviewPendingIdSet.has(id);
      const hasArrival = arrivalNoticeIdSet.has(id);
      const hasScheduleLine = shouldShowConfirmedScheduleNoticeBar(m, Date.now(), {
        showArrivalVerifyBanner: hasArrival,
        showSettlementHostBanner: hasSettlement || hasSettlementCollab,
      });
      const uid = userId?.trim() ?? '';
      const hasAutoCancelWarning =
        Boolean(uid) &&
        isMeetingHost(m, uid) &&
        shouldShowUnconfirmedAutoCancelWarningNotice(m, Date.now());
      if (
        !hasSettlement &&
        !hasSettlementCollab &&
        !hasPlaceReview &&
        !hasArrival &&
        !hasScheduleLine &&
        !hasAutoCancelWarning
      )
        continue;
      seen.add(id);
      out.push(m);
    }
    out.sort((a, b) => (meetingScheduleStartMs(a) ?? 0) - (meetingScheduleStartMs(b) ?? 0));
    return out;
  }, [
    myTabsMeetings,
    settlementNoticeIdSet,
    settlementCollabNoticeIdSet,
    placeReviewPendingIdSet,
    arrivalNoticeIdSet,
    homeArrivalNoticeUiTick,
    userId,
  ]);

  const homeTopNoticeSlides = useMemo((): MeetingDetailTopNoticeSlide[] => {
    void homeArrivalNoticeUiTick;
    const slides: MeetingDetailTopNoticeSlide[] = [];
    const now = Date.now();
    for (const m of homeNoticeOrderedMeetings) {
      const id = m.id.trim();
      if (placeReviewPendingIdSet.has(id)) {
        slides.push({
          key: `meeting-review-${id}`,
          element: (
            <MeetingPlaceReviewBanner
              hideTopBorder
              pillCapsule
              slideTrackFullBleed
              quotedMeetingTitle={buildMeetingTopNoticeTitleLeft(m, categories)}
              ctaSuffix="후기 남기기"
              onPress={() => router.push(`/meeting-review/${encodeURIComponent(id)}`)}
            />
          ),
        });
      }
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
      if (settlementCollabNoticeIdSet.has(id)) {
        slides.push({
          key: `settlement-collab-${id}`,
          element: (
            <SettlementHostBanner
              hideTopBorder
              pillCapsule
              slideTrackFullBleed
              quotedMeetingTitle={buildMeetingTopNoticeTitleLeft(m, categories)}
              ctaSuffix="함께 정산하기"
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
      const uid = userId?.trim() ?? '';
      const unconfOk =
        Boolean(uid) && isMeetingHost(m, uid) && shouldShowUnconfirmedAutoCancelWarningNotice(m, now);
      const unconfTitleLeft = unconfOk ? buildUnconfirmedAutoCancelWarningNoticeTitleLeft(m, categories) : '';
      const unconfTimeRight = unconfOk ? buildUnconfirmedAutoCancelWarningNoticeTimeRight(m) : '';
      const unconfA11y = unconfOk
        ? buildUnconfirmedAutoCancelWarningNoticeAccessibilityLabel(m, categories)
        : '';
      if (unconfOk && unconfTitleLeft.trim() !== '' && unconfTimeRight.trim() !== '') {
        slides.push({
          key: `unconfirmed-auto-cancel-${id}`,
          element: (
            <GinitPressable
              onPress={() => router.push(`/meeting/${encodeURIComponent(id)}`)}
              accessibilityRole="link"
              accessibilityLabel={unconfA11y.trim() || '모임 상세'}
              style={({ pressed }) => [pressed && { opacity: 0.88 }]}>
              <MeetingDetailStaticNoticeRow
                titleLeft={unconfTitleLeft}
                timeRight={unconfTimeRight}
                accessibilityLabel={unconfA11y}
                textColor={GinitTheme.colors.danger}
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
    settlementCollabNoticeIdSet,
    placeReviewPendingIdSet,
    arrivalNoticeIdSet,
    router,
    homeArrivalNoticeUiTick,
    categories,
    userId,
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
      if (settlementCollabNoticeIdSet.has(id)) {
        rows.push({
          key: `settlement-collab-${id}`,
          kind: 'settlement_collab',
          meetingId: id,
          meetingTitle: titleLine,
        });
      }
      if (placeReviewPendingIdSet.has(id)) {
        rows.push({
          key: `meeting-review-${id}`,
          kind: 'meeting_review',
          meetingId: id,
          meetingTitle: titleLine,
        });
      }
      if (arrivalNoticeIdSet.has(id)) {
        rows.push({ key: `arrival-${id}`, kind: 'arrival', meetingId: id, meetingTitle: titleLine });
      }
      const scheduleOk = shouldShowConfirmedScheduleNoticeBar(m, now, {
        showArrivalVerifyBanner: arrivalNoticeIdSet.has(id),
        showSettlementHostBanner: settlementNoticeIdSet.has(id) || settlementCollabNoticeIdSet.has(id),
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
      const uid = userId?.trim() ?? '';
      const unconfOk =
        Boolean(uid) && isMeetingHost(m, uid) && shouldShowUnconfirmedAutoCancelWarningNotice(m, now);
      const unconfTitleLeft = unconfOk ? buildUnconfirmedAutoCancelWarningNoticeTitleLeft(m, categories) : '';
      const unconfTimeRight = unconfOk ? buildUnconfirmedAutoCancelWarningNoticeTimeRight(m) : '';
      if (unconfOk && unconfTitleLeft.trim() !== '' && unconfTimeRight.trim() !== '') {
        rows.push({
          key: `unconfirmed-auto-cancel-${id}`,
          kind: 'unconfirmed_auto_cancel',
          meetingId: id,
          titleLeft: unconfTitleLeft,
          timeRight: unconfTimeRight,
        });
      }
    }
    return rows;
  }, [
    homeNoticeOrderedMeetings,
    settlementNoticeIdSet,
    settlementCollabNoticeIdSet,
    placeReviewPendingIdSet,
    arrivalNoticeIdSet,
    homeArrivalNoticeUiTick,
    categories,
    userId,
  ]);

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
        if (row.kind === 'settlement' || row.kind === 'settlement_collab') {
          router.push(`/settlement/${encodeURIComponent(mid)}`);
          return;
        }
        if (row.kind === 'meeting_review') {
          router.push(`/meeting-review/${encodeURIComponent(mid)}`);
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

  const selectedFilterLabel = useMemo(() => {
    if (selectedCategoryId == null) return null;
    return categories.find((c) => c.id === selectedCategoryId)?.label ?? null;
  }, [categories, selectedCategoryId]);

  const sortComboLabel = useMemo(() => listSortModeLabel(listSortMode), [listSortMode]);

  const openCategoryPicker = useCallback(() => setFeedListSettingsModalOpen(true), []);

  const closeFeedListSettingsModal = useCallback(() => setFeedListSettingsModalOpen(false), []);

  const openSortDropdown = useCallback(() => setSortDropdownOpen(true), []);
  const closeSortDropdown = useCallback(() => setSortDropdownOpen(false), []);

  const applyListSortMode = useCallback(
    (mode: MeetingListSortMode) => {
      void (async () => {
        if (mode === 'distance') {
          closeSortDropdown();
          setDistanceSortLocating(true);
          try {
            const ctx = await resolveFeedLocationForDistanceSort();
            if (!ctx.permissionGranted) return;
            setFeedCoords(ctx.coords);
            setListSortMode(mode);
          } finally {
            setDistanceSortLocating(false);
          }
          return;
        }
        setListSortMode(mode);
        closeSortDropdown();
      })();
    },
    [closeSortDropdown],
  );

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

  const {
    loaded: meetingNotifyLoaded,
    effectiveOn: meetingNotifyEffectiveOn,
    refresh: refreshMeetingNotify,
  } = useMeetingCreateNotifyEffective(profilePk);

  useFocusEffect(
    useCallback(() => {
      void refreshMeetingNotify();
    }, [refreshMeetingNotify]),
  );

  const openMeetingNotifySettings = useCallback(() => {
    closeFeedListSettingsModal();
    router.push('/profile/meeting-notify-settings');
  }, [closeFeedListSettingsModal, router]);

  const onSaveFeedListSettings = useCallback(
    async (result: {
      barVisibleCategoryIds: string[] | null;
      recruitingOnly: boolean;
      exploreTodayOnly: boolean;
      selectedCategoryId: string | null;
    }) => {
      setFeedBarVisibleCategoryIds(result.barVisibleCategoryIds);
      await persistFeedCategoryBarVisibleIds(result.barVisibleCategoryIds);
      setSelectedCategoryId(result.selectedCategoryId);
      setRecruitingOnly(result.recruitingOnly);
      setExploreTodayOnly(result.exploreTodayOnly);
      await persistFeedExploreTodayOnly(result.exploreTodayOnly);
      setFeedListSettingsModalOpen(false);
    },
    [],
  );

  /** 슬라이더 버튼 점 — 모집중·표시 카테고리·단일 종류 필터 또는 공개 모임 생성 알림이 켜진 경우 */
  const feedCategorySlidersDotActive = useMemo(
    () =>
      computeFeedMeetingListSettingsDotActive({
        recruitingOnly,
        exploreTodayOnly,
        meetingNotifyLoaded,
        meetingNotifyEffectiveOn,
        selectedCategoryId,
        categoriesLength: categories.length,
        barVisibleCategoryIds: feedBarVisibleCategoryIds,
      }),
    [
      categories.length,
      feedBarVisibleCategoryIds,
      selectedCategoryId,
      recruitingOnly,
      exploreTodayOnly,
      meetingNotifyLoaded,
      meetingNotifyEffectiveOn,
    ],
  );

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
      if (exploreActiveRegionNorm.trim()) {
        await feedMeetingReviews.runDeltaSync('pull_refresh');
      }
    } finally {
      setRefreshing(false);
    }
  }, [feedLocationReady, queryClient, userId, exploreActiveRegionNorm, feedMeetingReviews]);

  useEffect(() => {
    if (!feedLocationReady) return;
    if (registeredRegions.length > 0) return;
    openRegionModal();
  }, [feedLocationReady, registeredRegions.length, openRegionModal]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(FEED_INTEREST_REGION_SELECTION_CHANGED, () => {
      void refreshFromStorage();
    });
    return () => sub.remove();
  }, [refreshFromStorage]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(GINIT_MEETING_PLACE_REVIEW_SUBMITTED_EVENT, () => {
      if (!exploreActiveRegionNorm.trim()) return;
      void feedMeetingReviews.syncChangedReviews();
    });
    return () => sub.remove();
  }, [exploreActiveRegionNorm, feedMeetingReviews]);

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
        presentAppDialogAlert({ title: '로그인이 필요해요', body: '모임 상세는 로그인 후 볼 수 있어요.' });
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
            presentAppDialogConfirm({ title: '프로필을 완성해 주세요', body: detailMsg, cancelLabel: '닫기', confirmLabel: '정보 등록하기', onConfirm: () => pushProfileOpenRegisterInfo(router) });
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

  const onPressFeedReview = useCallback(
    (meetingId: string) => {
      router.push(`/meeting-review/${encodeURIComponent(meetingId)}`);
    },
    [router],
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
          thumbnailGrayscale={tab === 'private'}
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

  const renderExploreFeedRow = useCallback(
    (row: HomeFeedRow) => {
      if (row.type === 'REVIEW_SECTION') {
        return <FeedMeetingReviewSection reviews={row.reviews} onPressReview={onPressFeedReview} />;
      }
      return renderHomeItemForList(row.meeting, 'explore');
    },
    [onPressFeedReview, renderHomeItemForList],
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
        <InterestRegionHeaderCluster controls={interestRegion} variant="feed" />
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
                  ? exploreFeedRows
                  : tab === 'my'
                    ? sortedJoinedMeetings
                    : sortedEndedMeetings;
              return (
                <View key={tab} style={[styles.tabPage, { width: tabPagerWidth }]}>
                  {tab === 'explore' ? (
                    <FlashList<HomeFeedRow>
                      data={tabData as HomeFeedRow[]}
                      keyExtractor={homeFeedRowKey}
                      getItemType={(row) => row.type}
                      extraData={{
                        homeTab,
                        tab,
                        listSortMode,
                        recruitingOnly,
                        selectedCategoryId,
                        feedBarVisibleCategoryIds,
                        appliedFeedSearch,
                        exploreLen: exploreFeedMeetings.length,
                        feedReviewsLen: feedMeetingReviews.reviews.length,
                        endedLen: sortedEndedMeetings.length,
                        feedLocationReady,
                        registeredRegionsLen: registeredRegions.length,
                        exploreActiveRegionNorm,
                      }}
                      renderItem={({ item }) => renderExploreFeedRow(item)}
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
                  ) : (
                    <FlashList<Meeting>
                      data={tabData as Meeting[]}
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
                  )}
                </View>
              );
              })}
            </ScrollView>
            {!feedLocationReady ? (
              <View style={styles.locationBootstrapOverlay} accessibilityLabel="불러오는 중">
                <ActivityIndicator size="large" color={GinitTheme.colors.primary} />
                <Text style={styles.locationBootstrapLabel}>불러오는 중…</Text>
              </View>
            ) : distanceSortLocating ? (
              <View style={styles.feedDistanceSortOverlay} accessibilityLabel="내 위치 확인 중">
                <ActivityIndicator size="large" color={GinitTheme.colors.primary} />
                <Text style={styles.feedDistanceSortOverlayLabel}>내 위치를 확인중입니다</Text>
              </View>
            ) : null}
          </View>
        </View>

        <FeedMeetingListSettingsModal
          visible={feedListSettingsModalOpen}
          onRequestClose={closeFeedListSettingsModal}
          categories={categories}
          barVisibleCategoryIds={feedBarVisibleCategoryIds}
          recruitingOnly={recruitingOnly}
          exploreTodayOnly={exploreTodayOnly}
          selectedCategoryId={selectedCategoryId}
          onSave={onSaveFeedListSettings}
          windowHeight={windowHeight}
          profilePk={profilePk}
          isSignedIn={isSignedIn}
          onOpenMeetingNotifySettings={openMeetingNotifySettings}
        />

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
                            item.kind === 'unconfirmed_auto_cancel'
                              ? GinitTheme.colors.danger
                              : item.kind === 'schedule'
                                ? GinitTheme.colors.deepPurple
                                : GinitTheme.themeMainColor
                          }
                        />
                      </View>
                      <View style={styles.homeNoticesModalTextCol}>
                        <Text
                          style={[
                            styles.homeNoticesModalRowTitle,
                            item.kind === 'unconfirmed_auto_cancel' && styles.homeNoticesModalRowTitleDanger,
                          ]}
                          numberOfLines={1}>
                          {item.kind === 'schedule' || item.kind === 'unconfirmed_auto_cancel'
                            ? item.titleLeft
                            : item.meetingTitle}
                        </Text>
                        <Text
                          style={[
                            styles.homeNoticesModalRowSub,
                            (item.kind === 'settlement' ||
                              item.kind === 'settlement_collab' ||
                              item.kind === 'meeting_review' ||
                              item.kind === 'arrival') &&
                              styles.homeNoticesModalRowSubCta,
                            item.kind === 'unconfirmed_auto_cancel' && styles.homeNoticesModalRowSubDanger,
                          ]}
                          {...(item.kind === 'schedule' || item.kind === 'unconfirmed_auto_cancel'
                            ? {}
                            : { numberOfLines: 3 as const })}>
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

        <InterestRegionModals controls={interestRegion} safeAreaTop={safeInsets.top} />

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
                    onPress={() => applyListSortMode(mode)}
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
  feedDistanceSortOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(248, 250, 252, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 24,
    zIndex: 20,
  },
  feedDistanceSortOverlayLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#475569',
    textAlign: 'center',
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
  homeNoticesModalRowTitleDanger: {
    color: GinitTheme.colors.danger,
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
  homeNoticesModalRowSubDanger: {
    color: GinitTheme.colors.danger,
    fontWeight: '600',
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
