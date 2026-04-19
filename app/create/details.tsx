/**
 * 모임 등록 — 장소·일시 투표 후보를 한 화면에서만 편집 (`/create/details`).
 * `dateCandidates[]` · `placeCandidates[]` 다이나믹 폼, LayoutAnimation, 지도 미리보기 없음.
 * 완료 시 `setPendingVoteCandidates`로 2단계로 전달합니다.
 */
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useFocusEffect, useIsFocused, useNavigation } from '@react-navigation/native';
import { BlurView } from 'expo-blur';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react';
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
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GinitStyles } from '@/constants/GinitStyles';
import { layoutAnimateEaseInEaseOut } from '@/src/lib/android-layout-animation';
import { DateCandidateEditorCard, type DatePickerField } from '@/app/create/DateCandidateEditorCard';
import type { DateCandidate, PlaceCandidate, VoteCandidatesPayload } from '@/src/lib/meeting-place-bridge';
import { consumePendingVotePlaceRow, setPendingVoteCandidates } from '@/src/lib/meeting-place-bridge';
import {
  coerceDateCandidate,
  createPointCandidate,
  validateDateCandidate,
} from '@/src/lib/date-candidate';
import { parseSmartNaturalSchedule, type SmartNlpResult } from '@/src/lib/natural-language-schedule';

/** 스펙: Trust Blue */
const TRUST_BLUE = '#0052CC';
/** 스펙: 화면 전체 배경 (다크 네이비) */
const SCREEN_BG = '#0F172A';
/** 스펙: 플레이스홀더 */
const INPUT_PLACEHOLDER = 'rgba(255, 255, 255, 0.4)';

function animate() {
  layoutAnimateEaseInEaseOut();
}

/** 스택 전환 중에는 BlurView 대신 정적 View로 GPU 부하를 줄입니다. */
function VoteCandidateCard({
  reduceHeavyEffects,
  children,
  outerStyle,
}: {
  reduceHeavyEffects: boolean;
  children: ReactNode;
  outerStyle?: StyleProp<ViewStyle>;
}) {
  if (reduceHeavyEffects || Platform.OS === 'web') {
    return <View style={[styles.glassCardBlur, outerStyle]}>{children}</View>;
  }
  return (
    <BlurView
      tint="dark"
      intensity={40}
      style={[styles.glassCardBlur, outerStyle]}
      experimentalBlurMethod="dimezisBlurView">
      {children}
    </BlurView>
  );
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

function getPickerDraft(row: DateCandidate, field: DatePickerField): Date {
  switch (field) {
    case 'startDate':
    case 'startTime':
      return parseDateTimeStrings(row.startDate, row.startTime ?? '12:00');
    case 'endDate':
    case 'endTime':
      return parseDateTimeStrings(row.endDate ?? row.startDate, row.endTime ?? '12:00');
  }
}

function pickerFieldLabel(field: DatePickerField): string {
  switch (field) {
    case 'startDate':
      return '시작 날짜';
    case 'startTime':
      return '시작 시간';
    case 'endDate':
      return '종료 날짜';
    case 'endTime':
      return '종료 시간';
  }
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
    const dateCandidates: DateCandidate[] =
      initialPayload.dateCandidates.length > 0
        ? initialPayload.dateCandidates.map((d) => {
            const c = coerceDateCandidate(d, { startDate: seedDate, startTime: seedTime });
            const raw = d as { id?: string };
            const id = typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : newId('date');
            return { ...c, id };
          })
        : [createPointCandidate(newId('date'), seedDate, seedTime)];
    const placeCandidates =
      initialPayload.placeCandidates.length > 0
        ? initialPayload.placeCandidates.map(placeRowFromCandidate)
        : [emptyPlaceRow(seedQ)];
    return { placeCandidates, dateCandidates };
  }
  return {
    placeCandidates: [emptyPlaceRow(seedQ)],
    dateCandidates: [createPointCandidate(newId('date'), seedDate, seedTime)],
  };
}

/** 후보 1이 시드 기본 point 그대로인지 (NLP가 첫 카드를 교체해도 되는지). */
function isInitialState(d: DateCandidate, seedDate: string, seedTime: string): boolean {
  if (d.type !== 'point') return false;
  if (d.startDate.trim() !== seedDate.trim()) return false;
  if ((d.startTime ?? '').trim() !== seedTime.trim()) return false;
  if (d.endDate?.trim() || d.endTime?.trim()) return false;
  if (d.textLabel?.trim()) return false;
  if (d.subType) return false;
  if (d.isDeadlineSet) return false;
  return true;
}

type NlpApplyResult = {
  next: DateCandidate[];
  expandRowId: string | null;
  shouldAutoExpand: boolean;
  didAppend: boolean;
};

function computeNlpApply(prev: DateCandidate[], nlp: SmartNlpResult, seedDate: string, seedTime: string): NlpApplyResult {
  const first = prev[0];
  if (prev.length === 1 && first && isInitialState(first, seedDate, seedTime)) {
    const row: DateCandidate = { ...nlp.candidate, id: first.id };
    return {
      next: [row],
      expandRowId: first.id,
      shouldAutoExpand: nlp.candidate.type !== 'point',
      didAppend: false,
    };
  }
  const nid = newId('date');
  return {
    next: [...prev, { ...nlp.candidate, id: nid }],
    expandRowId: nid,
    shouldAutoExpand: nlp.candidate.type !== 'point',
    didAppend: true,
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

  const [picker, setPicker] = useState<{ rowId: string; field: DatePickerField } | null>(null);
  const [iosDraft, setIosDraft] = useState(() => new Date());
  const [nlpScheduleInput, setNlpScheduleInput] = useState('');
  const [nlpParsed, setNlpParsed] = useState<SmartNlpResult | null>(null);
  const [dateDetailExpanded, setDateDetailExpanded] = useState<Record<string, boolean>>({});
  const [deadlineTick, setDeadlineTick] = useState(0);
  const dateScrollRef = useRef<ScrollView>(null);

  const placeCandidatesRef = useRef(placeCandidates);
  placeCandidatesRef.current = placeCandidates;
  const dateCandidatesRef = useRef(dateCandidates);
  dateCandidatesRef.current = dateCandidates;
  /** `+ 장소 후보 추가` 직후 열린 검색에서 선택 없이 돌아오면 이 행 ID를 제거합니다. */
  const pendingEphemeralPlaceRowIdRef = useRef<string | null>(null);

  const isFocused = useIsFocused();
  const navigation = useNavigation();
  const [stackTransitionCoversScreen, setStackTransitionCoversScreen] = useState(false);
  useEffect(() => {
    type TransitionNav = {
      addListener: (event: string, cb: (e: { data?: { closing?: boolean } }) => void) => () => void;
    };
    const nav = navigation as unknown as TransitionNav;
    const onStart = nav.addListener('transitionStart', (e) => {
      if (e.data?.closing) setStackTransitionCoversScreen(true);
    });
    const onEnd = nav.addListener('transitionEnd', () => {
      setStackTransitionCoversScreen(false);
    });
    return () => {
      onStart();
      onEnd();
    };
  }, [navigation]);

  const reduceHeavyEffects = !isFocused || stackTransitionCoversScreen;

  const hasDeadlineRow = useMemo(() => dateCandidates.some((d) => d.type === 'deadline'), [dateCandidates]);
  useEffect(() => {
    if (!hasDeadlineRow) return undefined;
    const i = setInterval(() => setDeadlineTick((x) => x + 1), 1000);
    return () => clearInterval(i);
  }, [hasDeadlineRow]);

  useEffect(() => {
    const trimmed = nlpScheduleInput.trim();
    if (!trimmed) {
      setNlpParsed(null);
      return undefined;
    }
    const t = setTimeout(() => {
      setNlpParsed(parseSmartNaturalSchedule(trimmed, new Date()));
    }, 500);
    return () => clearTimeout(t);
  }, [nlpScheduleInput]);

  const applyNlpSuggestion = useCallback(() => {
    if (!nlpParsed) return;
    animate();
    const prev = dateCandidatesRef.current;
    const { next, expandRowId, shouldAutoExpand, didAppend } = computeNlpApply(prev, nlpParsed, seedDate, seedTime);
    setDateCandidates(next);
    if (shouldAutoExpand && expandRowId) {
      setDateDetailExpanded((ex) => ({ ...ex, [expandRowId]: true }));
    }
    setNlpScheduleInput('');
    setNlpParsed(null);
    if (didAppend && !embedded) {
      requestAnimationFrame(() => {
        InteractionManager.runAfterInteractions(() => {
          dateScrollRef.current?.scrollToEnd({ animated: true });
        });
      });
    }
  }, [embedded, nlpParsed, seedDate, seedTime]);

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
        for (let i = 0; i < dates.length; i += 1) {
          const err = validateDateCandidate(dates[i], i);
          if (err) return { ok: false, error: err };
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
      requestAnimationFrame(() => {
        InteractionManager.runAfterInteractions(() => {
          router.push({
            pathname: '/place-search',
            params: {
              initialQuery: q,
              voteRowId: row.id,
            },
          });
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
        InteractionManager.runAfterInteractions(() => animate());
        return;
      }

      const ephemeralId = pendingEphemeralPlaceRowIdRef.current;
      pendingEphemeralPlaceRowIdRef.current = null;
      if (!ephemeralId) return;

      setPlaceCandidates((prev) => {
        const row = prev.find((r) => r.id === ephemeralId);
        if (!row || isFilled(row)) return prev;
        if (prev.length <= 1) {
          return [emptyPlaceRow()];
        }
        return prev.filter((r) => r.id !== ephemeralId);
      });
      InteractionManager.runAfterInteractions(() => animate());
    }, []),
  );

  const addPlaceCandidate = useCallback(() => {
    const row = emptyPlaceRow();
    pendingEphemeralPlaceRowIdRef.current = row.id;
    setPlaceCandidates((prev) => [...prev, row]);
    requestAnimationFrame(() => {
      InteractionManager.runAfterInteractions(() => {
        router.push({
          pathname: '/place-search',
          params: {
            initialQuery: row.query.trim(),
            voteRowId: row.id,
          },
        });
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
    const nid = newId('date');
    setDateCandidates((prev) => {
      const last = prev[prev.length - 1];
      const row: DateCandidate = last ? { ...last, id: nid } : createPointCandidate(nid, fmtDate(new Date()), '15:00');
      return [...prev, row];
    });
    setDateDetailExpanded((ex) => ({ ...ex, [nid]: true }));
    if (!embedded) {
      requestAnimationFrame(() => {
        InteractionManager.runAfterInteractions(() => {
          dateScrollRef.current?.scrollToEnd({ animated: true });
        });
      });
    }
  }, [embedded]);

  const removeDateRow = useCallback((id: string) => {
    animate();
    setDateCandidates((prev) => (prev.length <= 1 ? prev : prev.filter((d) => d.id !== id)));
  }, []);

  const updateDateRow = useCallback((id: string, patch: Partial<DateCandidate>) => {
    setDateCandidates((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }, []);

  const openPicker = useCallback(
    (rowId: string, field: DatePickerField) => {
      const row = dateCandidates.find((d) => d.id === rowId);
      if (!row) return;
      setIosDraft(getPickerDraft(row, field));
      setPicker({ rowId, field });
    },
    [dateCandidates],
  );

  const applyIosPicker = useCallback(() => {
    if (!picker) return;
    const { rowId, field } = picker;
    const ymd = fmtDate(iosDraft);
    const hm = fmtTime(iosDraft);
    if (field === 'startDate') updateDateRow(rowId, { startDate: ymd });
    else if (field === 'startTime') updateDateRow(rowId, { startTime: hm });
    else if (field === 'endDate') updateDateRow(rowId, { endDate: ymd });
    else updateDateRow(rowId, { endTime: hm });
    setPicker(null);
  }, [iosDraft, picker, updateDateRow]);

  const lastPlaceCandidate = placeCandidates[placeCandidates.length - 1];
  const canAddPlaceCandidate =
    lastPlaceCandidate != null &&
    lastPlaceCandidate.latitude != null &&
    lastPlaceCandidate.longitude != null;

  const formBody = (
    <>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>일시 후보</Text>
      </View>
      <Text style={styles.sectionHint}>날짜·시간 후보를 추가하고 투표에서 고를 수 있어요.</Text>

      <View style={styles.nlpSection}>
        <Text style={styles.nlpLabel}>[말로 입력하세요]</Text>
        <VoteCandidateCard reduceHeavyEffects={reduceHeavyEffects} outerStyle={styles.nlpGlassOuter}>
          <View style={styles.nlpGlassInner}>
            <TextInput
              value={nlpScheduleInput}
              onChangeText={setNlpScheduleInput}
              placeholder='예: "내일 저녁 7시", "이번 주말 아무 때나"'
              placeholderTextColor={INPUT_PLACEHOLDER}
              style={styles.nlpTextInput}
              multiline={false}
              returnKeyType="done"
              autoCapitalize="none"
              autoCorrect={false}
              underlineColorAndroid="transparent"
            />
          </View>
        </VoteCandidateCard>
        {nlpParsed ? (
          <Pressable
            onPress={applyNlpSuggestion}
            style={({ pressed }) => [styles.nlpChip, pressed && styles.nlpChipPressed]}
            accessibilityRole="button"
            accessibilityLabel="자연어 일정 후보로 등록">
            <Text style={styles.nlpChipText}>📅 {nlpParsed.summary} 등록하기</Text>
          </Pressable>
        ) : null}
      </View>

      {dateCandidates.map((d, dateIndex) => (
        <DateCandidateEditorCard
          key={d.id}
          d={d}
          dateIndex={dateIndex}
          expanded={!!dateDetailExpanded[d.id]}
          onToggleExpanded={() => {
            animate();
            setDateDetailExpanded((prev) => ({ ...prev, [d.id]: !prev[d.id] }));
          }}
          canDelete={dateCandidates.length > 1}
          onRemove={() => removeDateRow(d.id)}
          onPatch={(patch) => updateDateRow(d.id, patch)}
          reduceHeavyEffects={reduceHeavyEffects}
          onOpenPicker={(field) => openPicker(d.id, field)}
          deadlineTick={deadlineTick}
        />
      ))}

      <Pressable onPress={addDateRow} style={styles.addCandidateBtn} accessibilityRole="button">
        <Text style={styles.addCandidateBtnLabel}>+ 일정 후보 추가</Text>
      </Pressable>

      <View style={[styles.sectionHeader, styles.sectionGap]}>
        <Text style={styles.sectionTitle}>장소 후보</Text>
      </View>
      <Text style={styles.sectionHint}>각 카드에서 장소 검색 화면으로 이동해 후보를 채워 주세요.</Text>

      {placeCandidates.map((row, placeIndex) => (
        <VoteCandidateCard key={row.id} reduceHeavyEffects={reduceHeavyEffects}>
          <View style={styles.glassCardInner}>
            {placeCandidates.length > 1 ? (
              <Pressable
                onPress={() => removePlaceCandidate(row.id)}
                style={styles.deleteIconBtn}
                accessibilityRole="button"
                accessibilityLabel="장소 후보 삭제">
                <Text style={styles.deleteIconText}>✕</Text>
              </Pressable>
            ) : null}
            <Text
              style={[styles.cardFieldTitle, placeCandidates.length <= 1 && styles.cardFieldTitleNoDeleteOffset]}>
              장소 후보 {placeIndex + 1}
            </Text>
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
        </VoteCandidateCard>
      ))}

      <Pressable
        onPress={addPlaceCandidate}
        disabled={!canAddPlaceCandidate}
        style={({ pressed }) => [
          styles.addCandidateBtn,
          !canAddPlaceCandidate && styles.addCandidateBtnDisabled,
          pressed && canAddPlaceCandidate && styles.addCandidateBtnPressed,
        ]}
        accessibilityRole="button"
        accessibilityState={{ disabled: !canAddPlaceCandidate }}>
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
          ref={dateScrollRef}
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
                <Text style={GinitStyles.modalTitle}>{pickerFieldLabel(picker.field)}</Text>
                <Pressable onPress={applyIosPicker} hitSlop={10}>
                  <Text style={GinitStyles.modalDone}>완료</Text>
                </Pressable>
              </View>
              <DateTimePicker
                value={iosDraft}
                mode={picker.field === 'startDate' || picker.field === 'endDate' ? 'date' : 'time'}
                display={picker.field === 'startDate' || picker.field === 'endDate' ? 'inline' : 'spinner'}
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
          mode={picker.field === 'startDate' || picker.field === 'endDate' ? 'date' : 'time'}
          display={picker.field === 'startTime' || picker.field === 'endTime' ? 'spinner' : 'default'}
          onChange={(event: DateTimePickerEvent, date) => {
            const { rowId, field } = picker;
            setPicker(null);
            if (event.type === 'dismissed' || !date) return;
            const ymd = fmtDate(date);
            const hm = fmtTime(date);
            if (field === 'startDate') updateDateRow(rowId, { startDate: ymd });
            else if (field === 'startTime') updateDateRow(rowId, { startTime: hm });
            else if (field === 'endDate') updateDateRow(rowId, { endDate: ymd });
            else updateDateRow(rowId, { endTime: hm });
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
  /** 자연어 일정 입력 — 리스트 상단 */
  nlpSection: {
    marginBottom: 6,
  },
  nlpLabel: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 2,
    color: 'rgba(255, 255, 255, 0.45)',
    marginBottom: 10,
  },
  /** 카드 루트에 합쳐짐: 다크 글로우 + 거의 투명 글래스 배경 */
  nlpGlassOuter: {
    marginBottom: 10,
    padding: 14,
    backgroundColor: 'rgba(15, 23, 42, 0.42)',
    borderColor: 'rgba(0, 82, 204, 0.45)',
    borderWidth: 1.5,
    shadowColor: TRUST_BLUE,
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.88,
    shadowRadius: 36,
    elevation: 26,
  },
  nlpGlassInner: {
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  nlpTextInput: {
    backgroundColor: 'transparent',
    color: 'rgba(255, 255, 255, 0.96)',
    fontSize: 16,
    fontWeight: '600',
    padding: 0,
    margin: 0,
    minHeight: 22,
  },
  nlpChip: {
    alignSelf: 'flex-start',
    marginTop: 10,
    marginBottom: 6,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: 'rgba(0, 82, 204, 0.38)',
    borderWidth: 1,
    borderColor: 'rgba(147, 197, 253, 0.55)',
  },
  nlpChipPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.98 }],
  },
  nlpChipText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#F8FAFC',
    letterSpacing: -0.2,
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
  cardFieldTitleNoDeleteOffset: {
    paddingRight: 0,
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
  addCandidateBtnDisabled: {
    opacity: 0.5,
  },
  addCandidateBtnPressed: {
    opacity: 0.92,
  },
});
