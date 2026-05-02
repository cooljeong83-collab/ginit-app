import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenShell } from '@/components/ui';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { GinitTheme } from '@/constants/ginit-theme';
import { useUserSession } from '@/src/context/UserSessionContext';
import { normalizeUserId } from '@/src/lib/app-user-id';
import { loadRegisteredFeedRegions } from '@/src/lib/feed-registered-regions';
import { getInterestRegionDisplayLabel } from '@/src/lib/korea-interest-districts';
import {
  fetchMeetingAreaNotifyMatrix,
  replaceMeetingAreaNotifyMatrix,
} from '@/src/lib/meeting-area-notify-rules';
import { safeRouterBack } from '@/src/lib/router-safe';
import { supabase } from '@/src/lib/supabase';

const meetingCreateSwitchTrack = { false: '#cbd5e1', true: GinitTheme.themeMainColor } as const;
/** «전체» 행 id — UI 전용. 서버 `region_norms` / `category_ids`에는 넣지 않음. 레거시 `*` 는 get 시 해당 섹션 전부 켠 것으로 펼침. */
const CATEGORY_ALL_ID = '*';

function sectionTitle(label: string) {
  return (
    <View style={styles.sectionHead}>
      <Text style={styles.sectionHeadText}>{label}</Text>
    </View>
  );
}

function RowSep() {
  return <View style={styles.sep} />;
}

type CatRow = { id: string; label: string; emoji: string };

/** 관심 지역·카테고리 둘 다 끔(0,0) 또는 둘 다 하나 이상 — 한쪽만 선택된 조합은 저장·이탈 불가 */
function isMeetingAreaNotifyMatrixValid(regionNorms: string[], categoryIds: string[]): boolean {
  const r = regionNorms.length;
  const c = categoryIds.length;
  return (r === 0 && c === 0) || (r >= 1 && c >= 1);
}

function matrixFromRefs(regionOnRef: { current: Set<string> }, catOnRef: { current: Set<string> }) {
  const regions = [...regionOnRef.current]
    .filter((id) => id !== CATEGORY_ALL_ID)
    .sort((a, b) => a.localeCompare(b, 'ko'));
  const cats = [...catOnRef.current]
    .filter((id) => id !== CATEGORY_ALL_ID)
    .sort((a, b) => a.localeCompare(b, 'ko'));
  return { regions, cats };
}

export default function MeetingNotifySettingsScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { userId, authProfile } = useUserSession();
  const profilePk = useMemo(() => {
    const u = userId?.trim();
    if (u) return u;
    const em = authProfile?.email?.trim();
    if (em) return normalizeUserId(em) ?? '';
    return '';
  }, [userId, authProfile?.email]);

  const [busy, setBusy] = useState(true);
  const [regionList, setRegionList] = useState<string[]>([]);
  const [catRows, setCatRows] = useState<CatRow[]>([]);
  const [regionOn, setRegionOn] = useState<Set<string>>(() => new Set());
  const [catOn, setCatOn] = useState<Set<string>>(() => new Set());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const catRowsRef = useRef<CatRow[]>([]);
  const regionListRef = useRef<string[]>([]);
  const regionOnRef = useRef(regionOn);
  const catOnRef = useRef(catOn);
  const flushSaveRef = useRef<() => Promise<void>>(async () => {});
  /** 서버에서 한 번 이상 불러온 뒤에만 이탈 시 저장(로딩 중 뒤로가기로 빈 매트릭스 덮어쓰기 방지) */
  const hydratedRef = useRef(false);
  /** 로컬 변경이 서버와 아직 다를 수 있음(디바운스가 이미 끝난 경우에도 이탈 시 flush 필요) */
  const dirtyRef = useRef(false);

  const allCatsMasterOn = useMemo(
    () => catRows.length > 0 && catRows.every((c) => catOn.has(c.id)),
    [catRows, catOn],
  );

  const allRegionsMasterOn = useMemo(
    () => regionList.length > 0 && regionList.every((r) => regionOn.has(r)),
    [regionList, regionOn],
  );

  const hasAnyRegionSelected = useMemo(
    () => regionList.length > 0 && regionList.some((r) => regionOn.has(r)),
    [regionList, regionOn],
  );

  useEffect(() => {
    catRowsRef.current = catRows;
  }, [catRows]);

  useEffect(() => {
    regionListRef.current = regionList;
  }, [regionList]);

  const flushSave = useCallback(async () => {
    const pk = profilePk.trim();
    if (!pk) return;
    const { regions, cats } = matrixFromRefs(regionOnRef, catOnRef);
    if (!isMeetingAreaNotifyMatrixValid(regions, cats)) {
      if (__DEV__) console.warn('[meeting-notify-settings] skip save: region/category must both be off or both have at least one');
      return;
    }
    const res = await replaceMeetingAreaNotifyMatrix(pk, regions, cats);
    // 저장 도중 새 토글로 디바운스가 다시 잡히면 dirty 유지
    if (res.ok && saveTimer.current == null) dirtyRef.current = false;
    if (!res.ok && __DEV__) console.warn('[meeting-notify-settings] save', res.message);
  }, [profilePk]);

  useEffect(() => {
    flushSaveRef.current = flushSave;
  }, [flushSave]);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      void flushSave();
    }, 650);
  }, [flushSave]);

  const reload = useCallback(async () => {
    const pk = profilePk.trim();
    if (!pk) {
      hydratedRef.current = false;
      setBusy(false);
      return;
    }
    hydratedRef.current = false;
    setBusy(true);
    try {
      const [regs, catRes, matrix] = await Promise.all([
        loadRegisteredFeedRegions(),
        supabase.from('meeting_categories').select('id,label,emoji,sort_order').order('sort_order', { ascending: true }),
        fetchMeetingAreaNotifyMatrix(pk),
      ]);
      const sortedRegs = [...regs].sort((a, b) => a.localeCompare(b, 'ko'));
      setRegionList(sortedRegs);
      const rows = catRes.data ?? [];
      const dbCats: CatRow[] = rows
        .map((c) => ({
          id: String((c as { id?: unknown }).id ?? '').trim(),
          label: String((c as { label?: unknown }).label ?? '').trim() || '카테고리',
          emoji: String((c as { emoji?: unknown }).emoji ?? '').trim() || '📌',
        }))
        .filter((c) => c.id);
      setCatRows(dbCats);

      const nextR = new Set<string>();
      const hadStarRegions = matrix.region_norms.includes(CATEGORY_ALL_ID);
      if (hadStarRegions) {
        for (const r of sortedRegs) nextR.add(r);
      } else {
        for (const r of sortedRegs) {
          if (matrix.region_norms.includes(r)) nextR.add(r);
        }
      }
      const nextC = new Set<string>();
      const hadStarWildcard = matrix.category_ids.includes(CATEGORY_ALL_ID);
      if (hadStarWildcard) {
        for (const c of dbCats) nextC.add(c.id);
      } else {
        for (const id of matrix.category_ids) {
          if (dbCats.some((c) => c.id === id)) nextC.add(id);
        }
      }
      regionOnRef.current = nextR;
      catOnRef.current = nextC;
      dirtyRef.current = false;
      setRegionOn(nextR);
      setCatOn(nextC);
      hydratedRef.current = true;
    } catch {
      hydratedRef.current = false;
      setRegionList([]);
      setCatRows([]);
      const emptyR = new Set<string>();
      const emptyC = new Set<string>();
      regionOnRef.current = emptyR;
      catOnRef.current = emptyC;
      setRegionOn(emptyR);
      setCatOn(emptyC);
    } finally {
      setBusy(false);
    }
  }, [profilePk]);

  const flushIfNeededOnLeave = useCallback(() => {
    const hadPendingSave = saveTimer.current != null;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (!hydratedRef.current || !(dirtyRef.current || hadPendingSave)) return;
    const { regions, cats } = matrixFromRefs(regionOnRef, catOnRef);
    if (!isMeetingAreaNotifyMatrixValid(regions, cats)) return;
    void flushSaveRef.current();
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
      return () => {
        flushIfNeededOnLeave();
      };
    }, [reload, flushIfNeededOnLeave]),
  );

  useEffect(() => {
    return () => {
      flushIfNeededOnLeave();
    };
  }, [flushIfNeededOnLeave]);

  /** 관심 지역을 모두 끄면 카테고리 선택도 비움(숨김 UI와 서버 규칙 정합) */
  useEffect(() => {
    if (busy) return;
    if (regionList.length === 0) return;
    const has = regionList.some((r) => regionOn.has(r));
    if (has) return;
    if (catOn.size === 0) return;
    const empty = new Set<string>();
    catOnRef.current = empty;
    dirtyRef.current = true;
    setCatOn(empty);
    scheduleSave();
  }, [busy, regionList, regionOn, catOn.size, scheduleSave]);

  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', (e) => {
      if (!hydratedRef.current) return;
      const { regions, cats } = matrixFromRefs(regionOnRef, catOnRef);
      if (isMeetingAreaNotifyMatrixValid(regions, cats)) return;
      e.preventDefault();
      Alert.alert('알림 설정', '카테고리를 최소 하나 이상 선택해 주세요.', [{ text: '확인' }]);
    });
    return unsub;
  }, [navigation]);

  const toggleRegion = useCallback(
    (norm: string, v: boolean) => {
      dirtyRef.current = true;
      setRegionOn((prev) => {
        let next: Set<string>;
        if (norm === CATEGORY_ALL_ID) {
          next = v ? new Set(regionListRef.current) : new Set();
        } else {
          next = new Set(prev);
          next.delete(CATEGORY_ALL_ID);
          if (v) next.add(norm);
          else next.delete(norm);
        }
        regionOnRef.current = next;
        return next;
      });
      scheduleSave();
    },
    [scheduleSave],
  );

  const toggleCat = useCallback(
    (catId: string, v: boolean) => {
      dirtyRef.current = true;
      setCatOn((prev) => {
        let next: Set<string>;
        if (catId === CATEGORY_ALL_ID) {
          next = v ? new Set(catRowsRef.current.map((c) => c.id)) : new Set();
        } else {
          next = new Set(prev);
          next.delete(CATEGORY_ALL_ID);
          if (v) next.add(catId);
          else next.delete(catId);
        }
        catOnRef.current = next;
        return next;
      });
      scheduleSave();
    },
    [scheduleSave],
  );

  if (Platform.OS === 'web') {
    return (
      <ScreenShell padded={false} style={styles.rootShell}>
        <SafeAreaView style={styles.safe} edges={['top']}>
          <View style={styles.topBar}>
            <Pressable onPress={() => safeRouterBack(router)} hitSlop={12} accessibilityRole="button" style={styles.backBtn}>
              <GinitSymbolicIcon name="chevron-back" size={22} color="#0f172a" />
            </Pressable>
            <Text style={styles.topTitle} numberOfLines={1}>
              모임 생성 알림
            </Text>
            <View style={styles.topBarSpacer} />
          </View>
          <View style={{ padding: 20 }}>
            <Text style={styles.rowLabel}>모바일 앱에서 설정할 수 있어요.</Text>
          </View>
        </SafeAreaView>
      </ScreenShell>
    );
  }

  return (
    <ScreenShell padded={false} style={styles.rootShell}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.topBar}>
          <Pressable onPress={() => safeRouterBack(router)} hitSlop={12} accessibilityRole="button" style={styles.backBtn}>
            <GinitSymbolicIcon name="chevron-back" size={22} color="#0f172a" />
          </Pressable>
          <Text style={styles.topTitle} numberOfLines={1}>
            공개 모임 생성 알림 설정
          </Text>
          <View style={styles.topBarSpacer} />
        </View>

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {busy ? (
            <View style={{ paddingVertical: 24, alignItems: 'center' }}>
              <ActivityIndicator color={GinitTheme.colors.primary} />
            </View>
          ) : (
            <>
              <View style={styles.block}>
                {sectionTitle('관심 지역')}
                {regionList.length === 0 ? (
                  <View style={styles.row}>
                    <View style={styles.rowText}>
                      <Text style={styles.rowLabel}>등록된 관심 지역이 없어요</Text>
                      <Text style={styles.rowSub}>탐색 탭에서 구를 등록한 뒤 다시 열어 주세요.</Text>
                    </View>
                  </View>
                ) : (
                  <>
                    <View style={styles.row}>
                      <View style={styles.rowText}>
                        <Text style={styles.rowLabel}>전체</Text>
                        <Text style={styles.rowLabelSub}>관심 지역 전체 알람 수신</Text>
                      </View>
                      <Switch
                        value={allRegionsMasterOn}
                        onValueChange={(v) => toggleRegion(CATEGORY_ALL_ID, v)}
                        trackColor={meetingCreateSwitchTrack}
                        thumbColor={allRegionsMasterOn ? '#FFFFFF' : '#f1f5f9'}
                        ios_backgroundColor="#cbd5e1"
                        accessibilityLabel="관심 지역 전체"
                      />
                    </View>
                    <RowSep />
                    {regionList.map((r, idx) => (
                      <View key={r}>
                        {idx > 0 ? <RowSep /> : null}
                        <View style={styles.row}>
                          <View style={styles.rowText}>
                            <Text style={styles.rowLabel}>{getInterestRegionDisplayLabel(r)}</Text>
                          </View>
                          <Switch
                            value={regionOn.has(r)}
                            onValueChange={(v) => toggleRegion(r, v)}
                            trackColor={meetingCreateSwitchTrack}
                            thumbColor={regionOn.has(r) ? '#FFFFFF' : '#f1f5f9'}
                            ios_backgroundColor="#cbd5e1"
                            accessibilityLabel={`관심 지역 ${getInterestRegionDisplayLabel(r)}`}
                          />
                        </View>
                      </View>
                    ))}
                  </>
                )}
              </View>

              {hasAnyRegionSelected ? (
                <View style={[styles.block, styles.blockGap]}>
                  {sectionTitle('카테고리')}
                  {catRows.length === 0 ? (
                    <View style={styles.row}>
                      <View style={styles.rowText}>
                        <Text style={styles.rowLabel}>등록된 모임 카테고리가 없어요</Text>
                        <Text style={styles.rowSub}>운영 설정에서 카테고리를 확인해 주세요.</Text>
                      </View>
                    </View>
                  ) : (
                    <>
                      <View style={styles.row}>
                        <View style={styles.rowText}>
                          <Text style={styles.rowLabel}>전체</Text>
                          <Text style={styles.rowLabelSub}>카테고리 전체 알람 수신</Text>
                        </View>
                        <Switch
                          value={allCatsMasterOn}
                          onValueChange={(v) => toggleCat(CATEGORY_ALL_ID, v)}
                          trackColor={meetingCreateSwitchTrack}
                          thumbColor={allCatsMasterOn ? '#FFFFFF' : '#f1f5f9'}
                          ios_backgroundColor="#cbd5e1"
                          accessibilityLabel="카테고리 전체"
                        />
                      </View>
                      <RowSep />
                      {catRows.map((c, idx) => (
                        <View key={c.id}>
                          {idx > 0 ? <RowSep /> : null}
                          <View style={styles.row}>
                            <View style={styles.rowText}>
                              <Text style={styles.rowLabel}>
                                {c.emoji} {c.label}
                              </Text>
                            </View>
                            <Switch
                              value={catOn.has(c.id)}
                              onValueChange={(v) => toggleCat(c.id, v)}
                              trackColor={meetingCreateSwitchTrack}
                              thumbColor={catOn.has(c.id) ? '#FFFFFF' : '#f1f5f9'}
                              ios_backgroundColor="#cbd5e1"
                              accessibilityLabel={`카테고리 ${c.label}`}
                            />
                          </View>
                        </View>
                      ))}
                    </>
                  )}
                </View>
              ) : null}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  rootShell: { flex: 1, backgroundColor: GinitTheme.colors.bg },
  safe: { flex: 1, backgroundColor: GinitTheme.colors.bg },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 48,
  },
  backBtn: { padding: 4 },
  topTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: '#0f172a' },
  topBarSpacer: { width: 30 },
  scroll: { paddingTop: 8, paddingBottom: 32 },
  block: { backgroundColor: 'transparent' },
  blockGap: { marginTop: 20 },
  sectionHead: {
    paddingHorizontal: 20,
    paddingBottom: 8,
    paddingTop: 4,
  },
  sectionHeadText: {
    fontSize: 13,
    fontWeight: '700',
    color: GinitTheme.colors.textMuted,
    letterSpacing: -0.1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    gap: 12,
  },
  rowText: { flex: 1, minWidth: 0 },
  rowLabel: { fontSize: 16, fontWeight: '400', color: GinitTheme.colors.text, letterSpacing: -0.2 },
  rowLabelSub: { fontSize: 13, fontWeight: '300', color: GinitTheme.colors.textSubGray, letterSpacing: -0.2 },
  rowSub: { marginTop: 4, fontSize: 12, fontWeight: '400', color: GinitTheme.colors.textMuted, lineHeight: 16 },
  sep: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 20,
    backgroundColor: GinitTheme.colors.border,
  },
});
