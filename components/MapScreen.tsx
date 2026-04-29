import { Ionicons } from '@expo/vector-icons';
import {
  NaverMapMarkerOverlay,
  NaverMapView,
  type ClusterMarkerProp,
  type NaverMapViewRef,
  type Region as NaverRegion,
} from '@mj-studio/react-native-naver-map';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  InteractionManager,
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  UIManager,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent
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
import { GinitTheme } from '@/constants/ginit-theme';
import { useAppPolicies } from '@/src/context/AppPoliciesContext';
import { useFirestoreMeetingPatchesByIds } from '@/src/hooks/useFirestoreMeetingPatchesByIds';
import { useUnmountCleanup } from '@/src/hooks/useUnmountCleanup';
import { getPolicyNumeric } from '@/src/lib/app-policies-store';
import type { Category } from '@/src/lib/categories';
import { subscribeCategories } from '@/src/lib/categories';
import {
  FEED_LOCATION_FALLBACK_SHORT,
  normalizeFeedRegionLabel,
  resolveFeedLocationContext,
} from '@/src/lib/feed-display-location';
import { loadFeedLocationCache, saveFeedLocationCache } from '@/src/lib/feed-location-cache';
import {
  buildMapCategoryChips,
  defaultFeedSearchFilters,
  listSortModeLabel,
  meetingMatchesCategoryFilter,
  meetingMatchesFeedSearch,
  sortMeetingsForFeed,
  type FeedSearchFilters,
  type MeetingListSortMode,
} from '@/src/lib/feed-meeting-utils';
import { formatDistanceForList, haversineDistanceMeters, meetingDistanceMetersFromUser, type LatLng } from '@/src/lib/geo-distance';
import { meetingListSource } from '@/src/lib/hybrid-data-source';
import { MAP_AVATAR_CLUSTERING_MAX_DELTA } from '@/src/lib/map-people-markers';
import { resolveMeetingListThumbnailUri } from '@/src/lib/meeting-list-thumbnail';
import { setPendingMeetingPlace } from '@/src/lib/meeting-place-bridge';
import type { Meeting, MeetingRecruitmentPhase } from '@/src/lib/meetings';
import {
  formatPublicMeetingAgeSummary,
  formatPublicMeetingApprovalSummary,
  formatPublicMeetingGenderSummary,
  formatPublicMeetingSettlementSummary,
  getMeetingRecruitmentPhase,
  MEETING_CAPACITY_UNLIMITED,
  meetingCategoryDisplayLabel,
  meetingParticipantCount,
  parsePublicMeetingDetailsConfig,
} from '@/src/lib/meetings';
import { subscribeMeetingsHybrid } from '@/src/lib/meetings-hybrid';
import { centerRegionToNaverRegion } from '@/src/lib/naver-map-region';
import { applyNearbySearchBiasFromMapNavigation } from '@/src/lib/nearby-search-bias';
import { fetchMeetingsWithinRadiusFromSupabase } from '@/src/lib/supabase-meetings-geo-search';
import { getUserProfilesForIds } from '@/src/lib/user-profile';

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
const MARKER_DARK_NAVY = '#0B1220';

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

// 초기 화면에서 보이는 “내 주변” 줌(표시 반경). 검색 반경(mapRadiusKm)과 분리합니다.
const INITIAL_VIEW_RADIUS_KM = 0.5;

// Android(NaverMap): 이 줌 레벨보다 낮으면 “숫자 클러스터”, 높으면 “아바타 마커” 표시
const NAVER_CLUSTER_MAX_ZOOM = 15;

const OVERLAP_DECIMALS = 4;
function overlapKey(lat: number, lng: number): string {
  return `${lat.toFixed(OVERLAP_DECIMALS)},${lng.toFixed(OVERLAP_DECIMALS)}`;
}

const MOCK_REGION_ROWS = [
  { id: 'gangnam', label: '강남구' },
  { id: 'mapo', label: '마포구' },
  { id: 'songpa', label: '송파구' },
  { id: 'ydp', label: '영등포구' },
] as const;

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

function markerPinColor(m: Meeting): string {
  return MARKER_DARK_NAVY;
}

function markerSymbol(m: Meeting): 'blue' | 'red' {
  // Android(Naver) 기본 심볼 마커는 상태(모집중/마감/확정)와 무관하게
  // 탭 컬러(네이비 톤)에 맞춰 통일합니다.
  return 'blue';
}

function regionCenteredOnUserRadius(lat: number, lng: number, radiusKm: number): Region {
  const radiusM = radiusKm * 1000;
  const metersPerDegLat = 111320;
  const dLat = Math.min(0.42, (radiusM * 2.25) / metersPerDegLat);
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const dLng = Math.min(0.48, dLat / Math.max(0.22, Math.abs(cosLat)));
  return { latitude: lat, longitude: lng, latitudeDelta: dLat, longitudeDelta: dLng };
}

function centerLatForBetweenTopAndBottom(targetLat: number, baseDeltaLat: number, topInsetPx: number, bottomSheetPx: number) {
  const bottomFrac = Math.max(0, Math.min(0.9, bottomSheetPx / Math.max(1, WINDOW_H)));
  const topOverlayPx = Math.max(0, topInsetPx) + 8 + 60; // 카테고리 글래스 바 영역(대략)
  const topFrac = Math.max(0, Math.min(0.4, topOverlayPx / Math.max(1, WINDOW_H)));
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
  const insets = useSafeAreaInsets();
  const { addCleanup } = useUnmountCleanup();
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
  const lastCompleteRegionRef = useRef<Region | null>(null);

  const sheetExpandedPx = useMemo(() => Math.min(520, Math.round(WINDOW_H * 0.58)), []);
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
  // 바텀시트는 로딩 전엔 "닫힌(아래 가려진)" 상태로 시작하고, 로딩 완료되면 펼쳐집니다.
  const sheetShown = useSharedValue(0);
  const sheetBoot = useSharedValue(1);
  const carouselDragStartIndexRef = useRef(0);
  const followSelectedRef = useRef(true);
  const programmaticCameraRef = useRef(false);
  const lastMarkerTapAtRef = useRef(0);

  const enableFollowSelected = useCallback(() => {
    followSelectedRef.current = true;
  }, []);

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
    closeSheet();
  }, [closeSheet]);

  const hideSheetForFreePan = useCallback(() => {
    followSelectedRef.current = false;
    closeSheet();
  }, [closeSheet]);

  const sheetPeekHeight = useMemo(
    () => {
      // 화면의 2/5 높이까지 올려서 “요약 패널”로 고정
      const h = Math.round(WINDOW_H * 0.4);
      return Math.max(220, h);
    },
    [insets.bottom],
  );

  // 닫힌 상태에서는 "핸들바만" 보이게 (내용이 잘려 보이지 않도록)
  const sheetMiniPeekHeight = useMemo(() => 28, []);

  const sheetRevealStyle = useAnimatedStyle(() => ({
    // 기본은 핸들바만 보이게(닫힘). 로딩 완료 시 sheetShown=1로 펼쳐집니다.
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
    [dragStartShown, liftDelta, sheetShown, enableFollowSelected],
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
    [sheetCollapsedPx, sheetExpandedPx, dragStartHeight, sheetHeight, setSheetExpandedJS],
  );

  const [regionLabel, setRegionLabel] = useState(FEED_LOCATION_FALLBACK_SHORT);
  const regionLabelRef = useRef(FEED_LOCATION_FALLBACK_SHORT);
  const manualRegionPickRef = useRef(false);
  const userCoordsRef = useRef<LatLng | null>(null);
  const [regionModalOpen, setRegionModalOpen] = useState(false);
  const [sortFilterModalOpen, setSortFilterModalOpen] = useState(false);
  const [mapSearchOpen, setMapSearchOpen] = useState(false);
  const [mapSearchFilters, setMapSearchFilters] = useState<FeedSearchFilters>(defaultFeedSearchFilters());
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [userCoords, setUserCoords] = useState<LatLng | null>(null);
  const [userHeadingDeg, setUserHeadingDeg] = useState<number | null>(null);
  const [genderByUserId, setGenderByUserId] = useState<Map<string, string>>(new Map());
  const [listSortMode, setListSortMode] = useState<MeetingListSortMode>('latest');
  const [recruitingOnly, setRecruitingOnly] = useState(true);
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);

  const [categories, setCategories] = useState<Category[]>([]);
  const [hybridMeetings, setHybridMeetings] = useState<Meeting[]>([]);
  const [rpcMeetings, setRpcMeetings] = useState<Meeting[]>([]);
  const [meetingsBooted, setMeetingsBooted] = useState(false);
  const [searchAnchor, setSearchAnchor] = useState<LatLng | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [driftTooFar, setDriftTooFar] = useState(false);
  const [listingRegion, setListingRegion] = useState<Region | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [zoomDeltaForClustering, setZoomDeltaForClustering] = useState(0.14);
  const [naverZoom, setNaverZoom] = useState<number>(16);

  const isMeetingsReady = meetingsBooted && !geoLoading;
  const hasAutoOpenedAfterReadyRef = useRef(false);
  useEffect(() => {
    // 첫 진입: 바텀시트는 기본적으로 닫힌(핸들만) 상태로 유지합니다.
    // 모임 로딩/재검색 중에는 시트를 자동으로 열지 않고, 열려있다면 스플래시로 로딩을 표현합니다.
    if (isMeetingsReady && !hasAutoOpenedAfterReadyRef.current) {
      hasAutoOpenedAfterReadyRef.current = true;
      openSheet();
    }
  }, [isMeetingsReady, openSheet]);

  const showSheetSplash = !meetingsBooted || geoLoading;

  const { version: appPoliciesVersion } = useAppPolicies();
  const mapRadiusKm = useMemo(() => {
    const raw = getPolicyNumeric('meeting', 'map_radius_km', 3);
    return Math.max(0.5, Math.min(80, raw));
  }, [appPoliciesVersion]);

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
      debouncedDriftCheck(r);
      debouncedListingRegionSet(r);
      debouncedZoomClustering(r);
    },
    [debouncedDriftCheck, debouncedListingRegionSet, debouncedZoomClustering],
  );

  useEffect(() => {
    regionLabelRef.current = regionLabel;
  }, [regionLabel]);

  useEffect(() => {
    userCoordsRef.current = userCoords;
  }, [userCoords]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await loadFeedLocationCache();
      if (cancelled) return;

      let coordsForDistance = null as LatLng | null;
      if (cached?.coords) {
        coordsForDistance = cached.coords;
        setUserCoords(coordsForDistance);
      }

      const ctx = await resolveFeedLocationContext();
      if (cancelled) return;

      const actualNorm = normalizeFeedRegionLabel(ctx.labelShort);
      const cachedLabel = cached?.label ?? '';
      const persistManual = Boolean(cached?.manualRegionPicked && cachedLabel.trim());

      if (persistManual) {
        manualRegionPickRef.current = true;
        setRegionLabel(normalizeFeedRegionLabel(cachedLabel));
      } else {
        manualRegionPickRef.current = false;
        setRegionLabel(actualNorm);
      }

      coordsForDistance = ctx.coords ?? coordsForDistance;
      setUserCoords(coordsForDistance);

      const labelToSave = persistManual ? normalizeFeedRegionLabel(cachedLabel) : actualNorm;
      await saveFeedLocationCache(labelToSave, coordsForDistance, { manualRegion: persistManual });

      if (coordsForDistance && !searchAnchor) {
        setSearchAnchor(coordsForDistance);
        setListingRegion(regionCenteredOnUserRadius(coordsForDistance.latitude, coordsForDistance.longitude, mapRadiusKm));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 초기 앵커만
  }, []);

  useEffect(() => {
    let posSub: Location.LocationSubscription | null = null;
    let headSub: Location.LocationSubscription | null = null;
    let cancelled = false;
    (async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (cancelled || perm.status !== 'granted') return;
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
    if (!searchAnchor) return;
    let alive = true;
    setGeoLoading(true);
    setGeoError(null);
    void (async () => {
      const res = await fetchMeetingsWithinRadiusFromSupabase(
        searchAnchor.latitude,
        searchAnchor.longitude,
        mapRadiusKm,
        selectedCategoryId,
      );
      if (!alive) return;
      setGeoLoading(false);
      if (res.ok) {
        setRpcMeetings(res.meetings);
        setDriftTooFar(false);
      } else {
        setGeoError(res.message);
        setRpcMeetings([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [searchAnchor, mapRadiusKm, selectedCategoryId]);

  useEffect(() => {
    setDriftTooFar(false);
  }, [searchAnchor]);

  useEffect(() => {
    if (!isSheetExpanded) return;
    const r = lastCompleteRegionRef.current;
    if (r) setListingRegion(r);
  }, [isSheetExpanded]);

  const hybridNearby = useMemo(() => {
    if (!searchAnchor) return [];
    const maxM = mapRadiusKm * 1000;
    return hybridMeetings.filter((m) => {
      const d = meetingDistanceMetersFromUser(m, searchAnchor);
      return d != null && d <= maxM;
    });
  }, [hybridMeetings, searchAnchor, mapRadiusKm]);

  const mergedMeetingsBase = useMemo(() => {
    const mapById = new Map<string, Meeting>();
    for (const m of rpcMeetings) mapById.set(m.id, m);
    for (const m of hybridNearby) mapById.set(m.id, m);
    return [...mapById.values()];
  }, [rpcMeetings, hybridNearby]);

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
      if (!meetingMatchesCategoryFilter(m, selectedCategoryId, categories)) return false;
      if (recruitingOnly && getMeetingRecruitmentPhase(m) !== 'recruiting') return false;
      return true;
    });
  }, [textFilteredMeetings, selectedCategoryId, categories, recruitingOnly]);

  const sortedFilteredMeetings = useMemo(
    () => sortMeetingsForFeed(filteredMeetings, listSortMode, searchAnchor ?? userCoords),
    [filteredMeetings, listSortMode, searchAnchor, userCoords],
  );

  const hadMeetingsOutsideRadius = Boolean(
    searchAnchor && filteredMeetings.length === 0 && hybridMeetings.length > 0 && rpcMeetings.length === 0 && !geoLoading,
  );

  const meetingsOnMap = useMemo(
    () =>
      sortedFilteredMeetings.filter(
        (m) =>
          typeof m.latitude === 'number' &&
          typeof m.longitude === 'number' &&
          Number.isFinite(m.latitude) &&
          Number.isFinite(m.longitude),
      ),
    [sortedFilteredMeetings],
  );

  const naverClusterMarkers: ClusterMarkerProp[] = useMemo(
    () =>
      meetingsOnMap.map((m) => ({
        identifier: m.id,
        latitude: m.latitude as number,
        longitude: m.longitude as number,
      })),
    [meetingsOnMap],
  );

  const naverUseClusters = Platform.OS === 'android' && naverZoom <= NAVER_CLUSTER_MAX_ZOOM;

  // (겹침(spider) 확장 기능 제거됨)

  // (겹침(동일 좌표) 그룹 선택 UI 제거됨 — 바텀시트는 현재 화면 내 전체 모임을 보여줍니다.)

  const boundsMeetings = useMemo(() => {
    if (!isSheetExpanded || !listingRegion) return sortedFilteredMeetings;
    return sortedFilteredMeetings.filter((m) => meetingInBounds(m, listingRegion));
  }, [sortedFilteredMeetings, isSheetExpanded, listingRegion]);

  const sheetMeetings = useMemo(() => {
    const district = (regionLabel ?? '').trim();
    const useDistrict = district !== '' && /구$/.test(district);

    const list = useDistrict
      ? sortedFilteredMeetings.filter((m) => {
          const hay = `${m.address ?? ''} ${m.location ?? ''} ${m.placeName ?? ''}`.replace(/\s+/g, ' ').trim();
          return hay.includes(district);
        })
      : (() => {
          const r = listingRegion ?? lastCompleteRegionRef.current;
          if (!r) return [];
          return sortedFilteredMeetings.filter((m) => meetingInBounds(m, r));
        })();

    const anchor = searchAnchor ?? userCoords;
    list.sort((a, b) => {
      const da = meetingDistanceMetersFromUser(a, anchor) ?? Number.POSITIVE_INFINITY;
      const db = meetingDistanceMetersFromUser(b, anchor) ?? Number.POSITIVE_INFINITY;
      return da - db;
    });
    return list;
  }, [sortedFilteredMeetings, listingRegion, regionLabel, searchAnchor, userCoords]);

  const initialMapRegion = useMemo(() => {
    if (searchAnchor) {
      const base = regionCenteredOnUserRadius(searchAnchor.latitude, searchAnchor.longitude, INITIAL_VIEW_RADIUS_KM);
      return {
        ...base,
        latitude: centerLatForBetweenTopAndBottom(
          searchAnchor.latitude,
          base.latitudeDelta,
          insets.top ?? 0,
          sheetPeekHeight,
        ),
      };
    }
    if (userCoords) {
      const base = regionCenteredOnUserRadius(userCoords.latitude, userCoords.longitude, INITIAL_VIEW_RADIUS_KM);
      return {
        ...base,
        latitude: centerLatForBetweenTopAndBottom(
          userCoords.latitude,
          base.latitudeDelta,
          insets.top ?? 0,
          sheetPeekHeight,
        ),
      };
    }
    return regionCenteredOnUserRadius(37.5665, 126.978, mapRadiusKm);
  }, [searchAnchor, userCoords, mapRadiusKm, insets.top, sheetPeekHeight]);

  const initialRegionReady = Boolean(searchAnchor ?? userCoords);

  const mapCategoryChips = useMemo(() => buildMapCategoryChips(categories), [categories]);

  const openRegionModal = useCallback(() => setRegionModalOpen(true), []);
  const closeRegionModal = useCallback(() => setRegionModalOpen(false), []);
  const pickRegion = useCallback((shortLabel: string) => {
    const norm = normalizeFeedRegionLabel(shortLabel);
    manualRegionPickRef.current = true;
    regionLabelRef.current = norm;
    setRegionLabel(norm);
    setRegionModalOpen(false);
    void saveFeedLocationCache(norm, userCoordsRef.current, { manualRegion: true });
  }, []);

  const openSortFilterModal = useCallback(() => setSortFilterModalOpen(true), []);
  const closeSortFilterModal = useCallback(() => setSortFilterModalOpen(false), []);

  const sortComboLabel = useMemo(() => listSortModeLabel(listSortMode), [listSortMode]);

  const onPressRescanThisArea = useCallback(() => {
    const r = lastCompleteRegionRef.current;
    if (!r) return;
    const next: LatLng = { latitude: r.latitude, longitude: r.longitude };
    setSearchAnchor(next);
    setListingRegion(r);
    setDriftTooFar(false);
    try {
      mapRef.current?.animateToRegion(r, 420);
    } catch {
      /* ignore */
    }
  }, []);

  const onPressMyLocation = useCallback(() => {
    const u = userCoordsRef.current;
    if (!u) return;
    // 내 위치로 가기: 바텀시트는 가리고, 지도는 자유 이동 모드로 전환
    hideSheetForFreePan();
    // "내 위치로 이동"은 줌(델타)을 유지하고 중심만 내 위치로 맞춥니다.
    // (초기 반경 0.5km로 region을 재설정하면 바텀시트 목록이 0개로 떨어져 빈 박스로 보일 수 있음)
    const base = lastCompleteRegionRef.current ?? listingRegion ?? initialMapRegion;
    const r: Region = {
      latitude: u.latitude,
      longitude: u.longitude,
      latitudeDelta: base.latitudeDelta,
      longitudeDelta: base.longitudeDelta,
    };
    lastCompleteRegionRef.current = r;
    setSearchAnchor(u);
    setListingRegion(r);
    setDriftTooFar(false);
    try {
      if (Platform.OS === 'android') {
        naverMapRef.current?.animateCameraTo({
          latitude: r.latitude,
          longitude: r.longitude,
          zoom: naverZoom,
          duration: 520,
          easing: 'EaseIn',
        });
      } else {
        mapRef.current?.animateToRegion(r, 450);
      }
    } catch {
      /* ignore */
    }
  }, [hideSheetForFreePan, initialMapRegion, listingRegion, naverZoom]);

  const onPressCreateFab = useCallback(() => {
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
  }, [router, listingRegion, initialMapRegion]);

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
    (meetingId: string) => {
      const idx = sortedFilteredMeetings.findIndex((m) => m.id === meetingId);
      if (idx < 0) return;
      const lead = 10;
      smoothScrollListToY(idx * LIST_ITEM_STRIDE - lead);
    },
    [sortedFilteredMeetings, smoothScrollListToY],
  );

  const scrollCarouselToMeetingId = useCallback(
    (meetingId: string) => {
      const idx = sheetMeetings.findIndex((m) => m.id === meetingId);
      if (idx < 0 || !carouselRef.current) return;
      try {
        carouselRef.current.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 });
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
      setSelectedMeetingId(meetingId);
      if (scrollAfterInteractionTimeoutRef.current != null) {
        clearTimeout(scrollAfterInteractionTimeoutRef.current);
        scrollAfterInteractionTimeoutRef.current = null;
      }
      if (scrollAfterInteractionCancelRef.current) {
        scrollAfterInteractionCancelRef.current();
        scrollAfterInteractionCancelRef.current = null;
      }
      const handle = InteractionManager.runAfterInteractions(() => {
        scrollAfterInteractionTimeoutRef.current = setTimeout(() => {
          scrollAfterInteractionTimeoutRef.current = null;
          scrollListToMeetingId(meetingId);
          scrollCarouselToMeetingId(meetingId);
        }, 56);
      });
      scrollAfterInteractionCancelRef.current = typeof handle?.cancel === 'function' ? () => handle.cancel() : null;
    },
    [scrollListToMeetingId, scrollCarouselToMeetingId],
  );

  const onPeopleMarkerPress = useCallback(
    (m: Meeting) => {
      lastMarkerTapAtRef.current = Date.now();
      setSelectedMeetingIndex(0);
      onMeetingMarkerPress(m.id);
      followSelectedRef.current = true;
      openSheet();
    },
    [onMeetingMarkerPress, openSheet],
  );

  const onMapPress = useCallback(() => {
    setSelectedMeetingId(null);
    setSelectedMeetingIndex(0);
    onUserMapGesture();
  }, [onUserMapGesture]);

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
    const lat = m?.latitude;
    const lng = m?.longitude;
    if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
    if (!followSelectedRef.current) return;

    // 바텀시트가 화면 하단을 가리므로, 마커가 화면 "상단 3/5"의 중앙에 오도록
    // 지도 센터를 약간 남쪽(= latitude 감소)으로 보정합니다.
    const base = lastCompleteRegionRef.current ?? initialMapRegion;
    const bottomFrac = Math.max(0, Math.min(0.9, sheetPeekHeight / Math.max(1, WINDOW_H)));
    // 상단 카테고리 메뉴(글래스 바) 높이까지 고려해서,
    // "상단 메뉴 하단 ~ 바텀시트 상단" 영역의 중앙에 마커가 오도록 보정합니다.
    const topOverlayPx = (insets.top ?? 0) + 8 + 60; // layerTop paddingTop + (대략) 글래스 바 높이
    const topFrac = Math.max(0, Math.min(0.4, topOverlayPx / Math.max(1, WINDOW_H)));
    const availableTop = topFrac;
    const availableBottom = 1 - bottomFrac;
    const desiredY = (availableTop + availableBottom) / 2; // 0..1, 화면 위=0
    const yShiftFrac = 0.5 - desiredY;
    const centerLat = lat - base.latitudeDelta * yShiftFrac;

    // iOS(MapView): 카드가 바뀌면 해당 마커로 센터 이동
    if (Platform.OS !== 'android') {
      try {
        programmaticCameraRef.current = true;
        const r: Region = {
          latitude: centerLat,
          longitude: lng,
          latitudeDelta: base.latitudeDelta,
          longitudeDelta: base.longitudeDelta,
        };
        mapRef.current?.animateToRegion(r, 420);
        setTimeout(() => {
          programmaticCameraRef.current = false;
        }, 520);
      } catch {
        /* ignore */
      }
      return;
    }

    // Android(Naver): 카드가 바뀌면 해당 마커로 센터 이동
    try {
      programmaticCameraRef.current = true;
      naverMapRef.current?.animateCameraTo({
        latitude: centerLat,
        longitude: lng,
        zoom: naverZoom,
        duration: 520,
        easing: 'EaseIn',
      });
      setTimeout(() => {
        programmaticCameraRef.current = false;
      }, 680);
    } catch {
      /* ignore */
    }
  }, [sheetMeetings, selectedMeetingIndex, naverZoom, initialMapRegion, sheetPeekHeight, insets.top]);

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
              <Text style={styles.listDist}>{formatDistanceForList(meetingDistanceMetersFromUser(m, searchAnchor ?? userCoords))}</Text>
              <View style={styles.joinBtn}>
                <Text style={styles.joinBtnText}>참가 신청</Text>
              </View>
            </View>
          </View>
        </Pressable>
      );
    },
    [router, categories, selectedMeetingId, searchAnchor, userCoords],
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
        <Pressable
          onPress={() => {
            setSelectedMeetingId(m.id);
            router.push(`/meeting/${m.id}`);
          }}
          style={[styles.sheetInfoWrap, selected && styles.sheetInfoWrapSelected]}
          accessibilityRole="button">
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
              <Ionicons
                name={m.isPublic === false ? 'lock-closed-outline' : 'globe-outline'}
                size={14}
                color={GinitTheme.colors.primary}
                style={styles.sheetMiniBadgeIcon}
              />
              <Text style={styles.sheetMiniBadgeText}>{publicText}</Text>
            </View>
            {capText ? (
              <View style={styles.sheetMiniBadge}>
                <Ionicons
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

          {/* 조건 칩(배열) — 인원 조건 + 상세 조건을 이어서 나열 */}
          {detailChips.length > 0 ? (
            <View style={styles.detailChipRow}>
              {detailChips.map((t) => (
                <View key={t} style={styles.detailChip}>
                  <Text style={styles.detailChipText} numberOfLines={1}>
                    {t}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          {/* 상세 팩트 영역 (옮기기 전 레이아웃로 롤백) */}
          <View style={styles.sheetFacts}>
            <View style={styles.sheetFactRow}>
              <Ionicons name="location-outline" size={16} color="#64748b" />
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
            </View>

            <View style={styles.sheetFactRow}>
              <Ionicons name="time-outline" size={16} color="#64748b" />
              <Text style={styles.sheetFactText} numberOfLines={1}>
                {scheduleText}
              </Text>
            </View>

            <View style={styles.sheetFactRow}>
              <Ionicons name="people-outline" size={16} color="#64748b" />
              <View style={styles.participantRow}>
                <Text style={styles.participantText} numberOfLines={1} ellipsizeMode="tail">
                  {participantCount > 0
                    ? `지금 참여자 ${participantCount}명 (${genderCountText})`
                    : `참여자 없음 (${genderCountText})`}
                </Text>
              </View>
            </View>

            <View style={styles.sheetFactRow}>
              <Ionicons name="navigate-outline" size={16} color="#64748b" />
              <Text style={styles.sheetFactText} numberOfLines={1}>
                {formatDistanceForList(meetingDistanceMetersFromUser(m, searchAnchor ?? userCoords))}
              </Text>
            </View>
          </View>

          {/* 모임 설명 숨김 */}
        </Pressable>
      );
    },
    [router, categories, selectedMeetingId, searchAnchor, userCoords],
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
              <Text style={styles.listDist}>{formatDistanceForList(meetingDistanceMetersFromUser(m, searchAnchor ?? userCoords))}</Text>
              <View style={styles.joinBtn}>
                <Text style={styles.joinBtnText}>참가 신청</Text>
              </View>
            </View>
          </View>
        </Pressable>
      );
    },
    [router, categories, selectedMeetingId, searchAnchor, userCoords],
  );

  const carouselWidth = useMemo(() => Dimensions.get('window').width - 32, []);

  const rescanTop = useMemo(
    () => Math.max(insets.top + 56, Math.round(WINDOW_H * 0.12)),
    [insets.top],
  );

  return (
    <GestureHandlerRootView style={styles.root}>
      <View style={styles.mapWrap}>
        {initialRegionReady ? (
          Platform.OS === 'android' ? (
            <NaverMapView
              ref={naverMapRef}
              style={StyleSheet.absoluteFillObject}
              initialRegion={centerRegionToNaverRegion(initialMapRegion)}
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
              onInitialized={() => setMapReady(true)}
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
              {naverUseClusters
                ? null
                : meetingsOnMap.map((m) => {
                const selected = m.id === selectedMeetingId;
                const lat = m.latitude as number;
                const lng = m.longitude as number;
                return (
                  <NaverMapMarkerOverlay
                    key={m.id}
                    latitude={lat}
                    longitude={lng}
                    image={{}}
                    onTap={() => onPeopleMarkerPress(m)}>
                    <View pointerEvents="none" collapsable={false} style={styles.naverDarkNavyMarker} />
                  </NaverMapMarkerOverlay>
                );
              })}

            </NaverMapView>
          ) : (
            <MapView
              ref={mapRef}
              style={StyleSheet.absoluteFillObject}
              provider={undefined}
              initialRegion={initialMapRegion}
              onMapLoaded={() => setMapReady(true)}
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
              {meetingsOnMap.map((m) => {
                const selected = m.id === selectedMeetingId;
                return (
                  <Marker
                    key={m.id}
                    identifier={m.id}
                    coordinate={{ latitude: m.latitude as number, longitude: m.longitude as number }}
                    tracksViewChanges={false}
                    onPress={(e) => {
                      // Marker press가 MapView onPress로 버블링되어 시트가 닫히는 케이스 방지
                      (e as any)?.stopPropagation?.();
                      onPeopleMarkerPress(m);
                    }}
                    pinColor={markerPinColor(m)}
                    zIndex={selected ? 1200 : 600}>
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
          <View style={styles.mapBoot}>
            <ActivityIndicator />
            <Text style={styles.mapBootText}>내 주변 불러오는 중…</Text>
          </View>
        )}

        {driftTooFar && mapReady ? (
          <View style={[styles.rescanWrap, { top: rescanTop }]} pointerEvents="box-none">
            <Pressable onPress={onPressRescanThisArea} style={({ pressed }) => [styles.rescanBtn, pressed && { opacity: 0.9 }]} accessibilityRole="button" accessibilityLabel="이 지역 재검색">
              <Ionicons name="refresh" size={18} color="#fff" />
              <Text style={styles.rescanBtnText}>이 지역 재검색</Text>
            </Pressable>
          </View>
        ) : null}

        {/* Layer 1 — 상단: 지역명 · 카테고리 칩 · 검색 */}
        <View style={[styles.layerTop, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
          <BlurView intensity={42} tint="light" style={styles.topGlass}>
            <View style={styles.topGlassInner}>
              {/* 지역 표시기(상단 pill) 숨김 */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow} style={styles.chipScroll}>
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
            <Ionicons name="add" size={24} color="#0f172a" />
          </Pressable>
          <Pressable
            onPress={() => setMapSearchOpen(true)}
            style={({ pressed }) => [styles.roundMapBtn, pressed && { opacity: 0.9 }]}
            accessibilityRole="button"
            accessibilityLabel="검색">
            <Ionicons name="search" size={22} color="#0f172a" />
          </Pressable>
          <Pressable
            onPress={onPressMyLocation}
            style={({ pressed }) => [styles.roundMapBtn, pressed && { opacity: 0.9 }]}
            accessibilityRole="button"
            accessibilityLabel="내 위치로 이동">
            <Ionicons name="locate" size={22} color="#0f172a" />
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
              // 내용이 잘리지 않도록 높이 제한을 두지 않습니다.
              style={{ maxHeight: LIST_CARD_HEIGHT + 110 }}
              //style={{ flexGrow: 0 }}
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

        {/* 모임 호출/재호출 중: 스플래시로 표현 (시트는 유지) */}
        {showSheetSplash ? (
          <View style={styles.sheetSplash} pointerEvents="none">
            <View style={styles.sheetSplashCard}>
              <ActivityIndicator />
              <Text style={styles.sheetSplashText}>모임 불러오는 중…</Text>
            </View>
          </View>
        ) : null}
      </Animated.View>

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
                  {selected ? <Ionicons name="checkmark-circle" size={22} color={GinitTheme.trustBlue} /> : <Ionicons name="ellipse-outline" size={22} color="#cbd5e1" />}
                </Pressable>
              );
            })}
            <Pressable onPress={closeSortFilterModal} style={styles.modalCloseBtn} accessibilityRole="button">
              <Text style={styles.modalCloseLabel}>닫기</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={regionModalOpen} animationType="fade" transparent onRequestClose={closeRegionModal}>
        <View style={styles.modalRoot}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={closeRegionModal} accessibilityRole="button" accessibilityLabel="지역 설정 닫기" />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>지역 설정</Text>
            <Text style={styles.modalHint}>동네를 선택하면 검색·지도 기준이 바뀌어요.</Text>
            {MOCK_REGION_ROWS.map((row) => (
              <Pressable
                key={row.id}
                onPress={() => pickRegion(row.label)}
                style={({ pressed }) => [styles.modalRow, pressed && styles.modalRowPressed]}
                accessibilityRole="button">
                <Text style={styles.modalRowLabel}>{row.label}</Text>
                {regionLabel === row.label ? <Ionicons name="checkmark-circle" size={22} color={GinitTheme.trustBlue} /> : <Ionicons name="chevron-forward" size={20} color="#94a3b8" />}
              </Pressable>
            ))}
            <Pressable onPress={closeRegionModal} style={styles.modalCloseBtn} accessibilityRole="button">
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
    borderColor: 'rgba(15, 23, 42, 0.08)',
  },
  topGlassInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  regionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: 120,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
  regionPillText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '800',
    color: GinitTheme.colors.text,
  },
  chipScroll: {
    flex: 1,
    maxHeight: 40,
  },
  chipRow: {
    alignItems: 'center',
    gap: 8,
    paddingRight: 4,
  },
  topChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.75)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.1)',
  },
  topChipActive: {
    backgroundColor: GinitTheme.trustBlue,
    borderColor: GinitTheme.trustBlue,
  },
  topChipLabel: {
    fontSize: 12,
    fontWeight: '800',
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
    fontWeight: '800',
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
    backgroundColor: GinitTheme.trustBlue,
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
    borderColor: GinitTheme.trustBlue,
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
    borderColor: GinitTheme.trustBlue,
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
    fontWeight: '900',
    letterSpacing: -0.2,
    lineHeight: 20,
    color: GinitTheme.colors.text,
  },
  listTitleCategory: {
    fontSize: 14,
    fontWeight: '800',
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
    fontWeight: '800',
    color: GinitTheme.trustBlue,
  },
  joinBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: GinitTheme.trustBlue,
  },
  joinBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#fff',
  },
  progressBadge: {
    flexShrink: 0,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  progressBadgeGreen: { backgroundColor: '#16A34A' },
  progressBadgeYellow: { backgroundColor: '#FACC15' },
  progressBadgeBlack: { backgroundColor: '#171717' },
  progressBadgeText: {
    fontSize: 10,
    fontWeight: '800',
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
  sheetSplashCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.08)',
  },
  sheetSplashText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#334155',
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
    fontWeight: '900',
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
    fontWeight: '900',
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
  detailChipRow: {
    marginTop: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  detailChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(15, 23, 42, 0.04)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.08)',
  },
  detailChipText: {
    fontSize: 12,
    fontWeight: '800',
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
    fontWeight: '800',
    color: '#0f172a',
  },
  sheetFacts: {
    marginTop: 12,
    gap: 8,
  },
  sheetFactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sheetFactText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
  },
  sheetFactSubText: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '600',
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
    fontWeight: '800',
    color: '#334155',
  },
  sheetInfoDesc: {
    marginTop: 12,
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
    lineHeight: 20,
  },
  naverDarkNavyMarker: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: MARKER_DARK_NAVY,
    borderWidth: 2,
    borderColor: '#fff',
    shadowColor: 'rgba(15, 23, 42, 0.28)',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 1,
    shadowRadius: 10,
    elevation: 8,
  },

});
