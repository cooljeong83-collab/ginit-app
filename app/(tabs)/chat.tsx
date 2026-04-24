import { Ionicons } from '@expo/vector-icons';
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

import { ChatMeetingListRow } from '@/components/chat/ChatMeetingListRow';
import { InAppAlarmsBellButton } from '@/components/in-app-alarms/InAppAlarmsBellButton';
import { GlassCategoryChip } from '@/components/feed/GlassCategoryChip';
import { ScreenShell } from '@/components/ui';
import { GinitTheme } from '@/constants/ginit-theme';
import type { Category } from '@/src/lib/categories';
import { subscribeCategories } from '@/src/lib/categories';
import { resolveFeedLocationContext } from '@/src/lib/feed-display-location';
import {
  buildFeedChips,
  listSortModeLabel,
  meetingMatchesCategoryFilter,
  type MeetingListSortMode,
  sortMeetingsForFeed,
} from '@/src/lib/feed-meeting-utils';
import { loadFeedLocationCache } from '@/src/lib/feed-location-cache';
import type { LatLng } from '@/src/lib/geo-distance';
import { filterJoinedMeetings } from '@/src/lib/joined-meetings';
import type { MeetingChatMessage } from '@/src/lib/meeting-chat';
import { subscribeMeetingChatLatestMessage } from '@/src/lib/meeting-chat';
import type { Meeting } from '@/src/lib/meetings';
import { sweepStalePublicUnconfirmedMeetingsForHost } from '@/src/lib/meeting-expiry-sweep';
import { fetchMeetingsOnce, subscribeMeetings } from '@/src/lib/meetings';
import { normalizePhoneUserId } from '@/src/lib/phone-user-id';
import type { UserProfile } from '@/src/lib/user-profile';
import { getUserProfilesForIds, isUserProfileWithdrawn } from '@/src/lib/user-profile';
import { useUserSession } from '@/src/context/UserSessionContext';

function profileForCreatedBy(
  map: Map<string, UserProfile>,
  createdBy: string | null | undefined,
): UserProfile | undefined {
  if (!createdBy?.trim()) return undefined;
  const n = normalizePhoneUserId(createdBy) ?? createdBy.trim();
  const hit = map.get(createdBy) ?? map.get(n);
  if (hit) return hit;
  for (const [k, v] of map) {
    if ((normalizePhoneUserId(k) ?? k.trim()) === n) return v;
  }
  return undefined;
}

export default function ChatTab() {
  const router = useRouter();
  const { userId } = useUserSession();
  const { width: windowWidth } = useWindowDimensions();
  const categoryChipMaxWidth = Math.min(200, Math.max(100, windowWidth * 0.42));

  const [userCoords, setUserCoords] = useState<LatLng | null>(null);
  const [sortFilterModalOpen, setSortFilterModalOpen] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [listSortMode, setListSortMode] = useState<MeetingListSortMode>('latest');

  const [categories, setCategories] = useState<Category[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [chipsMoreRight, setChipsMoreRight] = useState(false);
  const [latestByMeetingId, setLatestByMeetingId] = useState<
    Record<string, MeetingChatMessage | null | undefined>
  >({});
  const [hostProfiles, setHostProfiles] = useState<Map<string, UserProfile>>(new Map());
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
      const cached = await loadFeedLocationCache();
      if (cancelled) return;
      let coordsForDistance = null as LatLng | null;
      if (cached?.coords) {
        coordsForDistance = cached.coords;
        setUserCoords(coordsForDistance);
      }
      const ctx = await resolveFeedLocationContext();
      if (cancelled) return;
      coordsForDistance = ctx.coords ?? coordsForDistance;
      setUserCoords(coordsForDistance);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const unsub = subscribeCategories(
      (list) => setCategories(list),
      () => {
        /* 칩 없이도 동작 */
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
    const uid = userId?.trim();
    if (!uid || meetings.length === 0) return;
    void sweepStalePublicUnconfirmedMeetingsForHost(uid, meetings);
  }, [userId, meetings]);

  useEffect(() => {
    if (selectedCategoryId == null) return;
    if (categories.length > 0 && !categories.some((c) => c.id === selectedCategoryId)) {
      setSelectedCategoryId(null);
    }
  }, [categories, selectedCategoryId]);

  const joinedMeetings = useMemo(
    () => filterJoinedMeetings(meetings, userId),
    [meetings, userId],
  );

  const feedChips = useMemo(() => buildFeedChips(joinedMeetings, categories), [categories, joinedMeetings]);

  const filteredMeetings = useMemo(() => {
    return joinedMeetings.filter((m) =>
      meetingMatchesCategoryFilter(m, selectedCategoryId, categories),
    );
  }, [joinedMeetings, selectedCategoryId, categories]);

  const sortedFilteredMeetings = useMemo(
    () => sortMeetingsForFeed(filteredMeetings, listSortMode, userCoords),
    [filteredMeetings, listSortMode, userCoords],
  );

  const signedIn = Boolean(userId?.trim());

  const chatRowMeetingKey = useMemo(
    () => sortedFilteredMeetings.map((m) => m.id).join('\u0001'),
    [sortedFilteredMeetings],
  );

  useEffect(() => {
    if (!signedIn || sortedFilteredMeetings.length === 0) {
      return () => {};
    }
    const unsubs = sortedFilteredMeetings.map((m) =>
      subscribeMeetingChatLatestMessage(
        m.id,
        (msg) => {
          setLatestByMeetingId((p) => ({ ...p, [m.id]: msg }));
        },
        () => {
          setLatestByMeetingId((p) => ({ ...p, [m.id]: null }));
        },
      ),
    );
    return () => {
      unsubs.forEach((u) => u());
    };
  }, [chatRowMeetingKey, signedIn]);

  useEffect(() => {
    const hosts = [
      ...new Set(
        sortedFilteredMeetings
          .map((me) => (me.createdBy?.trim() ? normalizePhoneUserId(me.createdBy) ?? me.createdBy.trim() : ''))
          .filter(Boolean),
      ),
    ] as string[];
    if (hosts.length === 0) {
      setHostProfiles(new Map());
      return;
    }
    let cancelled = false;
    void getUserProfilesForIds(hosts).then((map) => {
      if (!cancelled) setHostProfiles(map);
    });
    return () => {
      cancelled = true;
    };
  }, [chatRowMeetingKey]);

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
            <View style={styles.chatHeaderRow}>
              <Text style={styles.chatTitle} accessibilityRole="header">
                채팅
              </Text>
              <View style={styles.headerActions}>
                <InAppAlarmsBellButton />
                <Pressable accessibilityRole="button" hitSlop={10} accessibilityLabel="채팅 설정">
                  <Ionicons name="settings-outline" size={24} color="#0f172a" />
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
                  <View pointerEvents="none" accessibilityElementsHidden style={styles.chipsScrollEdgeFade} />
                ) : null}
              </View>
            </View>
          </View>

          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionLabel}>
              내 모임{selectedFilterLabel ? ` · ${selectedFilterLabel}` : ''}
            </Text>
            <View style={styles.sectionHeaderControls}>
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
              <ActivityIndicator color={GinitTheme.colors.primary} />
              <Text style={styles.muted}>불러오는 중…</Text>
            </View>
          ) : null}

          {listError ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorTitle}>목록을 불러오지 못했어요</Text>
              <Text style={styles.errorBody}>{listError}</Text>
            </View>
          ) : null}

          {!loading && !listError && !signedIn ? (
            <Text style={styles.empty}>로그인하면 참여한 모임이 여기에 표시돼요.</Text>
          ) : null}

          {!loading && !listError && signedIn && joinedMeetings.length === 0 ? (
            <Text style={styles.empty}>참여 중인 모임이 없어요. 홈에서 모임에 참여해 보세요.</Text>
          ) : null}

          {!loading && !listError && signedIn && joinedMeetings.length > 0 && filteredMeetings.length === 0 ? (
            <Text style={styles.empty}>
              {selectedFilterLabel
                ? `「${selectedFilterLabel}」에 해당하는 참여 모임이 없어요. 다른 칩을 선택해 보세요.`
                : '조건에 맞는 모임이 없어요.'}
            </Text>
          ) : null}

          {sortedFilteredMeetings.length > 0 ? (
            <View style={styles.chatListBleed}>
              {sortedFilteredMeetings.map((m) => {
                const host = profileForCreatedBy(hostProfiles, m.createdBy);
                return (
                  <ChatMeetingListRow
                    key={m.id}
                    meeting={m}
                    hostPhotoUrl={host?.photoUrl ?? null}
                    hostNickname={host?.nickname ?? '주관자'}
                    hostWithdrawn={isUserProfileWithdrawn(host)}
                    latestMessage={latestByMeetingId[m.id]}
                    onPress={() => router.push(`/meeting-chat/${m.id}`)}
                  />
                );
              })}
            </View>
          ) : null}
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
      </SafeAreaView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: GinitTheme.colors.bg },
  safe: { flex: 1 },
  scroll: {
    paddingHorizontal: 20,
    paddingBottom: 28,
  },
  feedHeader: {
    marginBottom: 16,
    paddingTop: 4,
    gap: 12,
  },
  chatHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  chatTitle: {
    fontSize: 26,
    fontWeight: '900',
    color: '#0f172a',
    letterSpacing: -0.6,
    textShadowColor: 'rgba(255, 255, 255, 0.7)',
    textShadowOffset: { width: 0, height: 0.5 },
    textShadowRadius: 2,
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
    paddingRight: 14,
  },
  chipsScrollEdgeFade: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 28,
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
  chatListBleed: {
    marginHorizontal: -20,
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e8eaed',
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
    color: GinitTheme.colors.primary,
  },
});
