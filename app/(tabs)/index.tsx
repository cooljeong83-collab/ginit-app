import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { InAppAlarmsBellButton } from '@/components/in-app-alarms/InAppAlarmsBellButton';
import { GlassCategoryChip } from '@/components/feed/GlassCategoryChip';
import { MeetingFeedRow } from '@/components/feed/MeetingFeedRow';
import { GinitCard } from '@/components/ginit';
import { ScreenShell } from '@/components/ui';
import { GinitTheme } from '@/constants/ginit-theme';
import type { Category } from '@/src/lib/categories';
import { subscribeCategories } from '@/src/lib/categories';
import {
  FEED_LOCATION_FALLBACK_SHORT,
  resolveFeedLocationContext,
} from '@/src/lib/feed-display-location';
import {
  buildFeedChips,
  listSortModeLabel,
  meetingMatchesCategoryFilter,
  type MeetingListSortMode,
  sortMeetingsForFeed,
} from '@/src/lib/feed-meeting-utils';
import { loadFeedLocationCache, saveFeedLocationCache } from '@/src/lib/feed-location-cache';
import type { LatLng } from '@/src/lib/geo-distance';
import { useUserSession } from '@/src/context/UserSessionContext';
import { isUserJoinedMeeting } from '@/src/lib/joined-meetings';
import type { Meeting } from '@/src/lib/meetings';
import { fetchMeetingsOnce, getMeetingRecruitmentPhase, subscribeMeetings } from '@/src/lib/meetings';

/** 지역 설정 UI용 샘플 — 구 단위(추후 지도·검색과 연동) */
const MOCK_REGION_ROWS = [
  { id: 'gangnam', label: '강남구' },
  { id: 'mapo', label: '마포구' },
  { id: 'songpa', label: '송파구' },
  { id: 'ydp', label: '영등포구' },
] as const;

export default function FeedScreen() {
  const router = useRouter();
  const { phoneUserId } = useUserSession();
  const { width: windowWidth } = useWindowDimensions();
  /** 가로 칩이 화면에 맞게 읽히도록 최대 너비 (패딩·여백 반영) */
  const categoryChipMaxWidth = Math.min(200, Math.max(100, windowWidth * 0.42));

  const [regionLabel, setRegionLabel] = useState(FEED_LOCATION_FALLBACK_SHORT);
  const regionLabelRef = useRef(FEED_LOCATION_FALLBACK_SHORT);
  const manualRegionPickRef = useRef(false);
  /** 거리·거리순 정렬에 쓰는 기준점: 캐시 좌표 → GPS로 갱신(실패 시 캐시 유지) */
  const userCoordsRef = useRef<LatLng | null>(null);
  const [regionModalOpen, setRegionModalOpen] = useState(false);
  const [sortFilterModalOpen, setSortFilterModalOpen] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [userCoords, setUserCoords] = useState<LatLng | null>(null);
  const [listSortMode, setListSortMode] = useState<MeetingListSortMode>('latest');
  /** true면 모집중(정원 미달·미확정) 모임만 표시. 기본값 off */
  const [recruitingOnly, setRecruitingOnly] = useState(false);

  const [categories, setCategories] = useState<Category[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
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

  useEffect(() => {
    regionLabelRef.current = regionLabel;
  }, [regionLabel]);

  useEffect(() => {
    userCoordsRef.current = userCoords;
  }, [userCoords]);

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
      const cached = await loadFeedLocationCache();
      if (cancelled) return;

      let coordsForDistance = null as LatLng | null;
      if (cached) {
        setRegionLabel(cached.label);
        coordsForDistance = cached.coords;
        setUserCoords(coordsForDistance);
      }

      const ctx = await resolveFeedLocationContext();
      if (cancelled) return;
      if (!manualRegionPickRef.current) {
        setRegionLabel(ctx.labelShort);
      }
      coordsForDistance = ctx.coords ?? coordsForDistance;
      setUserCoords(coordsForDistance);

      const labelToSave = manualRegionPickRef.current ? regionLabelRef.current : ctx.labelShort;
      await saveFeedLocationCache(labelToSave, coordsForDistance);
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

  const feedChips = useMemo(() => buildFeedChips(meetings, categories), [categories, meetings]);

  const filteredMeetings = useMemo(() => {
    return meetings.filter((m) => {
      if (!meetingMatchesCategoryFilter(m, selectedCategoryId, categories)) return false;
      if (recruitingOnly && getMeetingRecruitmentPhase(m) !== 'recruiting') return false;
      return true;
    });
  }, [meetings, selectedCategoryId, categories, recruitingOnly]);

  const sortedFilteredMeetings = useMemo(
    () => sortMeetingsForFeed(filteredMeetings, listSortMode, userCoords),
    [filteredMeetings, listSortMode, userCoords],
  );

  const openRegionModal = useCallback(() => setRegionModalOpen(true), []);
  const closeRegionModal = useCallback(() => setRegionModalOpen(false), []);
  const pickRegion = useCallback((shortLabel: string) => {
    manualRegionPickRef.current = true;
    regionLabelRef.current = shortLabel;
    setRegionLabel(shortLabel);
    setRegionModalOpen(false);
    void saveFeedLocationCache(shortLabel, userCoordsRef.current);
  }, []);

  const selectedFilterLabel = useMemo(() => {
    if (selectedCategoryId == null) return null;
    return categories.find((c) => c.id === selectedCategoryId)?.label ?? null;
  }, [categories, selectedCategoryId]);

  const sortComboLabel = useMemo(() => listSortModeLabel(listSortMode), [listSortMode]);

  const openSortFilterModal = useCallback(() => setSortFilterModalOpen(true), []);
  const closeSortFilterModal = useCallback(() => setSortFilterModalOpen(false), []);

  const onPullRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await fetchMeetingsOnce();
      if (result.ok) {
        setMeetings(result.meetings);
        setListError(null);
      } else {
        setListError(result.message);
      }
    } finally {
      setRefreshing(false);
    }
  }, []);

  return (
    <ScreenShell padded={false} style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onPullRefresh}
              tintColor={GinitTheme.colors.primary}
              colors={[GinitTheme.colors.primary]}
            />
          }>
          <View style={styles.feedHeader}>
            <View style={styles.feedHeaderTopRow}>
              <View style={styles.locationCluster}>
                <Text style={styles.locationText} numberOfLines={1} accessibilityLabel={`현재 표시 지역 ${regionLabel}`}>
                  {regionLabel}
                </Text>
                <Pressable
                  onPress={openRegionModal}
                  style={styles.locationExpandBtn}
                  accessibilityRole="button"
                  accessibilityLabel="지역 설정 열기"
                  hitSlop={8}>
                  <Ionicons name="chevron-down" size={20} color={GinitTheme.colors.primary} />
                </Pressable>
              </View>
              <View style={styles.headerActions}>
                <Pressable accessibilityRole="button" hitSlop={10}>
                  <Ionicons name="search-outline" size={24} color="#0f172a" />
                </Pressable>
                <InAppAlarmsBellButton />
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
                {chipsMoreRight ? <View pointerEvents="none" accessibilityElementsHidden style={styles.chipsScrollEdgeFade} /> : null}
              </View>
            </View>
          </View>

          <GinitCard appearance="light" style={styles.heroCard}>
            <View style={styles.heroPanel}>
              <View style={styles.heroInner}>
                <View style={styles.heroCopy}>
                  <Text style={styles.heroTitle}>AI가 제안하는 완벽한 모임!</Text>
                  <Text style={styles.heroDesc}>
                    오늘 저녁, {userCoords ? `${regionLabel} 근처` : '내 주변'}에서 새로운 모임을 찾아보세요. 바로
                    참여해 보세요.
                  </Text>
                </View>
                <View style={styles.heroArt} accessibilityLabel="AI 추천">
                  <View style={styles.heroLogoWrap} pointerEvents="none">
                    <Image
                      source={require('@/assets/images/icon.png')}
                      style={styles.heroLogo}
                      contentFit="contain"
                    />
                  </View>
                  <Text style={styles.heroSparkle}>✨</Text>
                </View>
              </View>
            </View>
          </GinitCard>

          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionLabel}>
              모임{selectedFilterLabel ? ` · ${selectedFilterLabel}` : ''}
            </Text>
            <View style={styles.sectionHeaderControls}>
              <Pressable
                onPress={() => setRecruitingOnly((v) => !v)}
                style={[styles.recruitTogglePill, recruitingOnly && styles.recruitTogglePillOn]}
                accessibilityRole="button"
                accessibilityLabel="모집중만 보기"
                accessibilityState={{ selected: recruitingOnly }}>
                <Text style={[styles.recruitTogglePillLabel, recruitingOnly && styles.recruitTogglePillLabelOn]}>
                  모집중
                </Text>
              </Pressable>
              <Pressable
                onPress={openSortFilterModal}
                style={({ pressed }) => [styles.sortComboTrigger, pressed && styles.sortComboTriggerPressed]}
                accessibilityRole="button"
                accessibilityLabel={`정렬, 현재 ${sortComboLabel}`}
                accessibilityHint="탭하면 정렬 방식을 바꿀 수 있어요">
                <Text style={styles.sortComboTriggerText} numberOfLines={1} ellipsizeMode="tail">
                  {sortComboLabel}
                </Text>
                <Ionicons name="chevron-down" size={18} color="#475569" />
              </Pressable>
            </View>
          </View>

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
                : recruitingOnly
                  ? '모집중인 모임이 없어요. 모집중만 표시를 끄면 모집 완료·확정 모임도 볼 수 있어요.'
                  : '조건에 맞는 모임이 없어요.'}
            </Text>
          ) : null}

          {sortedFilteredMeetings.map((m) => (
            <MeetingFeedRow
              key={m.id}
              meeting={m}
              userCoords={userCoords}
              joined={isUserJoinedMeeting(m, phoneUserId)}
              onPress={() => router.push(`/meeting/${m.id}`)}
            />
          ))}
        </ScrollView>

        <Modal
          visible={sortFilterModalOpen}
          animationType="fade"
          transparent
          onRequestClose={closeSortFilterModal}>
          <View style={styles.modalRoot}>
            <Pressable
              style={StyleSheet.absoluteFillObject}
              onPress={closeSortFilterModal}
              accessibilityRole="button"
              accessibilityLabel="정렬 닫기"
            />
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
                    {selected ? (
                      <Ionicons name="checkmark-circle" size={22} color={GinitTheme.colors.primary} />
                    ) : (
                      <Ionicons name="ellipse-outline" size={22} color="#cbd5e1" />
                    )}
                  </Pressable>
                );
              })}
              <Pressable onPress={closeSortFilterModal} style={styles.modalCloseBtn} accessibilityRole="button">
                <Text style={styles.modalCloseLabel}>닫기</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

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
                    <Ionicons name="checkmark-circle" size={22} color={GinitTheme.colors.primary} />
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
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: GinitTheme.colors.bg },
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
  locationCluster: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
    gap: 2,
  },
  locationText: {
    flex: 1,
    flexShrink: 1,
    fontSize: 20,
    fontWeight: '700',
    color: GinitTheme.trustBlue,
    minWidth: 0,
  },
  locationExpandBtn: {
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderRadius: 8,
    flexShrink: 0,
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
    backgroundColor: 'rgba(246, 250, 255, 0.88)',
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
  heroLogo: {
    width: 46,
    height: 46,
  },
  heroLogoWrap: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.86)',
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: 'rgba(15, 23, 42, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: 'rgba(15, 23, 42, 0.12)',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 1,
    shadowRadius: 10,
    elevation: 3,
  },
  heroSparkle: {
    position: 'absolute',
    top: 6,
    right: 8,
    fontSize: 14,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 12,
    flexWrap: 'wrap',
  },
  sectionLabel: {
    flex: 1,
    minWidth: 120,
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  sectionHeaderControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
    minWidth: 0,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  sortComboTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: 220,
    minWidth: 120,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.82)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.12)',
  },
  sortComboTriggerPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderColor: 'rgba(0, 82, 204, 0.25)',
  },
  sortComboTriggerText: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  /** 정렬 콤보 옆 — 모집중만 표시 토글(기존 pill과 동일 크기·초록 on, 기본 off) */
  recruitTogglePill: {
    flexShrink: 0,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.55)',
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
