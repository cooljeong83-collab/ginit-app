import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GinitCard } from '@/components/ginit';
import { GinitTheme } from '@/constants/ginit-theme';
import type { Category } from '@/src/lib/categories';
import { subscribeCategories } from '@/src/lib/categories';
import {
  FEED_LOCATION_FALLBACK_SHORT,
  resolveFeedHeaderLocationLabel,
} from '@/src/lib/feed-display-location';
import type { Meeting } from '@/src/lib/meetings';
import { subscribeMeetings } from '@/src/lib/meetings';

const DEFAULT_THUMB =
  'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=400&h=400&fit=crop&q=80';

/** 지역 설정 UI용 샘플 — 구 단위(추후 지도·검색과 연동) */
const MOCK_REGION_ROWS = [
  { id: 'gangnam', label: '강남구' },
  { id: 'mapo', label: '마포구' },
  { id: 'songpa', label: '송파구' },
  { id: 'ydp', label: '영등포구' },
] as const;

type FeedChip = { filterId: string | null; label: string };

function GlassCategoryChip({
  label,
  active,
  onPress,
  maxLabelWidth,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  maxLabelWidth: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label} 카테고리 필터`}
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.chipPressable,
        { maxWidth: maxLabelWidth },
        pressed && !active && styles.chipPressed,
      ]}>
      <View style={[styles.chipClip, active && styles.chipClipActive]}>
        {!active ? (
          <>
            {Platform.OS === 'android' ? (
              <View style={[StyleSheet.absoluteFillObject, styles.chipAndroidFrost]} />
            ) : Platform.OS === 'web' ? (
              <View style={[StyleSheet.absoluteFillObject, styles.chipWebFrost]} />
            ) : (
              <BlurView
                intensity={GinitTheme.glassModal.blurIntensity}
                tint="light"
                style={StyleSheet.absoluteFillObject}
                experimentalBlurMethod="dimezisBlurView"
              />
            )}
            <View style={[StyleSheet.absoluteFillObject, styles.chipVeil]} pointerEvents="none" />
            <View style={[StyleSheet.absoluteFillObject, styles.chipInnerBorder]} pointerEvents="none" />
          </>
        ) : (
          <View style={[StyleSheet.absoluteFillObject, { backgroundColor: GinitTheme.trustBlue }]} />
        )}
        <View style={styles.chipLabelRow}>
          <Text
            style={[styles.chipGlassLabel, active && styles.chipGlassLabelActive, { maxWidth: maxLabelWidth - 28 }]}
            numberOfLines={1}>
            {label}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

function meetingMatchesCategoryFilter(m: Meeting, filterId: string | null, categories: Category[]): boolean {
  if (filterId == null) return true;
  const selected = categories.find((c) => c.id === filterId);
  const selectedLabel = selected?.label?.trim() ?? '';
  const mid = m.categoryId?.trim();
  if (mid && mid === filterId) return true;
  const ml = (m.categoryLabel ?? '').trim();
  if (ml && selectedLabel && ml === selectedLabel) return true;
  return false;
}

export default function FeedScreen() {
  const { width: windowWidth } = useWindowDimensions();
  /** 가로 칩이 화면에 맞게 읽히도록 최대 너비 (패딩·여백 반영) */
  const categoryChipMaxWidth = Math.min(200, Math.max(100, windowWidth * 0.42));

  const [regionLabel, setRegionLabel] = useState(FEED_LOCATION_FALLBACK_SHORT);
  const [locationResolving, setLocationResolving] = useState(true);
  const manualRegionPickRef = useRef(false);
  const [regionModalOpen, setRegionModalOpen] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);

  const [categories, setCategories] = useState<Category[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [chipsMoreRight, setChipsMoreRight] = useState(false);
  const chipsOffsetXRef = useRef(0);
  const chipsLayoutWRef = useRef(0);
  const chipsContentWRef = useRef(0);

  const recomputeChipsMoreRight = useCallback(() => {
    const x = chipsOffsetXRef.current;
    const cw = chipsContentWRef.current;
    const lw = chipsLayoutWRef.current;
    if (lw <= 0 || cw <= 0) {
      setChipsMoreRight(false);
      return;
    }
    const more = cw > lw + 4 && cw - x - lw > 8;
    setChipsMoreRight(more);
  }, []);

  const onCategoryChipsScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    chipsOffsetXRef.current = contentOffset.x;
    chipsContentWRef.current = contentSize.width;
    chipsLayoutWRef.current = layoutMeasurement.width;
    const more =
      contentSize.width > layoutMeasurement.width + 4 &&
      contentSize.width - contentOffset.x - layoutMeasurement.width > 8;
    setChipsMoreRight(more);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLocationResolving(true);
      const label = await resolveFeedHeaderLocationLabel();
      if (cancelled) return;
      if (manualRegionPickRef.current) {
        setLocationResolving(false);
        return;
      }
      setRegionLabel(label);
      setLocationResolving(false);
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
    setLoading(true);
    const unsub = subscribeMeetings(
      (list) => {
        setMeetings(list);
        setListError(null);
        setLoading(false);
      },
      (msg) => {
        setListError(msg);
        setLoading(false);
      },
    );
    return unsub;
  }, []);

  useEffect(() => {
    if (selectedCategoryId == null) return;
    if (categories.length > 0 && !categories.some((c) => c.id === selectedCategoryId)) {
      setSelectedCategoryId(null);
    }
  }, [categories, selectedCategoryId]);

  const feedChips: FeedChip[] = useMemo(() => {
    const countByCategoryId = new Map<string, number>();
    for (const m of meetings) {
      const cid = m.categoryId?.trim();
      if (cid) {
        countByCategoryId.set(cid, (countByCategoryId.get(cid) ?? 0) + 1);
        continue;
      }
      const lab = m.categoryLabel?.trim();
      if (!lab) continue;
      const matched = categories.find((c) => c.label.trim() === lab);
      if (matched) {
        countByCategoryId.set(matched.id, (countByCategoryId.get(matched.id) ?? 0) + 1);
      }
    }

    const sorted = [...categories].sort((a, b) => {
      const na = countByCategoryId.get(a.id) ?? 0;
      const nb = countByCategoryId.get(b.id) ?? 0;
      if (nb !== na) return nb - na;
      if (a.order !== b.order) return a.order - b.order;
      return a.label.localeCompare(b.label, 'ko');
    });

    return [{ filterId: null, label: '전체' }, ...sorted.map((c) => ({ filterId: c.id, label: c.label }))];
  }, [categories, meetings]);

  const filteredMeetings = useMemo(
    () => meetings.filter((m) => meetingMatchesCategoryFilter(m, selectedCategoryId, categories)),
    [meetings, selectedCategoryId, categories],
  );

  const openRegionModal = useCallback(() => setRegionModalOpen(true), []);
  const closeRegionModal = useCallback(() => setRegionModalOpen(false), []);
  const pickRegion = useCallback((shortLabel: string) => {
    manualRegionPickRef.current = true;
    setRegionLabel(shortLabel);
    setLocationResolving(false);
    setRegionModalOpen(false);
  }, []);

  const selectedFilterLabel = useMemo(() => {
    if (selectedCategoryId == null) return null;
    return categories.find((c) => c.id === selectedCategoryId)?.label ?? null;
  }, [categories, selectedCategoryId]);

  const regionDisplayShort = locationResolving ? '위치 확인 중…' : regionLabel;

  return (
    <LinearGradient colors={['#DCEEFF', '#F6FAFF', '#FFF4ED']} locations={[0, 0.45, 1]} style={styles.gradient}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled">
          <View style={styles.feedHeader}>
            <View style={styles.feedHeaderTopRow}>
              <Pressable
                onPress={openRegionModal}
                style={styles.locationRow}
                accessibilityRole="button"
                accessibilityLabel={`현재 위치 ${regionDisplayShort}, 지역 설정`}>
                <Text style={styles.locationText} numberOfLines={1}>
                  {regionDisplayShort}
                </Text>
                <Ionicons name="chevron-down" size={18} color={GinitTheme.trustBlue} />
              </Pressable>
              <View style={styles.headerActions}>
                <Pressable accessibilityRole="button" hitSlop={10}>
                  <Ionicons name="search-outline" size={24} color="#0f172a" />
                </Pressable>
                <Pressable accessibilityRole="button" hitSlop={10} style={styles.bellWrap}>
                  <Ionicons name="notifications-outline" size={24} color="#0f172a" />
                  <View style={styles.badge} />
                </Pressable>
              </View>
            </View>
            <View style={styles.chipsFullBleed}>
              <View style={styles.chipsStripWrap}>
                <ScrollView
                  horizontal
                  nestedScrollEnabled
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chipsRow}
                  style={styles.chipsScroll}
                  onScroll={onCategoryChipsScroll}
                  scrollEventThrottle={16}
                  onContentSizeChange={(w) => {
                    chipsContentWRef.current = w;
                    recomputeChipsMoreRight();
                  }}
                  onLayout={(e) => {
                    chipsLayoutWRef.current = e.nativeEvent.layout.width;
                    recomputeChipsMoreRight();
                  }}>
                  {feedChips.map((chip) => {
                    const active = chip.filterId === selectedCategoryId;
                    return (
                      <GlassCategoryChip
                        key={chip.filterId ?? 'all'}
                        label={chip.label}
                        active={active}
                        maxLabelWidth={categoryChipMaxWidth}
                        onPress={() => setSelectedCategoryId(chip.filterId)}
                      />
                    );
                  })}
                </ScrollView>
                {chipsMoreRight ? (
                  <LinearGradient
                    pointerEvents="none"
                    accessibilityElementsHidden
                    colors={[
                      'rgba(220, 238, 255, 0)',
                      'rgba(232, 244, 255, 0.45)',
                      'rgba(246, 250, 255, 0.88)',
                    ]}
                    locations={[0, 0.55, 1]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.chipsScrollEdgeFade}
                  />
                ) : null}
              </View>
            </View>
          </View>

          <GinitCard appearance="light" style={styles.heroCard}>
            <View style={styles.heroPanel}>
              <View style={styles.heroInner}>
                <View style={styles.heroCopy}>
                  <Text style={styles.heroTitle}>AI가 제안하는 완벽한 모임!</Text>
                  <Text style={styles.heroDesc}>
                    오늘 저녁, {locationResolving ? '내 주변' : `${regionLabel} 근처`}에서 새로운 모임을 찾아보세요. 바로
                    참여해 보세요.
                  </Text>
                </View>
                <View style={styles.heroArt} accessibilityLabel="AI 추천">
                  <Text style={styles.heroEmoji}>🤖</Text>
                  <Text style={styles.heroSparkle}>✨</Text>
                </View>
              </View>
            </View>
          </GinitCard>

          <Text style={styles.sectionLabel}>
            모임{selectedFilterLabel ? ` · ${selectedFilterLabel}` : ''}
          </Text>

          {loading ? (
            <View style={styles.centerRow}>
              <ActivityIndicator />
              <Text style={styles.muted}>불러오는 중…</Text>
            </View>
          ) : null}

          {listError ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorTitle}>목록을 불러오지 못했어요</Text>
              <Text style={styles.errorBody}>{listError}</Text>
            </View>
          ) : null}

          {!loading && !listError && meetings.length === 0 ? (
            <Text style={styles.empty}>등록된 모임이 없습니다. + 버튼으로 첫 모임을 만들어 보세요.</Text>
          ) : null}

          {!loading && !listError && meetings.length > 0 && filteredMeetings.length === 0 ? (
            <Text style={styles.empty}>
              {selectedFilterLabel
                ? `「${selectedFilterLabel}」 카테고리 모임이 아직 없어요. 다른 칩을 선택해 보세요.`
                : '조건에 맞는 모임이 없어요.'}
            </Text>
          ) : null}

          {filteredMeetings.map((m) => (
            <Pressable key={m.id} style={styles.meetRow} accessibilityRole="button">
              <Image
                source={{ uri: m.imageUrl?.trim() ? m.imageUrl.trim() : DEFAULT_THUMB }}
                style={styles.thumb}
                contentFit="cover"
              />
              <View style={styles.meetBody}>
                <View style={styles.meetTop}>
                  <Text style={styles.meetTitle} numberOfLines={1}>
                    {m.title}
                  </Text>
                  <Text style={styles.distance} numberOfLines={2}>
                    {m.address?.trim() || m.location}
                  </Text>
                </View>
                <View style={styles.tagRow}>
                  <View style={styles.tagPill}>
                    <Text style={styles.tagText} numberOfLines={1}>
                      {[m.categoryLabel, `최대 ${m.capacity}명`].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  {m.isPublic === false ? (
                    <View style={styles.lockPill}>
                      <Text style={styles.lockPillText}>비공개</Text>
                    </View>
                  ) : null}
                </View>
                {m.scheduleDate && m.scheduleTime ? (
                  <Text style={styles.schedule} numberOfLines={1}>
                    {m.scheduleDate} {m.scheduleTime}
                  </Text>
                ) : null}
                <Text style={styles.price} numberOfLines={2}>
                  {m.description}
                </Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>

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
              <Text style={styles.modalHint}>동네를 선택하면 피드 상단에 표시돼요. (추후 검색·지도와 연동)</Text>
              {MOCK_REGION_ROWS.map((row) => (
                <Pressable
                  key={row.id}
                  onPress={() => pickRegion(row.label)}
                  style={({ pressed }) => [styles.modalRow, pressed && styles.modalRowPressed]}
                  accessibilityRole="button">
                  <Text style={styles.modalRowLabel}>{row.label}</Text>
                  {regionLabel === row.label ? (
                    <Ionicons name="checkmark-circle" size={22} color={GinitTheme.trustBlue} />
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
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: {
    flex: 1,
  },
  safe: {
    flex: 1,
  },
  scroll: {
    paddingHorizontal: 20,
    paddingBottom: 28,
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
  locationRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minWidth: 0,
  },
  locationText: {
    flex: 1,
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
  chipsFullBleed: {
    alignSelf: 'stretch',
    marginHorizontal: -20,
    paddingHorizontal: 20,
  },
  bellWrap: {
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: GinitTheme.pointOrange,
    borderWidth: 1,
    borderColor: '#fff',
  },
  chipsStripWrap: {
    position: 'relative',
  },
  chipsScroll: {
    width: '100%',
  },
  chipsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 2,
    /** 다음 칩이 살짝 비치도록 — 페이드만 얹고 가짜 UI는 쓰지 않음 */
    paddingRight: 14,
  },
  /** 피드 상단 그라데이션(#DCEEFF→#F6FAFF)에 맞춘 좁은 스크롤 엣지 페이드 */
  chipsScrollEdgeFade: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 28,
  },
  chipPressable: {
    borderRadius: 20,
    minWidth: 72,
  },
  chipPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.98 }],
  },
  chipClip: {
    borderRadius: 16,
    overflow: 'hidden',
    paddingHorizontal: 12,
    paddingVertical: 6,
    justifyContent: 'center',
    minHeight: 32,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.55)',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 1,
  },
  chipClipActive: {
    borderColor: GinitTheme.trustBlue,
    shadowColor: GinitTheme.trustBlue,
    shadowOpacity: 0.22,
  },
  chipAndroidFrost: {
    backgroundColor: 'rgba(255, 255, 255, 0.78)',
  },
  chipWebFrost: {
    backgroundColor: 'rgba(255, 255, 255, 0.82)',
  },
  chipVeil: {
    backgroundColor: GinitTheme.glass.overlayLight,
  },
  chipInnerBorder: {
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.45)',
    borderRadius: 16,
  },
  chipLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: '100%',
  },
  chipGlassLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
    textAlign: 'center',
    lineHeight: 18,
  },
  chipGlassLabelActive: {
    color: '#FFFFFF',
  },
  heroCard: {
    marginBottom: 22,
    borderColor: 'rgba(255, 255, 255, 0.55)',
  },
  heroPanel: {
    paddingHorizontal: 4,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.78)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.95)',
  },
  heroInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  heroCopy: {
    flex: 1,
    gap: 8,
  },
  heroTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0b1220',
    letterSpacing: -0.3,
  },
  heroDesc: {
    fontSize: 15,
    lineHeight: 22,
    color: '#334155',
  },
  heroArt: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 82, 204, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: 'rgba(0, 82, 204, 0.14)',
  },
  heroEmoji: {
    fontSize: 36,
  },
  heroSparkle: {
    position: 'absolute',
    top: 6,
    right: 8,
    fontSize: 14,
  },
  sectionLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 12,
  },
  centerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
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
  meetRow: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    borderRadius: 20,
    padding: 12,
    marginBottom: 14,
    gap: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.06)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
  },
  thumb: {
    width: 88,
    height: 88,
    borderRadius: 16,
    backgroundColor: '#e2e8f0',
  },
  meetBody: {
    flex: 1,
    justifyContent: 'center',
    gap: 6,
  },
  meetTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  meetTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  distance: {
    maxWidth: '40%',
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
    textAlign: 'right',
  },
  tagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  tagPill: {
    alignSelf: 'flex-start',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  tagText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  lockPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(0, 82, 204, 0.1)',
  },
  lockPillText: {
    fontSize: 11,
    fontWeight: '800',
    color: GinitTheme.trustBlue,
  },
  schedule: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
  },
  price: {
    fontSize: 13,
    fontWeight: '500',
    color: '#334155',
    lineHeight: 18,
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
