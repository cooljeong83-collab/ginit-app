import { useFocusEffect } from '@react-navigation/native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  InteractionManager,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GooglePlacePreviewMap } from '@/components/GooglePlacePreviewMap';
import { GinitPlaceholderColor, GinitStyles } from '@/constants/GinitStyles';
import { GinitTheme } from '@/constants/ginit-theme';
import { setPendingMeetingPlace, setPendingVotePlaceRow } from '@/src/lib/meeting-place-bridge';
import type { NaverLocalPlace } from '@/src/lib/naver-local-search';
import { layoutAnimateEaseInEaseOut } from '@/src/lib/android-layout-animation';
import { ensureNearbySearchBias } from '@/src/lib/nearby-search-bias';
import { resolveNaverPlaceCoordinates, searchNaverLocalPlaces } from '@/src/lib/naver-local-search';

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
};

function PlaceSearchScreenInner({ useInlineMapPreview = false, initialQuery, voteRowId }: PlaceSearchScreenProps) {
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
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<NaverLocalPlace[]>([]);
  const [selected, setSelected] = useState<NaverLocalPlace | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [resolving, setResolving] = useState(false);

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
      setLoading(true);
      try {
        const { bias } = await ensureNearbySearchBias();
        const list = await searchNaverLocalPlaces(trimmed, { locationBias: bias });
        if (opts?.signal?.aborted) return;
        setHasSearched(true);
        setResults(list);
        if (useInlineMapPreview) {
          InteractionManager.runAfterInteractions(() => animateListLayout());
        }
        setSelected(null);
      } catch (e) {
        if (opts?.signal?.aborted) return;
        const msg = e instanceof Error ? e.message : '검색에 실패했습니다.';
        setError(msg);
        setResults([]);
        setSelected(null);
      } finally {
        setLoading(false);
      }
    },
    [useInlineMapPreview],
  );

  const onSearchPress = useCallback(() => {
    void runSearch(query);
  }, [query, runSearch]);

  useFocusEffect(
    useCallback(() => {
      const seed = initialQuery?.trim();
      if (!seed) return undefined;

      const ac = new AbortController();
      let focusTimer: ReturnType<typeof setTimeout> | undefined;
      const interaction = InteractionManager.runAfterInteractions(() => {
        void (async () => {
          setSelected(null);
          setError(null);
          await runSearch(seed, { signal: ac.signal });
          if (ac.signal.aborted) return;
          focusTimer = setTimeout(() => {
            searchInputRef.current?.focus();
            const len = seed.length;
            searchInputRef.current?.setNativeProps({
              selection: { start: len, end: len },
            });
          }, 140);
        })();
      });

      return () => {
        ac.abort();
        interaction.cancel?.();
        if (focusTimer) clearTimeout(focusTimer);
      };
    }, [initialQuery, runSearch]),
  );

  const onSelectPlace = useCallback(
    async (item: NaverLocalPlace) => {
      Keyboard.dismiss();
      if (useInlineMapPreview) {
        InteractionManager.runAfterInteractions(() => animateListLayout());
      }
      setError(null);
      setSelected(item);
      setResolving(true);
      try {
        const resolved = await resolveNaverPlaceCoordinates(item);
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
    const payload = {
      placeName: selected.title,
      address: addr,
      latitude: selected.latitude,
      longitude: selected.longitude,
    };
    if (voteRowId?.trim()) {
      setPendingVotePlaceRow({ ...payload, rowId: voteRowId.trim() });
    } else {
      setPendingMeetingPlace(payload);
    }
    router.back();
  }, [router, selected, voteRowId]);

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
      <KeyboardAvoidingView
        style={GinitStyles.flexFill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}>
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
              onSubmitEditing={() => void runSearch(query)}
              onFocus={() => setSearchFocused(true)}
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
              <ActivityIndicator color={GinitTheme.trustBlue} />
              <Text style={GinitStyles.mutedText}>{loading ? '검색 중…' : '선택한 주소로 위치 찾는 중…'}</Text>
            </View>
          ) : null}

          {error ? (
            <View style={GinitStyles.errorBanner}>
              <Text style={GinitStyles.errorBannerText}>{error}</Text>
            </View>
          ) : null}

          <View style={GinitStyles.listWrap}>
            <FlatList
              data={results}
              keyExtractor={(item) => item.id}
              extraData={`${selected?.id ?? ''}:${String(selected?.latitude)}:${String(selected?.longitude)}:${resolving ? '1' : '0'}`}
              keyboardShouldPersistTaps="handled"
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
                    검색 결과가 없어요. EXPO_PUBLIC_NAVER_SEARCH_CLIENT_ID·SECRET과 지역 검색 API 사용 신청을
                    확인하거나, 도로명·지번 주소로 다시 검색해 보세요.
                  </Text>
                )
              }
              renderItem={({ item }) => {
                const active = selected?.id === item.id;
                const resolved = active && item.latitude != null && item.longitude != null;
                const lat = item.latitude;
                const lng = item.longitude;
                const showInlineMap =
                  useInlineMapPreview && active && lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng);

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
                            <Text style={GinitStyles.listItemAddress} numberOfLines={2}>
                              {item.roadAddress || item.address}
                            </Text>
                            {item.category ? <Text style={GinitStyles.listItemCategory}>{item.category}</Text> : null}
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
        </SafeAreaView>
      </KeyboardAvoidingView>
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
  const { initialQuery, voteRowId } = useLocalSearchParams<{
    initialQuery?: string | string[];
    voteRowId?: string | string[];
  }>();
  return (
    <PlaceSearchScreen
      useInlineMapPreview
      initialQuery={pickParam(initialQuery)?.trim()}
      voteRowId={pickParam(voteRowId)?.trim()}
    />
  );
}
