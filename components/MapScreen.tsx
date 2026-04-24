import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  InteractionManager,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { NaverMapMarkerOverlay, NaverMapView } from '@mj-studio/react-native-naver-map';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
import { formatDistanceForList, meetingDistanceMetersFromUser, type LatLng } from '@/src/lib/geo-distance';
import { centerRegionToNaverRegion, type CenterLatLngRegion } from '@/src/lib/naver-map-region';
import { resolveMeetingListThumbnailUri } from '@/src/lib/meeting-list-thumbnail';
import type { Meeting, MeetingRecruitmentPhase } from '@/src/lib/meetings';
import { getMeetingRecruitmentPhase } from '@/src/lib/meetings';
import { subscribeMeetingsHybrid } from '@/src/lib/meetings-hybrid';

const MOCK_REGION_ROWS = [
  { id: 'gangnam', label: '강남구' },
  { id: 'mapo', label: '마포구' },
  { id: 'songpa', label: '송파구' },
  { id: 'ydp', label: '영등포구' },
] as const;

const { height: WINDOW_H } = Dimensions.get('window');

const SPRING = { damping: 22, stiffness: 260, mass: 0.85 };

/** 카드 고정 높이(118) + 아래 여백(10) — getItemLayout·스크롤 오프셋과 일치 */
const LIST_CARD_HEIGHT = 118;
const LIST_CARD_GAP = 10;
const LIST_ITEM_STRIDE = LIST_CARD_HEIGHT + LIST_CARD_GAP;

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

function computeMapRegion(meetings: Meeting[], userCoords: LatLng | null): CenterLatLngRegion {
  const fallbackLat = userCoords?.latitude ?? 37.5665;
  const fallbackLng = userCoords?.longitude ?? 126.978;
  const withCoords = meetings.filter(
    (m) =>
      typeof m.latitude === 'number' &&
      typeof m.longitude === 'number' &&
      Number.isFinite(m.latitude) &&
      Number.isFinite(m.longitude),
  );
  if (withCoords.length === 0) {
    return {
      latitude: fallbackLat,
      longitude: fallbackLng,
      latitudeDelta: 0.09,
      longitudeDelta: 0.09,
    };
  }
  const lats = withCoords.map((m) => m.latitude as number);
  const lngs = withCoords.map((m) => m.longitude as number);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const midLat = (minLat + maxLat) / 2;
  const midLng = (minLng + maxLng) / 2;
  let dLat = (maxLat - minLat) * 1.45 + 0.025;
  let dLng = (maxLng - minLng) * 1.45 + 0.025;
  dLat = Math.min(Math.max(dLat, 0.028), 0.4);
  dLng = Math.min(Math.max(dLng, 0.028), 0.4);
  return { latitude: midLat, longitude: midLng, latitudeDelta: dLat, longitudeDelta: dLng };
}

export default function MapScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const meetingListRef = useRef<FlatList<Meeting>>(null);
  const listScrollY = useRef(0);
  const listContentH = useRef(0);
  const listLayoutH = useRef(0);
  const listScrollRaf = useRef<number | null>(null);

  const sheetExpanded = useMemo(() => Math.min(440, Math.round(WINDOW_H * 0.42)), []);
  const sheetCollapsed = useMemo(() => {
    const peek = Math.round(108 + Math.max(insets.bottom, 10));
    const maxPeek = sheetExpanded - 72;
    return Math.max(96, Math.min(peek, maxPeek));
  }, [insets.bottom, sheetExpanded]);

  const sheetHeight = useSharedValue(sheetExpanded);
  const dragStartHeight = useSharedValue(sheetExpanded);

  const animatedSheetStyle = useAnimatedStyle(() => ({
    height: sheetHeight.value,
  }));

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
          sheetHeight.value = Math.min(sheetExpanded, Math.max(sheetCollapsed, next));
        })
        .onEnd(() => {
          const mid = (sheetExpanded + sheetCollapsed) / 2;
          sheetHeight.value = withSpring(
            sheetHeight.value < mid ? sheetCollapsed : sheetExpanded,
            SPRING,
          );
        }),
    [sheetCollapsed, sheetExpanded],
  );

  const [regionLabel, setRegionLabel] = useState(FEED_LOCATION_FALLBACK_SHORT);
  const regionLabelRef = useRef(FEED_LOCATION_FALLBACK_SHORT);
  const manualRegionPickRef = useRef(false);
  const userCoordsRef = useRef<LatLng | null>(null);
  const [regionModalOpen, setRegionModalOpen] = useState(false);
  const [sortFilterModalOpen, setSortFilterModalOpen] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [userCoords, setUserCoords] = useState<LatLng | null>(null);
  const [listSortMode, setListSortMode] = useState<MeetingListSortMode>('latest');
  const [recruitingOnly, setRecruitingOnly] = useState(true);
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);

  const [categories, setCategories] = useState<Category[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

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
    const unsub = subscribeCategories((list) => setCategories(list), () => {});
    return unsub;
  }, []);

  useEffect(() => {
    setLoading(true);
    const unsub = subscribeMeetingsHybrid(
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

  const mapRegion = useMemo(
    () => computeMapRegion(sortedFilteredMeetings, userCoords),
    [sortedFilteredMeetings, userCoords],
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

  const openSortFilterModal = useCallback(() => setSortFilterModalOpen(true), []);
  const closeSortFilterModal = useCallback(() => setSortFilterModalOpen(false), []);

  const sortComboLabel = useMemo(() => listSortModeLabel(listSortMode), [listSortMode]);

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

  useEffect(() => {
    return () => {
      if (listScrollRaf.current != null) {
        cancelAnimationFrame(listScrollRaf.current);
        listScrollRaf.current = null;
      }
    };
  }, []);

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
      InteractionManager.runAfterInteractions(() => {
        setTimeout(() => scrollListToMeetingId(meetingId), 56);
      });
    },
    [scrollListToMeetingId],
  );

  return (
    <GestureHandlerRootView style={styles.root}>
      <View style={styles.mapWrap}>
        <NaverMapView
          style={StyleSheet.absoluteFillObject}
          region={centerRegionToNaverRegion(mapRegion)}
          animationDuration={450}
          locale="ko"
          isExtentBoundedInKorea
          isShowLocationButton={false}
          isShowZoomControls={false}
          isShowCompass={false}
          isShowScaleBar={false}
          locationOverlay={
            userCoords
              ? {
                  isVisible: true,
                  position: { latitude: userCoords.latitude, longitude: userCoords.longitude },
                }
              : { isVisible: false }
          }
          {...(Platform.OS === 'android' ? { isUseTextureViewAndroid: true } : {})}
          accessibilityLabel="모임 지도">
          {meetingsOnMap.map((m) => {
            const selected = m.id === selectedMeetingId;
            return (
              <NaverMapMarkerOverlay
                key={m.id}
                latitude={m.latitude as number}
                longitude={m.longitude as number}
                tintColor={selected ? GinitTheme.trustBlue : GinitTheme.pointOrange}
                onTap={() => onMeetingMarkerPress(m.id)}
              />
            );
          })}
        </NaverMapView>

        <View style={[styles.searchBarWrap, { paddingTop: insets.top + 8 }]}>
          <Pressable
            onPress={openRegionModal}
            style={({ pressed }) => [styles.searchBar, pressed && styles.searchBarPressed]}
            accessibilityRole="button"
            accessibilityLabel={`주변 검색, 현재 지역 ${regionLabel}`}>
            <Ionicons name="search-outline" size={18} color="#64748b" />
            <Text style={styles.searchBarText} numberOfLines={1}>
              {regionLabel} 주변 검색…
            </Text>
          </Pressable>
          <Pressable
            onPress={openSortFilterModal}
            style={({ pressed }) => [styles.filterIconBtn, pressed && styles.filterIconBtnPressed]}
            accessibilityRole="button"
            accessibilityLabel="정렬 선택">
            <Ionicons name="options-outline" size={22} color="#0f172a" />
          </Pressable>
        </View>
      </View>

      <Animated.View
        style={[
          styles.sheet,
          animatedSheetStyle,
          { paddingBottom: Math.max(insets.bottom, 10) },
        ]}>
        <GestureDetector gesture={sheetPanGesture}>
          <View
            style={styles.sheetHandleHit}
            accessibilityRole="adjustable"
            accessibilityLabel="목록 패널 크기"
            accessibilityHint="위아래로 드래그하면 지도와 목록 영역 크기를 바꿀 수 있어요">
            <View style={styles.sheetHandle} />
          </View>
        </GestureDetector>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipScrollContent}
          style={styles.chipScroll}>
          {feedChips.map((chip) => {
            const active = chip.filterId === selectedCategoryId;
            return (
              <Pressable
                key={chip.filterId ?? 'all'}
                onPress={() => setSelectedCategoryId(chip.filterId)}
                style={[styles.sheetChip, active && styles.sheetChipActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}>
                <Text style={[styles.sheetChipLabel, active && styles.sheetChipLabelActive]} numberOfLines={1}>
                  {chip.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.sheetToolbar}>
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
            accessibilityLabel={`정렬, 현재 ${sortComboLabel}`}>
            <Text style={styles.sortComboTriggerText} numberOfLines={1} ellipsizeMode="tail">
              {sortComboLabel}
            </Text>
            <Ionicons name="chevron-down" size={18} color="#475569" />
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.sheetLoading}>
            <ActivityIndicator />
            <Text style={styles.muted}>불러오는 중…</Text>
          </View>
        ) : null}

        {listError ? (
          <Text style={styles.sheetError}>{listError}</Text>
        ) : null}

        {!loading && !listError && sortedFilteredMeetings.length === 0 ? (
          <Text style={styles.sheetEmpty}>
            {recruitingOnly
              ? '모집중인 모임이 없어요. 모집중만 표시를 끄면 더 많은 모임이 보여요.'
              : '조건에 맞는 모임이 없어요.'}
          </Text>
        ) : null}

        <FlatList
          ref={meetingListRef}
          data={sortedFilteredMeetings}
          keyExtractor={(m) => m.id}
          style={styles.listScroll}
          contentContainerStyle={styles.listScrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          scrollEventThrottle={16}
          onScroll={onMeetingListScroll}
          onContentSizeChange={(_, h) => {
            listContentH.current = h;
          }}
          onLayout={(e) => {
            listLayoutH.current = e.nativeEvent.layout.height;
          }}
          getItemLayout={(_data, index) => ({
            length: LIST_ITEM_STRIDE,
            offset: LIST_ITEM_STRIDE * index,
            index,
          })}
          renderItem={({ item: m }) => {
            const progressPill = meetingProgressPillStyles(getMeetingRecruitmentPhase(m));
            const selected = m.id === selectedMeetingId;
            return (
              <Pressable
                onPress={() => {
                  setSelectedMeetingId(m.id);
                  router.push(`/meeting/${m.id}`);
                }}
                style={[styles.listCard, selected && styles.listCardSelected]}
                accessibilityRole="button">
                <Image
                  source={{ uri: resolveMeetingListThumbnailUri(m) }}
                  style={styles.listThumb}
                  contentFit="cover"
                />
                <View style={styles.listCardBody}>
                  <View style={styles.listTitleRow}>
                    <Text style={styles.listTitle} numberOfLines={1} ellipsizeMode="tail">
                      {m.title}
                    </Text>
                    <View style={progressPill.wrap}>
                      <Text style={progressPill.text} numberOfLines={1}>
                        {progressPill.label}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.listMeta} numberOfLines={1}>
                    {[m.categoryLabel, `최대 ${m.capacity}명`].filter(Boolean).join(' · ')}
                  </Text>
                  <View style={styles.listFooter}>
                    <Text style={styles.listDist}>
                      {formatDistanceForList(meetingDistanceMetersFromUser(m, userCoords))}
                    </Text>
                    <View style={styles.joinBtn}>
                      <Text style={styles.joinBtnText}>참가 신청</Text>
                    </View>
                  </View>
                </View>
              </Pressable>
            );
          }}
        />
      </Animated.View>

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
                    <Ionicons name="checkmark-circle" size={22} color={GinitTheme.trustBlue} />
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

      <Modal visible={regionModalOpen} animationType="fade" transparent onRequestClose={closeRegionModal}>
        <View style={styles.modalRoot}>
          <Pressable
            style={StyleSheet.absoluteFillObject}
            onPress={closeRegionModal}
            accessibilityRole="button"
            accessibilityLabel="지역 설정 닫기"
          />
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
  searchBarWrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 4,
  },
  searchBarPressed: {
    opacity: 0.92,
  },
  searchBarText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#334155',
  },
  filterIconBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 3,
  },
  filterIconBtnPressed: {
    opacity: 0.9,
  },
  sheet: {
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
    paddingBottom: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(15, 23, 42, 0.15)',
    marginBottom: 10,
  },
  chipScroll: {
    marginBottom: 10,
    maxHeight: 40,
  },
  chipScrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: 8,
  },
  sheetChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.1)',
  },
  sheetChipActive: {
    backgroundColor: GinitTheme.trustBlue,
    borderColor: GinitTheme.trustBlue,
  },
  sheetChipLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
  },
  sheetChipLabelActive: {
    color: '#fff',
  },
  sheetToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    marginBottom: 10,
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
  listScroll: {
    flex: 1,
  },
  listScrollContent: {
    paddingBottom: 12,
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
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: -0.2,
    lineHeight: 20,
    color: GinitTheme.colors.text,
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
});
