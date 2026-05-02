import { LinearGradient } from 'expo-linear-gradient';
import {
  Fragment,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Dimensions,
  findNodeHandle,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
  type ViewStyle,
} from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NaverPlaceWebViewModal } from '@/components/NaverPlaceWebViewModal';
import { GinitTheme } from '@/constants/ginit-theme';
import { layoutAnimateEaseInEaseOut } from '@/src/lib/android-layout-animation';
import { deferSoftInputUntilUserTapProps } from '@/src/lib/defer-soft-input-until-user-tap';
import { haversineDistanceMeters, type LatLng } from '@/src/lib/geo-distance';
import type { PlaceCandidate } from '@/src/lib/meeting-place-bridge';
import {
  resolvePlaceSearchRowCoordinates,
  searchPlacesText,
  type PlaceSearchRow,
} from '@/src/lib/google-places-text-search';
import {
  resolveNaverPlaceDetailWebUrlLikeVoteChip,
  sanitizeNaverLocalPlaceLink,
} from '@/src/lib/naver-local-search';
import { ensureNearbySearchBias } from '@/src/lib/nearby-search-bias';

import { INPUT_PLACEHOLDER, wizardSpecialtyStyles as S } from './wizard-specialty-styles';

function measureHostInWindow(
  scrollHost: unknown,
  anchorWindowY: number,
  pad: number,
  callback: (x: number, y: number, w: number, h: number) => void,
): void {
  if (scrollHost == null) return;
  const host = scrollHost as {
    measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void;
  };
  if (typeof host.measureInWindow === 'function') {
    host.measureInWindow(callback);
    return;
  }
  const tag = findNodeHandle(scrollHost as never);
  if (tag != null && typeof UIManager.measureInWindow === 'function') {
    UIManager.measureInWindow(tag, callback);
    return;
  }
  callback(0, anchorWindowY - pad, Dimensions.get('window').width, Dimensions.get('window').height);
}

type ScrollHost = {
  scrollToPosition?: (x: number, y: number, animated?: boolean) => void;
  scrollTo?: (opts: { x?: number; y?: number; animated?: boolean }) => void;
  getScrollResponder?: () =>
    | {
        scrollTo?: (opts: { x?: number; y?: number; animated?: boolean }) => void;
        scrollResponderScrollTo?: (opts: { x: number; y: number; animated: boolean }) => void;
      }
    | null
    | undefined;
};

function scrollParentToY(scrollHost: unknown, y: number, animated: boolean): void {
  if (scrollHost == null) return;
  const clamped = Math.max(0, y);
  const h = scrollHost as ScrollHost;
  if (typeof h.scrollToPosition === 'function') {
    h.scrollToPosition(0, clamped, animated);
    return;
  }
  if (typeof h.scrollTo === 'function') {
    h.scrollTo({ x: 0, y: clamped, animated });
    return;
  }
  if (typeof h.getScrollResponder === 'function') {
    const r = h.getScrollResponder();
    if (r && typeof r.scrollResponderScrollTo === 'function') {
      r.scrollResponderScrollTo({ x: 0, y: clamped, animated });
      return;
    }
    if (r && typeof r.scrollTo === 'function') {
      r.scrollTo({ x: 0, y: clamped, animated });
    }
  }
}

const WEB_SCROLLBAR_CLASS = 'ginit-early-place-nested-scroll';
const WEB_SCROLLBAR_STYLE_ID = 'ginit-early-place-nested-scroll-style';

/** 내 주변 영화관 전용 스크롤 영역 최대 높이 */
const CINEMA_SCROLL_MAX = 168;
/** details 플로팅「n개의 장소로 일정 정하기」+ 여백(대략) */
const FLOATING_CTA_RESERVE = 100;
/** Google Places Text Search — 첫 페이지·추가 로드 모두 5건 */
const PLACE_PAGE = 5;

/** 영화 카테고리: 상단 시드(서울 일대 예시 좌표) */
const NEARBY_CINEMA_SEEDS: PlaceCandidate[] = [
  {
    id: 'seed-cgv-gangnam',
    placeName: 'CGV 강남',
    address: '서울 강남구 강남대로 422',
    latitude: 37.5011,
    longitude: 127.0264,
  },
  {
    id: 'seed-megabox-coex',
    placeName: '메가박스 코엑스',
    address: '서울 강남구 영동대로 513',
    latitude: 37.5128,
    longitude: 127.0582,
  },
  {
    id: 'seed-lotte-worldtower',
    placeName: '롯데시네마 월드타워',
    address: '서울 송파구 올림픽로 300',
    latitude: 37.5133,
    longitude: 127.1028,
  },
  {
    id: 'seed-cgv-yongsan',
    placeName: 'CGV 용산아이파크몰',
    address: '서울 용산구 한강대로23길 55',
    latitude: 37.5298,
    longitude: 126.9642,
  },
  {
    id: 'seed-megabox-ddm',
    placeName: '메가박스 동대문',
    address: '서울 중구 장동 432-1',
    latitude: 37.5664,
    longitude: 127.0075,
  },
];

function newPlaceId() {
  return `place-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export type EarlyPlaceSearchProps = {
  value: PlaceCandidate[];
  onChange: (next: PlaceCandidate[]) => void;
  showCinemaPicks?: boolean;
  disabled?: boolean;
  /** `ScrollView` 또는 `KeyboardAwareScrollView` 등 */
  parentScrollRef?: RefObject<ScrollView | null> | RefObject<unknown>;
  parentScrollYRef?: RefObject<number>;
};

export function EarlyPlaceSearch({
  value,
  onChange,
  showCinemaPicks = false,
  disabled,
  parentScrollRef,
  parentScrollYRef,
}: EarlyPlaceSearchProps) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [addingMore, setAddingMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<PlaceSearchRow[]>([]);
  const [rowsNextPageToken, setRowsNextPageToken] = useState<string | null>(null);
  const [rowsLoadingMore, setRowsLoadingMore] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const rowsSearchQueryKeyRef = useRef('');
  const rowsLoadMoreGuardRef = useRef(false);
  /** GPS 확보 시 영화관 시드 정렬·검색 재실행용 */
  const [userCoords, setUserCoords] = useState<LatLng | null>(null);
  const [nearbyHint, setNearbyHint] = useState<string | null>(null);
  const [locationReady, setLocationReady] = useState(false);
  const [naverPlaceWebModal, setNaverPlaceWebModal] = useState<{ url: string; title: string } | null>(null);
  const expandedPickerRef = useRef<View>(null);
  const earlyPlaceQueryInputRef = useRef<TextInput>(null);
  const earlyPlaceQueryDeferKb = useMemo(() => deferSoftInputUntilUserTapProps(earlyPlaceQueryInputRef), []);

  /** 웹: 얇은 Trust Blue 톤 스크롤바 (::webkit-scrollbar) */
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return undefined;
    if (document.getElementById(WEB_SCROLLBAR_STYLE_ID)) return undefined;
    const thumb = GinitTheme.colors.ctaGradient[1];
    const el = document.createElement('style');
    el.id = WEB_SCROLLBAR_STYLE_ID;
    el.textContent = `
      .${WEB_SCROLLBAR_CLASS}::-webkit-scrollbar { width: 4px; }
      .${WEB_SCROLLBAR_CLASS}::-webkit-scrollbar-track {
        background: rgba(15, 23, 42, 0.25);
        border-radius: 4px;
      }
      .${WEB_SCROLLBAR_CLASS}::-webkit-scrollbar-thumb {
        background: ${thumb};
        border-radius: 4px;
      }
    `;
    document.head.appendChild(el);
    return undefined;
  }, []);

  useEffect(() => {
    if (value.length === 0) setAddingMore(false);
  }, [value.length]);

  useEffect(() => {
    let cancelled = false;
    void ensureNearbySearchBias().then(({ bias, coords }) => {
      if (cancelled) return;
      setUserCoords(coords);
      setNearbyHint(bias);
      setLocationReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const cinemaSeedsOrdered = useMemo(() => {
    if (!userCoords) return [...NEARBY_CINEMA_SEEDS];
    return [...NEARBY_CINEMA_SEEDS].sort((a, b) => {
      const da = haversineDistanceMeters(userCoords, { latitude: a.latitude, longitude: a.longitude });
      const db = haversineDistanceMeters(userCoords, { latitude: b.latitude, longitude: b.longitude });
      if (da !== db) return da - db;
      return a.placeName.localeCompare(b.placeName, 'ko');
    });
  }, [userCoords]);

  useEffect(() => {
    if (!addingMore || value.length === 0) return;
    if (!parentScrollRef?.current || !parentScrollYRef) return;

    let cancelled = false;
    let t1: ReturnType<typeof setTimeout> | null = null;
    let t2: ReturnType<typeof setTimeout> | null = null;

    const align = () => {
      if (cancelled) return;
      const scrollView = parentScrollRef.current;
      const anchor = expandedPickerRef.current;
      if (!scrollView || !anchor) return;
      anchor.measureInWindow((hx: number, hy: number) => {
        if (cancelled) return;
        measureHostInWindow(scrollView, hy, 12, (sx: number, sy: number) => {
          if (cancelled) return;
          const scrollY = parentScrollYRef.current;
          const pad = 12;
          const nextY = scrollY + (hy - sy) - pad;
          scrollParentToY(scrollView, nextY, true);
        });
      });
    };

    const raf = requestAnimationFrame(() => {
      if (cancelled) return;
      t1 = setTimeout(align, Platform.OS === 'android' ? 120 : 72);
      t2 = setTimeout(align, Platform.OS === 'android' ? 280 : 220);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      if (t1) clearTimeout(t1);
      if (t2) clearTimeout(t2);
    };
  }, [addingMore, parentScrollRef, parentScrollYRef, value.length]);

  const pickerOpen = value.length === 0 || addingMore;
  const qTrim = query.trim();
  const showCinemaBlock = showCinemaPicks && qTrim.length === 0;

  const windowH = Dimensions.get('window').height;
  /**
   * 검색 결과 스크롤 패널 높이 — 플로팅 일정 버튼·하단 세이프 영역을 넘지 않도록 상한을 낮춤.
   * (과거 60vh/500px는 마법사+플로팅과 겹침)
   */
  const listPanelHeight = useMemo(() => {
    const reserve = FLOATING_CTA_RESERVE + insets.bottom + 24;
    const cap = Math.round(windowH * 0.36 - reserve);
    return Math.max(168, Math.min(300, cap));
  }, [windowH, insets.bottom]);

  /** 영화관만 보이고 검색어가 없을 때는 하단 패널을 숨겨 빈 코멘트 영역 제거 */
  const showSearchResultsPanel = !(showCinemaBlock && qTrim.length === 0);

  const cinemaScrollStyle = useMemo((): ViewStyle[] => {
    const base: ViewStyle[] = [{ width: '100%' }];
    if (Platform.OS === 'web') {
      base.push({
        height: CINEMA_SCROLL_MAX,
        maxHeight: CINEMA_SCROLL_MAX,
        minHeight: 0,
        overflowY: 'scroll',
        overflowX: 'hidden',
        scrollbarWidth: 'thin',
        scrollbarColor: `${GinitTheme.colors.ctaGradient[1]} rgba(15, 23, 42, 0.12)`,
      } as ViewStyle);
    } else {
      base.push({
        height: CINEMA_SCROLL_MAX,
        maxHeight: CINEMA_SCROLL_MAX,
        minHeight: 0,
        width: '100%',
      });
    }
    return base;
  }, []);

  useEffect(() => {
    if (!pickerOpen) return;
    if (qTrim.length === 0) {
      setRows([]);
      setRowsNextPageToken(null);
      setErr(null);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setErr(null);
    setRowsNextPageToken(null);
    rowsSearchQueryKeyRef.current = qTrim;
    const t = setTimeout(() => {
      void (async () => {
        try {
          const { bias, coords } = await ensureNearbySearchBias();
          if (!alive) return;
          const { places: list, nextPageToken } = await searchPlacesText(qTrim, {
            locationBias: bias,
            userCoords: coords,
            maxResultCount: PLACE_PAGE,
          });
          if (!alive) return;
          setRows(list);
          setRowsNextPageToken(nextPageToken?.trim() ? nextPageToken.trim() : null);
        } catch (e) {
          if (!alive) return;
          setRows([]);
          setRowsNextPageToken(null);
          setErr(e instanceof Error ? e.message : '검색에 실패했습니다.');
        } finally {
          if (alive) setLoading(false);
        }
      })();
    }, 380);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [pickerOpen, qTrim, locationReady]);

  const loadMoreRows = useCallback(() => {
    const qt = query.trim();
    if (!pickerOpen || qt.length === 0) return;
    if (rowsSearchQueryKeyRef.current !== qt) return;
    if (rowsLoadMoreGuardRef.current || loading || rowsLoadingMore) return;
    if (err) return;
    const pageToken = rowsNextPageToken;
    if (pageToken == null) return;
    rowsLoadMoreGuardRef.current = true;
    setRowsLoadingMore(true);
    void (async () => {
      try {
        const { bias, coords } = await ensureNearbySearchBias();
        const qt2 = query.trim();
        if (rowsSearchQueryKeyRef.current !== qt2) return;
        const { places: list, nextPageToken } = await searchPlacesText(qt2, {
          locationBias: bias,
          userCoords: coords,
          pageToken,
          maxResultCount: PLACE_PAGE,
        });
        const qt3 = query.trim();
        if (rowsSearchQueryKeyRef.current !== qt3) return;
        setRows((prev) => {
          const seen = new Set(prev.map((r) => r.id));
          return [...prev, ...list.filter((r) => !seen.has(r.id))];
        });
        setRowsNextPageToken(nextPageToken?.trim() ? nextPageToken.trim() : null);
      } catch (e) {
        if (rowsSearchQueryKeyRef.current === qt) {
          setErr(e instanceof Error ? e.message : '검색에 실패했습니다.');
        }
      } finally {
        rowsLoadMoreGuardRef.current = false;
        setRowsLoadingMore(false);
      }
    })();
  }, [pickerOpen, query, loading, rowsLoadingMore, err, rowsNextPageToken]);

  const handleListNearEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
      const threshold = 72;
      if (layoutMeasurement.height + contentOffset.y >= contentSize.height - threshold) {
        loadMoreRows();
      }
    },
    [loadMoreRows],
  );

  const onPickCandidate = useCallback(
    (p: PlaceCandidate) => {
      if (value.some((x) => x.placeName === p.placeName && x.address === p.address)) {
        layoutAnimateEaseInEaseOut();
        setQuery('');
        setAddingMore(false);
        return;
      }
      layoutAnimateEaseInEaseOut();
      const next: PlaceCandidate = { ...p, id: newPlaceId() };
      onChange([...value, next]);
      setQuery('');
      setAddingMore(false);
    },
    [onChange, value],
  );

  const onPickPlaceRow = useCallback(
    async (item: PlaceSearchRow) => {
      if (disabled) return;
      layoutAnimateEaseInEaseOut();
      setLoading(true);
      try {
        const resolved = await resolvePlaceSearchRowCoordinates(item);
        const addr = resolved.roadAddress?.trim() || resolved.address?.trim() || '';
        if (resolved.latitude == null || resolved.longitude == null) throw new Error('좌표 없음');
        const linkFromApi =
          sanitizeNaverLocalPlaceLink(resolved.link) ?? sanitizeNaverLocalPlaceLink(item.link);
        onPickCandidate({
          id: resolved.id,
          placeName: resolved.title.trim(),
          address: addr,
          latitude: resolved.latitude,
          longitude: resolved.longitude,
          ...(linkFromApi ? { naverPlaceLink: linkFromApi } : {}),
        });
      } catch (e) {
        setErr(e instanceof Error ? e.message : '위치를 불러오지 못했습니다.');
      } finally {
        setLoading(false);
      }
    },
    [disabled, onPickCandidate],
  );

  const removeOne = useCallback(
    (id: string) => {
      layoutAnimateEaseInEaseOut();
      onChange(value.filter((x) => x.id !== id));
    },
    [onChange, value],
  );

  const toggleAdd = useCallback(() => {
    layoutAnimateEaseInEaseOut();
    setAddingMore((v) => !v);
    setQuery('');
  }, []);

  const searchHeader = (
    <View>
      <Text style={S.fieldLabel}>장소 검색</Text>
      <LinearGradient
        colors={[...GinitTheme.colors.brandGradient, GinitTheme.colors.ctaGradient[1]]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.placeSearchGradientBorder}>
        <View style={styles.placeSearchGradientInner}>
          <TextInput
            ref={earlyPlaceQueryInputRef}
            {...earlyPlaceQueryDeferKb}
            value={query}
            onChangeText={setQuery}
            placeholder='예: "강남 CGV", "영등포 맛집"'
            placeholderTextColor={INPUT_PLACEHOLDER}
            style={styles.placeSearchInput}
            editable={!disabled}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="default"
            inputMode="text"
            underlineColorAndroid="transparent"
            {...(Platform.OS === 'ios' ? { clearButtonMode: 'while-editing' as const } : {})}
          />
        </View>
      </LinearGradient>
      {nearbyHint ? (
        <Text style={[S.fieldHint, { marginTop: 6 }]}>{`「${nearbyHint}」 근처로 검색해요`}</Text>
      ) : locationReady ? (
        <Text style={[S.fieldHint, { marginTop: 6 }]}>
          위치를 쓰지 못했어요. 검색어에 동·구 이름을 넣으면 더 잘 찾아요.
        </Text>
      ) : (
        <Text style={[S.fieldHint, { marginTop: 6 }]}>내 위치를 불러오는 중…</Text>
      )}
    </View>
  );

  const listScrollViewStyle = useMemo((): ViewStyle[] => {
    const h = listPanelHeight;
    const base: ViewStyle[] = [{ width: '100%' }];
    if (Platform.OS === 'web') {
      base.push({
        height: h,
        maxHeight: h,
        minHeight: 0,
        overflowY: 'scroll',
        overflowX: 'hidden',
        scrollbarWidth: 'thin',
        scrollbarColor: `${GinitTheme.colors.ctaGradient[1]} rgba(15, 23, 42, 0.12)`,
      } as ViewStyle);
    } else {
      base.push({
        flex: 1,
        minHeight: 0,
        width: '100%',
        maxHeight: h,
      });
    }
    return base;
  }, [listPanelHeight]);

  const webScrollClassProps =
    Platform.OS === 'web' ? ({ className: WEB_SCROLLBAR_CLASS } as Record<string, string>) : {};

  const listContentStyle = useMemo(
    () => [
      { gap: 10, paddingTop: 8, paddingBottom: 12 } as ViewStyle,
      Platform.OS === 'web' && ({ width: '100%', flexDirection: 'column' } as const),
    ],
    [],
  );

  const renderPickRow = (key: string, title: string, address: string, onPress: () => void) => (
    <Animated.View
      key={key}
      style={Platform.OS === 'web' ? ({ width: '100%' } as const) : { alignSelf: 'stretch' }}
      entering={FadeInDown.duration(320)}>
      <Pressable
        onPress={onPress}
        disabled={disabled || loading}
        style={({ pressed }) => [
          styles.resultCard,
          Platform.OS === 'web' && { width: '100%' as const },
          pressed && styles.resultCardPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={title}>
        <Text style={styles.resultTitle} numberOfLines={2}>
          {title}
        </Text>
        <Text style={styles.resultAddr} numberOfLines={3}>
          {address}
        </Text>
      </Pressable>
    </Animated.View>
  );

  const cinemaScrollBlock =
    showCinemaBlock ? (
      <View style={styles.cinemaSection}>
        {!locationReady ? (
          <View style={styles.cinemaLoadingWrap} accessibilityLabel="내 위치 확인 중">
            <ActivityIndicator color={GinitTheme.colors.primary} />
            <Text style={[S.fieldHint, styles.cinemaLoadingHint]}>
              내 위치를 확인한 뒤, 가까운 영화관부터 순서대로 보여 드려요
            </Text>
          </View>
        ) : (
          <>
            <Text style={S.fieldHint}>
              {userCoords
                ? '내 위치에서 가까운 순 — CGV · 롯데시네마 · 메가박스 등'
                : '영화관 빠른 선택 — 위치를 허용하면 가까운 순으로 정렬돼요'}
            </Text>
            <View style={styles.cinemaListShell}>
              <ScrollView
                {...webScrollClassProps}
                style={cinemaScrollStyle}
                contentContainerStyle={styles.cinemaScrollContent}
                nestedScrollEnabled
                overScrollMode="never"
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                showsVerticalScrollIndicator={false}>
                {cinemaSeedsOrdered.map((c) =>
                  renderPickRow(`cinema-${c.id}`, c.placeName, c.address, () =>
                    onPickCandidate({ ...c, id: newPlaceId() }),
                  ),
                )}
              </ScrollView>
            </View>
          </>
        )}
      </View>
    ) : null;

  const searchListBody = (
    <>
      {qTrim.length > 0 ? (
        loading ? (
          <View style={{ paddingVertical: 24, alignItems: 'center', gap: 10 }}>
            <ActivityIndicator size="large" color={GinitTheme.colors.primary} />
            <Text style={S.resultMeta}>검색 중…</Text>
          </View>
        ) : err ? (
          <Text style={S.resultMeta}>{err}</Text>
        ) : rows.length === 0 ? (
          <Text style={S.resultMeta}>검색 결과가 없어요.</Text>
        ) : (
          <>
            {rows.map((item) => {
              const addr = (item.roadAddress || item.address || '').trim() || item.category;
              const detailUrl = resolveNaverPlaceDetailWebUrlLikeVoteChip({
                naverPlaceLink: item.link,
                title: item.title,
                addressLine: typeof addr === 'string' && addr.trim() ? addr.trim() : undefined,
              });
              return (
                <Animated.View
                  key={item.id}
                  style={Platform.OS === 'web' ? ({ width: '100%' } as const) : { alignSelf: 'stretch' }}
                  entering={FadeInDown.duration(320)}>
                  <View style={[styles.resultCard, Platform.OS === 'web' && { width: '100%' as const }]}>
                    <Pressable
                      onPress={() => void onPickPlaceRow(item)}
                      disabled={disabled || loading}
                      style={({ pressed }) => [pressed && styles.resultCardPressed]}
                      accessibilityRole="button"
                      accessibilityLabel={item.title}>
                      <Text style={styles.resultTitle} numberOfLines={2}>
                        {item.title}
                      </Text>
                      <Text style={styles.resultAddr} numberOfLines={3}>
                        {addr}
                      </Text>
                    </Pressable>
                    {detailUrl ? (
                      <Pressable
                        onPress={() =>
                          setNaverPlaceWebModal({ url: detailUrl, title: item.title.trim() || '상세 정보' })
                        }
                        disabled={disabled || loading}
                        style={({ pressed }) => [styles.naverDetailBtn, pressed && { opacity: 0.88 }]}
                        accessibilityRole="button"
                        accessibilityLabel="상세 정보">
                        <Text style={styles.naverDetailBtnText}>상세 정보</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </Animated.View>
              );
            })}
            {rowsLoadingMore ? (
              <View style={{ paddingVertical: 12, alignItems: 'center' }}>
                <ActivityIndicator color={GinitTheme.colors.primary} />
              </View>
            ) : null}
          </>
        )
      ) : showCinemaBlock ? null : (
        <Text style={S.resultMeta}>
          {nearbyHint
            ? '검색어를 입력하면 이 근처 장소를 찾아요.'
            : locationReady
              ? '검색어를 입력하면 장소를 찾아요.'
              : '검색어를 입력하면 주변 장소를 찾아요.'}
        </Text>
      )}
    </>
  );

  const listScroll = (
    <View
      style={[
        styles.listPanelShell,
        {
          height: listPanelHeight,
          maxHeight: listPanelHeight,
          minHeight: 0,
        },
      ]}>
      <ScrollView
        {...webScrollClassProps}
        style={listScrollViewStyle}
        contentContainerStyle={listContentStyle}
        nestedScrollEnabled
        overScrollMode="never"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        onScroll={handleListNearEnd}
        scrollEventThrottle={400}>
        {searchListBody}
      </ScrollView>
    </View>
  );

  const listScrollOrNull = showSearchResultsPanel ? listScroll : null;

  if (value.length === 0) {
    return (
      <Fragment>
        <View style={styles.pickerRoot}>
          {searchHeader}
          {cinemaScrollBlock}
          {listScrollOrNull}
        </View>
        <NaverPlaceWebViewModal
          visible={naverPlaceWebModal != null}
          url={naverPlaceWebModal?.url}
          pageTitle={naverPlaceWebModal?.title ?? '상세 정보'}
          onClose={() => setNaverPlaceWebModal(null)}
        />
      </Fragment>
    );
  }

  return (
    <Fragment>
    <View style={styles.pickColumnOuter}>
      <Text style={S.fieldLabel}>선택된 장소 후보</Text>
      <Animated.View
        layout={LinearTransition.springify().damping(18).stiffness(220)}
        style={styles.pickedStack}>
        {value.map((item, index) => (
          <Animated.View
            key={item.id}
            layout={LinearTransition.springify().damping(18).stiffness(220)}
            entering={FadeInDown.duration(400).delay(Math.min(index * 64, 260))}>
            <View style={[styles.pickedRow, styles.pickedRowRecess]}>
              <View style={styles.pickedTextCol}>
                <Text style={styles.resultTitle} numberOfLines={2}>
                  {item.placeName}
                </Text>
                <Text style={styles.resultAddr} numberOfLines={4}>
                  {item.address}
                </Text>
              </View>
              <Pressable
                onPress={() => removeOne(item.id)}
                disabled={disabled}
                style={({ pressed }) => [pressed && { opacity: 0.85 }]}
                accessibilityRole="button"
                accessibilityLabel={`${item.placeName} 후보에서 제거`}>
                <Text style={styles.pickedRemove}>삭제</Text>
              </Pressable>
            </View>
          </Animated.View>
        ))}
      </Animated.View>

      <Pressable
        onPress={toggleAdd}
        disabled={disabled}
        style={({ pressed }) => [styles.addMoreBtn, pressed && styles.addMoreBtnPressed]}
        accessibilityRole="button">
        <Text style={styles.addMoreBtnLabel}>{addingMore ? '검색 닫기' : '+ 다른 장소 후보 추가'}</Text>
      </Pressable>

      {addingMore ? (
        <View ref={expandedPickerRef} collapsable={false} style={[styles.pickerRoot, { marginTop: 12 }]}>
          {searchHeader}
          {cinemaScrollBlock}
          {listScrollOrNull}
        </View>
      ) : null}
    </View>
    <NaverPlaceWebViewModal
      visible={naverPlaceWebModal != null}
      url={naverPlaceWebModal?.url}
      pageTitle={naverPlaceWebModal?.title ?? '상세 정보'}
      onClose={() => setNaverPlaceWebModal(null)}
    />
    </Fragment>
  );
}

const styles = StyleSheet.create({
  /** 일반 모임 `VoteCandidatesForm` 장소 단계와 동일 톤 — 바깥 래퍼만 */
  pickerRoot: {
    flexDirection: 'column',
    alignSelf: 'stretch',
    width: '100%',
    maxWidth: '100%',
    minHeight: 0,
    flexShrink: 1,
    marginTop: 4,
  },
  pickColumnOuter: {
    width: '100%',
    maxWidth: '100%',
    flexDirection: 'column',
    alignSelf: 'stretch',
    minHeight: 0,
    flexShrink: 1,
  },
  placeSearchGradientBorder: {
    borderRadius: 16,
    padding: 2,
    marginTop: 4,
    marginBottom: 0,
  },
  placeSearchGradientInner: {
    borderRadius: 14,
    backgroundColor: GinitTheme.colors.surface,
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 0,
  },
  placeSearchInput: {
    minHeight: 20,
    fontSize: 16,
    fontWeight: '700',
    color: GinitTheme.colors.text,
    lineHeight: 22,
    padding: 0,
    margin: 0,
  },
  listPanelShell: {
    marginTop: 8,
    width: '100%',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
    backgroundColor: 'rgba(255, 255, 255, 0.45)',
    overflow: 'hidden',
    flexGrow: 0,
    flexShrink: 0,
    alignSelf: 'stretch',
  },
  cinemaSection: {
    marginTop: 4,
    marginBottom: 4,
    flexShrink: 0,
    alignSelf: 'stretch',
  },
  cinemaLoadingWrap: {
    minHeight: CINEMA_SCROLL_MAX,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 12,
  },
  cinemaLoadingHint: {
    marginTop: 10,
    textAlign: 'center',
    lineHeight: 18,
  },
  cinemaListShell: {
    marginTop: 6,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
    backgroundColor: 'rgba(255, 255, 255, 0.45)',
    overflow: 'hidden',
    alignSelf: 'stretch',
  },
  cinemaScrollContent: {
    gap: 10,
    paddingTop: 8,
    paddingBottom: 10,
    paddingHorizontal: 4,
  },
  resultCard: {
    width: '100%',
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  resultCardPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.99 }],
  },
  resultTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: GinitTheme.colors.text,
    lineHeight: 18,
    marginBottom: 6,
  },
  resultAddr: {
    fontSize: 11,
    fontWeight: '700',
    color: GinitTheme.colors.textMuted,
    lineHeight: 15,
  },
  naverDetailBtn: {
    marginTop: 8,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: GinitTheme.radius.button,
    borderWidth: 1,
    borderColor: GinitTheme.colors.primary,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
  },
  naverDetailBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: GinitTheme.colors.primary,
  },
  pickedStack: {
    flexDirection: 'column',
    gap: 10,
    marginTop: 8,
    width: Platform.OS === 'web' ? ('100%' as const) : undefined,
    alignSelf: 'stretch',
  },
  pickedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  pickedRowRecess: {
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    borderColor: GinitTheme.colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  pickedTextCol: {
    flex: 1,
    minWidth: 0,
  },
  pickedRemove: {
    fontSize: 12,
    fontWeight: '600',
    color: GinitTheme.colors.danger,
  },
  addMoreBtn: {
    alignSelf: 'stretch',
    marginTop: 10,
    marginBottom: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addMoreBtnPressed: {
    opacity: 0.95,
    backgroundColor: GinitTheme.colors.primarySoft,
    borderColor: 'rgba(134, 211, 183, 0.75)',
  },
  addMoreBtnLabel: {
    color: GinitTheme.colors.primary,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
});
