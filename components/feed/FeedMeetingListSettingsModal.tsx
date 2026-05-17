import { GinitPressable } from '@/components/ui/GinitPressable';
import Feather from '@expo/vector-icons/Feather';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { GinitTheme } from '@/constants/ginit-theme';
import type { Category } from '@/src/lib/categories';
import { fetchMeetingAreaNotifyMatrix } from '@/src/lib/meeting-area-notify-rules';

const meetingCreateSwitchTrack = { false: '#cbd5e1', true: GinitTheme.themeMainColor } as const;

export type FeedMeetingListSettingsSaveResult = {
  barVisibleCategoryIds: string[] | null;
  recruitingOnly: boolean;
  exploreTodayOnly: boolean;
  selectedCategoryId: string | null;
};

export type FeedMeetingListSettingsModalProps = {
  visible: boolean;
  onRequestClose: () => void;
  categories: Category[];
  barVisibleCategoryIds: string[] | null;
  recruitingOnly: boolean;
  exploreTodayOnly: boolean;
  selectedCategoryId: string | null;
  onSave: (result: FeedMeetingListSettingsSaveResult) => void | Promise<void>;
  windowHeight: number;
  profilePk: string;
  isSignedIn: boolean;
  onOpenMeetingNotifySettings: () => void;
};

export function computeFeedMeetingListSettingsDotActive(params: {
  recruitingOnly: boolean;
  exploreTodayOnly: boolean;
  meetingNotifyLoaded: boolean;
  meetingNotifyEffectiveOn: boolean;
  selectedCategoryId: string | null;
  categoriesLength: number;
  barVisibleCategoryIds: string[] | null;
}): boolean {
  const {
    recruitingOnly,
    exploreTodayOnly,
    meetingNotifyLoaded,
    meetingNotifyEffectiveOn,
    selectedCategoryId,
    categoriesLength,
    barVisibleCategoryIds,
  } = params;
  return (
    recruitingOnly ||
    exploreTodayOnly ||
    (meetingNotifyLoaded && meetingNotifyEffectiveOn) ||
    selectedCategoryId != null ||
    (categoriesLength > 0 &&
      barVisibleCategoryIds != null &&
      barVisibleCategoryIds.length < categoriesLength)
  );
}

export function useMeetingCreateNotifyEffective(profilePk: string, refreshWhen = true) {
  const [loaded, setLoaded] = useState(false);
  const [effectiveOn, setEffectiveOn] = useState(false);
  const fetchGenRef = useRef(0);

  const refresh = useCallback(async () => {
    if (Platform.OS === 'web') {
      setLoaded(true);
      setEffectiveOn(false);
      return;
    }
    const pk = profilePk.trim();
    if (!pk) {
      setLoaded(true);
      setEffectiveOn(false);
      return;
    }
    const gen = ++fetchGenRef.current;
    setLoaded(false);
    try {
      const m = await fetchMeetingAreaNotifyMatrix(pk);
      if (gen !== fetchGenRef.current) return;
      const rn = (m.region_norms ?? []).filter((x) => String(x ?? '').trim() !== '');
      const ci = (m.category_ids ?? []).filter((x) => String(x ?? '').trim() !== '');
      setEffectiveOn(rn.length > 0 && ci.length > 0);
    } catch {
      if (gen !== fetchGenRef.current) return;
      setEffectiveOn(false);
    } finally {
      if (gen === fetchGenRef.current) setLoaded(true);
    }
  }, [profilePk]);

  useEffect(() => {
    if (!refreshWhen) return;
    void refresh();
  }, [refresh, refreshWhen]);

  return { loaded, effectiveOn, refresh };
}

export function FeedMeetingListSettingsModal({
  visible,
  onRequestClose,
  categories,
  barVisibleCategoryIds,
  recruitingOnly,
  exploreTodayOnly,
  selectedCategoryId,
  onSave,
  windowHeight,
  profilePk,
  isSignedIn,
  onOpenMeetingNotifySettings,
}: FeedMeetingListSettingsModalProps) {
  const sortedCategoryMaster = useMemo(
    () =>
      [...categories].sort((a, b) =>
        a.order !== b.order ? a.order - b.order : a.label.localeCompare(b.label, 'ko'),
      ),
    [categories],
  );

  const [visibilityDraft, setVisibilityDraft] = useState<string[]>([]);
  const [recruitingOnlyDraft, setRecruitingOnlyDraft] = useState(false);
  const [exploreTodayOnlyDraft, setExploreTodayOnlyDraft] = useState(false);
  const [listShowMoreBelow, setListShowMoreBelow] = useState(false);
  const listLayHRef = useRef(0);
  const listContHRef = useRef(0);
  const listScrollYRef = useRef(0);
  const listScrollRef = useRef<ScrollView | null>(null);

  const {
    loaded: meetingNotifyLoaded,
    effectiveOn: meetingNotifyEffectiveOn,
    refresh: refreshMeetingNotify,
  } = useMeetingCreateNotifyEffective(profilePk, false);

  const cardMaxH = useMemo(() => Math.min(640, Math.floor(windowHeight * 0.88)), [windowHeight]);
  const categoryListMaxH = useMemo(() => Math.max(120, cardMaxH - 500), [cardMaxH]);

  const syncListMoreBelow = useCallback(() => {
    const lh = listLayHRef.current;
    const ch = listContHRef.current;
    const y = listScrollYRef.current;
    if (lh <= 0 || ch <= lh + 8) {
      setListShowMoreBelow(false);
      return;
    }
    setListShowMoreBelow(ch - y - lh > 10);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const ordered = sortedCategoryMaster.map((c) => c.id);
    const vis =
      barVisibleCategoryIds == null
        ? [...ordered]
        : ordered.filter((id) => barVisibleCategoryIds.includes(id));
    setVisibilityDraft(vis);
    setRecruitingOnlyDraft(recruitingOnly);
    setExploreTodayOnlyDraft(exploreTodayOnly);
  }, [visible, sortedCategoryMaster, barVisibleCategoryIds, recruitingOnly, exploreTodayOnly]);

  useEffect(() => {
    if (!visible) return;
    void refreshMeetingNotify();
  }, [visible, refreshMeetingNotify]);

  useEffect(() => {
    if (visible) return;
    listScrollYRef.current = 0;
    listLayHRef.current = 0;
    listContHRef.current = 0;
    setListShowMoreBelow(false);
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    listScrollYRef.current = 0;
    requestAnimationFrame(() => {
      try {
        listScrollRef.current?.scrollTo({ y: 0, animated: false });
      } catch {
        /* ignore */
      }
      syncListMoreBelow();
    });
  }, [visible, syncListMoreBelow]);

  const toggleVisibilityDraft = useCallback(
    (id: string) => {
      setVisibilityDraft((prev) => {
        const ordered = sortedCategoryMaster.map((c) => c.id);
        const set = new Set(prev);
        if (set.has(id)) set.delete(id);
        else set.add(id);
        return ordered.filter((oid) => set.has(oid));
      });
    },
    [sortedCategoryMaster],
  );

  const toggleSelectAll = useCallback(() => {
    setVisibilityDraft((prev) => {
      const ordered = sortedCategoryMaster.map((c) => c.id);
      if (ordered.length === 0) return prev;
      const allOn =
        prev.length === ordered.length && ordered.every((id) => prev.includes(id));
      return allOn ? [] : [...ordered];
    });
  }, [sortedCategoryMaster]);

  const selectAllChecked = useMemo(() => {
    const ordered = sortedCategoryMaster.map((c) => c.id);
    if (ordered.length === 0) return false;
    return (
      visibilityDraft.length === ordered.length &&
      ordered.every((id) => visibilityDraft.includes(id))
    );
  }, [sortedCategoryMaster, visibilityDraft]);

  const onPressSave = useCallback(() => {
    const ordered = sortedCategoryMaster.map((c) => c.id);
    if (ordered.length > 0 && visibilityDraft.length === 0) {
      Alert.alert('선택 필요', '피드에서 고를 카테고리를 최소 하나 이상 선택해 주세요.');
      return;
    }
    const nextVisible =
      ordered.length === 0 || visibilityDraft.length === ordered.length
        ? null
        : [...visibilityDraft];
    let nextFilter = selectedCategoryId;
    if (nextFilter != null) {
      if (!ordered.includes(nextFilter)) nextFilter = null;
      else if (nextVisible != null && !nextVisible.includes(nextFilter)) nextFilter = null;
    }
    void onSave({
      barVisibleCategoryIds: nextVisible,
      recruitingOnly: recruitingOnlyDraft,
      exploreTodayOnly: exploreTodayOnlyDraft,
      selectedCategoryId: nextFilter,
    });
  }, [
    sortedCategoryMaster,
    visibilityDraft,
    recruitingOnlyDraft,
    exploreTodayOnlyDraft,
    selectedCategoryId,
    onSave,
  ]);

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onRequestClose}>
      <View style={styles.modalRoot}>
        <GinitPressable
          style={StyleSheet.absoluteFillObject}
          onPress={onRequestClose}
          accessibilityRole="button"
          accessibilityLabel="모임 목록 설정 닫기"
        />
        <View style={[styles.modalCard, { maxHeight: cardMaxH, overflow: 'hidden' }]}>
          <Text style={styles.modalTitle}>모임 목록</Text>
          <Text style={[styles.modalHint, styles.modalHintTight]}>
            목록에 쓸 모임 종류는 «저장»할 때 반영돼요. 모집중·당일 모임만 보기는 탐색·지도에 적용돼요. 정렬·검색은 상단에서 바꿀 수 있어요.
          </Text>
          <View style={styles.divider} />
          <GinitPressable
            onPress={toggleSelectAll}
            style={({ pressed }) => [styles.modalRow, pressed && styles.modalRowPressed]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: selectAllChecked }}
            accessibilityLabel="모든 카테고리 표시">
            <Text style={styles.modalRowLabel}>모두 표시</Text>
            {selectAllChecked ? (
              <GinitSymbolicIcon name="checkmark-circle" size={22} color={GinitTheme.themeMainColor} />
            ) : (
              <GinitSymbolicIcon name="ellipse-outline" size={22} color="#cbd5e1" />
            )}
          </GinitPressable>
          <View style={styles.divider} />
          <View style={styles.scrollWrap}>
            <ScrollView
              ref={listScrollRef}
              style={[styles.scroll, { maxHeight: categoryListMaxH }]}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              nestedScrollEnabled
              scrollEventThrottle={16}
              onLayout={(e) => {
                listLayHRef.current = e.nativeEvent.layout.height;
                syncListMoreBelow();
              }}
              onContentSizeChange={(_, h) => {
                listContHRef.current = h;
                syncListMoreBelow();
              }}
              onScroll={(e) => {
                listScrollYRef.current = e.nativeEvent.contentOffset.y;
                syncListMoreBelow();
              }}>
              {sortedCategoryMaster.map((c) => {
                const on = visibilityDraft.includes(c.id);
                return (
                  <GinitPressable
                    key={c.id}
                    onPress={() => toggleVisibilityDraft(c.id)}
                    style={({ pressed }) => [styles.modalRow, pressed && styles.modalRowPressed]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}>
                    <View style={styles.categoryNameRow}>
                      <Text style={styles.categoryEmoji} allowFontScaling={false}>
                        {c.emoji}
                      </Text>
                      <Text style={[styles.modalRowLabel, styles.categoryLabel]} numberOfLines={1}>
                        {c.label}
                      </Text>
                    </View>
                    {on ? (
                      <GinitSymbolicIcon name="checkmark-circle" size={22} color={GinitTheme.themeMainColor} />
                    ) : (
                      <GinitSymbolicIcon name="ellipse-outline" size={22} color="#cbd5e1" />
                    )}
                  </GinitPressable>
                );
              })}
            </ScrollView>
            {listShowMoreBelow ? (
              <View pointerEvents="none" style={styles.scrollMoreCue} accessibilityElementsHidden>
                <LinearGradient
                  colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.96)']}
                  locations={[0.2, 1]}
                  start={{ x: 0.5, y: 0 }}
                  end={{ x: 0.5, y: 1 }}
                  style={StyleSheet.absoluteFillObject}
                />
                <Feather name="chevron-down" size={18} color="#64748b" style={styles.scrollMoreIcon} />
              </View>
            ) : null}
          </View>
          <View style={[styles.divider, styles.dividerSection]} />
          <Text style={styles.modalSectionTitle}>표시</Text>
          <GinitPressable
            onPress={() => setRecruitingOnlyDraft((v) => !v)}
            style={({ pressed }) => [styles.modalRow, pressed && styles.modalRowPressed]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: recruitingOnlyDraft }}
            accessibilityLabel="모집중만 보기">
            <Text style={[styles.modalRowLabel, styles.displayOptionLabel]}>모집중만 보기</Text>
            <View style={styles.checkCol}>
              {recruitingOnlyDraft ? (
                <GinitSymbolicIcon name="checkmark-circle" size={22} color={GinitTheme.themeMainColor} />
              ) : (
                <GinitSymbolicIcon name="ellipse-outline" size={22} color="#cbd5e1" />
              )}
            </View>
          </GinitPressable>
          <GinitPressable
            onPress={() => setExploreTodayOnlyDraft((v) => !v)}
            style={({ pressed }) => [styles.modalRow, pressed && styles.modalRowPressed]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: exploreTodayOnlyDraft }}
            accessibilityLabel="당일 모임만 보기">
            <Text style={[styles.modalRowLabel, styles.displayOptionLabel]}>당일 모임만 보기</Text>
            <View style={styles.checkCol}>
              {exploreTodayOnlyDraft ? (
                <GinitSymbolicIcon name="checkmark-circle" size={22} color={GinitTheme.themeMainColor} />
              ) : (
                <GinitSymbolicIcon name="ellipse-outline" size={22} color="#cbd5e1" />
              )}
            </View>
          </GinitPressable>
          {isSignedIn && Platform.OS !== 'web' ? (
            <>
              <View style={styles.divider} />
              <Text style={styles.modalSectionTitle}>알림</Text>
              <GinitPressable
                onPress={onOpenMeetingNotifySettings}
                style={({ pressed }) => [styles.modalRow, styles.modalRowTall, pressed && styles.modalRowPressed]}
                accessibilityRole="button"
                accessibilityLabel="모임 생성 알림 설정">
                <View style={styles.rowLabelBlock}>
                  <Text style={styles.modalRowLabel}>공개 모임 생성 알림</Text>
                  <Text style={styles.subHint} numberOfLines={2}>
                    관심 지역·카테고리별로 새 공개 모임만 알려요.
                  </Text>
                </View>
                <GinitPressable
                  onPress={onOpenMeetingNotifySettings}
                  hitSlop={10}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants">
                  {meetingNotifyLoaded ? (
                    <Switch
                      value={meetingNotifyEffectiveOn}
                      disabled
                      trackColor={meetingCreateSwitchTrack}
                      thumbColor={meetingNotifyEffectiveOn ? '#FFFFFF' : '#f1f5f9'}
                      ios_backgroundColor="#cbd5e1"
                      accessibilityElementsHidden
                    />
                  ) : (
                    <ActivityIndicator color={GinitTheme.colors.primary} />
                  )}
                </GinitPressable>
              </GinitPressable>
            </>
          ) : null}
          <View style={styles.actions}>
            <GinitPressable
              onPress={onRequestClose}
              style={({ pressed }) => [styles.actionGhost, pressed && { opacity: 0.85 }]}
              accessibilityRole="button">
              <Text style={styles.actionGhostLabel}>취소</Text>
            </GinitPressable>
            <GinitPressable
              onPress={onPressSave}
              style={({ pressed }) => [styles.actionPrimary, pressed && { opacity: 0.9 }]}
              accessibilityRole="button">
              <Text style={styles.actionPrimaryLabel}>저장</Text>
            </GinitPressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
    marginBottom: 16,
  },
  modalHintTight: {
    marginBottom: 0,
  },
  modalSectionTitle: {
    marginTop: 4,
    marginBottom: 2,
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },
  modalRowLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0f172a',
  },
  modalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 9,
    paddingHorizontal: 4,
  },
  modalRowTall: {
    alignItems: 'flex-start',
    paddingVertical: 12,
  },
  modalRowPressed: {
    backgroundColor: 'rgba(0, 82, 204, 0.06)',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    backgroundColor: GinitTheme.colors.border,
    marginHorizontal: 4,
    marginTop: 4,
    marginBottom: 8,
  },
  dividerSection: {
    marginTop: 10,
    marginBottom: 6,
  },
  scrollWrap: {
    position: 'relative',
    alignSelf: 'stretch',
    flexGrow: 0,
  },
  scroll: {
    flexGrow: 0,
  },
  scrollMoreCue: {
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
  scrollMoreIcon: {
    zIndex: 1,
  },
  categoryNameRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
    marginRight: 8,
  },
  categoryEmoji: {
    fontSize: 18,
    lineHeight: 22,
  },
  categoryLabel: {
    flexShrink: 1,
  },
  rowLabelBlock: {
    flex: 1,
    minWidth: 0,
    paddingRight: 8,
  },
  subHint: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    color: '#64748b',
  },
  checkCol: {
    paddingTop: 2,
  },
  displayOptionLabel: {
    flex: 1,
    minWidth: 0,
    marginRight: 8,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 20,
    marginTop: 14,
    paddingTop: 4,
  },
  actionGhost: {
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  actionGhostLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#64748b',
  },
  actionPrimary: {
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  actionPrimaryLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: GinitTheme.themeMainColor,
  },
});
