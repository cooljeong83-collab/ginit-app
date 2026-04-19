/**
 * 모임 등록 — 장소·일시 투표 후보를 한 화면에서만 편집 (`/create/details`).
 * `dateCandidates[]` · `placeCandidates[]` 다이나믹 폼, LayoutAnimation, 지도 미리보기 없음.
 * 완료 시 `setPendingVoteCandidates`로 2단계로 전달합니다.
 */
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useFocusEffect } from '@react-navigation/native';
import { BlurView } from 'expo-blur';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  Alert,
  InteractionManager,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GinitStyles } from '@/constants/GinitStyles';
import { layoutAnimateEaseInEaseOut } from '@/src/lib/android-layout-animation';
import type { DateCandidate, PlaceCandidate, VoteCandidatesPayload } from '@/src/lib/meeting-place-bridge';
import { consumePendingVotePlaceRow, setPendingVoteCandidates } from '@/src/lib/meeting-place-bridge';

/** 스펙: Trust Blue */
const TRUST_BLUE = '#0052CC';
/** 스펙: 화면 전체 배경 (다크 네이비) */
const SCREEN_BG = '#0F172A';
/** 스펙: 플레이스홀더 */
const INPUT_PLACEHOLDER = 'rgba(255, 255, 255, 0.4)';

function animate() {
  layoutAnimateEaseInEaseOut();
}

function pickParam(v: string | string[] | undefined): string | undefined {
  if (v == null) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

function newId(p: string) {
  return `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function fmtDate(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function fmtTime(d: Date) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function parseDateTimeStrings(dateStr: string, timeStr: string): Date {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  const tm = /^(\d{1,2}):(\d{2})$/.exec(timeStr.trim());
  const now = new Date();
  if (!dm) return now;
  const y = Number(dm[1]);
  const mo = Number(dm[2]) - 1;
  const day = Number(dm[3]);
  let hh = 12;
  let mm = 0;
  if (tm) {
    hh = Number(tm[1]);
    mm = Number(tm[2]);
  }
  return new Date(y, mo, day, hh, mm, 0, 0);
}

type PlaceRowModel = {
  id: string;
  query: string;
  placeName: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
};

function emptyPlaceRow(seedQuery = ''): PlaceRowModel {
  return {
    id: newId('place'),
    query: seedQuery,
    placeName: '',
    address: '',
    latitude: null,
    longitude: null,
  };
}

function isFilled(p: PlaceRowModel) {
  return p.latitude != null && p.longitude != null && p.placeName.trim().length > 0;
}

function placeRowFromCandidate(p: PlaceCandidate): PlaceRowModel {
  return {
    id: p.id,
    query: p.placeName,
    placeName: p.placeName,
    address: p.address,
    latitude: p.latitude,
    longitude: p.longitude,
  };
}

function buildInitialEditorState(
  initialPayload: VoteCandidatesPayload | null | undefined,
  seedQ: string,
  seedDate: string,
  seedTime: string,
): { placeCandidates: PlaceRowModel[]; dateCandidates: DateCandidate[] } {
  const hasPayload =
    (initialPayload?.placeCandidates?.length ?? 0) > 0 || (initialPayload?.dateCandidates?.length ?? 0) > 0;
  if (hasPayload && initialPayload) {
    const dateCandidates =
      initialPayload.dateCandidates.length > 0
        ? initialPayload.dateCandidates.map((d) => ({ ...d }))
        : [{ id: newId('date'), scheduleDate: seedDate, scheduleTime: seedTime }];
    const placeCandidates =
      initialPayload.placeCandidates.length > 0
        ? initialPayload.placeCandidates.map(placeRowFromCandidate)
        : [emptyPlaceRow(seedQ)];
    return { placeCandidates, dateCandidates };
  }
  return {
    placeCandidates: [emptyPlaceRow(seedQ)],
    dateCandidates: [{ id: newId('date'), scheduleDate: seedDate, scheduleTime: seedTime }],
  };
}

export type VoteCandidatesFormProps = {
  seedPlaceQuery?: string;
  seedScheduleDate: string;
  seedScheduleTime: string;
  initialPayload?: VoteCandidatesPayload | null;
  embedded?: boolean;
};

export type VoteCandidatesBuildResult =
  | { ok: true; payload: VoteCandidatesPayload }
  | { ok: false; error: string };

export type VoteCandidatesFormHandle = {
  buildPayload: () => VoteCandidatesBuildResult;
};

export const VoteCandidatesForm = forwardRef<VoteCandidatesFormHandle, VoteCandidatesFormProps>(function VoteCandidatesForm(
  { seedPlaceQuery = '', seedScheduleDate, seedScheduleTime, initialPayload = null, embedded = false },
  ref,
) {
  const router = useRouter();
  const seedQ = seedPlaceQuery.trim();
  const seedDate = seedScheduleDate.trim() || fmtDate(new Date());
  const seedTime = seedScheduleTime.trim() || '15:00';

  const init = buildInitialEditorState(initialPayload, seedQ, seedDate, seedTime);
  const [placeCandidates, setPlaceCandidates] = useState<PlaceRowModel[]>(() => init.placeCandidates);
  const [dateCandidates, setDateCandidates] = useState<DateCandidate[]>(() => init.dateCandidates);

  const [picker, setPicker] = useState<{ rowId: string; mode: 'date' | 'time' } | null>(null);
  const [iosDraft, setIosDraft] = useState(() => new Date());

  const placeCandidatesRef = useRef(placeCandidates);
  placeCandidatesRef.current = placeCandidates;
  const dateCandidatesRef = useRef(dateCandidates);
  dateCandidatesRef.current = dateCandidates;
  /** `+ 장소 후보 추가` 직후 열린 검색에서 선택 없이 돌아오면 이 행 ID를 제거합니다. */
  const pendingEphemeralPlaceRowIdRef = useRef<string | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      buildPayload: (): VoteCandidatesBuildResult => {
        const rows = placeCandidatesRef.current;
        const dates = dateCandidatesRef.current;
        const filledPlaces = rows.filter(isFilled);
        if (filledPlaces.length === 0) {
          return { ok: false, error: '장소 후보를 한 곳 이상 장소 선택 화면에서 골라 주세요.' };
        }
        for (const d of dates) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(d.scheduleDate.trim())) {
            return { ok: false, error: '일시 후보의 날짜는 YYYY-MM-DD 형식이어야 합니다.' };
          }
          if (!/^\d{1,2}:\d{2}$/.test(d.scheduleTime.trim())) {
            return { ok: false, error: '일시 후보의 시간은 HH:mm 형식이어야 합니다.' };
          }
        }
        const placeCandidatesOut: PlaceCandidate[] = filledPlaces.map((r) => ({
          id: r.id,
          placeName: r.placeName.trim(),
          address: r.address.trim(),
          latitude: r.latitude as number,
          longitude: r.longitude as number,
        }));
        const dateCandidatesOut = dates.map((d) => ({ ...d }));
        return { ok: true, payload: { placeCandidates: placeCandidatesOut, dateCandidates: dateCandidatesOut } };
      },
    }),
    [],
  );

  const openPlaceSearch = useCallback(
    (row: PlaceRowModel) => {
      const q = row.query.trim() || row.placeName.trim();
      InteractionManager.runAfterInteractions(() => {
        router.push({
          pathname: '/place-search',
          params: {
            initialQuery: q,
            voteRowId: row.id,
          },
        });
      });
    },
    [router],
  );

  useFocusEffect(
    useCallback(() => {
      const sel = consumePendingVotePlaceRow();
      if (sel) {
        pendingEphemeralPlaceRowIdRef.current = null;
        setPlaceCandidates((prev) => {
          const hit = prev.some((r) => r.id === sel.rowId);
          if (!hit) return prev;
          animate();
          return prev.map((r) =>
            r.id === sel.rowId
              ? {
                  ...r,
                  query: sel.placeName,
                  placeName: sel.placeName,
                  address: sel.address,
                  latitude: sel.latitude,
                  longitude: sel.longitude,
                }
              : r,
          );
        });
        return;
      }

      const ephemeralId = pendingEphemeralPlaceRowIdRef.current;
      pendingEphemeralPlaceRowIdRef.current = null;
      if (!ephemeralId) return;

      setPlaceCandidates((prev) => {
        const row = prev.find((r) => r.id === ephemeralId);
        if (!row || isFilled(row)) return prev;
        animate();
        if (prev.length <= 1) {
          return [emptyPlaceRow()];
        }
        return prev.filter((r) => r.id !== ephemeralId);
      });
    }, []),
  );

  const addPlaceCandidate = useCallback(() => {
    const row = emptyPlaceRow();
    pendingEphemeralPlaceRowIdRef.current = row.id;
    setPlaceCandidates((prev) => [...prev, row]);
    /** LayoutAnimation과 push가 겹치면 잔상·끊김이 나므로, 전환은 인터랙션 이후에만 실행 */
    InteractionManager.runAfterInteractions(() => {
      router.push({
        pathname: '/place-search',
        params: {
          initialQuery: row.query.trim(),
          voteRowId: row.id,
        },
      });
    });
  }, [router]);

  const removePlaceCandidate = useCallback((id: string) => {
    animate();
    setPlaceCandidates((prev) => {
      if (prev.length <= 1) {
        return [emptyPlaceRow()];
      }
      return prev.filter((r) => r.id !== id);
    });
  }, []);

  const addDateRow = useCallback(() => {
    animate();
    setDateCandidates((prev) => [
      ...prev,
      { id: newId('date'), scheduleDate: fmtDate(new Date()), scheduleTime: '15:00' },
    ]);
  }, []);

  const removeDateRow = useCallback((id: string) => {
    animate();
    setDateCandidates((prev) => (prev.length <= 1 ? prev : prev.filter((d) => d.id !== id)));
  }, []);

  const updateDateRow = useCallback((id: string, patch: Partial<DateCandidate>) => {
    setDateCandidates((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }, []);

  const openPicker = useCallback(
    (rowId: string, mode: 'date' | 'time') => {
      const row = dateCandidates.find((d) => d.id === rowId);
      if (!row) return;
      setIosDraft(parseDateTimeStrings(row.scheduleDate, row.scheduleTime));
      setPicker({ rowId, mode });
    },
    [dateCandidates],
  );

  const applyIosPicker = useCallback(() => {
    if (!picker) return;
    const { rowId, mode } = picker;
    if (mode === 'date') {
      updateDateRow(rowId, { scheduleDate: fmtDate(iosDraft) });
    } else {
      updateDateRow(rowId, { scheduleTime: fmtTime(iosDraft) });
    }
    setPicker(null);
  }, [iosDraft, picker, updateDateRow]);

  const formBody = (
    <>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>일시 후보</Text>
      </View>
      <Text style={styles.sectionHint}>날짜·시간 후보를 추가하고 투표에서 고를 수 있어요.</Text>

      {dateCandidates.map((d, dateIndex) => (
        <BlurView
          key={d.id}
          tint="dark"
          intensity={40}
          style={styles.glassCardBlur}
          experimentalBlurMethod="dimezisBlurView">
          <View style={styles.glassCardInner}>
            <Pressable
              onPress={() => (dateCandidates.length > 1 ? removeDateRow(d.id) : undefined)}
              disabled={dateCandidates.length <= 1}
              style={[styles.deleteIconBtn, dateCandidates.length <= 1 && styles.deleteIconBtnDisabled]}
              accessibilityRole="button"
              accessibilityLabel="일시 후보 삭제">
              <Text style={styles.deleteIconText}>✕</Text>
            </Pressable>
            <Text style={styles.cardFieldTitle}>일정 후보 {dateIndex + 1}</Text>
            {Platform.OS === 'web' ? (
              <View style={styles.row2}>
                <View style={[styles.fieldRecess, styles.fieldRecessHalf]}>
                  <TextInput
                    value={d.scheduleDate}
                    onChangeText={(t) => updateDateRow(d.id, { scheduleDate: t })}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={INPUT_PLACEHOLDER}
                    style={styles.textInputBare}
                    autoCapitalize="none"
                  />
                </View>
                <View style={[styles.fieldRecess, styles.fieldRecessHalf]}>
                  <TextInput
                    value={d.scheduleTime}
                    onChangeText={(t) => updateDateRow(d.id, { scheduleTime: t })}
                    placeholder="HH:mm"
                    placeholderTextColor={INPUT_PLACEHOLDER}
                    style={styles.textInputBare}
                    autoCapitalize="none"
                  />
                </View>
              </View>
            ) : (
              <View style={styles.row2}>
                <View style={[styles.fieldRecess, styles.fieldRecessHalf]}>
                  <Pressable
                    onPress={() => openPicker(d.id, 'date')}
                    style={styles.dateTimePressable}
                    accessibilityRole="button">
                    <Text style={styles.dateTimeLabel}>날짜</Text>
                    <Text style={styles.dateTimeValue}>{d.scheduleDate}</Text>
                  </Pressable>
                </View>
                <View style={[styles.fieldRecess, styles.fieldRecessHalf]}>
                  <Pressable
                    onPress={() => openPicker(d.id, 'time')}
                    style={styles.dateTimePressable}
                    accessibilityRole="button">
                    <Text style={styles.dateTimeLabel}>시간</Text>
                    <Text style={styles.dateTimeValue}>{d.scheduleTime}</Text>
                  </Pressable>
                </View>
              </View>
            )}
          </View>
        </BlurView>
      ))}

      <Pressable onPress={addDateRow} style={styles.addCandidateBtn} accessibilityRole="button">
        <Text style={styles.addCandidateBtnLabel}>+ 일정 후보 추가</Text>
      </Pressable>

      <View style={[styles.sectionHeader, styles.sectionGap]}>
        <Text style={styles.sectionTitle}>장소 후보</Text>
      </View>
      <Text style={styles.sectionHint}>각 카드에서 장소 검색 화면으로 이동해 후보를 채워 주세요.</Text>

      {placeCandidates.map((row, placeIndex) => (
        <BlurView
          key={row.id}
          tint="dark"
          intensity={40}
          style={styles.glassCardBlur}
          experimentalBlurMethod="dimezisBlurView">
          <View style={styles.glassCardInner}>
            <Pressable
              onPress={() => removePlaceCandidate(row.id)}
              style={styles.deleteIconBtn}
              accessibilityRole="button"
              accessibilityLabel="장소 후보 삭제">
              <Text style={styles.deleteIconText}>✕</Text>
            </Pressable>
            <Text style={styles.cardFieldTitle}>장소 후보 {placeIndex + 1}</Text>
            {isFilled(row) ? (
              <Pressable onPress={() => openPlaceSearch(row)} accessibilityRole="button" accessibilityLabel="장소 다시 선택">
                <Text style={styles.placeEmoji}>📍</Text>
                <Text style={styles.placeNameText} numberOfLines={2}>
                  {row.placeName}
                </Text>
                <Text style={styles.placeAddrText} numberOfLines={4}>
                  {row.address}
                </Text>
                <Text style={styles.placeHint}>탭하여 장소 선택 화면에서 바꾸기</Text>
              </Pressable>
            ) : (
              <View style={styles.fieldRecess}>
                <Pressable
                  onPress={() => openPlaceSearch(row)}
                  style={styles.placeSearchPressable}
                  accessibilityRole="button"
                  accessibilityLabel="장소 검색 화면으로 이동">
                  <Text 
                    style={[   styles.placeDraftText,     { color: '#0F172A' }, !row.query.trim() && { color: 'rgba(15, 23, 42, 0.35)' }   ]} numberOfLines={2}>
                    {row.query.trim() || '가게 이름 · 주소 검색 (탭하면 장소 선택 화면)'}
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        </BlurView>
      ))}

      <Pressable onPress={addPlaceCandidate} style={styles.addCandidateBtn} accessibilityRole="button">
        <Text style={styles.addCandidateBtnLabel}>+ 장소 후보 추가</Text>
      </Pressable>
    </>
  );

  return (
    <>
      {embedded ? (
        <View style={styles.scrollContent}>{formBody}</View>
      ) : (
        <ScrollView
          style={GinitStyles.flexFill}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}>
          {formBody}
        </ScrollView>
      )}

      {picker && Platform.OS === 'ios' ? (
        <Modal visible transparent animationType="slide" onRequestClose={() => setPicker(null)}>
          <View style={GinitStyles.modalRoot}>
            <Pressable style={GinitStyles.modalBackdrop} onPress={() => setPicker(null)} accessibilityRole="button" />
            <View style={GinitStyles.modalSheet}>
              <View style={GinitStyles.modalHeader}>
                <Pressable onPress={() => setPicker(null)} hitSlop={10}>
                  <Text style={GinitStyles.modalCancel}>취소</Text>
                </Pressable>
                <Text style={GinitStyles.modalTitle}>{picker.mode === 'date' ? '날짜 선택' : '시간 선택'}</Text>
                <Pressable onPress={applyIosPicker} hitSlop={10}>
                  <Text style={GinitStyles.modalDone}>완료</Text>
                </Pressable>
              </View>
              <DateTimePicker
                value={iosDraft}
                mode={picker.mode}
                display={picker.mode === 'date' ? 'inline' : 'spinner'}
                onChange={(_, date) => {
                  if (date) setIosDraft(date);
                }}
                locale="ko-KR"
                themeVariant="dark"
              />
            </View>
          </View>
        </Modal>
      ) : null}

      {picker && Platform.OS === 'android' ? (
        <DateTimePicker
          value={iosDraft}
          mode={picker.mode}
          display={picker.mode === 'time' ? 'spinner' : 'default'}
          onChange={(event: DateTimePickerEvent, date) => {
            const mode = picker.mode;
            const rowId = picker.rowId;
            setPicker(null);
            if (event.type === 'dismissed' || !date) return;
            if (mode === 'date') {
              updateDateRow(rowId, { scheduleDate: fmtDate(date) });
            } else {
              updateDateRow(rowId, { scheduleTime: fmtTime(date) });
            }
          }}
        />
      ) : null}
    </>
  );
});

export default function CreateDetailsScreen() {
  const router = useRouter();
  const voteFormRef = useRef<VoteCandidatesFormHandle>(null);
  const {
    initialQuery: initialQueryParam,
    scheduleDate: scheduleDateParam,
    scheduleTime: scheduleTimeParam,
    categoryLabel: categoryLabelParam,
  } = useLocalSearchParams<{
    initialQuery?: string | string[];
    scheduleDate?: string | string[];
    scheduleTime?: string | string[];
    categoryLabel?: string | string[];
  }>();

  const seedQ = pickParam(initialQueryParam)?.trim() ?? '';
  const seedDate = pickParam(scheduleDateParam)?.trim() || fmtDate(new Date());
  const seedTime = pickParam(scheduleTimeParam)?.trim() || '15:00';
  const categoryLabel = pickParam(categoryLabelParam)?.trim() || '';

  const screenTitle = useMemo(
    () => (categoryLabel ? `${categoryLabel} · 후보 설정` : '장소·일시 후보'),
    [categoryLabel],
  );

  const handleBack = useCallback(() => {
    const r = voteFormRef.current?.buildPayload();
    if (r && !r.ok) {
      Alert.alert('입력 확인', r.error);
      return;
    }
    if (r?.ok) {
      setPendingVoteCandidates(r.payload);
    }
    router.back();
  }, [router]);

  return (
    <View style={styles.screenRoot}>
      <KeyboardAvoidingView
        style={GinitStyles.flexFill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}>
        <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
          <View style={styles.topBarRow}>
            <Pressable onPress={handleBack} hitSlop={12} accessibilityRole="button">
              <Text style={styles.backLink}>← 닫기</Text>
            </Pressable>
            <Text style={styles.screenTitle} numberOfLines={1}>
              {screenTitle}
            </Text>
            <View style={{ width: 56 }} />
          </View>

          <VoteCandidatesForm
            ref={voteFormRef}
            key={`route-${seedQ}-${seedDate}-${seedTime}`}
            seedPlaceQuery={seedQ}
            seedScheduleDate={seedDate}
            seedScheduleTime={seedTime}
            initialPayload={null}
            embedded={false}
          />
        </SafeAreaView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screenRoot: {
    flex: 1,
    backgroundColor: SCREEN_BG,
  },
  safeArea: {
    flex: 1,
    backgroundColor: SCREEN_BG,
    paddingHorizontal: 20,
  },
  topBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 8,
  },
  backLink: {
    fontSize: 16,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.85)',
    minWidth: 56,
  },
  screenTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '900',
    color: 'rgba(255, 255, 255, 0.95)',
    letterSpacing: -0.3,
  },
  scrollContent: {
    paddingTop: 8,
    paddingBottom: 40,
  },
  sectionHeader: {
    marginBottom: 6,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.35,
  },
  sectionHint: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
    lineHeight: 19,
    marginBottom: 14,
  },
  sectionGap: {
    marginTop: 26,
  },
  /** 글래스 카드: BlurView 루트 — 스펙 수치 그대로 */
  glassCardBlur: {
    marginBottom: 16,
    borderRadius: 24,
    padding: 20,
    backgroundColor: 'rgb(255, 255, 255)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    overflow: 'hidden',
    shadowColor: TRUST_BLUE,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.6,
    shadowRadius: 24,
    elevation: 15,
  },
  glassCardInner: {
    position: 'relative',
  },
  deleteIconBtn: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(15, 23, 42, 0.67)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  deleteIconBtnDisabled: {
    opacity: 0.35,
  },
  deleteIconText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 16,
  },
  /** 카드 안 제목 (일정 후보 1 등) */
  cardFieldTitle: {
    color: 'rgb(0, 0, 0)',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 12,
    paddingRight: 40,
  },
  row2: {
    flexDirection: 'row',
    gap: 10,
  },
  /** 음각 필드 래퍼 */
  fieldRecess: {
    backgroundColor: 'rgba(255, 255, 255, 0.72)', // 흰색 반투명 (Line 229)
    borderColor: 'rgba(0, 0, 0, 0.93)', // 아주 연한 테두리 추가
    borderRadius: 12,
    padding: 16,
  },
  fieldRecessHalf: {
    flex: 1,
    minWidth: 0,
  },
  textInputBare: {
    backgroundColor: 'transparent',
    color: '#000000',
    fontSize: 16,
    fontWeight: '600',
    padding: 0,
    margin: 0,
  },
  dateTimePressable: {
    gap: 4,
  },
  dateTimeLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(0, 0, 0, 0.62)',
  },
  dateTimeValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000000',
  },
  placeEmoji: {
    fontSize: 20,
    marginBottom: 6,
  },
  placeNameText: {
    fontSize: 17,
    fontWeight: '800',
    color: '#000000',
    marginBottom: 6,
    paddingRight: 36,
  },
  placeAddrText: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(0, 0, 0, 0.75)',
    lineHeight: 20,
  },
  placeHint: {
    marginTop: 10,
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(0, 0, 0, 0.5)',
  },
  placeSearchPressable: {
    minHeight: 24,
    justifyContent: 'center',
  },
  placeDraftText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0F172A',
  },
  /** + 후보 추가 — 스펙 */
  addCandidateBtn: {
    alignSelf: 'stretch',
    marginBottom: 8,
    backgroundColor: TRUST_BLUE,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addCandidateBtnLabel: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
});
