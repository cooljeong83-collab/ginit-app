/**
 * 모임 등록 — 장소·일시 투표 후보를 한 화면에서만 편집 (`/create/details`).
 * `dateCandidates[]` · `placeCandidates[]` 다이나믹 폼, LayoutAnimation, 지도 미리보기 없음.
 * 완료 시 `setPendingVoteCandidates`로 2단계로 전달합니다.
 */
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  Alert,
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

import { GinitPlaceholderColor, GinitStyles } from '@/constants/GinitStyles';
import { GinitTheme } from '@/constants/ginit-theme';
import type { DateCandidate, PlaceCandidate, VoteCandidatesPayload } from '@/src/lib/meeting-place-bridge';
import { layoutAnimateEaseInEaseOut } from '@/src/lib/android-layout-animation';
import { consumePendingVotePlaceRow, setPendingVoteCandidates } from '@/src/lib/meeting-place-bridge';

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
  /** `consumePendingVoteCandidates` 등 외부에서 넣은 후보로 폼을 채울 때 */
  initialPayload?: VoteCandidatesPayload | null;
  /** true면 부모 `ScrollView` 안에 넣기 위해 내부 스크롤을 쓰지 않습니다. */
  embedded?: boolean;
};

export type VoteCandidatesBuildResult =
  | { ok: true; payload: VoteCandidatesPayload }
  | { ok: false; error: string };

export type VoteCandidatesFormHandle = {
  /** 현재 폼 상태로 투표 후보 페이로드를 만듭니다. 장소·일시 검증 실패 시 `ok: false`. */
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
        const placeCandidates: PlaceCandidate[] = filledPlaces.map((r) => ({
          id: r.id,
          placeName: r.placeName.trim(),
          address: r.address.trim(),
          latitude: r.latitude as number,
          longitude: r.longitude as number,
        }));
        const dateCandidatesOut = dates.map((d) => ({ ...d }));
        return { ok: true, payload: { placeCandidates, dateCandidates: dateCandidatesOut } };
      },
    }),
    [],
  );

  const openPlaceSearch = useCallback(
    (row: PlaceRowModel) => {
      const q = row.query.trim() || row.placeName.trim();
      router.push({
        pathname: '/place-search',
        params: {
          initialQuery: q,
          voteRowId: row.id,
        },
      });
    },
    [router],
  );

  useFocusEffect(
    useCallback(() => {
      const sel = consumePendingVotePlaceRow();
      if (!sel) return;
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
    }, []),
  );

  const addPlaceCandidate = useCallback(() => {
    animate();
    setPlaceCandidates((prev) => [...prev, emptyPlaceRow()]);
  }, []);

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

  const openPicker = useCallback((rowId: string, mode: 'date' | 'time') => {
    const row = dateCandidates.find((d) => d.id === rowId);
    if (!row) return;
    setIosDraft(parseDateTimeStrings(row.scheduleDate, row.scheduleTime));
    setPicker({ rowId, mode });
  }, [dateCandidates]);

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
        <View style={styles.sectionAccent} />
        <Text style={styles.sectionTitle}>일시 후보</Text>
      </View>
      <Text style={styles.sectionHint}>날짜·시간 후보를 추가하고 투표에서 고를 수 있어요.</Text>

      {dateCandidates.map((d) => (
        <View key={d.id} style={[styles.floatGlass, styles.dateCard]}>
          {Platform.OS === 'web' ? (
            <View style={GinitStyles.row2}>
              <TextInput
                value={d.scheduleDate}
                onChangeText={(t) => updateDateRow(d.id, { scheduleDate: t })}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={GinitPlaceholderColor}
                style={[GinitStyles.glassInput, GinitStyles.glassInputHalf, GinitStyles.detailFormText]}
                autoCapitalize="none"
              />
              <TextInput
                value={d.scheduleTime}
                onChangeText={(t) => updateDateRow(d.id, { scheduleTime: t })}
                placeholder="HH:mm"
                placeholderTextColor={GinitPlaceholderColor}
                style={[GinitStyles.glassInput, GinitStyles.glassInputHalf, GinitStyles.detailFormText]}
                autoCapitalize="none"
              />
            </View>
          ) : (
            <View style={GinitStyles.row2}>
              <Pressable
                onPress={() => openPicker(d.id, 'date')}
                style={[GinitStyles.glassInput, GinitStyles.glassInputHalf, GinitStyles.inputPressable]}
                accessibilityRole="button">
                <Text style={GinitStyles.inputPressableLabel}>날짜</Text>
                <Text style={GinitStyles.inputPressableValue}>{d.scheduleDate}</Text>
              </Pressable>
              <Pressable
                onPress={() => openPicker(d.id, 'time')}
                style={[GinitStyles.glassInput, GinitStyles.glassInputHalf, GinitStyles.inputPressable]}
                accessibilityRole="button">
                <Text style={GinitStyles.inputPressableLabel}>시간</Text>
                <Text style={GinitStyles.inputPressableValue}>{d.scheduleTime}</Text>
              </Pressable>
            </View>
          )}
          <Pressable
            onPress={() => (dateCandidates.length > 1 ? removeDateRow(d.id) : null)}
            disabled={dateCandidates.length <= 1}
            style={styles.deleteTextWrap}
            accessibilityRole="button"
            accessibilityLabel="일시 후보 삭제">
            <Text style={[styles.deleteText, dateCandidates.length <= 1 && styles.deleteTextDisabled]}>[삭제]</Text>
          </Pressable>
        </View>
      ))}

      <Pressable onPress={addDateRow} style={styles.addPrimaryBtn} accessibilityRole="button">
        <Text style={styles.addPrimaryBtnLabel}>+ 일정 후보 추가</Text>
      </Pressable>

      <View style={[styles.sectionHeader, styles.sectionGap]}>
        <View style={styles.sectionAccent} />
        <Text style={styles.sectionTitle}>장소 후보</Text>
      </View>
      <Text style={styles.sectionHint}>각 카드에서 장소 검색 화면으로 이동해 후보를 채워 주세요.</Text>

      {placeCandidates.map((row) => (
        <View key={row.id} style={styles.cardWrap}>
          {isFilled(row) ? (
            <View style={[styles.floatGlass, styles.placeCard]}>
              <Pressable onPress={() => openPlaceSearch(row)} accessibilityRole="button" accessibilityLabel="장소 다시 선택">
                <Text style={styles.filledPin}>📍</Text>
                <Text style={styles.filledTitle} numberOfLines={2}>
                  {row.placeName}
                </Text>
                <Text style={styles.filledAddr} numberOfLines={4}>
                  {row.address}
                </Text>
                <Text style={styles.placeSearchHint}>탭하여 장소 선택 화면에서 바꾸기</Text>
              </Pressable>
              <Pressable
                onPress={() => removePlaceCandidate(row.id)}
                style={styles.deleteTextWrap}
                accessibilityRole="button"
                accessibilityLabel="장소 후보 삭제">
                <Text style={styles.deleteText}>[삭제]</Text>
              </Pressable>
            </View>
          ) : (
            <View style={[styles.floatGlass, styles.placeCard]}>
              <Pressable
                onPress={() => openPlaceSearch(row)}
                style={[GinitStyles.glassInput, styles.placeSearchPressable]}
                accessibilityRole="button"
                accessibilityLabel="장소 검색 화면으로 이동">
                <Text
                  style={[GinitStyles.detailFormText, !row.query.trim() && styles.placeSearchPlaceholder]}
                  numberOfLines={2}>
                  {row.query.trim() || '가게 이름 · 주소 검색 (탭하면 장소 선택 화면)'}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => removePlaceCandidate(row.id)}
                style={styles.deleteTextWrap}
                accessibilityRole="button"
                accessibilityLabel="장소 후보 삭제">
                <Text style={styles.deleteText}>[삭제]</Text>
              </Pressable>
            </View>
          )}
        </View>
      ))}

      <Pressable onPress={addPlaceCandidate} style={styles.addPrimaryBtn} accessibilityRole="button">
        <Text style={styles.addPrimaryBtnLabel}>+ 장소 후보 추가</Text>
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
                themeVariant="light"
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
    <View style={GinitStyles.screenRoot}>
      <LinearGradient colors={['#DCEEFF', '#EEF6FF', '#FFF4ED']} locations={[0, 0.45, 1]} style={StyleSheet.absoluteFill} />
      {Platform.OS === 'web' ? (
        <View style={[StyleSheet.absoluteFill, GinitStyles.webVeil]} />
      ) : (
        <>
          <BlurView
            pointerEvents="none"
            intensity={GinitTheme.glassModal.blurIntensity}
            tint="light"
            style={StyleSheet.absoluteFill}
          />
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, GinitStyles.frostVeil]} />
        </>
      )}
      <KeyboardAvoidingView
        style={GinitStyles.flexFill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}>
        <SafeAreaView style={GinitStyles.safeAreaPadded} edges={['top', 'bottom']}>
          <View style={GinitStyles.topBarRow}>
            <Pressable onPress={handleBack} hitSlop={12} accessibilityRole="button">
              <Text style={GinitStyles.backLink}>← 닫기</Text>
            </Pressable>
            <Text style={GinitStyles.screenTitleLarge} numberOfLines={1}>
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
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 40,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 6,
  },
  sectionAccent: {
    width: 4,
    height: 18,
    borderRadius: 2,
    backgroundColor: GinitTheme.trustBlue,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '900',
    color: '#0f172a',
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
  /** 다크 글로우 + 반투명 글래스 — 카드가 배경에서 떠 있는 느낌 */
  floatGlass: {
    backgroundColor: 'rgba(255, 255, 255, 0.46)',
    borderRadius: GinitTheme.radius.card,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.52)',
    borderTopColor: 'rgba(255, 255, 255, 0.72)',
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 14,
    shadowColor: '#0b1426',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.32,
    shadowRadius: 28,
    elevation: 18,
    overflow: 'visible',
  },
  dateCard: {
    gap: 12,
  },
  placeCard: {
    gap: 12,
  },
  cardWrap: {
    marginBottom: 0,
  },
  deleteTextWrap: {
    alignSelf: 'flex-end',
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  deleteText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#B91C1C',
  },
  deleteTextDisabled: {
    color: '#94a3b8',
  },
  filledPin: {
    fontSize: 20,
    marginBottom: 6,
  },
  filledTitle: {
    fontSize: 17,
    fontWeight: '900',
    color: '#0f172a',
    marginBottom: 6,
  },
  filledAddr: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
    lineHeight: 20,
  },
  placeSearchPressable: {
    minHeight: 52,
    justifyContent: 'center',
    borderRadius: GinitTheme.radius.button,
  },
  placeSearchPlaceholder: {
    color: GinitPlaceholderColor,
  },
  placeSearchHint: {
    marginTop: 10,
    fontSize: 12,
    fontWeight: '700',
    color: GinitTheme.trustBlue,
    opacity: 0.85,
  },
  addPrimaryBtn: {
    alignSelf: 'stretch',
    marginBottom: 8,
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: GinitTheme.radius.button,
    backgroundColor: 'rgba(0, 82, 204, 0.12)',
    borderWidth: 1.5,
    borderColor: 'rgba(0, 82, 204, 0.35)',
    shadowColor: '#001a4d',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 16,
    elevation: 10,
  },
  addPrimaryBtnLabel: {
    fontSize: 15,
    fontWeight: '900',
    color: GinitTheme.trustBlue,
    textAlign: 'center',
    letterSpacing: -0.2,
  },
});
