import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import * as Font from 'expo-font';
import {
  type ReactNode,
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
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ViewStyle,
} from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { layoutAnimateEaseInEaseOut } from '@/src/lib/android-layout-animation';
import { haversineDistanceMeters, type LatLng } from '@/src/lib/geo-distance';
import type { PlaceCandidate } from '@/src/lib/meeting-place-bridge';
import { ensureNearbySearchBias } from '@/src/lib/nearby-search-bias';
import type { NaverLocalPlace } from '@/src/lib/naver-local-search';
import { resolveNaverPlaceCoordinates, searchNaverLocalPlaces } from '@/src/lib/naver-local-search';

import {
  INPUT_PLACEHOLDER,
  movieAddOutlineBtnWebStyle,
  movieListRowWebGlassStyle,
  wizardSpecialtyStyles as S,
} from './wizard-specialty-styles';

const TRUST_BLUE = '#0052CC';

const WEB_SCROLLBAR_CLASS = 'ginit-early-place-nested-scroll';
const WEB_SCROLLBAR_STYLE_ID = 'ginit-early-place-nested-scroll-style';

/** 내 주변 영화관 전용 스크롤 영역 최대 높이 */
const CINEMA_SCROLL_MAX = 168;
/** details 플로팅「n개의 장소로 일정 정하기」+ 여백(대략) */
const FLOATING_CTA_RESERVE = 100;

const PRETENDARD_BOLD_URI =
  'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/packages/pretendard/dist/public/static/Pretendard-Bold.otf';
const PRETENDARD_REGULAR_URI =
  'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/packages/pretendard/dist/public/static/Pretendard-Regular.otf';

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

function PlaceGlassCard({ children, pressed }: { children: ReactNode; pressed: boolean }) {
  if (Platform.OS === 'web') {
    return (
      <View
        style={[
          S.movieListRowCardFallback,
          movieListRowWebGlassStyle,
          pressed && S.movieListRowPressedOrange,
        ]}>
        <View style={styles.listCardInner}>{children}</View>
      </View>
    );
  }
  return (
    <View style={[S.movieListRowOuter, pressed && S.movieListRowPressedOrange]}>
      <BlurView
        tint="dark"
        intensity={26}
        style={StyleSheet.absoluteFill}
        experimentalBlurMethod="dimezisBlurView"
      />
      <View style={styles.listCardInner}>{children}</View>
    </View>
  );
}

export type EarlyPlaceSearchProps = {
  value: PlaceCandidate[];
  onChange: (next: PlaceCandidate[]) => void;
  showCinemaPicks?: boolean;
  disabled?: boolean;
  parentScrollRef?: RefObject<ScrollView | null>;
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
  const [rows, setRows] = useState<NaverLocalPlace[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [fontBold, setFontBold] = useState<string | undefined>(undefined);
  const [fontRegular, setFontRegular] = useState<string | undefined>(undefined);
  /** GPS 확보 시 영화관 시드 정렬·검색 재실행용 */
  const [userCoords, setUserCoords] = useState<LatLng | null>(null);
  const [nearbyHint, setNearbyHint] = useState<string | null>(null);
  const [locationReady, setLocationReady] = useState(false);
  const expandedPickerRef = useRef<View>(null);

  /** 웹: 얇은 Trust Blue 톤 스크롤바 (::webkit-scrollbar) */
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return undefined;
    if (document.getElementById(WEB_SCROLLBAR_STYLE_ID)) return undefined;
    const el = document.createElement('style');
    el.id = WEB_SCROLLBAR_STYLE_ID;
    el.textContent = `
      .${WEB_SCROLLBAR_CLASS}::-webkit-scrollbar { width: 4px; }
      .${WEB_SCROLLBAR_CLASS}::-webkit-scrollbar-track {
        background: rgba(15, 23, 42, 0.25);
        border-radius: 4px;
      }
      .${WEB_SCROLLBAR_CLASS}::-webkit-scrollbar-thumb {
        background: rgba(0, 82, 204, 0.35);
        border-radius: 4px;
      }
    `;
    document.head.appendChild(el);
    return undefined;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await Font.loadAsync({
          PretendardBold: PRETENDARD_BOLD_URI,
          PretendardRegular: PRETENDARD_REGULAR_URI,
        });
        if (!cancelled) {
          setFontBold('PretendardBold');
          setFontRegular('PretendardRegular');
        }
      } catch {
        if (!cancelled) {
          setFontBold(undefined);
          setFontRegular(undefined);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
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
        const scrollHost = scrollView as unknown as View;
        scrollHost.measureInWindow((sx: number, sy: number) => {
          if (cancelled) return;
          const scrollY = parentScrollYRef.current;
          const nextY = scrollY + (hy - sy) - 12;
          scrollView.scrollTo({ y: Math.max(0, nextY), animated: true });
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
        scrollbarColor: 'rgba(0, 82, 204, 0.38) rgba(15, 23, 42, 0.12)',
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
      setErr(null);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setErr(null);
    const t = setTimeout(() => {
      void (async () => {
        try {
          const { bias } = await ensureNearbySearchBias();
          if (!alive) return;
          const list = await searchNaverLocalPlaces(qTrim, { locationBias: bias });
          if (!alive) return;
          setRows(list);
        } catch (e) {
          if (!alive) return;
          setRows([]);
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

  const titleStyle = useMemo(
    () => [styles.placeTitle, fontBold ? { fontFamily: fontBold } : { fontWeight: '700' as const }],
    [fontBold],
  );
  const addressStyle = useMemo(
    () => [styles.placeAddress, fontRegular ? { fontFamily: fontRegular } : { fontWeight: '400' as const }],
    [fontRegular],
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

  const onPickNaver = useCallback(
    async (item: NaverLocalPlace) => {
      if (disabled) return;
      layoutAnimateEaseInEaseOut();
      setLoading(true);
      try {
        const resolved = await resolveNaverPlaceCoordinates(item);
        const addr = resolved.roadAddress?.trim() || resolved.address?.trim() || '';
        if (resolved.latitude == null || resolved.longitude == null) throw new Error('좌표 없음');
        onPickCandidate({
          id: resolved.id,
          placeName: resolved.title.trim(),
          address: addr,
          latitude: resolved.latitude,
          longitude: resolved.longitude,
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
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="영화관, 지역명, 맛집 등 검색…"
        placeholderTextColor={INPUT_PLACEHOLDER}
        style={[S.textInput, { marginTop: 4 }]}
        editable={!disabled}
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
        {...(Platform.OS === 'ios' ? { clearButtonMode: 'while-editing' as const } : {})}
      />
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
        scrollbarColor: 'rgba(0, 82, 204, 0.38) rgba(15, 23, 42, 0.12)',
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
      { gap: 14, paddingTop: 8, paddingBottom: 12 } as ViewStyle,
      Platform.OS === 'web' && ({ width: '100%', flexDirection: 'column' } as const),
    ],
    [],
  );

  const renderPickRow = (key: string, title: string, address: string, onPress: () => void) => (
    <Animated.View key={key} style={S.movieListItemOuter} entering={FadeInDown.duration(320)}>
      <Pressable
        onPress={onPress}
        disabled={disabled || loading}
        style={Platform.OS === 'web' ? ({ width: '100%' } as const) : undefined}
        accessibilityRole="button"
        accessibilityLabel={title}>
        {({ pressed }) => (
          <PlaceGlassCard pressed={pressed}>
            <Text style={titleStyle} numberOfLines={2}>
              {title}
            </Text>
            <Text style={addressStyle} numberOfLines={3}>
              {address}
            </Text>
          </PlaceGlassCard>
        )}
      </Pressable>
    </Animated.View>
  );

  const cinemaScrollBlock =
    showCinemaBlock ? (
      <View style={styles.cinemaSection}>
        {!locationReady ? (
          <View style={styles.cinemaLoadingWrap} accessibilityLabel="내 위치 확인 중">
            <ActivityIndicator color={TRUST_BLUE} />
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
            <ActivityIndicator size="large" color={TRUST_BLUE} />
            <Text style={S.resultMeta}>검색 중…</Text>
          </View>
        ) : err ? (
          <Text style={S.resultMeta}>{err}</Text>
        ) : rows.length === 0 ? (
          <Text style={S.resultMeta}>검색 결과가 없어요.</Text>
        ) : (
          rows.map((item) => {
            const addr = (item.roadAddress || item.address || '').trim() || item.category;
            return renderPickRow(item.id, item.title, addr, () => void onPickNaver(item));
          })
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
        showsVerticalScrollIndicator={false}>
        {searchListBody}
      </ScrollView>
    </View>
  );

  const listScrollOrNull = showSearchResultsPanel ? listScroll : null;

  if (value.length === 0) {
    return (
      <View style={styles.pickerRoot}>
        {searchHeader}
        {cinemaScrollBlock}
        {listScrollOrNull}
      </View>
    );
  }

  return (
    <View style={styles.pickColumnOuter}>
      <Text style={S.fieldLabel}>확정된 장소 후보</Text>
      <Animated.View
        layout={LinearTransition.springify().damping(18).stiffness(220)}
        style={S.movieCandidatesColumn}>
        {value.map((item, index) => (
          <Animated.View
            key={item.id}
            layout={LinearTransition.springify().damping(18).stiffness(220)}
            entering={FadeInDown.duration(400).delay(Math.min(index * 64, 260))}>
            <View style={styles.confirmedCard}>
              <Pressable
                onPress={() => removeOne(item.id)}
                disabled={disabled}
                style={({ pressed }) => [S.movieConfirmedRemoveHit, pressed && { opacity: 0.85 }]}
                accessibilityRole="button"
                accessibilityLabel={`${item.placeName} 후보에서 제거`}>
                <Ionicons name="close" size={18} color="rgba(248, 250, 252, 0.92)" />
              </Pressable>
              <Text style={[titleStyle, { paddingRight: 4 }]} numberOfLines={2}>
                {item.placeName}
              </Text>
              <Text style={addressStyle} numberOfLines={4}>
                {item.address}
              </Text>
            </View>
          </Animated.View>
        ))}
      </Animated.View>

      <Pressable
        onPress={toggleAdd}
        disabled={disabled}
        style={({ pressed }) => [
          S.movieAddOutlineBtn,
          Platform.OS === 'web' && movieAddOutlineBtnWebStyle,
          pressed && S.movieAddOutlineBtnPressed,
        ]}
        accessibilityRole="button">
        <Text style={S.movieAddOutlineBtnLabel}>
          {addingMore ? '검색 닫기' : '+ 다른 장소 후보 추가'}
        </Text>
      </Pressable>

      {addingMore ? (
        <View ref={expandedPickerRef} collapsable={false} style={[styles.pickerRoot, { marginTop: 12 }]}>
          {searchHeader}
          {cinemaScrollBlock}
          {listScrollOrNull}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  /** 부모(페이지 ScrollView)가 자식 높이로 늘어나지 않도록 — 리스트만 내부 스크롤 */
  pickerRoot: {
    flexDirection: 'column',
    alignSelf: 'stretch',
    width: '100%',
    maxWidth: '100%',
    minHeight: 0,
    flexShrink: 1,
    marginTop: 4,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
    overflow: 'hidden',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
  },
  pickColumnOuter: {
    width: '100%',
    maxWidth: '100%',
    flexDirection: 'column',
    alignSelf: 'stretch',
    minHeight: 0,
    flexShrink: 1,
  },
  listCardInner: {
    width: '100%',
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  listPanelShell: {
    marginTop: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    backgroundColor: 'rgba(15, 23, 42, 0.25)',
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
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    backgroundColor: 'rgba(15, 23, 42, 0.2)',
    overflow: 'hidden',
    alignSelf: 'stretch',
  },
  cinemaScrollContent: {
    gap: 12,
    paddingTop: 6,
    paddingBottom: 10,
    paddingHorizontal: 0,
  },
  placeTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F8FAFC',
    letterSpacing: -0.3,
    lineHeight: 22,
  },
  placeAddress: {
    fontSize: 13,
    fontWeight: '400',
    color: 'rgba(255, 255, 255, 0.6)',
    lineHeight: 19,
  },
  confirmedCard: {
    position: 'relative',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    paddingVertical: 14,
    paddingHorizontal: 14,
    paddingRight: 44,
    overflow: 'hidden',
    ...Platform.select({
      web: {
        backgroundColor: 'rgba(255, 255, 255, 0.08)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      } as const,
      default: {
        backgroundColor: 'rgba(15, 23, 42, 0.72)',
      },
    }),
  },
});
