import { useFocusEffect } from '@react-navigation/native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  InteractionManager,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { KeyboardAwareFlatList } from 'react-native-keyboard-aware-scroll-view';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PlaceCandidateDetailLinkRow } from '@/components/create/PlaceCandidateDetailLinkRow';
import { GooglePlacePreviewMap } from '@/components/GooglePlacePreviewMap';
import { NaverPlaceWebViewModal } from '@/components/NaverPlaceWebViewModal';
import { GinitPlaceholderColor, GinitStyles } from '@/constants/GinitStyles';
import { GinitTheme } from '@/constants/ginit-theme';
import { layoutAnimateEaseInEaseOut } from '@/src/lib/android-layout-animation';
import {
  resolvePlaceSearchRowCoordinates,
  searchPlacesText,
  stableNaverLocalSearchDedupeKey,
  type PlaceSearchRow,
} from '@/src/lib/naver-local-place-search-text';
import { setPendingMeetingPlace, setPendingVotePlaceRow } from '@/src/lib/meeting-place-bridge';
import { setCreateMeetingPlaceAutopilotError } from '@/src/lib/create-meeting-autopilot-place-result';
import { sanitizeNaverLocalPlaceLink } from '@/src/lib/naver-local-search';
import { placeKeyFromNaverLocalSearchId } from '@/src/lib/place-key';
import { ensureNearbySearchBias } from '@/src/lib/nearby-search-bias';

const PLACE_PAGE = 5;

function animateListLayout() {
  layoutAnimateEaseInEaseOut();
}

function pickParam(v: string | string[] | undefined): string | undefined {
  if (v == null) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

export type PlaceSearchScreenProps = {
  /** `/create/details` 진입 시 — 선택 행 아래에 네이버 지도 인라인 미리보기 */
  useInlineMapPreview?: boolean;
  /**
   * 모임 등록에서 이미 선택된 상호명 — 화면 진입 시 검색창 초기값·자동 네이버 검색에 사용.
   * (`/create/details`에서 `router.push` params로 전달)
   */
  initialQuery?: string;
  /** 후보 행에서 열었을 때 — 확인 시 이 ID로만 브리지에 저장 */
  voteRowId?: string;
  /** `1`이면 검색 완료 후 첫 결과 선택·확인까지 자동(모임 생성 오토파일럿) */
  createAutopilot?: string;
};

function PlaceSearchScreenInner({
  useInlineMapPreview = false,
  initialQuery,
  voteRowId,
  createAutopilot,
}: PlaceSearchScreenProps) {
  const router = useRouter();
  const searchInputRef = useRef<TextInput>(null);
  const [searchFocused, setSearchFocused] = useState(false);
  /** 첫 프레임은 BlurView 없이 정적 레이어로 그려 전환 직후 프레임 드랍을 줄입니다. */
  const [nativeDecorReady, setNativeDecorReady] = useState(Platform.OS === 'web');
  useEffect(() => {
    if (Platform.OS === 'web') return undefined;
    const id = requestAnimationFrame(() => setNativeDecorReady(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<PlaceSearchRow[]>([]);
  const resultsRef = useRef(results);
  resultsRef.current = results;
  const [selected, setSelected] = useState<PlaceSearchRow | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [naverPlaceWebModal, setNaverPlaceWebModal] = useState<{ url: string; title: string } | null>(null);
  const lastListSearchKeyRef = useRef('');
  const loadMoreGuardRef = useRef(false);
  const autopilotEmptyHandledRef = useRef(false);
  const autopilotPickStartedRef = useRef(false);
  const autopilotConfirmStartedRef = useRef(false);

  useEffect(() => {
    return () => {
      autopilotEmptyHandledRef.current = false;
      autopilotPickStartedRef.current = false;
      autopilotConfirmStartedRef.current = false;
    };
  }, []);

  const canConfirm =
    selected != null && selected.latitude != null && selected.longitude != null && !resolving;

  const runSearch = useCallback(
    async (raw: string, opts?: { signal?: AbortSignal }) => {
      Keyboard.dismiss();
      const trimmed = raw.trim();
      if (!trimmed) {
        setError('검색어를 입력하고 검색을 눌러 주세요.');
        return;
      }
      setQuery(trimmed);
      setError(null);
      setNextPageToken(null);
      setLoading(true);
      try {
        const { bias, coords } = await ensureNearbySearchBias();
        const { places: list, nextPageToken: nxt } = await searchPlacesText(trimmed, {
          locationBias: bias,
          userCoords: coords,
          maxResultCount: PLACE_PAGE,
        });
        if (opts?.signal?.aborted) return;
        setHasSearched(true);
        setResults(list);
        lastListSearchKeyRef.current = trimmed;
        setNextPageToken(nxt?.trim() ? nxt.trim() : null);
        if (useInlineMapPreview) {
          InteractionManager.runAfterInteractions(() => animateListLayout());
        }
        setSelected(null);
      } catch (e) {
        if (opts?.signal?.aborted) return;
        const msg = e instanceof Error ? e.message : '검색에 실패했습니다.';
        setError(msg);
        setResults([]);
        lastListSearchKeyRef.current = '';
        setNextPageToken(null);
        setSelected(null);
      } finally {
        setLoading(false);
      }
    },
    [useInlineMapPreview],
  );

  const loadMore = useCallback(() => {
    const key = query.trim();
    if (!key || loadMoreGuardRef.current || loading || loadingMore || resolving) return;
    if (key !== lastListSearchKeyRef.current) return;
    const pageToken = nextPageToken;
    if (pageToken == null) return;
    loadMoreGuardRef.current = true;
    setLoadingMore(true);
    void (async () => {
      try {
        const { bias, coords } = await ensureNearbySearchBias();
        const key2 = query.trim();
        if (key2 !== lastListSearchKeyRef.current) return;
        const excludeStablePlaceKeys = resultsRef.current.map((r) => stableNaverLocalSearchDedupeKey(r));
        const { places: list, nextPageToken: nxt } = await searchPlacesText(key2, {
          locationBias: bias,
          userCoords: coords,
          pageToken,
          maxResultCount: PLACE_PAGE,
          excludeStablePlaceKeys,
        });
        const key3 = query.trim();
        if (key3 !== lastListSearchKeyRef.current) return;
        const prevRes = resultsRef.current;
        const seen0 = new Set(prevRes.map((r) => r.id));
        const fresh0 = list.filter((p) => !seen0.has(p.id));
        if (fresh0.length === 0) {
          setNextPageToken(null);
        } else {
          setResults((prev) => {
            const seen = new Set(prev.map((r) => r.id));
            const fresh = list.filter((p) => !seen.has(p.id));
            return fresh.length ? [...prev, ...fresh] : prev;
          });
          setNextPageToken(nxt?.trim() ? nxt.trim() : null);
        }
      } catch {
        // 목록은 유지, 추가 페이지만 생략
        setNextPageToken(null);
      } finally {
        loadMoreGuardRef.current = false;
        setLoadingMore(false);
      }
    })();
  }, [query, loading, loadingMore, resolving, nextPageToken]);

  const onSearchPress = useCallback(() => {
    void runSearch(query);
  }, [query, runSearch]);

  useFocusEffect(
    useCallback(() => {
      const seed = initialQuery?.trim();
      if (!seed) return undefined;

      const ac = new AbortController();
      const interaction = InteractionManager.runAfterInteractions(() => {
        void (async () => {
          setSelected(null);
          setError(null);
          await runSearch(seed, { signal: ac.signal });
        })();
      });

      return () => {
        ac.abort();
        interaction.cancel?.();
      };
    }, [initialQuery, runSearch]),
  );

  const onSelectPlace = useCallback(
    async (item: PlaceSearchRow) => {
      Keyboard.dismiss();
      if (useInlineMapPreview) {
        InteractionManager.runAfterInteractions(() => animateListLayout());
      }
      setError(null);
      setSelected(item);
      setResolving(true);
      try {
        const resolved = await resolvePlaceSearchRowCoordinates(item);
        if (useInlineMapPreview) {
          InteractionManager.runAfterInteractions(() => animateListLayout());
        }
        setSelected(resolved);
        setResults((prev) => prev.map((p) => (p.id === item.id ? resolved : p)));
      } catch (e) {
        const msg = e instanceof Error ? e.message : '위치를 불러오지 못했습니다.';
        setError(msg);
      } finally {
        setResolving(false);
      }
    },
    [useInlineMapPreview],
  );

  const onConfirm = useCallback(() => {
    if (!selected || selected.latitude == null || selected.longitude == null) {
      setError('목록에서 장소를 눌러 위치를 먼저 불러와 주세요.');
      return;
    }
    const addr = selected.roadAddress?.trim() || selected.address?.trim() || '';
    const linkFromApi = sanitizeNaverLocalPlaceLink(selected.link);
    const thumb = (selected.thumbnailUrl ?? '').trim();
    const cat = (selected.category ?? '').trim();
    const pk = placeKeyFromNaverLocalSearchId(selected.id);
    const payload = {
      placeName: selected.title,
      address: addr,
      latitude: selected.latitude,
      longitude: selected.longitude,
      ...(pk ? { placeKey: pk } : {}),
      ...(cat ? { category: cat } : {}),
      ...(linkFromApi ? { naverPlaceLink: linkFromApi } : {}),
      ...(thumb.startsWith('https://') ? { preferredPhotoMediaUrl: thumb } : {}),
    };
    if (voteRowId?.trim()) {
      setPendingVotePlaceRow({ ...payload, rowId: voteRowId.trim() });
    } else {
      setPendingMeetingPlace(payload);
    }
    router.back();
  }, [router, selected, voteRowId]);

  const onConfirmRef = useRef(onConfirm);
  onConfirmRef.current = onConfirm;

  const createAutopilotOn = createAutopilot === '1';

  useEffect(() => {
    if (!createAutopilotOn) return;
    if (!hasSearched || loading) return;
    if (results.length > 0) return;
    if (autopilotEmptyHandledRef.current) return;
    autopilotEmptyHandledRef.current = true;
    setCreateMeetingPlaceAutopilotError(error?.trim() ? error : '검색 결과가 없어요.');
    router.back();
  }, [createAutopilotOn, hasSearched, loading, results.length, error, router]);

  useEffect(() => {
    if (!createAutopilotOn) return;
    if (!hasSearched || loading || resolving) return;
    if (results.length === 0) return;
    if (autopilotPickStartedRef.current) return;
    autopilotPickStartedRef.current = true;
    const first = results[0];
    const t = setTimeout(() => {
      void onSelectPlace(first);
    }, 420);
    return () => clearTimeout(t);
  }, [createAutopilotOn, hasSearched, loading, resolving, results, onSelectPlace]);

  useEffect(() => {
    if (!createAutopilotOn) return;
    if (!selected || resolving) return;
    if (selected.latitude == null || selected.longitude == null) return;
    if (autopilotConfirmStartedRef.current) return;
    autopilotConfirmStartedRef.current = true;
    const t = setTimeout(() => {
      onConfirmRef.current();
    }, 520);
    return () => clearTimeout(t);
  }, [createAutopilotOn, selected, resolving]);

  return (
    <View style={GinitStyles.screenRoot}>
      <LinearGradient colors={['#DCEEFF', '#EEF6FF', '#FFF4ED']} locations={[0, 0.45, 1]} style={StyleSheet.absoluteFill} />
      {Platform.OS === 'web' ? (
        <View style={[StyleSheet.absoluteFill, GinitStyles.webVeil]} />
      ) : nativeDecorReady ? (
        <>
          <BlurView
            pointerEvents="none"
            intensity={GinitTheme.glassModal.blurIntensity}
            tint="light"
            style={StyleSheet.absoluteFill}
          />
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, GinitStyles.frostVeil]} />
        </>
      ) : (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.enteringStaticVeil]} />
      )}
      <SafeAreaView style={GinitStyles.safeAreaPadded} edges={['top', 'bottom']}>
          <View style={GinitStyles.topBarRow}>
            <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button">
              <Text style={GinitStyles.backLink}>← 닫기</Text>
            </Pressable>
            <Text style={GinitStyles.screenTitleLarge}>장소 검색</Text>
            <View style={{ width: 56 }} />
          </View>

          <View style={GinitStyles.searchRow}>
            <TextInput
              ref={searchInputRef}
              value={query}
              onChangeText={setQuery}
              placeholder="가게 이름, 업체명, 주소 검색"
              placeholderTextColor={GinitPlaceholderColor}
              style={[
                GinitStyles.glassInput,
                GinitStyles.glassInputFlex,
                searchFocused && GinitStyles.glassInputFocused,
              ]}
              returnKeyType="search"
              keyboardType="default"
              inputMode="text"
              onSubmitEditing={() => void runSearch(query)}
              onFocus={() => {
                setSearchFocused(true);
              }}
              onBlur={() => setSearchFocused(false)}
            />
            <Pressable onPress={onSearchPress} style={GinitStyles.primaryButton} accessibilityRole="button">
              <LinearGradient
                colors={GinitTheme.colors.ctaGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={GinitStyles.buttonGradientBg}
                pointerEvents="none"
              />
              <Text style={GinitStyles.primaryButtonLabel}>검색</Text>
            </Pressable>
          </View>

          {loading || resolving ? (
            <View style={GinitStyles.rowCenter}>
              <ActivityIndicator color={GinitTheme.themeMainColor} />
              <Text style={GinitStyles.mutedText}>{loading ? '검색 중…' : '선택한 주소로 위치 찾는 중…'}</Text>
            </View>
          ) : null}

          {error ? (
            <View style={GinitStyles.errorBanner}>
              <Text style={GinitStyles.errorBannerText}>{error}</Text>
            </View>
          ) : null}

          <View style={GinitStyles.listWrap}>
            <KeyboardAwareFlatList
              data={results}
              keyExtractor={(item) => item.id}
              extraData={`${selected?.id ?? ''}:${String(selected?.latitude)}:${String(selected?.longitude)}:${resolving ? '1' : '0'}`}
              keyboardShouldPersistTaps="handled"
              enableOnAndroid
              initialNumToRender={8}
              maxToRenderPerBatch={10}
              windowSize={7}
              removeClippedSubviews={Platform.OS === 'android'}
              contentContainerStyle={GinitStyles.listContent}
              ListEmptyComponent={
                loading || error ? null : !hasSearched ? (
                  <Text style={GinitStyles.mutedText}>검색어를 입력하고 검색을 눌러 주세요.</Text>
                ) : (
                  <Text style={GinitStyles.mutedText}>
                    검색 결과가 없어요. EXPO_PUBLIC_KAKAO_REST_API_KEY(카카오 REST API 키)를 확인하거나, 다른
                    검색어로 다시 시도해 보세요.
                  </Text>
                )
              }
              ListFooterComponent={
                loadingMore ? (
                  <View style={{ paddingVertical: 16, alignItems: 'center' }}>
                    <ActivityIndicator color={GinitTheme.themeMainColor} />
                  </View>
                ) : null
              }
              onEndReached={() => void loadMore()}
              onEndReachedThreshold={0.35}
              renderItem={({ item }) => {
                const active = selected?.id === item.id;
                const resolved = active && item.latitude != null && item.longitude != null;
                const lat = item.latitude;
                const lng = item.longitude;
                const showInlineMap =
                  useInlineMapPreview && active && lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng);

                const addrLine = (item.roadAddress || item.address || '').trim() || undefined;
                return (
                  <View style={GinitStyles.itemWrap}>
                    <View style={GinitStyles.glassListRowWrap}>
                      <Pressable
                        onPress={() => void onSelectPlace(item)}
                        style={[GinitStyles.glassListRow, active && GinitStyles.glassListRowSelected]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}>
                        <View style={GinitStyles.listRowInner}>
                          <View style={GinitStyles.listTextCol}>
                            <Text style={GinitStyles.listItemTitle} numberOfLines={2}>
                              {item.title}
                            </Text>
                            {item.category ? (
                              <Text style={GinitStyles.listItemCategory}>{item.category}</Text>
                            ) : null}
                            <Text style={GinitStyles.listItemAddress} numberOfLines={3}>
                              {item.roadAddress || item.address || ''}
                            </Text>
                          </View>
                          <View style={GinitStyles.listTrailCol}>
                            {active ? (
                              <View style={[GinitStyles.checkBubble, resolved && GinitStyles.checkBubbleDone]}>
                                <Text style={GinitStyles.checkMark}>✓</Text>
                              </View>
                            ) : (
                              <View style={GinitStyles.checkPlaceholder} />
                            )}
                          </View>
                        </View>
                      </Pressable>
                      <PlaceCandidateDetailLinkRow
                        title={item.title}
                        link={item.link}
                        addressLine={addrLine}
                        disabled={resolving}
                        containerStyle={{ marginTop: 8, marginHorizontal: 12, marginBottom: 10 }}
                        onOpenUrl={(url, t) => setNaverPlaceWebModal({ url, title: t })}
                      />
                    </View>
                    {showInlineMap ? (
                      <View style={GinitStyles.inlineMapSlot}>
                        <GooglePlacePreviewMap latitude={lat} longitude={lng} height={200} borderRadius={12} />
                      </View>
                    ) : null}
                  </View>
                );
              }}
            />
          </View>

          <Pressable
            onPress={onConfirm}
            disabled={!canConfirm}
            style={({ pressed }) => [
              GinitStyles.ctaButton,
              GinitStyles.ctaButtonIsland,
              !canConfirm && GinitStyles.ctaButtonDisabled,
              pressed && canConfirm && GinitStyles.ctaButtonPressed,
            ]}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canConfirm }}>
            <LinearGradient
              colors={GinitTheme.colors.ctaGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={GinitStyles.buttonGradientBg}
              pointerEvents="none"
            />
            <Text style={GinitStyles.ctaButtonLabel}>확인</Text>
          </Pressable>

          <NaverPlaceWebViewModal
            visible={naverPlaceWebModal != null}
            url={naverPlaceWebModal?.url}
            pageTitle={naverPlaceWebModal?.title ?? '상세 정보'}
            onClose={() => setNaverPlaceWebModal(null)}
          />
        </SafeAreaView>
    </View>
  );
}

export const PlaceSearchScreen = memo(PlaceSearchScreenInner);

const styles = StyleSheet.create({
  enteringStaticVeil: {
    backgroundColor: '#E8EEF8',
  },
});

export default function PlaceSearchRoute() {
  const { initialQuery, voteRowId, createAutopilot } = useLocalSearchParams<{
    initialQuery?: string | string[];
    voteRowId?: string | string[];
    createAutopilot?: string | string[];
  }>();
  return (
    <PlaceSearchScreen
      useInlineMapPreview
      initialQuery={pickParam(initialQuery)?.trim()}
      voteRowId={pickParam(voteRowId)?.trim()}
      createAutopilot={pickParam(createAutopilot)?.trim()}
    />
  );
}
