import Feather from '@expo/vector-icons/Feather';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {
  NaverMapMarkerOverlay,
  NaverMapView,
  type ClusterMarkerProp,
  type NaverMapViewRef,
  type Region as NaverRegion,
} from '@mj-studio/react-native-naver-map';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as Linking from 'expo-linking';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  UIManager,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import MapView from 'react-native-map-clustering';
import { Marker, type Region } from 'react-native-maps';
import Animated, {
  Easing,
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FeedSearchFilterModal } from '@/components/feed/FeedSearchFilterModal';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { GinitTheme } from '@/constants/ginit-theme';
import { useAppPolicies } from '@/src/context/AppPoliciesContext';
import { useUserSession } from '@/src/context/UserSessionContext';
import { useFirestoreMeetingPatchesByIds } from '@/src/hooks/useFirestoreMeetingPatchesByIds';
import { useUnmountCleanup } from '@/src/hooks/useUnmountCleanup';
import { getPolicyNumeric } from '@/src/lib/app-policies-store';
import type { Category } from '@/src/lib/categories';
import { subscribeCategories } from '@/src/lib/categories';
import {
  FEED_LOCATION_FALLBACK_SHORT,
  normalizeFeedRegionLabel,
  resolveFeedLocationContextWithoutPermissionPrompt,
  resolveFeedLocationWithGrantedPermission,
} from '@/src/lib/feed-display-location';
import { saveFeedLocationCache } from '@/src/lib/feed-location-cache';
import {
  buildMapCategoryChips,
  defaultFeedSearchFilters,
  feedSearchFiltersActive,
  listSortModeLabel,
  meetingMatchesCategoryFilter,
  meetingMatchesFeedSearch,
  sortMeetingsForFeed,
  type FeedSearchFilters,
  type MeetingListSortMode,
} from '@/src/lib/feed-meeting-utils';
import {
  approximateCenterLatLngForFeedRegion,
  approximateCenterLatLngForFeedRegionSync,
} from '@/src/lib/feed-region-map-center';
import { loadRegisteredFeedRegions, peekFeedRegionMapSelectionForMapBoot } from '@/src/lib/feed-registered-regions';
import { categoryEmojiForMeeting } from '@/src/lib/friend-presence-activity';
import { formatDistanceForList, haversineDistanceMeters, meetingDistanceMetersFromUser, type LatLng } from '@/src/lib/geo-distance';
import { meetingListSource } from '@/src/lib/hybrid-data-source';
import { loadMapCategoryBarVisibleIds, persistMapCategoryBarVisibleIds } from '@/src/lib/map-category-bar-preference';
import { getMeetingMapPinAccentColor } from '@/src/lib/map-meeting-marker-appearance';
import {
  MAP_AVATAR_CLUSTERING_MAX_DELTA,
  groupMeetingsByCoordinateOverlap,
  meetingCoordinateKey,
} from '@/src/lib/map-people-markers';
import { resolveMeetingListThumbnailUri } from '@/src/lib/meeting-list-thumbnail';
import { setPendingMeetingPlace } from '@/src/lib/meeting-place-bridge';
import type { Meeting, MeetingRecruitmentPhase } from '@/src/lib/meetings';
import {
  MEETING_CAPACITY_UNLIMITED,
  formatPublicMeetingAgeSummary,
  formatPublicMeetingApprovalSummary,
  formatPublicMeetingGenderSummary,
  formatPublicMeetingSettlementSummary,
  getMeetingRecruitmentPhase,
  isMeetingScheduledTodaySeoul,
  meetingCategoryDisplayLabel,
  meetingParticipantCount,
  parsePublicMeetingDetailsConfig,
} from '@/src/lib/meetings';
import { subscribeMeetingsHybrid } from '@/src/lib/meetings-hybrid';
import { centerRegionToNaverRegion } from '@/src/lib/naver-map-region';
import { applyNearbySearchBiasFromMapNavigation } from '@/src/lib/nearby-search-bias';
import { pushProfileOpenRegisterInfo } from '@/src/lib/profile-register-info';
import { fetchMeetingsWithinRadiusFromSupabase } from '@/src/lib/supabase-meetings-geo-search';
import { getUserProfile, getUserProfilesForIds, isMeetingServiceComplianceComplete } from '@/src/lib/user-profile';

const { height: WINDOW_H } = Dimensions.get('window');

// RN New Architecture(Fabric)에서는 setLayoutAnimationEnabledExperimental이 no-op이며
// "currently a no-op in the New Architecture" 워닝을 발생시킵니다. (기능엔 영향 없음)
// 구 아키텍처에서만 호출해 워닝을 제거합니다.
const isFabric = typeof (global as any)?.nativeFabricUIManager !== 'undefined';
if (Platform.OS === 'android' && !isFabric && UIManager.setLayoutAnimationEnabledExperimental) {
  try {
    UIManager.setLayoutAnimationEnabledExperimental(true);
  } catch {
    /* ignore */
  }
}

// `react-native-map-clustering` 버전에 따라 Marker 확장 props(예: cluster)가 타입에 없을 수 있어
// 내 위치 마커에만 any 캐스팅을 사용합니다.
const AnyMarker = Marker as any;

const SPRING = { damping: 22, stiffness: 260, mass: 0.85 };
const SHEET_REVEAL_TIMING_MS = 340;
const SHEET_SNAP_THRESHOLD = 0.52;
const SHEET_VELOCITY_OPEN = -520;
const SHEET_VELOCITY_CLOSE = 520;
const MY_LOCATION_CENTER_EXTRA_BOTTOM_PX = 84;
/** 내 위치 버튼 탭 시 지도 가시 줌 — 중심 기준 반경 2km */
const MY_LOCATION_BUTTON_VIEW_RADIUS_KM = 1;

function formatSchedulePretty(m: Pick<Meeting, 'scheduleDate' | 'scheduleTime'>): string | null {
  const d = (m.scheduleDate ?? '').trim();
  const t = (m.scheduleTime ?? '').trim();
  if (!d && !t) return null;

  const dm = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const tm = t.match(/^(\d{1,2}):(\d{2})$/);
  const hh = tm ? Math.max(0, Math.min(23, Number(tm[1]))) : null;
  const mm = tm ? Math.max(0, Math.min(59, Number(tm[2]))) : null;
  const timeDisp = hh != null && mm != null ? `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}` : '';

  if (!dm) {
    const parts = [d, timeDisp].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : null;
  }

  const y = Number(dm[1]);
  const mo = Number(dm[2]);
  const da = Number(dm[3]);
  if (![y, mo, da].every(Number.isFinite)) {
    const parts = [d, timeDisp].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : null;
  }

  // “서울 기준” 요일 표시를 위해 +09:00로 고정해 date 객체 생성
  const iso = `${dm[1]}-${dm[2]}-${dm[3]}T${timeDisp || '00:00'}:00+09:00`;
  const date = new Date(iso);
  const weekday = Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('ko-KR', { weekday: 'short', timeZone: 'Asia/Seoul' }).format(date)
    : '';

  const md = `${mo}/${da}${weekday ? `(${weekday})` : ''}`;
  return [md, timeDisp].filter(Boolean).join(' · ');
}

const LIST_CARD_HEIGHT = 118;
const LIST_CARD_GAP = 10;
const LIST_ITEM_STRIDE = LIST_CARD_HEIGHT + LIST_CARD_GAP;

/** `styles.sheet`의 paddingTop과 동일하게 유지 */
const SHEET_OUTER_PADDING_TOP_PX = 8;
/** 핸들 히트 영역 + 핸들바(측정에 포함되지 않는 상단 고정 구간) */
const SHEET_HANDLE_STACK_MIN_PX = 48;
/** `styles.sheetCta` + 한 줄 라벨(모임 상세 보기) 세로 합 — sheetPeekHeight·캐러셀 상한에서 동일 값 사용 */
const SHEET_CTA_BLOCK_HEIGHT_PX = 8 + 14 + 14 + 20;

// 초기 화면에서 보이는 북남 방향 지도 높이(미터). 중심 기준 반경 ≈ 1km → 전체 약 2km.
// 검색·RPC 반경(mapRadiusKm)과는 별도입니다.
const INITIAL_VIEW_NS_SPAN_METERS = 2000;

/** Android(Naver): 이 줌 이하에서는 SDK 숫자 클러스터, 그 이상에서는 개별 마커(핀+caption) */
const NAVER_CLUSTER_MAX_ZOOM = 15;

// 위치 권한 미허용·관심 지역 미설정 시 기본 진입 중심(영등포구)
const DEFAULT_NO_LOCATION_CENTER: LatLng = { latitude: 37.5263, longitude: 126.8962 };

/** `getPolicyNumeric('meeting','map_radius_km',3)` 기본과 동일 — 초기 state는 정책 훅보다 먼저 잡기 위함 */
const MAP_BOOT_POLICY_RADIUS_KM = 3;

function mapBootAnchorAndRegionFromInterestMemory(radiusKm: number): {
  anchor: LatLng;
  region: Region;
  exploreActiveNorm: string;
} {
  const { regions, activeNorm } = peekFeedRegionMapSelectionForMapBoot();
  if (regions.length === 0) {
    const r = regionCenteredOnUserRadius(
      DEFAULT_NO_LOCATION_CENTER.latitude,
      DEFAULT_NO_LOCATION_CENTER.longitude,
      radiusKm,
    );
    return { anchor: DEFAULT_NO_LOCATION_CENTER, region: r, exploreActiveNorm: '' };
  }
  const setN = new Set(regions.map((x) => normalizeFeedRegionLabel(x)));
  const exploreActiveNorm =
    activeNorm && setN.has(activeNorm) ? activeNorm : normalizeFeedRegionLabel(regions[0]!);
  const center = approximateCenterLatLngForFeedRegionSync(exploreActiveNorm);
  const r = regionCenteredOnUserRadius(center.latitude, center.longitude, radiusKm);
  return { anchor: center, region: r, exploreActiveNorm };
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

function meetingProgressPillStyles(phase: MeetingRecruitmentPhase) {
  switch (phase) {
    case 'confirmed':
      return {
        label: '확정',
        wrap: [styles.progressBadge, styles.progressBadgeBlack],
        text: [styles.progressBadgeText, styles.progressBadgeTextLight],
      };
    case 'full':
      return {
        label: '모집 완료',
        wrap: [styles.progressBadge, styles.progressBadgeYellow],
        text: [styles.progressBadgeText, styles.progressBadgeTextOnYellow],
      };
    default:
      return {
        label: '모집중',
        wrap: [styles.progressBadge, styles.progressBadgeGreen],
        text: [styles.progressBadgeText, styles.progressBadgeTextLight],
      };
  }
}

/** 동일 장소 스택에서 `createdAt`이 가장 이른 모임을 대표로 쓰기 위한 정렬 키 */
function meetingCreatedAtMillis(m: Meeting): number {
  const ts = m.createdAt;
  if (ts && typeof (ts as { toMillis?: () => number }).toMillis === 'function') {
    try {
      const ms = (ts as { toMillis: () => number }).toMillis();
      if (Number.isFinite(ms)) return ms;
    } catch {
      /* ignore */
    }
  }
  return Number.MAX_SAFE_INTEGER;
}

type MapMarkerRenderItem =
  | { kind: 'single'; meeting: Meeting; key: string }
  | { kind: 'stack'; meetings: Meeting[]; count: number; key: string; lead: Meeting };

function regionCenteredOnUserRadius(lat: number, lng: number, radiusKm: number): Region {
  const radiusM = radiusKm * 1000;
  const metersPerDegLat = 111320;
  const dLat = Math.min(0.42, (radiusM * 2.25) / metersPerDegLat);
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const dLng = Math.min(0.48, dLat / Math.max(0.22, Math.abs(cosLat)));
  return { latitude: lat, longitude: lng, latitudeDelta: dLat, longitudeDelta: dLng };
}

/** 북남 방향 `spanMeters`(지도에 보이는 높이) 기준으로 위경도 델타를 맞춥니다. */
function regionCenteredOnNorthSouthSpanMeters(lat: number, lng: number, spanMeters: number): Region {
  const metersPerDegLat = 111320;
  const dLat = Math.min(0.42, spanMeters / metersPerDegLat);
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const dLng = Math.min(0.48, dLat / Math.max(0.22, Math.abs(cosLat)));
  return { latitude: lat, longitude: lng, latitudeDelta: dLat, longitudeDelta: dLng };
}

function centerLatForBetweenTopAndBottom(
  targetLat: number,
  baseDeltaLat: number,
  topInsetPx: number,
  bottomSheetPx: number,
  windowH: number,
) {
  const bottomFrac = Math.max(0, Math.min(0.9, bottomSheetPx / Math.max(1, windowH)));
  // 상단 카테고리 메뉴(글래스 바)는 기기/폰트에 따라 높이 체감이 커서,
  // 내 위치 이동 시 마커가 위쪽으로 붙어 보이지 않도록 추정치를 조금 넉넉하게 잡습니다.
  const topOverlayPx = Math.max(0, topInsetPx) ; // 카테고리 글래스 바 영역(대략)
  const topFrac = Math.max(0, Math.min(0.4, topOverlayPx / Math.max(1, windowH)));
  const desiredY = (topFrac + (1 - bottomFrac)) / 2;
  const yShiftFrac = 0.5 - desiredY;
  return targetLat - baseDeltaLat * yShiftFrac;
}

function regionToBounds(r: Region) {
  const latMin = r.latitude - r.latitudeDelta / 2;
  const latMax = r.latitude + r.latitudeDelta / 2;
  const lngMin = r.longitude - r.longitudeDelta / 2;
  const lngMax = r.longitude + r.longitudeDelta / 2;
  return { latMin, latMax, lngMin, lngMax };
}

function meetingInBounds(m: Meeting, r: Region): boolean {
  const lat = m.latitude;
  const lng = m.longitude;
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  const b = regionToBounds(r);
  return lat >= b.latMin && lat <= b.latMax && lng >= b.lngMin && lng <= b.lngMax;
}

/** 지도 가시 박스를 원형 RPC에 넣기 위한 반경(km): 중심~코너, 상한 `maxKm` */
function regionCoverageRadiusKm(r: Region, maxKm: number): number {
  const center: LatLng = { latitude: r.latitude, longitude: r.longitude };
  const ne: LatLng = {
    latitude: r.latitude + r.latitudeDelta / 2,
    longitude: r.longitude + r.longitudeDelta / 2,
  };
  const m = haversineDistanceMeters(center, ne);
  const km = m / 1000;
  return Math.max(0.5, Math.min(maxKm, km));
}

function useDebouncedRegion(onDebounced: (r: Region) => void, ms: number) {
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cb = useRef(onDebounced);
  cb.current = onDebounced;
  return useCallback(
    (r: Region) => {
      if (t.current) clearTimeout(t.current);
      t.current = setTimeout(() => {
        t.current = null;
        cb.current(r);
      }, ms);
    },
    [ms],
  );
}

function naverRegionToCenter(r: NaverRegion): Region {
  return {
    latitude: r.latitude + r.latitudeDelta / 2,
    longitude: r.longitude + r.longitudeDelta / 2,
    latitudeDelta: r.latitudeDelta,
    longitudeDelta: r.longitudeDelta,
  };
}

export default function MapScreen() {
  const router = useRouter();
  const { userId } = useUserSession();
  const insets = useSafeAreaInsets();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const { addCleanup } = useUnmountCleanup();
  const mapBootInit = useMemo(() => mapBootAnchorAndRegionFromInterestMemory(MAP_BOOT_POLICY_RADIUS_KM), []);
  // `react-native-map-clustering`의 ref 타입은 내부적으로 콜백 ref를 쓰므로 any로 둡니다.
  const mapRef = useRef<any>(null);
  const naverMapRef = useRef<NaverMapViewRef>(null);
  const meetingListRef = useRef<FlatList<Meeting>>(null);
  const carouselRef = useRef<FlatList<Meeting>>(null);
  const listScrollY = useRef(0);
  const listContentH = useRef(0);
  const listLayoutH = useRef(0);
  const listScrollRaf = useRef<number | null>(null);
  const scrollAfterInteractionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollAfterInteractionCancelRef = useRef<(() => void) | null>(null);
  const lastCompleteRegionRef = useRef<Region | null>(mapBootInit.region);
  const lastQueriedRegionRef = useRef<Region | null>(mapBootInit.region);
  const suppressRescanUntilMsRef = useRef(0);
  /** `mapGeoQueryRegion` state와 동기 — `onRegionChangeComplete`에서 최신 조회 박스 참조 */
  const mapGeoQueryRegionRef = useRef<Region | null>(null);
  /** 내 위치: 카메라는 좁게·RPC·병합은 `mapRadiusKm`일 때, idle에서 `pending`이 좁은 카메라로 덮이며 재검색이 뜨는 것 방지 */
  const mapSnapCameraTighterThanQueryRef = useRef(false);

  const sheetExpandedPx = useMemo(() => Math.min(Math.round(windowHeight * 0.62), 560), [windowHeight]);
  const sheetCollapsedPx = useMemo(() => {
    const peek = Math.round(200 + Math.max(insets.bottom, 10));
    const maxPeek = sheetExpandedPx - 80;
    return Math.max(168, Math.min(peek, maxPeek));
  }, [insets.bottom, sheetExpandedPx]);

  const sheetHeight = useSharedValue(sheetCollapsedPx);
  const dragStartHeight = useSharedValue(sheetCollapsedPx);

  const [isSheetExpanded, setIsSheetExpanded] = useState(false);

  const animatedSheetStyle = useAnimatedStyle(() => ({
    height: sheetHeight.value,
  }));

  const [selectedMeetingIndex, setSelectedMeetingIndex] = useState(0);
  // 바텀시트는 기본으로 요약 영역이 펼쳐진 상태(핸들만이 아닌 전체 피크)로 시작합니다.
  const sheetShown = useSharedValue(1);
  const sheetBoot = useSharedValue(1);
  const carouselDragStartIndexRef = useRef(0);
  const followSelectedRef = useRef(true);
  const lastMarkerTapAtRef = useRef(0);

  const enableFollowSelected = useCallback(() => {
    followSelectedRef.current = true;
  }, []);

  const [mapMovedSinceSearch, setMapMovedSinceSearch] = useState(false);
  const [pendingRegion, setPendingRegion] = useState<Region | null>(() => mapBootInit.region);
  const [queriedRegion, setQueriedRegion] = useState<Region | null>(() => mapBootInit.region);

  const openSheet = useCallback(() => {
    sheetShown.value = withTiming(1, {
      duration: SHEET_REVEAL_TIMING_MS,
      easing: Easing.out(Easing.cubic),
      reduceMotion: ReduceMotion.Never,
    });
  }, [sheetShown]);

  const closeSheet = useCallback(() => {
    sheetShown.value = withTiming(0, {
      duration: SHEET_REVEAL_TIMING_MS,
      easing: Easing.out(Easing.cubic),
      reduceMotion: ReduceMotion.Never,
    });
  }, [sheetShown]);

  const onUserMapGesture = useCallback(() => {
    // 마커 탭 직후 카메라 콜백/탭 버블링으로 시트가 바로 닫히는 것을 방지
    if (Date.now() - lastMarkerTapAtRef.current < 450) return;
    followSelectedRef.current = false;
    setMapMovedSinceSearch(true);
    closeSheet();
  }, [closeSheet]);

  const [sheetSummaryInnerHeight, setSheetSummaryInnerHeight] = useState(0);

  // 닫힌 상태에서는 "핸들바만" 보이게 (내용이 잘려 보이지 않도록)
  const sheetMiniPeekHeight = useMemo(() => 28, []);
  /** 펼쳐진 요약 시트 높이(핸들~CTA). 지도 센터 보정·시트 translate에 동일 값 사용 */
  const sheetPeekHeight = useMemo(() => {
    const sheetTopPadding = 8;
    const handleRow = 4 + 4 + 6 + 10;
    // 상세 정보(칩/주소/시간/참여자/거리)가 잘리지 않도록 카드 영역 높이를 충분히 확보합니다.
    const carousel = LIST_CARD_HEIGHT + 160;
    const dots = 18 + 6;
    // CTA(모임 상세 보기) 높이는 시트 피크에 이중 포함하지 않아, 시트가 그만큼 내려가 지도 가시 영역을 넓힙니다.
    // 기기별로 CTA 하단이 잘리는 경우를 막기 위해 피크 높이에만 소량 여유를 둡니다.
    const ctaBreathingPx = 14;
    return sheetTopPadding + handleRow + carousel + dots + ctaBreathingPx;
  }, []);

  const sheetRevealStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - sheetShown.value) * (sheetPeekHeight - sheetMiniPeekHeight) }],
    opacity: 1,
  }));

  const liftDelta = useMemo(() => sheetPeekHeight - sheetMiniPeekHeight, [sheetPeekHeight, sheetMiniPeekHeight]);
  const controlsLiftStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -sheetShown.value * liftDelta }],
  }));

  const sheetContentStyle = useAnimatedStyle(() => ({
    opacity: sheetShown.value,
    transform: [{ translateY: (1 - sheetShown.value) * 10 }],
  }));

  const dragStartShown = useSharedValue(0);
  const sheetHandlePanGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY([-6, 6])
        .failOffsetX([-28, 28])
        .onBegin(() => {
          dragStartShown.value = sheetShown.value;
          runOnJS(setMapMovedSinceSearch)(true);
        })
        .onUpdate((e) => {
          const next = dragStartShown.value + (-e.translationY / Math.max(1, liftDelta));
          sheetShown.value = Math.max(0, Math.min(1, next));
        })
        .onEnd((e) => {
          const vy = e.velocityY ?? 0;
          const open =
            vy <= SHEET_VELOCITY_OPEN ? true : vy >= SHEET_VELOCITY_CLOSE ? false : sheetShown.value >= SHEET_SNAP_THRESHOLD;
          if (open) runOnJS(enableFollowSelected)();
          sheetShown.value = withTiming(open ? 1 : 0, {
            duration: SHEET_REVEAL_TIMING_MS,
            easing: Easing.out(Easing.cubic),
            reduceMotion: ReduceMotion.Never,
          });
        }),
    [dragStartShown, liftDelta, sheetShown, enableFollowSelected, setMapMovedSinceSearch],
  );

  const setSheetExpandedJS = useCallback((expanded: boolean) => {
    setIsSheetExpanded(expanded);
  }, []);

  const sheetPanGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY([-10, 10])
        .failOffsetX([-28, 28])
        .onBegin(() => {
          dragStartHeight.value = sheetHeight.value;
          runOnJS(setMapMovedSinceSearch)(true);
        })
        .onUpdate((e) => {
          const next = dragStartHeight.value - e.translationY;
          sheetHeight.value = Math.min(sheetExpandedPx, Math.max(sheetCollapsedPx, next));
        })
        .onEnd(() => {
          const mid = (sheetExpandedPx + sheetCollapsedPx) / 2;
          const expand = sheetHeight.value >= mid;
          sheetHeight.value = withSpring(expand ? sheetExpandedPx : sheetCollapsedPx, SPRING, (finished) => {
            if (finished) runOnJS(setSheetExpandedJS)(expand);
          });
        }),
    [sheetCollapsedPx, sheetExpandedPx, dragStartHeight, sheetHeight, setSheetExpandedJS, setMapMovedSinceSearch],
  );

  const [regionLabel, setRegionLabel] = useState(FEED_LOCATION_FALLBACK_SHORT);
  const regionLabelRef = useRef(FEED_LOCATION_FALLBACK_SHORT);
  const userCoordsRef = useRef<LatLng | null>(null);
  const [sortFilterModalOpen, setSortFilterModalOpen] = useState(false);
  const [mapSearchOpen, setMapSearchOpen] = useState(false);
  const [mapSearchFilters, setMapSearchFilters] = useState<FeedSearchFilters>(defaultFeedSearchFilters());
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  /** `null`이면 상단 칩에 카테고리 마스터 전부 표시 */
  const [mapBarVisibleCategoryIds, setMapBarVisibleCategoryIds] = useState<string[] | null>(null);
  const [mapCategoryBarModalOpen, setMapCategoryBarModalOpen] = useState(false);
  const [categoryBarDraft, setCategoryBarDraft] = useState<string[]>([]);
  const [userCoords, setUserCoords] = useState<LatLng | null>(null);
  const [userHeadingDeg, setUserHeadingDeg] = useState<number | null>(null);
  const [genderByUserId, setGenderByUserId] = useState<Map<string, string>>(new Map());
  const [listSortMode, setListSortMode] = useState<MeetingListSortMode>('distance');
  const [recruitingOnly, setRecruitingOnly] = useState(true);
  /** 탐색 상단 카테고리 팝업에서 저장 시 적용 — 서울 달력 기준 오늘 일정 모임만 */
  const [mapTodayOnly, setMapTodayOnly] = useState(false);
  const [categoryBarTodayOnlyDraft, setCategoryBarTodayOnlyDraft] = useState(false);
  /** 상단 카테고리 설정 모달 — 카테고리 목록 스크롤 하단 «더 있음» */
  const categoryBarModalListLayHRef = useRef(0);
  const categoryBarModalListContHRef = useRef(0);
  const categoryBarModalListScrollYRef = useRef(0);
  const [categoryBarModalListShowMoreBelow, setCategoryBarModalListShowMoreBelow] = useState(false);
  const categoryBarModalCategoryListScrollRef = useRef<ScrollView | null>(null);
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);

  const [categories, setCategories] = useState<Category[]>([]);
  const [hybridMeetings, setHybridMeetings] = useState<Meeting[]>([]);
  const [rpcMeetings, setRpcMeetings] = useState<Meeting[]>([]);
  const [meetingsBooted, setMeetingsBooted] = useState(false);
  /** 반경 RPC(fetchMeetingsWithinRadiusFromSupabase) 진행 중 — 하이브리드 부트 후에도 시트 빈 카피 깜빡임 방지 */
  const [mapGeoMeetingsLoading, setMapGeoMeetingsLoading] = useState(false);
  const [searchAnchor, setSearchAnchor] = useState<LatLng | null>(() => mapBootInit.anchor);
  const [driftTooFar, setDriftTooFar] = useState(false);
  const [listingRegion, setListingRegion] = useState<Region | null>(() => mapBootInit.region);
  /** 마지막으로 조회한 지도 가시 영역(이 지역 재검색·초기 로드·내 위치) — RPC·목록·마커 기준 */
  const [mapGeoQueryRegion, setMapGeoQueryRegion] = useState<Region | null>(() => mapBootInit.region);
  useEffect(() => {
    mapGeoQueryRegionRef.current = mapGeoQueryRegion;
  }, [mapGeoQueryRegion]);
  const [zoomDeltaForClustering, setZoomDeltaForClustering] = useState(
    INITIAL_VIEW_NS_SPAN_METERS / 111320,
  );
  const [naverZoom, setNaverZoom] = useState<number>(16);
  /** 상단 카테고리 칩 가로 스크롤 — 오른쪽 «더 있음» 표시용 */
  const [chipScrollLayoutW, setChipScrollLayoutW] = useState(0);
  const [chipScrollContentW, setChipScrollContentW] = useState(0);
  const [chipScrollOffsetX, setChipScrollOffsetX] = useState(0);
  const isMapScreenFocused = useIsFocused();

  /**
   * 하이브리드 최초 부트 전, 또는 반경 RPC 진행 중까지 시트 스플래시 — 그 사이 빈 시트 카피가 먼저 깜빡이지 않게 함.
   * 관심지역 기반 초기 앵커는 동기로 잡히므로 권한·GPS 대기로 시트를 가리지 않습니다.
   */
  const showSheetSplash = !meetingsBooted || mapGeoMeetingsLoading;

  const { version: appPoliciesVersion } = useAppPolicies();
  const mapRadiusKm = useMemo(() => {
    const raw = getPolicyNumeric('meeting', 'map_radius_km', 3);
    return Math.max(0.5, Math.min(80, raw));
  }, [appPoliciesVersion]);

  /**
   * 지도 중심을 `u`로 맞춥니다. `viewRadiusKm`이 정책보다 작으면(내 위치 버튼) 카메라만 그 줌으로 두고,
   * RPC·하이브리드 병합(`mapGeoQueryRegion`)은 정책 `mapRadiusKm` 박스로 넓혀 화면 밖·원거리 모임까지 로드합니다.
   */
  const snapMapToUserCoords = useCallback(
    (u: LatLng, viewRadiusKm?: number) => {
      enableFollowSelected();
      openSheet();
      setListSortMode('distance');
      setSelectedMeetingIndex(0);

      const tightKm =
        typeof viewRadiusKm === 'number' && Number.isFinite(viewRadiusKm) ? viewRadiusKm : mapRadiusKm;
      const cameraTighterThanPolicy =
        typeof viewRadiusKm === 'number' && Number.isFinite(viewRadiusKm) && viewRadiusKm < mapRadiusKm;

      const base = regionCenteredOnUserRadius(u.latitude, u.longitude, tightKm);
      const rCamera: Region = {
        ...base,
        latitude: centerLatForBetweenTopAndBottom(
          u.latitude,
          base.latitudeDelta,
          insets.top ?? 0,
          sheetPeekHeight + MY_LOCATION_CENTER_EXTRA_BOTTOM_PX,
          windowHeight,
        ),
        longitude: u.longitude,
      };

      const rQuery: Region = (() => {
        if (!cameraTighterThanPolicy) return rCamera;
        const baseQ = regionCenteredOnUserRadius(
          rCamera.latitude,
          rCamera.longitude,
          mapRadiusKm,
        );
        return {
          latitude: rCamera.latitude,
          longitude: rCamera.longitude,
          latitudeDelta: baseQ.latitudeDelta,
          longitudeDelta: baseQ.longitudeDelta,
        };
      })();

      mapSnapCameraTighterThanQueryRef.current = cameraTighterThanPolicy;
      lastCompleteRegionRef.current = rCamera;
      setSearchAnchor(u);
      setListingRegion(rCamera);
      setMapGeoQueryRegion(rQuery);
      setQueriedRegion(rQuery);
      setPendingRegion(rQuery);
      lastQueriedRegionRef.current = rQuery;
      // "내 위치로 이동" 직후 카메라 idle/region 콜백이 연속으로 들어오며
      // `pendingRegion`이 미세하게 달라져 재검색 버튼이 다시 뜨는 현상을 방지합니다.
      suppressRescanUntilMsRef.current = Date.now() + 1400;
      setDriftTooFar(false);
      setMapMovedSinceSearch(false);
      try {
        if (Platform.OS === 'android') {
          naverMapRef.current?.animateRegionTo({
            ...centerRegionToNaverRegion(rCamera),
            duration: 520,
            easing: 'EaseIn',
          });
        } else {
          mapRef.current?.animateToRegion(rCamera, 450);
        }
      } catch {
        /* ignore */
      }
    },
    [
      enableFollowSelected,
      openSheet,
      mapRadiusKm,
      insets.top,
      sheetPeekHeight,
      windowHeight,
    ],
  );

  /** 지도 탭 진입·재진입: 시트·레이아웃만 동기화 (카메라·권한은 관심지역 동기 초기값 / «내 위치» 버튼에서만 처리) */
  useFocusEffect(
    useCallback(() => {
      setMapMovedSinceSearch(false);
      openSheet();
      sheetHeight.value = withSpring(sheetCollapsedPx, SPRING);
      setIsSheetExpanded(false);
      return () => {
        /* 스택(모임 상세 등)으로 가려질 때 네이티브 지도 freeze 이슈 완화: 포커스 해제 시 별도 처리 없음 */
      };
    }, [openSheet, sheetCollapsedPx, sheetHeight, setMapMovedSinceSearch]),
  );

  const driftThresholdM = mapRadiusKm * 1000;

  const debouncedDriftCheck = useDebouncedRegion(
    useCallback(
      (r: Region) => {
        const center: LatLng = { latitude: r.latitude, longitude: r.longitude };
        if (!searchAnchor) {
          setDriftTooFar(false);
          return;
        }
        setDriftTooFar(haversineDistanceMeters(center, searchAnchor) > driftThresholdM);
      },
      [searchAnchor, driftThresholdM],
    ),
    400,
  );

  const debouncedListingRegionSet = useDebouncedRegion(
    useCallback((r: Region) => {
      if (isSheetExpanded) setListingRegion(r);
    }, [isSheetExpanded]),
    280,
  );

  const debouncedZoomClustering = useDebouncedRegion(
    useCallback((r: Region) => {
      setZoomDeltaForClustering(r.latitudeDelta);
    }, []),
    140,
  );

  const clusteringEnabled = zoomDeltaForClustering > MAP_AVATAR_CLUSTERING_MAX_DELTA;

  // (겹침(spider) 확장 기능 제거됨)

  const onRegionChangeComplete = useCallback(
    (r: Region) => {
      lastCompleteRegionRef.current = r;
      const q = mapGeoQueryRegionRef.current;
      if (mapSnapCameraTighterThanQueryRef.current && q) {
        const centerMoveM = haversineDistanceMeters(
          { latitude: r.latitude, longitude: r.longitude },
          { latitude: q.latitude, longitude: q.longitude },
        );
        const rRadKm = regionCoverageRadiusKm(r, 80);
        const qRadKm = regionCoverageRadiusKm(q, 80);
        if (centerMoveM < 55 && rRadKm < qRadKm * 0.92) {
          debouncedDriftCheck(r);
          debouncedListingRegionSet(r);
          debouncedZoomClustering(r);
          return;
        }
        mapSnapCameraTighterThanQueryRef.current = false;
      }
      setPendingRegion(r);
      debouncedDriftCheck(r);
      debouncedListingRegionSet(r);
      debouncedZoomClustering(r);
    },
    [debouncedDriftCheck, debouncedListingRegionSet, debouncedZoomClustering],
  );

  useEffect(() => {
    if (!mapGeoQueryRegion) return;
    setQueriedRegion(mapGeoQueryRegion);
    lastQueriedRegionRef.current = mapGeoQueryRegion;
    setPendingRegion((prev) => prev ?? (lastCompleteRegionRef.current ?? mapGeoQueryRegion));
    setMapMovedSinceSearch(false);
  }, [mapGeoQueryRegion]);

  const hasPendingRescan = useMemo(() => {
    if (Date.now() < suppressRescanUntilMsRef.current) return false;
    const q = queriedRegion;
    const p = pendingRegion;
    if (!q || !p) return false;
    const centerMoveM = haversineDistanceMeters(
      { latitude: q.latitude, longitude: q.longitude },
      { latitude: p.latitude, longitude: p.longitude },
    );
    const zoomChanged = Math.abs((q.latitudeDelta ?? 0) - (p.latitudeDelta ?? 0)) > 0.0001;
    return centerMoveM > 8 || zoomChanged;
  }, [pendingRegion, queriedRegion]);

  useEffect(() => {
    // 초기/복귀 타이밍에 `mapGeoQueryRegion`이 아직 세팅되지 않으면 버튼 판단 기준(queriedRegion)이 null이라
    // 지도에서 움직여도 “이 지역 재검색”이 뜨지 않습니다.
    // 이 경우 현재 지도 region을 조회 기준으로 먼저 잡아두고, 이후 이동/줌 변경에서 즉시 버튼이 뜨게 합니다.
    if (queriedRegion) return;
    const base = pendingRegion ?? lastCompleteRegionRef.current;
    if (!base) return;
    setQueriedRegion(base);
    lastQueriedRegionRef.current = base;
  }, [pendingRegion, queriedRegion]);

  useEffect(() => {
    regionLabelRef.current = regionLabel;
  }, [regionLabel]);

  useEffect(() => {
    userCoordsRef.current = userCoords;
  }, [userCoords]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const regions = await loadRegisteredFeedRegions();
      if (cancelled) return;
      const { activeNorm: activeRaw } = peekFeedRegionMapSelectionForMapBoot();
      let exploreActiveNorm = '';
      if (regions.length > 0) {
        const setN = new Set(regions.map((r) => normalizeFeedRegionLabel(r)));
        exploreActiveNorm =
          activeRaw && setN.has(activeRaw) ? activeRaw : normalizeFeedRegionLabel(regions[0]!);
      }

      const ctx = await resolveFeedLocationContextWithoutPermissionPrompt();
      if (cancelled) return;

      const coordsForDistance = ctx.coords;

      setRegionLabel(
        exploreActiveNorm
          ? normalizeFeedRegionLabel(exploreActiveNorm)
          : normalizeFeedRegionLabel(ctx.labelShort),
      );

      setUserCoords(coordsForDistance);

      const labelToSave = exploreActiveNorm
        ? normalizeFeedRegionLabel(exploreActiveNorm)
        : normalizeFeedRegionLabel(ctx.labelShort);
      await saveFeedLocationCache(labelToSave, coordsForDistance, { manualRegion: false });

      const interestCenter = exploreActiveNorm
        ? await approximateCenterLatLngForFeedRegion(exploreActiveNorm)
        : DEFAULT_NO_LOCATION_CENTER;
      if (cancelled) return;
      const r0 = regionCenteredOnUserRadius(interestCenter.latitude, interestCenter.longitude, mapRadiusKm);
      const prev = lastCompleteRegionRef.current;
      const movedM =
        prev == null
          ? 99999
          : haversineDistanceMeters(
              { latitude: prev.latitude, longitude: prev.longitude },
              interestCenter,
            );
      const zoomChanged =
        prev == null ||
        Math.abs((prev.latitudeDelta ?? 0) - (r0.latitudeDelta ?? 0)) > 1e-7;
      if (movedM > 120 || zoomChanged) {
        lastCompleteRegionRef.current = r0;
        setSearchAnchor(interestCenter);
        setListingRegion(r0);
        setMapGeoQueryRegion(r0);
        setPendingRegion(r0);
        lastQueriedRegionRef.current = r0;
        setMapMovedSinceSearch(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mapRadiusKm]);

  useEffect(() => {
    let posSub: Location.LocationSubscription | null = null;
    let headSub: Location.LocationSubscription | null = null;
    let cancelled = false;
    (async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync().catch(() => null);
        if (cancelled || perm?.status !== 'granted') return;
        posSub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: 1200,
            distanceInterval: 6,
          },
          (p) => {
            const c = p.coords;
            if (!c) return;
            const next: LatLng = { latitude: c.latitude, longitude: c.longitude };
            setUserCoords(next);
          },
        );
        headSub = await Location.watchHeadingAsync((h) => {
          const deg = h.trueHeading ?? h.magHeading;
          if (typeof deg === 'number' && Number.isFinite(deg)) setUserHeadingDeg(deg);
        });
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
      try {
        posSub?.remove();
      } catch {
        /* ignore */
      }
      try {
        headSub?.remove();
      } catch {
        /* ignore */
      }
    };
  }, []);

  useEffect(() => {
    const unsub = subscribeCategories((list) => setCategories(list), () => {});
    return unsub;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadMapCategoryBarVisibleIds().then((v) => {
      if (!cancelled) setMapBarVisibleCategoryIds(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const unsub = subscribeMeetingsHybrid(
      (list) => {
        setHybridMeetings(list);
        setMeetingsBooted(true);
      },
      () => {},
    );
    return unsub;
  }, []);

  useEffect(() => {
    if (selectedCategoryId == null) return;
    if (categories.length > 0 && !categories.some((c) => c.id === selectedCategoryId)) {
      setSelectedCategoryId(null);
    }
  }, [categories, selectedCategoryId]);

  useEffect(() => {
    if (!searchAnchor && !mapGeoQueryRegion) {
      setMapGeoMeetingsLoading(false);
      return;
    }
    let alive = true;
    setMapGeoMeetingsLoading(true);
    void (async () => {
      try {
        const anchor =
          mapGeoQueryRegion != null
            ? { latitude: mapGeoQueryRegion.latitude, longitude: mapGeoQueryRegion.longitude }
            : searchAnchor!;
        const radiusKm = mapGeoQueryRegion ? regionCoverageRadiusKm(mapGeoQueryRegion, 80) : mapRadiusKm;
        const res = await fetchMeetingsWithinRadiusFromSupabase(
          anchor.latitude,
          anchor.longitude,
          radiusKm,
          selectedCategoryId,
        );
        if (!alive) return;
        if (res.ok) {
          setRpcMeetings(res.meetings);
          setDriftTooFar(false);
        } else {
          setRpcMeetings([]);
        }
      } finally {
        if (alive) setMapGeoMeetingsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [searchAnchor, mapGeoQueryRegion, mapRadiusKm, selectedCategoryId]);

  useEffect(() => {
    setDriftTooFar(false);
  }, [searchAnchor]);

  useEffect(() => {
    if (!isSheetExpanded) return;
    const r = lastCompleteRegionRef.current;
    if (r) setListingRegion(r);
  }, [isSheetExpanded]);

  const hybridInMapQueryArea = useMemo(() => {
    if (!mapGeoQueryRegion) return [];
    return hybridMeetings.filter((m) => meetingInBounds(m, mapGeoQueryRegion));
  }, [hybridMeetings, mapGeoQueryRegion]);

  const mergedMeetingsBase = useMemo(() => {
    const mapById = new Map<string, Meeting>();
    const inQuery = (m: Meeting) => {
      return !mapGeoQueryRegion || meetingInBounds(m, mapGeoQueryRegion);
    };
    for (const m of rpcMeetings) {
      if (inQuery(m)) mapById.set(m.id, m);
    }
    for (const m of hybridInMapQueryArea) mapById.set(m.id, m);
    return [...mapById.values()];
  }, [rpcMeetings, hybridInMapQueryArea, mapGeoQueryRegion]);

  const firestorePatches = useFirestoreMeetingPatchesByIds(
    mergedMeetingsBase.map((m) => m.id),
    meetingListSource() === 'supabase',
  );

  const mergedMeetings = useMemo(() => {
    if (firestorePatches.size === 0) return mergedMeetingsBase;
    return mergedMeetingsBase.map((m) => {
      const fs = firestorePatches.get(m.id);
      if (!fs) return m;
      return {
        ...m,
        participantIds: fs.participantIds ?? m.participantIds,
        participantVoteLog: fs.participantVoteLog ?? m.participantVoteLog,
        voteTallies: fs.voteTallies ?? m.voteTallies,
      };
    });
  }, [mergedMeetingsBase, firestorePatches]);

  const textFilteredMeetings = useMemo(() => {
    if (!meetingMatchesFeedSearch) return mergedMeetings;
    const active = mapSearchFilters;
    const isActive = Boolean(
      active.textQuery.trim() ||
        active.ageInclude.length > 0 ||
        active.genderRatio != null ||
        active.settlement != null ||
        active.approvalType != null,
    );
    if (!isActive) return mergedMeetings;
    return mergedMeetings.filter((m) => meetingMatchesFeedSearch(m, active));
  }, [mergedMeetings, mapSearchFilters]);

  const filteredMeetings = useMemo(() => {
    return textFilteredMeetings.filter((m) => {
      if (m.isPublic === false) return false;
      if (!meetingMatchesCategoryFilter(m, selectedCategoryId, categories)) return false;
      if (recruitingOnly && getMeetingRecruitmentPhase(m) !== 'recruiting') return false;
      if (mapTodayOnly && !isMeetingScheduledTodaySeoul(m)) return false;
      return true;
    });
  }, [textFilteredMeetings, selectedCategoryId, categories, recruitingOnly, mapTodayOnly]);

  /** 목록·거리 표시: 내 위치(GPS) 기준. GPS 없을 때 «가까운 순»은 임박순과 동일하게 정렬 */
  const sortedFilteredMeetings = useMemo(() => {
    if (listSortMode === 'distance' && !userCoords) {
      return sortMeetingsForFeed(filteredMeetings, 'soon', null);
    }
    return sortMeetingsForFeed(filteredMeetings, listSortMode, userCoords);
  }, [filteredMeetings, listSortMode, userCoords]);

  const meetingsOnMap = useMemo(() => {
    let list = sortedFilteredMeetings.filter(
      (m) =>
        typeof m.latitude === 'number' &&
        typeof m.longitude === 'number' &&
        Number.isFinite(m.latitude) &&
        Number.isFinite(m.longitude),
    );
    if (mapGeoQueryRegion) list = list.filter((m) => meetingInBounds(m, mapGeoQueryRegion));
    return list;
  }, [sortedFilteredMeetings, mapGeoQueryRegion]);

  /**
   * 동일 좌표 다건: 지도에는 숫자 마커 1개만 두고, 좌표는 공유(나선 분리 없음).
   * 바텀시트·카메라 추적은 `createdAt`이 가장 이른 모임을 대표로 맞춥니다.
   */
  const mapMarkerCoordsByMeetingId = useMemo(() => {
    const out = new Map<string, LatLng>();
    const groups = groupMeetingsByCoordinateOverlap(meetingsOnMap);
    for (const group of groups.values()) {
      const sorted = [...group].sort((a, b) => meetingCreatedAtMillis(a) - meetingCreatedAtMillis(b));
      const base = sorted[0];
      if (!base) continue;
      const lat = base.latitude as number;
      const lng = base.longitude as number;
      for (const m of sorted) {
        out.set(m.id, { latitude: lat, longitude: lng });
      }
    }
    return out;
  }, [meetingsOnMap]);

  const mapMarkerRenderItems = useMemo((): MapMarkerRenderItem[] => {
    const groups = groupMeetingsByCoordinateOverlap(meetingsOnMap);
    const items: MapMarkerRenderItem[] = [];
    for (const group of groups.values()) {
      const sorted = [...group].sort((a, b) => meetingCreatedAtMillis(a) - meetingCreatedAtMillis(b));
      const first = sorted[0];
      if (!first) continue;
      if (sorted.length === 1) {
        items.push({ kind: 'single', meeting: first, key: first.id });
      } else {
        const lat = first.latitude as number;
        const lng = first.longitude as number;
        const key = `stack:${meetingCoordinateKey(lat, lng)}`;
        items.push({ kind: 'stack', meetings: sorted, count: sorted.length, key, lead: first });
      }
    }
    return items;
  }, [meetingsOnMap]);

  const naverClusterMarkers: ClusterMarkerProp[] = useMemo(
    () =>
      mapMarkerRenderItems.map((item) => {
        const m = item.kind === 'single' ? item.meeting : item.lead;
        const c = mapMarkerCoordsByMeetingId.get(m.id) ?? {
          latitude: m.latitude as number,
          longitude: m.longitude as number,
        };
        return {
          identifier: m.id,
          latitude: c.latitude,
          longitude: c.longitude,
        };
      }),
    [mapMarkerRenderItems, mapMarkerCoordsByMeetingId],
  );

  const naverUseClusters = Platform.OS === 'android' && naverZoom <= NAVER_CLUSTER_MAX_ZOOM;

  // (겹침(spider) 확장 기능 제거됨)

  // (겹침(동일 좌표) 그룹 선택 UI 제거됨 — 바텀시트는 현재 화면 내 전체 모임을 보여줍니다.)

  const boundsMeetings = useMemo(() => {
    if (!isSheetExpanded || !listingRegion) return sortedFilteredMeetings;
    return sortedFilteredMeetings.filter((m) => meetingInBounds(m, listingRegion));
  }, [sortedFilteredMeetings, isSheetExpanded, listingRegion]);

  const sheetMeetings = useMemo(() => {
    const r = mapGeoQueryRegion;
    return r
      ? sortedFilteredMeetings.filter((m) => meetingInBounds(m, r))
      : [...sortedFilteredMeetings];
  }, [sortedFilteredMeetings, mapGeoQueryRegion]);

  const initialMapRegion = useMemo(() => {
    if (searchAnchor) {
      const base = regionCenteredOnNorthSouthSpanMeters(
        searchAnchor.latitude,
        searchAnchor.longitude,
        INITIAL_VIEW_NS_SPAN_METERS,
      );
      return {
        ...base,
        latitude: centerLatForBetweenTopAndBottom(
          searchAnchor.latitude,
          base.latitudeDelta,
          insets.top ?? 0,
          sheetPeekHeight,
          windowHeight,
        ),
      };
    }
    if (userCoords) {
      const base = regionCenteredOnNorthSouthSpanMeters(
        userCoords.latitude,
        userCoords.longitude,
        INITIAL_VIEW_NS_SPAN_METERS,
      );
      return {
        ...base,
        latitude: centerLatForBetweenTopAndBottom(
          userCoords.latitude,
          base.latitudeDelta,
          insets.top ?? 0,
          sheetPeekHeight,
          windowHeight,
        ),
      };
    }
    return regionCenteredOnUserRadius(DEFAULT_NO_LOCATION_CENTER.latitude, DEFAULT_NO_LOCATION_CENTER.longitude, 1);
  }, [searchAnchor, userCoords, insets.top, sheetPeekHeight, windowHeight]);

  const moveMapToMeetingPin = useCallback(
    (m: Meeting) => {
      const lat = m.latitude;
      const lng = m.longitude;
      if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return;

      const base = lastCompleteRegionRef.current ?? mapGeoQueryRegion ?? initialMapRegion;
      const next: Region = {
        ...base,
        latitude: centerLatForBetweenTopAndBottom(
          lat,
          base.latitudeDelta,
          insets.top ?? 0,
          sheetPeekHeight,
          windowHeight,
        ),
        longitude: lng,
      };

      lastCompleteRegionRef.current = next;
      try {
        if (Platform.OS === 'android') {
          naverMapRef.current?.animateRegionTo({
            ...centerRegionToNaverRegion(next),
            duration: 420,
            easing: 'EaseIn',
          });
        } else {
          mapRef.current?.animateToRegion(next, 420);
        }
      } catch {
        /* ignore */
      }
    },
    [initialMapRegion, insets.top, mapGeoQueryRegion, sheetPeekHeight, windowHeight],
  );

  const sortedMapCategoryMaster = useMemo(
    () =>
      [...categories].sort((a, b) =>
        a.order !== b.order ? a.order - b.order : a.label.localeCompare(b.label, 'ko'),
      ),
    [categories],
  );

  const mapCategoryChips = useMemo(
    () => buildMapCategoryChips(categories, mapBarVisibleCategoryIds),
    [categories, mapBarVisibleCategoryIds],
  );

  const showMapCategoryChipsScrollMore = useMemo(() => {
    const lw = chipScrollLayoutW;
    const cw = chipScrollContentW;
    const ox = chipScrollOffsetX;
    if (lw < 8 || cw <= lw + 4) return false;
    return ox < cw - lw - 8;
  }, [chipScrollLayoutW, chipScrollContentW, chipScrollOffsetX]);

  const onMapCategoryChipsScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setChipScrollOffsetX(e.nativeEvent.contentOffset.x);
  }, []);

  const onMapCategoryChipsContentSizeChange = useCallback((w: number) => {
    setChipScrollContentW(w);
  }, []);

  const onMapCategoryChipsLayout = useCallback((e: LayoutChangeEvent) => {
    setChipScrollLayoutW(e.nativeEvent.layout.width);
  }, []);

  /** 상단 칩 일부만 표시하도록 저장된 경우 → 옵션 버튼을 선택된 칩 스타일로 */
  const mapCategoryBarFilterActive = useMemo(() => {
    if (mapTodayOnly) return true;
    if (categories.length === 0) return false;
    if (mapBarVisibleCategoryIds == null) return false;
    return mapBarVisibleCategoryIds.length < categories.length;
  }, [categories.length, mapBarVisibleCategoryIds, mapTodayOnly]);

  useEffect(() => {
    if (!categories.length || mapBarVisibleCategoryIds == null) return;
    const idSet = new Set(categories.map((c) => c.id));
    const valid = mapBarVisibleCategoryIds.filter((id) => idSet.has(id));
    if (valid.length === mapBarVisibleCategoryIds.length) return;
    const next =
      valid.length === 0 || valid.length === categories.length ? null : valid;
    setMapBarVisibleCategoryIds(next);
    void persistMapCategoryBarVisibleIds(next);
  }, [categories, mapBarVisibleCategoryIds]);

  useEffect(() => {
    if (selectedCategoryId == null) return;
    const ok = mapCategoryChips.some((c) => c.filterId === selectedCategoryId);
    if (!ok) setSelectedCategoryId(null);
  }, [mapCategoryChips, selectedCategoryId]);

  const openMapCategoryBarModal = useCallback(() => {
    const ordered = sortedMapCategoryMaster.map((c) => c.id);
    if (mapBarVisibleCategoryIds == null) {
      setCategoryBarDraft(ordered);
    } else {
      setCategoryBarDraft(ordered.filter((id) => mapBarVisibleCategoryIds.includes(id)));
    }
    setCategoryBarTodayOnlyDraft(mapTodayOnly);
    setMapCategoryBarModalOpen(true);
  }, [sortedMapCategoryMaster, mapBarVisibleCategoryIds, mapTodayOnly]);

  const closeMapCategoryBarModal = useCallback(() => setMapCategoryBarModalOpen(false), []);

  const syncCategoryBarModalListMoreBelow = useCallback(() => {
    const lh = categoryBarModalListLayHRef.current;
    const ch = categoryBarModalListContHRef.current;
    const y = categoryBarModalListScrollYRef.current;
    if (lh <= 0 || ch <= lh + 8) {
      setCategoryBarModalListShowMoreBelow(false);
      return;
    }
    const remaining = ch - y - lh;
    setCategoryBarModalListShowMoreBelow(remaining > 10);
  }, []);

  /** 상단 카테고리 모달: 카드 maxHeight 기준으로 목록 스크롤 상한을 잡아 카드 밖으로 밀리지 않게 함 */
  const mapCategoryBarModalCardMaxH = useMemo(
    () => Math.min(560, Math.floor(windowHeight * 0.82)),
    [windowHeight],
  );
  const mapCategoryBarModalCategoryListMaxH = useMemo(
    () => Math.max(120, mapCategoryBarModalCardMaxH - 372),
    [mapCategoryBarModalCardMaxH],
  );

  useEffect(() => {
    if (mapCategoryBarModalOpen) return;
    categoryBarModalListScrollYRef.current = 0;
    categoryBarModalListLayHRef.current = 0;
    categoryBarModalListContHRef.current = 0;
    setCategoryBarModalListShowMoreBelow(false);
  }, [mapCategoryBarModalOpen]);

  useEffect(() => {
    if (!mapCategoryBarModalOpen) return;
    categoryBarModalListScrollYRef.current = 0;
    requestAnimationFrame(() => {
      try {
        categoryBarModalCategoryListScrollRef.current?.scrollTo({ y: 0, animated: false });
      } catch {
        /* ignore */
      }
      syncCategoryBarModalListMoreBelow();
    });
  }, [mapCategoryBarModalOpen, syncCategoryBarModalListMoreBelow]);

  const toggleCategoryBarDraft = useCallback(
    (id: string) => {
      setCategoryBarDraft((prev) => {
        const ordered = sortedMapCategoryMaster.map((c) => c.id);
        const set = new Set(prev);
        if (set.has(id)) {
          set.delete(id);
        } else {
          set.add(id);
        }
        return ordered.filter((oid) => set.has(oid));
      });
    },
    [sortedMapCategoryMaster],
  );

  /** 켜져 있으면 마스터 전부 선택(저장 시 null=전체 칩). 끄면 개별 선택을 비움 → 저장 시 최소 1개 검증. */
  const toggleCategoryBarSelectAll = useCallback(() => {
    setCategoryBarDraft((prev) => {
      const ordered = sortedMapCategoryMaster.map((c) => c.id);
      if (ordered.length === 0) return prev;
      const allOn =
        prev.length === ordered.length && ordered.every((id) => prev.includes(id));
      return allOn ? [] : [...ordered];
    });
  }, [sortedMapCategoryMaster]);

  const categoryBarSelectAllChecked = useMemo(() => {
    const ordered = sortedMapCategoryMaster.map((c) => c.id);
    if (ordered.length === 0) return false;
    return (
      categoryBarDraft.length === ordered.length &&
      ordered.every((id) => categoryBarDraft.includes(id))
    );
  }, [sortedMapCategoryMaster, categoryBarDraft]);

  const saveMapCategoryBarModal = useCallback(async () => {
    const ordered = sortedMapCategoryMaster.map((c) => c.id);
    if (ordered.length > 0 && categoryBarDraft.length === 0) {
      Alert.alert('선택 필요', '상단 칩에 표시할 카테고리를 최소 하나 이상 선택해 주세요.');
      return;
    }
    const next =
      ordered.length === 0 || categoryBarDraft.length === ordered.length
        ? null
        : [...categoryBarDraft];
    setMapBarVisibleCategoryIds(next);
    await persistMapCategoryBarVisibleIds(next);
    setMapTodayOnly(categoryBarTodayOnlyDraft);
    setMapCategoryBarModalOpen(false);
  }, [sortedMapCategoryMaster, categoryBarDraft, categoryBarTodayOnlyDraft]);

  const openSortFilterModal = useCallback(() => setSortFilterModalOpen(true), []);
  const closeSortFilterModal = useCallback(() => setSortFilterModalOpen(false), []);

  const sortComboLabel = useMemo(() => listSortModeLabel(listSortMode), [listSortMode]);

  const onPressRescanThisArea = useCallback(() => {
    const r = pendingRegion ?? lastCompleteRegionRef.current;
    if (!r) return;
    mapSnapCameraTighterThanQueryRef.current = false;
    const next: LatLng = { latitude: r.latitude, longitude: r.longitude };
    setSearchAnchor(next);
    setListingRegion(r);
    setMapGeoQueryRegion(r);
    setQueriedRegion(r);
    lastQueriedRegionRef.current = r;
    setPendingRegion(r);
    setDriftTooFar(false);
    setMapMovedSinceSearch(false);
    try {
      mapRef.current?.animateToRegion(r, 420);
    } catch {
      /* ignore */
    }
  }, [pendingRegion]);

  const onPressMyLocation = useCallback(() => {
    void (async () => {
      if (Platform.OS === 'web') {
        Alert.alert('위치 권한', '웹에서는 내 위치 이동을 지원하지 않습니다.');
        return;
      }

      let granted = (await Location.getForegroundPermissionsAsync().catch(() => null))?.status === 'granted';
      if (!granted) {
        const req = await Location.requestForegroundPermissionsAsync().catch(() => null);
        granted = req?.status === 'granted';
      }
      if (granted) {
        const ctx = await resolveFeedLocationWithGrantedPermission();
        const c = ctx.coords;
        if (!c) {
          Alert.alert(
            '위치를 가져올 수 없어요',
            '권한은 허용되었지만 현재 위치 좌표를 읽지 못했습니다. 잠시 후 다시 시도해 주세요.',
          );
          return;
        }
        userCoordsRef.current = c;
        setUserCoords(c);
        snapMapToUserCoords(c, MY_LOCATION_BUTTON_VIEW_RADIUS_KM);
        return;
      }

      const settingsHint =
        Platform.OS === 'ios'
          ? '설정 앱 → 개인정보 보호 및 보안 → 위치 서비스 → 지닛 에서 «위치»를 «앱을 사용하는 동안» 또는 «항상»으로 바꿔 주세요.'
          : '설정 → 앱 → 지닛 → 권한 → 위치 에서 «앱 사용 중에만 허용» 또는 «항상 허용»으로 바꿔 주세요.';

      Alert.alert(
        '위치 권한이 필요해요',
        `내 위치로 이동하려면 GPS(위치) 사용을 허용해야 합니다.\n\n${settingsHint}\n\n한 번 거절하셨다면 위 경로에서 다시 켤 수 있고, 아래 «설정 열기»로 바로 이동할 수도 있어요.`,
        [
          { text: '닫기', style: 'cancel' },
          { text: '설정 열기', onPress: () => void Linking.openSettings() },
        ],
      );
    })();
  }, [snapMapToUserCoords]);

  const onPressCreateFab = useCallback(() => {
    void (async () => {
      const pk = userId?.trim();
      if (pk) {
        try {
          const p = await getUserProfile(pk);
          if (!isMeetingServiceComplianceComplete(p, pk)) {
            Alert.alert('인증 정보 등록', '모임을 이용하시려면 약관 동의와 필요한 프로필 정보를 입력해 주세요.', [
              { text: '확인', onPress: () => pushProfileOpenRegisterInfo(router) },
            ]);
            return;
          }
        } catch {
          /* 등록 시 addMeeting에서 재검증 */
        }
      }
      const r = lastCompleteRegionRef.current ?? listingRegion ?? initialMapRegion;
      const lat = r.latitude;
      const lng = r.longitude;
      applyNearbySearchBiasFromMapNavigation(
        { latitude: lat, longitude: lng },
        regionLabelRef.current?.trim() ? regionLabelRef.current : null,
      );
      setPendingMeetingPlace({
        placeName: '지도 중심',
        address: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        latitude: lat,
        longitude: lng,
      });
      router.push('/create/details');
    })();
  }, [router, userId, listingRegion, initialMapRegion]);

  useEffect(() => {
    addCleanup(() => {
      if (listScrollRaf.current != null) {
        cancelAnimationFrame(listScrollRaf.current);
        listScrollRaf.current = null;
      }
      if (scrollAfterInteractionTimeoutRef.current != null) {
        clearTimeout(scrollAfterInteractionTimeoutRef.current);
        scrollAfterInteractionTimeoutRef.current = null;
      }
      if (scrollAfterInteractionCancelRef.current) {
        scrollAfterInteractionCancelRef.current();
        scrollAfterInteractionCancelRef.current = null;
      }
    });
  }, [addCleanup]);

  const smoothScrollListToY = useCallback((targetY: number, durationMs = 480) => {
    const list = meetingListRef.current;
    if (!list) return;
    if (listScrollRaf.current != null) {
      cancelAnimationFrame(listScrollRaf.current);
      listScrollRaf.current = null;
    }
    const maxScroll = Math.max(0, listContentH.current - listLayoutH.current);
    const to = Math.min(maxScroll, Math.max(0, targetY));
    const from = listScrollY.current;
    if (Math.abs(to - from) < 3) return;

    const start = Date.now();
    const step = () => {
      const elapsed = Date.now() - start;
      const t = Math.min(1, elapsed / durationMs);
      const y = from + (to - from) * easeOutCubic(t);
      list.scrollToOffset({ offset: y, animated: false });
      if (t < 1) {
        listScrollRaf.current = requestAnimationFrame(step);
      } else {
        listScrollRaf.current = null;
        listScrollY.current = to;
      }
    };
    listScrollRaf.current = requestAnimationFrame(step);
  }, []);

  const scrollListToMeetingId = useCallback(
    (meetingId: string, opts?: { animated?: boolean }) => {
      const idx = sortedFilteredMeetings.findIndex((m) => m.id === meetingId);
      if (idx < 0) return;
      const lead = 10;
      const targetY = idx * LIST_ITEM_STRIDE - lead;
      if (opts?.animated === false) {
        if (listScrollRaf.current != null) {
          cancelAnimationFrame(listScrollRaf.current);
          listScrollRaf.current = null;
        }
        const list = meetingListRef.current;
        if (!list) return;
        const maxScroll = Math.max(0, listContentH.current - listLayoutH.current);
        const to = Math.min(maxScroll, Math.max(0, targetY));
        list.scrollToOffset({ offset: to, animated: false });
        listScrollY.current = to;
        return;
      }
      smoothScrollListToY(targetY);
    },
    [sortedFilteredMeetings, smoothScrollListToY],
  );

  const scrollCarouselToMeetingId = useCallback(
    (meetingId: string, opts?: { animated?: boolean }) => {
      const idx = sheetMeetings.findIndex((m) => m.id === meetingId);
      if (idx < 0 || !carouselRef.current) return;
      try {
        carouselRef.current.scrollToIndex({
          index: idx,
          animated: opts?.animated !== false,
          viewPosition: 0.5,
        });
      } catch {
        /* layout */
      }
    },
    [sheetMeetings],
  );

  const onMeetingListScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    listScrollY.current = e.nativeEvent.contentOffset.y;
  }, []);

  useEffect(() => {
    if (!selectedMeetingId) return;
    if (!sortedFilteredMeetings.some((m) => m.id === selectedMeetingId)) {
      setSelectedMeetingId(null);
    }
  }, [sortedFilteredMeetings, selectedMeetingId]);

  const onMeetingMarkerPress = useCallback(
    (meetingId: string) => {
      const idx = sheetMeetings.findIndex((m) => m.id === meetingId);
      setSelectedMeetingId(meetingId);
      setSelectedMeetingIndex(idx >= 0 ? idx : 0);
      if (listScrollRaf.current != null) {
        cancelAnimationFrame(listScrollRaf.current);
        listScrollRaf.current = null;
      }
      if (scrollAfterInteractionTimeoutRef.current != null) {
        clearTimeout(scrollAfterInteractionTimeoutRef.current);
        scrollAfterInteractionTimeoutRef.current = null;
      }
      if (scrollAfterInteractionCancelRef.current) {
        scrollAfterInteractionCancelRef.current();
        scrollAfterInteractionCancelRef.current = null;
      }
      /** 다음 프레임: 시트·FlatList 레이아웃 반영 후 애니메이션 없이 맞춤 */
      scrollAfterInteractionTimeoutRef.current = setTimeout(() => {
        scrollAfterInteractionTimeoutRef.current = null;
        requestAnimationFrame(() => {
          scrollListToMeetingId(meetingId, { animated: false });
          scrollCarouselToMeetingId(meetingId, { animated: false });
        });
      }, 0);
      scrollAfterInteractionCancelRef.current = () => {
        if (scrollAfterInteractionTimeoutRef.current != null) {
          clearTimeout(scrollAfterInteractionTimeoutRef.current);
          scrollAfterInteractionTimeoutRef.current = null;
        }
      };
    },
    [sheetMeetings, scrollListToMeetingId, scrollCarouselToMeetingId],
  );

  const onPeopleMarkerPress = useCallback(
    (m: Meeting) => {
      lastMarkerTapAtRef.current = Date.now();
      followSelectedRef.current = true;
      openSheet();
      onMeetingMarkerPress(m.id);
    },
    [onMeetingMarkerPress, openSheet],
  );

  const onMapPress = useCallback(() => {
    setSelectedMeetingId(null);
    setSelectedMeetingIndex(0);
    if (sheetShown.value >= 0.5) {
      onUserMapGesture();
      return;
    }
    enableFollowSelected();
    openSheet();
  }, [enableFollowSelected, onUserMapGesture, openSheet, sheetShown]);

  const onClusterPress = useCallback(
    // `react-native-map-clustering`의 콜백 시그니처는 버전마다 달라 any로 처리합니다.
    (cluster: any, markers?: any[]) => {
      try {
        if (Platform.OS === 'ios') {
          LayoutAnimation.configureNext(LayoutAnimation.Presets.spring);
        }
      } catch {
        /* ignore */
      }

      const coord =
        cluster?.geometry?.coordinates && Array.isArray(cluster.geometry.coordinates)
          ? { latitude: cluster.geometry.coordinates[1], longitude: cluster.geometry.coordinates[0] }
          : cluster?.coordinate;

      const rawMarkers = Array.isArray(markers)
        ? markers
        : Array.isArray(cluster?.markers)
          ? cluster.markers
          : [];

      const ids = rawMarkers
        .map((mk: any) => mk?.props?.identifier ?? mk?.identifier ?? mk?.id)
        .filter((x: any) => typeof x === 'string' && x && !x.startsWith('spider-'));

      // 클러스터 탭 시 spider 펼침은 제거. 기본 줌 동작은 라이브러리에 맡깁니다.

      // 기본 동작(확대/센터 이동)은 라이브러리에 맡깁니다.
    },
    [meetingsOnMap],
  );

  const onCarouselViewable = useCallback(({ viewableItems }: { viewableItems: { item: Meeting }[] }) => {
    const first = viewableItems[0]?.item;
    if (first?.id) setSelectedMeetingId(first.id);
  }, []);

  const onSelectedViewable = useCallback(
    ({ viewableItems }: { viewableItems: { index: number | null }[] }) => {
      const idx = viewableItems[0]?.index;
      if (typeof idx !== 'number' || !Number.isFinite(idx)) return;
      setSelectedMeetingIndex(idx);
      const m = sheetMeetings[idx];
      if (m?.id) setSelectedMeetingId(m.id);
    },
    [sheetMeetings],
  );

  const onSheetCarouselBeginDrag = useCallback(() => {
    carouselDragStartIndexRef.current = selectedMeetingIndex;
    setMapMovedSinceSearch(true);
    enableFollowSelected();
    openSheet();
  }, [selectedMeetingIndex, enableFollowSelected, openSheet]);

  const onSheetCarouselMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const stride = Dimensions.get('window').width - 32;
      const raw = Math.round(e.nativeEvent.contentOffset.x / Math.max(1, stride));
      const start = carouselDragStartIndexRef.current;
      const clamped = Math.max(0, Math.min(sheetMeetings.length - 1, Math.max(start - 1, Math.min(start + 1, raw))));
      if (clamped !== raw && carouselRef.current) {
        try {
          carouselRef.current.scrollToIndex({ index: clamped, animated: true, viewPosition: 0.5 });
        } catch {
          /* ignore */
        }
      }
      setSelectedMeetingIndex(clamped);
      const m = sheetMeetings[clamped];
      if (m?.id) setSelectedMeetingId(m.id);
    },
    [sheetMeetings],
  );

  useEffect(() => {
    const m = sheetMeetings[selectedMeetingIndex];
    if (!m) return;
    const ids: string[] = [];
    const host = m.createdBy?.trim();
    if (host) ids.push(host);
    const parts = Array.isArray(m.participantIds) ? m.participantIds : [];
    for (const x of parts) {
      const t = String(x ?? '').trim();
      if (t) ids.push(t);
    }
    const uniq = [...new Set(ids)].slice(0, 50);
    if (uniq.length === 0) return;

    // 이미 캐시에 있는 id는 제외
    const missing = uniq.filter((id) => !genderByUserId.has(id));
    if (missing.length === 0) return;

    let cancelled = false;
    (async () => {
      try {
        const profiles = await getUserProfilesForIds(missing);
        if (cancelled) return;
        setGenderByUserId((prev) => {
          const next = new Map(prev);
          for (const id of missing) {
            const p = profiles.get(id);
            const g = (p?.gender ?? '').toString().trim().toUpperCase();
            if (g === 'MALE' || g === 'FEMALE') next.set(id, g);
            else next.set(id, 'UNKNOWN');
          }
          return next;
        });
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [genderByUserId, selectedMeetingIndex, sheetMeetings]);

  const renderCarouselCard = useCallback(
    ({ item: m }: { item: Meeting }) => {
      const progressPill = meetingProgressPillStyles(getMeetingRecruitmentPhase(m));
      const selected = m.id === selectedMeetingId;
      const categoryDisplay = meetingCategoryDisplayLabel(m, categories)?.trim() ?? '';
      const metaSecond = m.capacity ? `최대 ${m.capacity}명` : '';
      const listMetaText = categoryDisplay ? metaSecond : [m.categoryLabel, metaSecond].filter(Boolean).join(' · ');
      return (
        <Pressable
          onPress={() => {
            setSelectedMeetingId(m.id);
            router.push(`/meeting/${m.id}`);
          }}
          style={[styles.carouselCard, selected && styles.carouselCardSelected]}
          accessibilityRole="button">
          <Image source={{ uri: resolveMeetingListThumbnailUri(m) }} style={styles.listThumb} contentFit="cover" />
          <View style={styles.listCardBody}>
            <View style={styles.listTitleRow}>
              <Text style={styles.listTitle} numberOfLines={1} ellipsizeMode="tail">
                {categoryDisplay ? <Text style={styles.listTitleCategory}>[{categoryDisplay}] </Text> : null}
                {m.title}
              </Text>
              <View style={progressPill.wrap}>
                <Text style={progressPill.text} numberOfLines={1}>
                  {progressPill.label}
                </Text>
              </View>
            </View>
            <Text style={styles.listMeta} numberOfLines={1}>
              {listMetaText}
            </Text>
            <View style={styles.listFooter}>
              <Text style={styles.listDist}>{formatDistanceForList(meetingDistanceMetersFromUser(m, userCoords))}</Text>
              <View style={styles.joinBtn}>
                <Text style={styles.joinBtnText}>참가 신청</Text>
              </View>
            </View>
          </View>
        </Pressable>
      );
    },
    [router, categories, selectedMeetingId, userCoords],
  );

  const renderSheetMeetingText = useCallback(
    ({ item: m }: { item: Meeting }) => {
      const progressPill = meetingProgressPillStyles(getMeetingRecruitmentPhase(m));
      const selected = m.id === selectedMeetingId;
      const categoryDisplay = meetingCategoryDisplayLabel(m, categories)?.trim() ?? '';

      const cap = m.capacity;
      const capText =
        typeof cap === 'number' && Number.isFinite(cap) ? (cap >= MEETING_CAPACITY_UNLIMITED ? '무제한' : `최대 ${cap}명`) : '';
      const publicText = m.isPublic === false ? '비공개' : '공개 모집';
      const placeTitle = (m.placeName ?? m.location ?? '').trim();
      const placeSub = (m.address ?? '').trim();
      const scheduleText = formatSchedulePretty(m) ?? '일시 미정';
      const participantCount = meetingParticipantCount(m);
      const idsForGenderCount = (() => {
        const ids: string[] = [];
        const host = m.createdBy?.trim();
        if (host) ids.push(host);
        const parts = Array.isArray(m.participantIds) ? m.participantIds : [];
        for (const x of parts) {
          const t = String(x ?? '').trim();
          if (t) ids.push(t);
        }
        return [...new Set(ids)];
      })();
      const genderCountText = (() => {
        let male = 0;
        let female = 0;
        let unknown = 0;
        for (const id of idsForGenderCount) {
          const g = genderByUserId.get(id);
          if (g === 'MALE') male++;
          else if (g === 'FEMALE') female++;
          else unknown++;
        }
        // 아직 로딩 전이면 unknown이 커서 "? 표기"가 의미가 없으므로,
        // 로딩된 값이 하나도 없을 때는 '?'로 표시합니다.
        if (male + female === 0 && idsForGenderCount.length > 0) return '남 ? · 여 ?';
        // 일부만 로딩되면, 알 수 없는 인원은 '?'로만 남겨두고 남/여만 확정 표시
        return unknown > 0 ? `남 ${male} · 여 ${female} · ?${unknown}` : `남 ${male} · 여 ${female}`;
      })();

      const publicDetails = m.isPublic === false ? null : parsePublicMeetingDetailsConfig(m.meetingConfig);
      const detailChips = (() => {
        if (!publicDetails) return [];
        const d = publicDetails;
        const settlementRaw = formatPublicMeetingSettlementSummary(d.settlement, d.membershipFeeWon);
        const settlementValue =
          settlementRaw.includes('더치') ? '더치페이' : settlementRaw;
        return [
          `연령 ${formatPublicMeetingAgeSummary(d.ageLimit)}`,
          `성별 ${formatPublicMeetingGenderSummary(d.genderRatio, d.hostGenderSnapshot)}`,
          `정산 ${settlementValue}`,
          `승인 ${formatPublicMeetingApprovalSummary(d.approvalType)}`,
        ].filter(Boolean);
      })();
      return (
        <View style={[styles.sheetInfoWrap, selected && styles.sheetInfoWrapSelected]}>
          <View style={styles.sheetInfoHeader}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.sheetInfoTitle} numberOfLines={1} ellipsizeMode="tail">
                {categoryDisplay ? `[${categoryDisplay}] ` : ''}
                {m.title}
              </Text>
            </View>
            <View style={styles.sheetBadgeCol}>
              <View style={progressPill.wrap}>
                <Text style={progressPill.text} numberOfLines={1}>
                  {progressPill.label}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.sheetBadgesRow}>
            <View style={styles.sheetMiniBadge}>
              <GinitSymbolicIcon
                name={m.isPublic === false ? 'lock-closed-outline' : 'globe-outline'}
                size={14}
                color={GinitTheme.colors.primary}
                style={styles.sheetMiniBadgeIcon}
              />
              <Text style={styles.sheetMiniBadgeText}>{publicText}</Text>
            </View>
            {capText ? (
              <View style={styles.sheetMiniBadge}>
                <GinitSymbolicIcon
                  name="people-outline"
                  size={14}
                  color={GinitTheme.colors.primary}
                  style={styles.sheetMiniBadgeIcon}
                />
                <Text style={styles.sheetMiniBadgeText} numberOfLines={1} ellipsizeMode="tail">
                  인원 {capText}
                </Text>
              </View>
            ) : null}
          </View>

          {/* 공개 모임 상세 조건: 한 줄 + 가로 스크롤(캐러셀 내 중첩 스크롤) */}
          {detailChips.length > 0 ? (
            <ScrollView
              horizontal
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
              showsHorizontalScrollIndicator={false}
              style={styles.detailChipScroll}
              contentContainerStyle={styles.detailChipScrollContent}>
              {detailChips.map((t, idx) => (
                <View key={`${m.id}-detail-${idx}`} style={styles.detailChip}>
                  <Text style={styles.detailChipText} numberOfLines={1}>
                    {t}
                  </Text>
                </View>
              ))}
            </ScrollView>
          ) : null}

          {/* 상세 팩트 영역 (옮기기 전 레이아웃로 롤백) */}
          <View style={styles.sheetFacts}>
            <View style={[styles.sheetFactRow, styles.sheetFactRowLocation]}>
              <GinitSymbolicIcon name="location-outline" size={16} color="#64748b" />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.sheetFactText} numberOfLines={1}>
                  {placeTitle || '장소'}
                </Text>
                {placeSub ? (
                  <Text style={styles.sheetFactSubText} numberOfLines={1}>
                    {placeSub}
                  </Text>
                ) : null}
              </View>
              <View style={styles.sheetMovePinCol}>
                <Pressable
                  onPress={() => moveMapToMeetingPin(m)}
                  style={({ pressed }) => [styles.sheetMovePinInlineBtn, pressed && { opacity: 0.9 }]}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="모임 위치로 이동">
                  <GinitSymbolicIcon name="locate-outline" size={16} color={GinitTheme.colors.primary} />
                  <Text style={styles.sheetMovePinInlineText} numberOfLines={1}>
                    {formatDistanceForList(meetingDistanceMetersFromUser(m, userCoords))}
                  </Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.sheetFactRow}>
              <GinitSymbolicIcon name="time-outline" size={16} color="#64748b" />
              <Text style={styles.sheetFactText} numberOfLines={1}>
                {scheduleText}
              </Text>
            </View>

            <View style={styles.sheetFactRow}>
              <GinitSymbolicIcon name="people-outline" size={16} color="#64748b" />
              <View style={styles.participantRow}>
                <Text style={styles.participantText} numberOfLines={1} ellipsizeMode="tail">
                  {participantCount > 0
                    ? `지금 참여자 ${participantCount}명 (${genderCountText})`
                    : `참여자 없음 (${genderCountText})`}
                </Text>
              </View>
            </View>
          </View>

          {/* 모임 설명 숨김 */}
        </View>
      );
    },
    [categories, selectedMeetingId, userCoords, moveMapToMeetingPin],
  );

  const renderVerticalRow = useCallback(
    ({ item: m }: { item: Meeting }) => {
      const progressPill = meetingProgressPillStyles(getMeetingRecruitmentPhase(m));
      const selected = m.id === selectedMeetingId;
      const categoryDisplay = meetingCategoryDisplayLabel(m, categories)?.trim() ?? '';
      const metaSecond = m.capacity ? `최대 ${m.capacity}명` : '';
      const listMetaText = categoryDisplay ? metaSecond : [m.categoryLabel, metaSecond].filter(Boolean).join(' · ');
      return (
        <Pressable
          onPress={() => {
            setSelectedMeetingId(m.id);
            router.push(`/meeting/${m.id}`);
          }}
          style={[styles.listCard, selected && styles.listCardSelected]}
          accessibilityRole="button">
          <Image source={{ uri: resolveMeetingListThumbnailUri(m) }} style={styles.listThumb} contentFit="cover" />
          <View style={styles.listCardBody}>
            <View style={styles.listTitleRow}>
              <Text style={styles.listTitle} numberOfLines={1} ellipsizeMode="tail">
                {categoryDisplay ? <Text style={styles.listTitleCategory}>[{categoryDisplay}] </Text> : null}
                {m.title}
              </Text>
              <View style={progressPill.wrap}>
                <Text style={progressPill.text} numberOfLines={1}>
                  {progressPill.label}
                </Text>
              </View>
            </View>
            <Text style={styles.listMeta} numberOfLines={1}>
              {listMetaText}
            </Text>
            <View style={styles.listFooter}>
              <Text style={styles.listDist}>{formatDistanceForList(meetingDistanceMetersFromUser(m, userCoords))}</Text>
              <View style={styles.joinBtn}>
                <Text style={styles.joinBtnText}>참가 신청</Text>
              </View>
            </View>
          </View>
        </Pressable>
      );
    },
    [router, categories, selectedMeetingId, userCoords],
  );

  const carouselWidth = useMemo(() => Dimensions.get('window').width - 32, []);

  const rescanTop = useMemo(
    () => Math.max(insets.top + 66, Math.round(WINDOW_H * 0.12) + 10),
    [insets.top],
  );

  return (
    <GestureHandlerRootView style={styles.root}>
      <View style={styles.mapWrap}>
        {isMapScreenFocused ? (
          Platform.OS === 'android' ? (
            <NaverMapView
              ref={naverMapRef}
              style={StyleSheet.absoluteFillObject}
              initialRegion={centerRegionToNaverRegion(lastCompleteRegionRef.current ?? initialMapRegion)}
              locationOverlay={
                userCoords
                  ? {
                      isVisible: true,
                      position: { latitude: userCoords.latitude, longitude: userCoords.longitude },
                      bearing: typeof userHeadingDeg === 'number' ? userHeadingDeg : 0,
                      circleRadius: 22,
                      circleColor: 'rgba(0,82,204,0.14)',
                      circleOutlineWidth: 1,
                      circleOutlineColor: 'rgba(0,82,204,0.18)',
                    }
                  : { isVisible: false }
              }
              onCameraChanged={({ zoom, reason }) => {
                if (typeof zoom === 'number' && Number.isFinite(zoom)) setNaverZoom(zoom);
                // 마커 탭/프로그램 이동(Developer/Control/Location)까지 제스처로 오인하면
                // 바텀시트가 "올라왔다가 바로 사라지는" 문제가 생깁니다.
                if (reason === 'Gesture') onUserMapGesture();
              }}
              onCameraIdle={({ region }) => onRegionChangeComplete(naverRegionToCenter(region))}
              onTapMap={onMapPress}
              onTapClusterLeaf={({ markerIdentifier }) => {
                const m = meetingsOnMap.find((x) => x.id === markerIdentifier);
                if (m) onPeopleMarkerPress(m);
              }}
              isShowZoomControls={false}
              isShowCompass={false}
              isShowScaleBar={false}
              isShowLocationButton={false}
              isExtentBoundedInKorea
              locale="ko"
              isUseTextureViewAndroid
              clusters={
                naverUseClusters && naverClusterMarkers.length > 0
                  ? [
                      {
                        markers: naverClusterMarkers,
                        animate: true,
                        screenDistance: 48,
                        minZoom: 0,
                        maxZoom: NAVER_CLUSTER_MAX_ZOOM,
                        width: 44,
                        height: 44,
                      },
                    ]
                  : []
              }
              accessibilityLabel="모임 지도 (네이버맵)">
              {/*
               * 줌 아웃: SDK `clusters`로 동그라미+개수. 줌 인: `NaverMapMarkerOverlay`로 기본 핀+caption(이모지).
               * 클러스터 leaf에는 caption API가 없어, 멀리서는 숫자 묶음만 보이는 것이 정상입니다.
               */}
              {naverUseClusters
                ? null
                : mapMarkerRenderItems.map((item) => {
                if (item.kind === 'single') {
                  const m = item.meeting;
                  const selected = m.id === selectedMeetingId;
                  const c = mapMarkerCoordsByMeetingId.get(m.id) ?? {
                    latitude: m.latitude as number,
                    longitude: m.longitude as number,
                  };
                  const pinColor = getMeetingMapPinAccentColor(m, categories);
                  const emoji = categoryEmojiForMeeting(m, categories);
                  return (
                    <NaverMapMarkerOverlay
                      key={item.key}
                      latitude={c.latitude}
                      longitude={c.longitude}
                      width={56}
                      height={60}
                      anchor={{ x: 0.5, y: 1 }}
                      zIndex={selected ? 1200 : 600}
                      onTap={() => onPeopleMarkerPress(m)}>
                      <View
                        key={`${m.id}:${pinColor}:${emoji}`}
                        pointerEvents="none"
                        collapsable={false}
                        style={styles.naverMeetingPinRoot}>
                        <MaterialCommunityIcons
                          name="map-marker"
                          size={60}
                          color={pinColor}
                          style={styles.naverMeetingPinGlyph}
                        />
                        <View style={styles.naverMeetingPinEmojiDisc} collapsable={false}>
                          <Text style={styles.naverMeetingPinEmojiText} allowFontScaling={false}>
                            {emoji}
                          </Text>
                        </View>
                      </View>
                    </NaverMapMarkerOverlay>
                  );
                }
                const lead = item.lead;
                const stackSelected = item.meetings.some((x) => x.id === selectedMeetingId);
                const c = mapMarkerCoordsByMeetingId.get(lead.id) ?? {
                  latitude: lead.latitude as number,
                  longitude: lead.longitude as number,
                };
                const stackEmoji = categoryEmojiForMeeting(lead, categories);
                const stackPinColor = getMeetingMapPinAccentColor(lead, categories);
                return (
                  <NaverMapMarkerOverlay
                    key={item.key}
                    latitude={c.latitude}
                    longitude={c.longitude}
                    width={56}
                    height={60}
                    anchor={{ x: 0.5, y: 1 }}
                    zIndex={stackSelected ? 1200 : 600}
                    onTap={() => onPeopleMarkerPress(lead)}>
                    <View
                      key={`${lead.id}:stack:${stackPinColor}:${stackEmoji}:${item.count}`}
                      pointerEvents="none"
                      collapsable={false}
                      style={styles.naverMeetingPinRoot}>
                      <MaterialCommunityIcons
                        name="map-marker"
                        size={60}
                        color={stackPinColor}
                        style={styles.naverMeetingPinGlyph}
                      />
                      <View style={styles.naverMeetingPinEmojiDiscStack} collapsable={false}>
                        <Text style={styles.naverMeetingPinEmojiTextStack} allowFontScaling={false}>
                          {stackEmoji}
                        </Text>
                        <Text style={styles.naverMeetingPinStackCountText} allowFontScaling={false}>
                          {item.count}
                        </Text>
                      </View>
                    </View>
                  </NaverMapMarkerOverlay>
                );
              })}

            </NaverMapView>
          ) : (
            <MapView
              ref={mapRef}
              style={StyleSheet.absoluteFillObject}
              provider={undefined}
              initialRegion={lastCompleteRegionRef.current ?? initialMapRegion}
              onPanDrag={onUserMapGesture}
              onRegionChangeComplete={onRegionChangeComplete}
              onPress={onMapPress}
              // 클러스터 탭 시 spiderfier(방사형 펼침)
              onClusterPress={onClusterPress}
              clusteringEnabled={clusteringEnabled}
              spiralEnabled={false}
              clusterColor={GinitTheme.colors.primary}
              clusterTextColor="#FFFFFF"
              minPoints={2}
              radius={Dimensions.get('window').width * 0.08}
              accessibilityLabel="모임 지도">
              {mapMarkerRenderItems.map((item) => {
                if (item.kind === 'single') {
                  const m = item.meeting;
                  const selected = m.id === selectedMeetingId;
                  const coord = mapMarkerCoordsByMeetingId.get(m.id) ?? {
                    latitude: m.latitude as number,
                    longitude: m.longitude as number,
                  };
                  const iosPinAccent = getMeetingMapPinAccentColor(m, categories);
                  return (
                    <Marker
                      key={item.key}
                      identifier={m.id}
                      coordinate={coord}
                      anchor={{ x: 0.5, y: 0.5 }}
                      tracksViewChanges={false}
                      onPress={(e) => {
                        (e as any)?.stopPropagation?.();
                        onPeopleMarkerPress(m);
                      }}
                      zIndex={selected ? 1200 : 600}>
                      <View
                        pointerEvents="none"
                        collapsable={false}
                        style={[styles.mapCategoryEmojiMarker, { borderColor: iosPinAccent }]}>
                        <Text style={styles.mapCategoryEmojiMarkerText} allowFontScaling={false}>
                          {categoryEmojiForMeeting(m, categories)}
                        </Text>
                      </View>
                    </Marker>
                  );
                }
                const lead = item.lead;
                const stackSelected = item.meetings.some((x) => x.id === selectedMeetingId);
                const coord = mapMarkerCoordsByMeetingId.get(lead.id) ?? {
                  latitude: lead.latitude as number,
                  longitude: lead.longitude as number,
                };
                const iosStackAccent = getMeetingMapPinAccentColor(lead, categories);
                return (
                  <Marker
                    key={item.key}
                    identifier={lead.id}
                    coordinate={coord}
                    tracksViewChanges={false}
                    anchor={{ x: 0.5, y: 0.5 }}
                    onPress={(e) => {
                      (e as any)?.stopPropagation?.();
                      onPeopleMarkerPress(lead);
                    }}
                    zIndex={stackSelected ? 1200 : 600}>
                    <View
                      style={[
                        styles.mapStackCountBubble,
                        { backgroundColor: iosStackAccent, borderColor: GinitTheme.colors.surfaceStrong },
                      ]}
                      collapsable={false}>
                      <Text style={styles.mapStackCountBubbleEmoji} allowFontScaling={false}>
                        {categoryEmojiForMeeting(lead, categories)}
                      </Text>
                      <Text style={styles.mapStackCountBubbleText}>{item.count}</Text>
                    </View>
                  </Marker>
                );
              })}

              {userCoords ? (
                <AnyMarker
                  key="user-location"
                  coordinate={{ latitude: userCoords.latitude, longitude: userCoords.longitude }}
                  anchor={{ x: 0.5, y: 0.5 }}
                  // react-native-map-clustering에서 내 위치가 클러스터에 포함되지 않도록
                  cluster={false}
                  tracksViewChanges={false}>
                  <View pointerEvents="none" collapsable={false} style={styles.userMarkerWrap}>
                    <View style={styles.userAccuracyHalo} />
                    <View style={styles.userDotOuter}>
                      <View style={styles.userDotInner} />
                    </View>
                    {typeof userHeadingDeg === 'number' ? (
                      <View
                        style={[
                          styles.userHeadingCone,
                          { transform: [{ rotate: `${userHeadingDeg}deg` }] },
                        ]}
                      />
                    ) : null}
                  </View>
                </AnyMarker>
              ) : null}
            </MapView>
          )
        ) : (
          <View style={[StyleSheet.absoluteFillObject, styles.mapPausedFill]} pointerEvents="none" />
        )}

        {mapMovedSinceSearch && (hasPendingRescan || driftTooFar) ? (
          <View style={[styles.rescanWrap, { top: rescanTop }]} pointerEvents="box-none">
            <Pressable onPress={onPressRescanThisArea} style={({ pressed }) => [styles.rescanBtn, pressed && { opacity: 0.9 }]} accessibilityRole="button" accessibilityLabel="이 지역 재검색">
              <GinitSymbolicIcon name="refresh" size={18} color="#fff" />
              <Text style={styles.rescanBtnText}>이 지역 재검색</Text>
            </Pressable>
          </View>
        ) : null}

        {/* Layer 1 — 상단: 지역명 · 카테고리 칩 · 검색 */}
        <View style={[styles.layerTop, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
          <BlurView intensity={0} tint="light" style={styles.topGlass}>
            <View style={styles.topGlassInner}>
              <Pressable
                onPress={openMapCategoryBarModal}
                style={({ pressed }) => [
                  styles.topChip,
                  mapCategoryBarFilterActive && styles.topChipActive,
                  { flexShrink: 0 },
                  pressed && { opacity: 0.88 },
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: mapCategoryBarFilterActive }}
                accessibilityLabel="상단에 표시할 카테고리 설정">
                <GinitSymbolicIcon
                  name="settings-outline"
                  size={20}
                  color={mapCategoryBarFilterActive ? '#ffffff' : '#475569'}
                />
              </Pressable>
              <View style={styles.chipScrollWrap}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chipRow}
                  style={styles.chipScroll}
                  onLayout={onMapCategoryChipsLayout}
                  onContentSizeChange={(w) => onMapCategoryChipsContentSizeChange(w)}
                  onScroll={onMapCategoryChipsScroll}
                  scrollEventThrottle={32}
                  onScrollBeginDrag={() => setMapMovedSinceSearch(true)}>
                  {mapCategoryChips.map((chip) => {
                    const active = chip.filterId === selectedCategoryId;
                    return (
                      <Pressable
                        key={chip.filterId ?? 'all'}
                        onPress={() => setSelectedCategoryId(chip.filterId)}
                        style={[styles.topChip, active && styles.topChipActive]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}>
                        <Text style={[styles.topChipLabel, active && styles.topChipLabelActive]} numberOfLines={1}>
                          {chip.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
                {showMapCategoryChipsScrollMore ? (
                  <View
                    pointerEvents="none"
                    style={styles.chipScrollMoreCue}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants">
                    <LinearGradient
                      colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.88)']}
                      locations={[0.15, 1]}
                      start={{ x: 0, y: 0.5 }}
                      end={{ x: 1, y: 0.5 }}
                      style={StyleSheet.absoluteFillObject}
                    />
                    <Feather name="chevron-right" size={18} color="#64748b" style={styles.chipScrollMoreIcon} />
                  </View>
                ) : null}
              </View>
            </View>
          </BlurView>
        </View>

        {/* Layer 2 — 우측 컨트롤 (모임추가/검색/내위치): 바텀 시트 위에 항상 위치 */}
        <Animated.View
          style={[styles.mapControlsRight, { bottom: sheetMiniPeekHeight + 12 }, controlsLiftStyle]}
          pointerEvents="box-none">
          <Pressable
            onPress={onPressCreateFab}
            style={({ pressed }) => [styles.roundMapBtn, pressed && { opacity: 0.9 }]}
            accessibilityRole="button"
            accessibilityLabel="약속 잡기">
            <GinitSymbolicIcon name="add" size={22} color={GinitTheme.colors.deepPurple} />
          </Pressable>
          <Pressable
            onPress={() => setMapSearchOpen(true)}
            style={({ pressed }) => [styles.roundMapBtn, pressed && { opacity: 0.9 }]}
            accessibilityRole="button"
            accessibilityLabel="검색">
            <GinitSymbolicIcon name="search" size={22} color={GinitTheme.colors.deepPurple} />
          </Pressable>
          <Pressable
            onPress={onPressMyLocation}
            style={({ pressed }) => [styles.roundMapBtn, pressed && { opacity: 0.9 }]}
            accessibilityRole="button"
            accessibilityLabel="내 위치로 이동">
            <GinitSymbolicIcon name="locate" size={22} color={GinitTheme.colors.deepPurple} />
          </Pressable>
        </Animated.View>
      </View>

      {/* Layer 3 — 바텀시트: 기본은 핸들만 살짝, 선택 시 요약 카드 노출 */}
      <Animated.View
        style={[
          styles.sheet,
          { height: sheetPeekHeight, paddingBottom: Math.max(insets.bottom, 10) },
          sheetRevealStyle,
        ]}>
        <GestureDetector gesture={sheetHandlePanGesture}>
          <View style={styles.sheetHandleHit} accessibilityRole="adjustable" accessibilityLabel="모임 요약 패널">
            <View style={styles.sheetHandle} />
          </View>
        </GestureDetector>

        {sheetMeetings.length > 0 ? (
          <Animated.View style={sheetContentStyle}>
            <FlatList
              key="selected-carousel"
              ref={carouselRef}
              data={sheetMeetings}
              keyExtractor={(m) => m.id}
              horizontal
              pagingEnabled
              disableIntervalMomentum
              showsHorizontalScrollIndicator={false}
              snapToInterval={carouselWidth}
              decelerationRate="fast"
              contentContainerStyle={{ paddingRight: 0 }}
              // 상세 텍스트가 길어도 충분히 보이도록 카드 표시 높이 상한을 확대합니다(피크에서 CTA 분리만큼 상한 축소).
              style={{ maxHeight: LIST_CARD_HEIGHT + 220 - SHEET_CTA_BLOCK_HEIGHT_PX }}
              getItemLayout={(_, index) => ({
                length: carouselWidth,
                offset: carouselWidth * index,
                index,
              })}
              onViewableItemsChanged={onSelectedViewable}
              onScrollBeginDrag={onSheetCarouselBeginDrag}
              onMomentumScrollEnd={onSheetCarouselMomentumEnd}
              viewabilityConfig={{ itemVisiblePercentThreshold: 55 }}
              renderItem={({ item }) => <View style={{ width: carouselWidth }}>{renderSheetMeetingText({ item })}</View>}
            />

            {sheetMeetings.length > 1 ? (
              <View style={styles.pageDots} pointerEvents="none">
                {sheetMeetings.map((_, i) => (
                  <View
                    key={`dot-${i}`}
                    style={[styles.pageDot, i === selectedMeetingIndex && styles.pageDotActive]}
                  />
                ))}
              </View>
            ) : null}

            <Pressable
              onPress={() => {
                const m = sheetMeetings[selectedMeetingIndex];
                if (!m?.id) return;
                setSelectedMeetingId(m.id);
                router.push(`/meeting/${m.id}`);
              }}
              style={({ pressed }) => [styles.sheetCta, pressed && { opacity: 0.92 }]}
              accessibilityRole="button"
              accessibilityLabel="모임 상세 보기">
              <Text style={styles.sheetCtaText}>모임 상세 보기</Text>
            </Pressable>
          </Animated.View>
        ) : null}

        {/* 모임 호출/재호출 중: 스플래시(스피너)만 표시 (시트는 유지) */}
        {showSheetSplash ? (
          <View style={styles.sheetSplash} pointerEvents="box-none">
            <ActivityIndicator color={GinitTheme.colors.primary} />
          </View>
        ) : sheetMeetings.length === 0 ? (
          <Animated.View style={[sheetContentStyle, styles.sheetEmptyWrap]}>
            <Text style={styles.sheetEmptyGuide}>
              {feedSearchFiltersActive(mapSearchFilters)
                ? `지금 조회 중인 지도 영역에는 모임이 없습니다.\n검색 필터를 바꿔 보시겠어요?`
                : '등록된 모임이 없습니다.\n+ 버튼으로 첫 모임을 만들어 보세요.'}
            </Text>
            <Pressable
              onPress={onPressCreateFab}
              style={({ pressed }) => [styles.sheetCta, pressed && { opacity: 0.92 }]}
              accessibilityRole="button"
              accessibilityLabel="모임 만들기">
              <Text style={styles.sheetCtaText}>모임 만들기</Text>
            </Pressable>
          </Animated.View>
        ) : null}
      </Animated.View>

      <Modal
        visible={mapCategoryBarModalOpen}
        animationType="fade"
        transparent
        onRequestClose={closeMapCategoryBarModal}>
        <View style={styles.modalRoot}>
          <Pressable
            style={StyleSheet.absoluteFillObject}
            onPress={closeMapCategoryBarModal}
            accessibilityRole="button"
            accessibilityLabel="카테고리 표시 설정 닫기"
          />
          <View
            style={[styles.modalCard, { maxHeight: mapCategoryBarModalCardMaxH, overflow: 'hidden' }]}>
            <Text style={styles.modalTitle}>상단 카테고리</Text>
            <Text style={styles.modalHint}>
              지도 위 가로 칩에 나올 카테고리만 골라요. «전체»는 항상 맨 앞에 있어요. 카테고리와 «당일 모임만 보기»는 «저장»할 때
              반영돼요.
            </Text>
            <View style={styles.mapCategoryBarModalDivider} />
            <Pressable
              onPress={toggleCategoryBarSelectAll}
              style={({ pressed }) => [
                styles.mapCategoryBarModalRow,
                pressed && styles.modalRowPressed,
              ]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: categoryBarSelectAllChecked }}
              accessibilityLabel="모든 카테고리 표시">
              <Text style={styles.modalRowLabel}>모두 표시</Text>
              {categoryBarSelectAllChecked ? (
                <GinitSymbolicIcon name="checkmark-circle" size={22} color={GinitTheme.themeMainColor} />
              ) : (
                <GinitSymbolicIcon name="ellipse-outline" size={22} color="#cbd5e1" />
              )}
            </Pressable>
            <View style={styles.mapCategoryBarModalDivider} />
            <View style={styles.categoryBarModalScrollWrap}>
              <ScrollView
                ref={categoryBarModalCategoryListScrollRef}
                style={[styles.categoryBarModalScroll, { maxHeight: mapCategoryBarModalCategoryListMaxH }]}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                nestedScrollEnabled
                scrollEventThrottle={16}
                onLayout={(e) => {
                  categoryBarModalListLayHRef.current = e.nativeEvent.layout.height;
                  syncCategoryBarModalListMoreBelow();
                }}
                onContentSizeChange={(_, h) => {
                  categoryBarModalListContHRef.current = h;
                  syncCategoryBarModalListMoreBelow();
                }}
                onScroll={(e) => {
                  categoryBarModalListScrollYRef.current = e.nativeEvent.contentOffset.y;
                  syncCategoryBarModalListMoreBelow();
                }}>
                {sortedMapCategoryMaster.map((c) => {
                  const on = categoryBarDraft.includes(c.id);
                  return (
                    <Pressable
                      key={c.id}
                      onPress={() => toggleCategoryBarDraft(c.id)}
                      style={({ pressed }) => [
                        styles.mapCategoryBarModalRow,
                        pressed && styles.modalRowPressed,
                      ]}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}>
                      <View style={styles.mapCategoryBarModalCategoryNameRow}>
                        <Text style={styles.mapCategoryBarModalCategoryEmoji} allowFontScaling={false}>
                          {c.emoji}
                        </Text>
                        <Text
                          style={[styles.modalRowLabel, styles.mapCategoryBarModalCategoryLabel]}
                          numberOfLines={1}>
                          {c.label}
                        </Text>
                      </View>
                      {on ? (
                        <GinitSymbolicIcon name="checkmark-circle" size={22} color={GinitTheme.themeMainColor} />
                      ) : (
                        <GinitSymbolicIcon name="ellipse-outline" size={22} color="#cbd5e1" />
                      )}
                    </Pressable>
                  );
                })}
              </ScrollView>
              {categoryBarModalListShowMoreBelow ? (
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
            <Pressable
              onPress={() => setCategoryBarTodayOnlyDraft((v) => !v)}
              style={({ pressed }) => [
                styles.mapCategoryBarModalRow,
                styles.mapCategoryBarModalRowTall,
                pressed && styles.modalRowPressed,
              ]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: categoryBarTodayOnlyDraft }}
              accessibilityLabel="당일 모임만 보기">
              <View style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                <Text style={styles.modalRowLabel}>당일 모임만 보기</Text>
                <Text style={styles.mapCategoryBarModalSubHint} numberOfLines={2}>
                  한국 기준 오늘 날짜로 잡힌 일정만 지도·목록에 표시합니다.
                </Text>
              </View>
              <View style={styles.mapCategoryBarModalCheckCol}>
                {categoryBarTodayOnlyDraft ? (
                  <GinitSymbolicIcon name="checkmark-circle" size={22} color={GinitTheme.themeMainColor} />
                ) : (
                  <GinitSymbolicIcon name="ellipse-outline" size={22} color="#cbd5e1" />
                )}
              </View>
            </Pressable>
            <View style={styles.categoryBarModalActions}>
              <Pressable
                onPress={closeMapCategoryBarModal}
                style={({ pressed }) => [styles.categoryBarActionGhost, pressed && { opacity: 0.85 }]}
                accessibilityRole="button">
                <Text style={styles.categoryBarActionGhostLabel}>취소</Text>
              </Pressable>
              <Pressable
                onPress={() => void saveMapCategoryBarModal()}
                style={({ pressed }) => [styles.categoryBarActionPrimary, pressed && { opacity: 0.9 }]}
                accessibilityRole="button">
                <Text style={styles.modalCloseLabel}>저장</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={sortFilterModalOpen} animationType="fade" transparent onRequestClose={closeSortFilterModal}>
        <View style={styles.modalRoot}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={closeSortFilterModal} accessibilityRole="button" accessibilityLabel="정렬 닫기" />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>정렬</Text>
            <Text style={styles.modalHint}>목록을 어떤 순서로 보여줄지 선택하세요.</Text>
            {(['distance', 'latest', 'soon'] as const).map((mode) => {
              const selected = listSortMode === mode;
              const label = listSortModeLabel(mode);
              return (
                <Pressable
                  key={mode}
                  onPress={() => {
                    setListSortMode(mode);
                    closeSortFilterModal();
                  }}
                  style={({ pressed }) => [styles.modalRow, pressed && styles.modalRowPressed]}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}>
                  <Text style={styles.modalRowLabel}>{label}</Text>
                  {selected ? <GinitSymbolicIcon name="checkmark-circle" size={22} color={GinitTheme.themeMainColor} /> : <GinitSymbolicIcon name="ellipse-outline" size={22} color="#cbd5e1" />}
                </Pressable>
              );
            })}
            <Pressable onPress={closeSortFilterModal} style={styles.modalCloseBtn} accessibilityRole="button">
              <Text style={styles.modalCloseLabel}>닫기</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <FeedSearchFilterModal
        visible={mapSearchOpen}
        filters={mapSearchFilters}
        onChangeFilters={setMapSearchFilters}
        onClose={() => setMapSearchOpen(false)}
        onApply={() => setMapSearchOpen(false)}
      />
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#e2e8f0',
  },
  mapWrap: {
    flex: 1,
    minHeight: 120,
  },
  /** 지도 비포커스 시 자리만 유지(모임 상세 등 스택 위에 있을 때) */
  mapPausedFill: {
    backgroundColor: '#e2e8f0',
  },
  layerTop: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 40,
  },
  topGlass: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  topGlassInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  /** ScrollView는 자식 클리핑을 위해 부모에 라운딩 + overflow 권장(Android 포함) */
  chipScrollWrap: {
    flex: 1,
    minWidth: 0,
    position: 'relative',
    borderRadius: 999,
    overflow: 'hidden',
  },
  chipScroll: {
    flex: 1,
    maxHeight: 40,
  },
  chipScrollMoreCue: {
    position: 'absolute',
    right: 2,
    top: 2,
    bottom: 2,
    width: 38,
    borderRadius: 999,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'flex-end',
    paddingRight: 4,
  },
  chipScrollMoreIcon: {
    zIndex: 1,
  },
  chipRow: {
    alignItems: 'center',
    gap: 8,
    paddingRight: 4,
  },
  topChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.75)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.34)',
  },
  topChipActive: {
    backgroundColor: GinitTheme.themeMainColor,
    borderColor: GinitTheme.themeMainColor,
  },
  topChipLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#475569',
  },
  topChipLabelActive: {
    color: '#fff',
  },
  // 검색 버튼은 우측 `roundMapBtn` 스타일을 재사용합니다.
  rescanWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 18,
  },
  rescanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: GinitTheme.colors.primary,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  rescanBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  mapControlsRight: {
    position: 'absolute',
    right: 16,
    zIndex: 80,
    elevation: 80,
    gap: 10,
  },
  roundMapBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 3,
  },
  // fab(약속 잡기) 버튼은 `roundMapBtn` 스타일을 재사용합니다.
  userDotOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,82,204,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  userDotInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: GinitTheme.themeMainColor,
    borderWidth: 2,
    borderColor: '#fff',
  },
  userMarkerWrap: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  userAccuracyHalo: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,82,204,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(0,82,204,0.18)',
  },
  userHeadingCone: {
    position: 'absolute',
    width: 0,
    height: 0,
    borderLeftWidth: 16,
    borderRightWidth: 16,
    borderBottomWidth: 36,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: 'rgba(0,82,204,0.24)',
    top: -18,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 45,
    backgroundColor: '#f8fafc',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    overflow: 'hidden',
    paddingHorizontal: 16,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.06)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 12,
  },
  sheetHandleHit: {
    alignSelf: 'stretch',
    paddingTop: 4,
    paddingBottom: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(15, 23, 42, 0.15)',
    marginBottom: 6,
  },
  sheetToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    marginBottom: 8,
  },
  recruitTogglePill: {
    flexShrink: 0,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
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
  sortComboTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: 200,
    minWidth: 108,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.12)',
  },
  sortComboTriggerPressed: {
    borderColor: 'rgba(0, 82, 204, 0.25)',
  },
  sortComboTriggerText: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  sheetLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  muted: {
    fontSize: 13,
    color: '#64748b',
  },
  sheetError: {
    fontSize: 13,
    color: '#b91c1c',
    marginBottom: 8,
  },
  sheetEmpty: {
    fontSize: 13,
    color: '#64748b',
    marginBottom: 8,
    lineHeight: 18,
  },
  boundsHint: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
    marginBottom: 8,
  },
  listScroll: {
    flex: 1,
  },
  listScrollContent: {
    paddingBottom: 12,
  },
  carouselCard: {
    flexDirection: 'row',
    height: LIST_CARD_HEIGHT,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 10,
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.06)',
  },
  carouselCardSelected: {
    borderColor: GinitTheme.themeMainColor,
    backgroundColor: 'rgba(0, 82, 204, 0.04)',
  },
  listCard: {
    flexDirection: 'row',
    height: LIST_CARD_HEIGHT,
    marginBottom: LIST_CARD_GAP,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 10,
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.06)',
  },
  listCardSelected: {
    borderColor: GinitTheme.themeMainColor,
    backgroundColor: 'rgba(0, 82, 204, 0.04)',
  },
  listThumb: {
    width: 64,
    height: 64,
    borderRadius: 12,
    backgroundColor: '#e2e8f0',
  },
  listCardBody: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  listTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  listTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.2,
    lineHeight: 20,
    color: GinitTheme.colors.text,
  },
  listTitleCategory: {
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: -0.15,
    color: '#64748b',
  },
  listMeta: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
  },
  listFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  listDist: {
    fontSize: 13,
    fontWeight: '600',
    color: GinitTheme.themeMainColor,
  },
  joinBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: GinitTheme.themeMainColor,
  },
  joinBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
  },
  progressBadge: {
    flexShrink: 0,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    marginRight: 10,
  },
  progressBadgeGreen: { backgroundColor: '#16A34A' },
  progressBadgeYellow: { backgroundColor: '#FACC15' },
  progressBadgeBlack: { backgroundColor: '#171717' },
  progressBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
  },
  progressBadgeTextLight: { color: '#fff' },
  progressBadgeTextOnYellow: { color: '#422006' },
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
    marginBottom: 0,
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
  /** 상단 카테고리 설정 모달만: 구분선 없음·행 간격 살짝 넓힘 */
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
  modalRowPressed: {
    backgroundColor: 'rgba(0, 82, 204, 0.06)',
  },
  modalRowLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0f172a',
  },
  mapCategoryBarModalCategoryNameRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
    marginRight: 8,
  },
  mapCategoryBarModalCategoryEmoji: {
    fontSize: 18,
    lineHeight: 22,
  },
  mapCategoryBarModalCategoryLabel: {
    flexShrink: 1,
  },
  mapCategoryBarModalSubHint: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    color: '#64748b',
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
  mapBoot: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#e2e8f0',
  },
  mapBootText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748b',
  },

  pageDots: {
    marginTop: 18,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  pageDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(100, 116, 139, 0.35)',
  },
  pageDotActive: {
    width: 16,
    backgroundColor: GinitTheme.colors.primary,
  },

  sheetSplash: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(248, 250, 252, 0.65)',
  },
  sheetEmptyWrap: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 4,
    alignItems: 'stretch',
  },
  sheetEmptyGuide: {
    fontSize: 15,
    fontWeight: '700',
    color: '#475569',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 12,
  },

  sheetCta: {
    marginTop: 8,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: GinitTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetCtaText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
    letterSpacing: -0.2,
  },

  sheetInfoWrap: {
    paddingTop: 6,
    paddingBottom: 10,
  },
  sheetInfoWrapSelected: {
    opacity: 1,
  },
  sheetInfoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sheetInfoTitle: {
    fontSize: 19,
    fontWeight: '600',
    color: '#0f172a',
    letterSpacing: -0.2,
  },
  // sheetMetaBlock/sheetMetaRow/sheetMetaLine: (제목 아래 메타 배치 롤백으로 미사용)
  // sheetInfoSubtitle: (카테고리를 제목 옆으로 이동하면서 미사용)
  sheetBadgesRow: {
    marginTop: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  sheetBadgeCol: {
    alignItems: 'flex-end',
  },
  // sheetBadgeSubRow/sheetBadgeSubText: (모집 배지 아래 거리 표기 롤백으로 미사용)
  detailChipScroll: {
    marginTop: 10,
  },
  detailChipScrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: 12,
  },
  detailChip: {
    flexShrink: 0,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(15, 23, 42, 0.04)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.08)',
  },
  detailChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0f172a',
  },
  sheetMiniBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.08)',
  },
  sheetMiniBadgeIcon: { marginRight: 6 },
  sheetMiniBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0f172a',
  },
  sheetFacts: {
    marginTop: 12,
    gap: 8,
  },
  sheetMovePinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.08)',
  },
  sheetMovePinInlineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 30,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(15, 23, 42, 0.04)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.06)',
  },
  sheetMovePinCol: {
    alignItems: 'flex-end',
    gap: 4,
  },
  sheetMovePinInlineText: {
    fontSize: 12,
    fontWeight: '600',
    color: GinitTheme.colors.primary,
    letterSpacing: -0.1,
  },
  sheetMovePinDistanceText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
  },
  sheetMovePinText: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: '600',
    color: '#0f172a',
    letterSpacing: -0.1,
  },
  sheetFactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sheetFactRowLocation: {
    alignItems: 'flex-start',
    minHeight: 40,
    paddingVertical: 2,
  },
  sheetFactText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 10,
    paddingTop: 2,
    paddingBottom: 2,
    color: '#334155',
    ...Platform.select({
      android: {
        includeFontPadding: true,
      },
      default: {},
    }),
  },
  sheetFactSubText: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
    color: '#64748b',
  },
  participantRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
  },
  // participantStack/participantBubble: (참여자 왼쪽 동그라미 제거)
  participantText: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
  },
  sheetInfoDesc: {
    marginTop: 12,
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
    lineHeight: 20,
  },
  /** Android 네이버: MCI 핀 + 흰 원(이모지) — 핀 머리(상단 둥근 부분) 안에 맞춤 */
  naverMeetingPinRoot: {
    width: 56,
    height: 60,
    position: 'relative',
  },
  naverMeetingPinGlyph: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: 0,
    zIndex: 0,
  },
  naverMeetingPinEmojiDisc: {
    position: 'absolute',
    top: 8,
    alignSelf: 'center',
    width: 28,
    height: 28,
    marginLeft: 4,
    borderRadius: 12,
    backgroundColor: GinitTheme.colors.surfaceStrong,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  naverMeetingPinEmojiDiscStack: {
    position: 'absolute',
    top: 8,
    alignSelf: 'center',
    width: 29,
    height: 29,
    borderRadius: 14,
    marginLeft: 4,
    backgroundColor: GinitTheme.colors.surfaceStrong,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  naverMeetingPinEmojiText: {
    fontSize: 14,
    lineHeight: 16,
    textAlign: 'center',
    ...Platform.select({
      android: { includeFontPadding: false },
      default: {},
    }),
  },
  naverMeetingPinEmojiTextStack: {
    fontSize: 12,
    lineHeight: 14,
    textAlign: 'center',
    ...Platform.select({
      android: { includeFontPadding: false },
      default: {},
    }),
  },
  naverMeetingPinStackCountText: {
    fontSize: 11,
    fontWeight: '700',
    color: GinitTheme.colors.text,
    marginTop: -2,
  },
  mapCategoryEmojiMarker: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: GinitTheme.colors.surfaceStrong,
    borderWidth: 2,
    borderColor: GinitTheme.colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: 'rgba(15, 23, 42, 0.28)',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 1,
    shadowRadius: 10,
    elevation: 8,
  },
  mapCategoryEmojiMarkerText: {
    fontSize: 20,
    lineHeight: 24,
    textAlign: 'center',
    ...Platform.select({
      android: { includeFontPadding: false },
      default: {},
    }),
  },
  mapStackCountBubble: {
    minWidth: 44,
    height: 44,
    paddingHorizontal: 8,
    borderRadius: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: GinitTheme.colors.primary,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  mapStackCountBubbleEmoji: {
    fontSize: 18,
    lineHeight: 22,
  },
  mapStackCountBubbleText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#FFFFFF',
  },

});
