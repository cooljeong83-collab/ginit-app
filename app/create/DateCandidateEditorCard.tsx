/**
 * 일시 후보 카드 — 8가지 type별 글래스 UI (VoteCandidatesForm 전용).
 */
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import type { DateCandidate, DateCandidateType } from '@/src/lib/meeting-place-bridge';
import { rangeNightsBadge } from '@/src/lib/date-candidate';

import { GinitTheme } from '@/constants/ginit-theme';

const TRUST_BLUE = GinitTheme.colors.primary;
const ORANGE = GinitTheme.colors.warning;
const INPUT_PLACEHOLDER = GinitTheme.colors.textMuted;

export type DatePickerField = 'startDate' | 'startTime' | 'endDate' | 'endTime';

const TYPE_OPTIONS: { type: DateCandidateType; label: string }[] = [
  { type: 'point', label: '한 시각' },
  { type: 'date-range', label: '날짜 기간' },
  { type: 'datetime-range', label: '일시 기간' },
  { type: 'recurring', label: '반복' },
  { type: 'multi', label: '여러 안' },
  { type: 'flexible', label: '유연' },
  { type: 'tbd', label: '미정' },
  { type: 'deadline', label: '마감' },
];

/**
 * NOTE:
 * 이 파일은 `/app` 아래에 위치해 Expo Router가 route로 인식합니다.
 * 실제로는 화면이 아니라 내부 컴포넌트이므로, 라우터 경고를 막기 위해
 * 빈 default export를 제공합니다. (추후 `components/`로 이동 권장)
 */
export default function _DateCandidateEditorCardRoute() {
  return null;
}

function VoteGlassShell({
  reduceHeavyEffects,
  children,
  outerStyle,
}: {
  reduceHeavyEffects: boolean;
  children: ReactNode;
  outerStyle?: StyleProp<ViewStyle>;
}) {
  const flat = StyleSheet.flatten(outerStyle) as ViewStyle | undefined;
  const {
    margin,
    marginTop,
    marginBottom,
    marginLeft,
    marginRight,
    marginHorizontal,
    marginVertical,
    alignSelf,
    borderRadius,
    ...innerRest
  } = flat ?? {};

  const wrapStyle: StyleProp<ViewStyle> = [
    styles.glassWrap,
    (margin != null ||
      marginTop != null ||
      marginBottom != null ||
      marginLeft != null ||
      marginRight != null ||
      marginHorizontal != null ||
      marginVertical != null ||
      alignSelf != null) && {
      margin,
      marginTop,
      marginBottom,
      marginLeft,
      marginRight,
      marginHorizontal,
      marginVertical,
      alignSelf,
    },
    borderRadius != null && { borderRadius },
  ];

  const innerStyle: StyleProp<ViewStyle> = [styles.glassInner, borderRadius != null && { borderRadius }, innerRest];

  // 텍스트 가독성을 위해 iOS에서도 BlurView를 사용하지 않습니다.
  if (reduceHeavyEffects || Platform.OS === 'web' || Platform.OS === 'ios') {
    return (
      <View style={wrapStyle}>
        <View style={innerStyle}>{children}</View>
      </View>
    );
  }

  return (
    <View style={wrapStyle}>
      <View style={innerStyle}>{children}</View>
    </View>
  );
}

function NeonBadge({ text, color }: { text: string; color: 'blue' | 'orange' }) {
  const c = color === 'orange' ? ORANGE : TRUST_BLUE;
  return (
    <View style={[styles.neonBadge, { borderColor: c, shadowColor: c }]}>
      <Text style={[styles.neonBadgeText, { color: c }]}>{text}</Text>
    </View>
  );
}

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function parseEnd(d: DateCandidate): Date | null {
  const de = d.endDate?.trim();
  const te = d.endTime?.trim();
  if (!de || !te) return null;
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(de);
  const tm = /^(\d{1,2}):(\d{2})$/.exec(te);
  if (!dm || !tm) return null;
  return new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(tm[1]), Number(tm[2]), 0, 0);
}

function parseStart(d: DateCandidate): Date {
  const ds = d.startDate.trim();
  const ts = (d.startTime ?? '00:00').trim();
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ds);
  const tm = /^(\d{1,2}):(\d{2})$/.exec(ts);
  if (!dm || !tm) return new Date();
  return new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(tm[1]), Number(tm[2]), 0, 0);
}

function DeadlineBar({ d, tick }: { d: DateCandidate; tick: number }) {
  const end = parseEnd(d);
  const start = parseStart(d);
  const { ratio, label } = useMemo(() => {
    void tick;
    if (!end) return { ratio: 0, label: '—' };
    const now = Date.now();
    const span = Math.max(1, end.getTime() - start.getTime());
    let r = (now - start.getTime()) / span;
    r = Math.min(1, Math.max(0, r));
    let lbl = '';
    const left = end.getTime() - now;
    if (left <= 0) lbl = '마감됨';
    else {
      const sec = Math.floor(left / 1000);
      const days = Math.floor(sec / 86400);
      const h = Math.floor((sec % 86400) / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = sec % 60;
      if (days > 0) lbl = `${days}일 ${pad2(h)}:${pad2(m)}:${pad2(s)}`;
      else lbl = `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
    }
    return { ratio: r, label: lbl };
  }, [end, start, tick]);

  return (
    <View style={styles.deadlineBlock}>
      <View style={styles.deadlineTrack}>
        <View style={[styles.deadlineFill, { width: `${Math.round(ratio * 100)}%` }]} />
      </View>
      <Text style={styles.deadlineCountdown}>{label}</Text>
    </View>
  );
}

function applyTypeSwitch(prev: DateCandidate, next: DateCandidateType): DateCandidate {
  const sd = prev.startDate;
  const st = prev.startTime ?? '15:00';
  const ed = prev.endDate ?? sd;
  const et = prev.endTime ?? st;
  switch (next) {
    case 'point':
      return {
        ...prev,
        type: 'point',
        startDate: sd,
        startTime: st,
        endDate: undefined,
        endTime: undefined,
        textLabel: undefined,
        subType: undefined,
        isDeadlineSet: undefined,
      };
    case 'date-range':
      return {
        ...prev,
        type: 'date-range',
        startDate: sd,
        endDate: ed,
        startTime: undefined,
        endTime: undefined,
        textLabel: undefined,
        subType: undefined,
        isDeadlineSet: undefined,
      };
    case 'datetime-range':
      return {
        ...prev,
        type: 'datetime-range',
        startDate: sd,
        startTime: st,
        endDate: ed,
        endTime: et,
        textLabel: undefined,
        subType: undefined,
        isDeadlineSet: undefined,
      };
    case 'recurring':
      return {
        ...prev,
        type: 'recurring',
        subType: prev.subType ?? 'weekly',
        startDate: sd,
        startTime: st,
        endDate: undefined,
        endTime: undefined,
        textLabel: undefined,
        isDeadlineSet: undefined,
      };
    case 'multi':
      return {
        ...prev,
        type: 'multi',
        startDate: sd,
        startTime: st,
        textLabel: prev.textLabel ?? '',
        endDate: undefined,
        endTime: undefined,
        subType: undefined,
        isDeadlineSet: undefined,
      };
    case 'flexible':
      return {
        ...prev,
        type: 'flexible',
        startDate: sd,
        startTime: st,
        textLabel: prev.textLabel ?? '',
        endDate: undefined,
        endTime: undefined,
        subType: undefined,
        isDeadlineSet: undefined,
      };
    case 'tbd':
      return {
        ...prev,
        type: 'tbd',
        startDate: sd,
        startTime: undefined,
        endDate: undefined,
        endTime: undefined,
        textLabel: undefined,
        subType: undefined,
        isDeadlineSet: undefined,
      };
    case 'deadline':
      return {
        ...prev,
        type: 'deadline',
        startDate: sd,
        startTime: st,
        endDate: ed,
        endTime: et,
        isDeadlineSet: true,
        textLabel: undefined,
        subType: undefined,
      };
    default:
      return prev;
  }
}

export function DateCandidateEditorCard({
  d,
  dateIndex,
  expanded,
  onToggleExpanded,
  canDelete,
  onRemove,
  onPatch,
  reduceHeavyEffects,
  onOpenPicker,
  deadlineTick,
  autoFocusFirstInput = false,
}: {
  d: DateCandidate;
  dateIndex: number;
  expanded: boolean;
  onToggleExpanded: () => void;
  canDelete: boolean;
  onRemove: () => void;
  onPatch: (patch: Partial<DateCandidate>) => void;
  reduceHeavyEffects: boolean;
  onOpenPicker: (field: DatePickerField) => void;
  deadlineTick: number;
  /** 새 카드 추가 직후: 첫 입력창에 자동 포커스 */
  autoFocusFirstInput?: boolean;
}) {
  const badge = d.type === 'date-range' || d.type === 'datetime-range' ? rangeNightsBadge(d.startDate, d.endDate ?? d.startDate) : null;
  const firstInputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!autoFocusFirstInput) return;
    if (!expanded) return;
    const id = requestAnimationFrame(() => {
      firstInputRef.current?.focus?.();
    });
    return () => cancelAnimationFrame(id);
  }, [autoFocusFirstInput, expanded, d.type]);

  const renderWebPair = (
    dateVal: string,
    timeVal: string | undefined,
    onDate: (t: string) => void,
    onTime: (t: string) => void,
    timePlaceholder: string,
    timeDisabled?: boolean,
  ) => (
    <View style={styles.row2}>
      <View style={[styles.fieldRecess, styles.fieldRecessHalf]}>
        <TextInput
          value={dateVal}
          onChangeText={onDate}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={INPUT_PLACEHOLDER}
          style={styles.textInputBare}
          autoCapitalize="none"
        />
      </View>
      <View style={[styles.fieldRecess, styles.fieldRecessHalf]}>
        <TextInput
          value={timeDisabled ? '' : (timeVal ?? '')}
          onChangeText={onTime}
          placeholder={timePlaceholder}
          placeholderTextColor={INPUT_PLACEHOLDER}
          style={styles.textInputBare}
          autoCapitalize="none"
          editable={!timeDisabled}
        />
      </View>
    </View>
  );

  const renderNativePair = (
    dateVal: string,
    timeVal: string | undefined,
    fieldD: DatePickerField,
    fieldT: DatePickerField,
    timeDisabled?: boolean,
  ) => (
    <View style={styles.row2}>
      <View style={[styles.fieldRecess, styles.fieldRecessHalf]}>
        <Pressable onPress={() => onOpenPicker(fieldD)} style={styles.dateTimePressable} accessibilityRole="button">
          <Text style={styles.dateTimeLabel}>날짜</Text>
          <Text style={styles.dateTimeValue}>{dateVal}</Text>
        </Pressable>
      </View>
      <View style={[styles.fieldRecess, styles.fieldRecessHalf]}>
        {timeDisabled ? (
          <View style={styles.dateTimePressable}>
            <Text style={styles.dateTimeLabel}>시간</Text>
            <Text style={[styles.dateTimeValue, styles.tbdNeon]}>TBD</Text>
          </View>
        ) : (
          <Pressable onPress={() => onOpenPicker(fieldT)} style={styles.dateTimePressable} accessibilityRole="button">
            <Text style={styles.dateTimeLabel}>시간</Text>
            <Text style={styles.dateTimeValue}>{timeVal ?? '—'}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );

  const typeChips = expanded ? (
    <View style={styles.typeChipWrap}>
      {TYPE_OPTIONS.map(({ type, label }) => (
        <Pressable
          key={type}
          onPress={() => onPatch(applyTypeSwitch(d, type))}
          style={[styles.typeChip, d.type === type && styles.typeChipOn]}
          accessibilityRole="button">
          <Text style={[styles.typeChipLabel, d.type === type && styles.typeChipLabelOn]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  ) : null;

  let body: ReactNode = null;

  if (!expanded && d.type === 'point') {
    body =
      Platform.OS === 'web' ? (
        renderWebPair(
          d.startDate,
          d.startTime,
          (t) => onPatch({ startDate: t }),
          (t) => onPatch({ startTime: t }),
          'HH:mm',
        )
      ) : (
        renderNativePair(d.startDate, d.startTime, 'startDate', 'startTime')
      );
  } else if (!expanded) {
    body = (
      <View style={styles.compactSummary}>
        {d.type === 'date-range' || d.type === 'datetime-range' ? (
          <>
            <View style={styles.rangeRow}>
              <Text style={styles.rangeDate}>{d.startDate}</Text>
              <Text style={styles.rangeArrow}>→</Text>
              <Text style={styles.rangeDate}>{d.endDate ?? '—'}</Text>
            </View>
            {d.type === 'datetime-range' ? (
              <Text style={styles.rangeTime}>
                {(d.startTime ?? '') + ' ~ ' + (d.endTime ?? '')}
              </Text>
            ) : null}
            {badge ? (
              <View style={styles.n박뱃지}>
                <Text style={styles.n박뱃지Text}>{badge}</Text>
              </View>
            ) : null}
          </>
        ) : d.type === 'recurring' ? (
          <Text style={styles.summaryText}>
            {d.subType === 'daily' ? '매일' : d.subType === 'monthly' ? '매월' : '매주'} · {d.startDate}{' '}
            {d.startTime ?? ''}
          </Text>
        ) : d.type === 'multi' ? (
          <Text style={styles.summaryText} numberOfLines={3}>
            {d.textLabel ?? '여러 안'}
          </Text>
        ) : d.type === 'flexible' ? (
          <Text style={styles.flexPreview} numberOfLines={4}>
            {d.textLabel ?? '유연 일정'}
          </Text>
        ) : d.type === 'tbd' ? (
          <Text style={styles.summaryText}>날짜 {d.startDate} · 시간 미정</Text>
        ) : d.type === 'deadline' ? null : (
          <Text style={styles.summaryText}>일정</Text>
        )}
      </View>
    );
  } else {
    switch (d.type) {
      case 'point':
        body = (
          <>
            {typeChips}
            {Platform.OS === 'web' ? (
              renderWebPair(
                d.startDate,
                d.startTime,
                (t) => onPatch({ startDate: t }),
                (t) => onPatch({ startTime: t }),
                'HH:mm',
              )
            ) : (
              renderNativePair(d.startDate, d.startTime, 'startDate', 'startTime')
            )}
          </>
        );
        break;
      case 'date-range':
        body = (
          <>
            {typeChips}
            <Text style={styles.blockLabel}>시작 → 종료 (날짜만)</Text>
            {Platform.OS === 'web' ? (
              <>
                <View style={styles.fieldRecess}>
                  <TextInput
                    ref={firstInputRef}
                    value={d.startDate}
                    onChangeText={(t) => onPatch({ startDate: t })}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={INPUT_PLACEHOLDER}
                    style={styles.textInputBare}
                    autoCapitalize="none"
                  />
                </View>
                <Text style={[styles.blockLabel, { marginTop: 10 }]}>종료일</Text>
                <View style={styles.fieldRecess}>
                  <TextInput
                    value={d.endDate ?? ''}
                    onChangeText={(t) => onPatch({ endDate: t })}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={INPUT_PLACEHOLDER}
                    style={styles.textInputBare}
                    autoCapitalize="none"
                  />
                </View>
              </>
            ) : (
              <>
                <Pressable onPress={() => onOpenPicker('startDate')} style={styles.fieldRecess}>
                  <Text style={styles.dateTimeLabel}>시작일</Text>
                  <Text style={styles.dateTimeValue}>{d.startDate}</Text>
                </Pressable>
                <View style={{ height: 8 }} />
                <Pressable onPress={() => onOpenPicker('endDate')} style={styles.fieldRecess}>
                  <Text style={styles.dateTimeLabel}>종료일</Text>
                  <Text style={styles.dateTimeValue}>{d.endDate ?? '—'}</Text>
                </Pressable>
              </>
            )}
            {badge ? (
              <View style={[styles.n박뱃지, { marginTop: 10 }]}>
                <Text style={styles.n박뱃지Text}>{badge}</Text>
              </View>
            ) : null}
          </>
        );
        break;
      case 'datetime-range':
        body = (
          <>
            {typeChips}
            <Text style={styles.blockLabel}>시작</Text>
            {Platform.OS === 'web' ? (
              renderWebPair(
                d.startDate,
                d.startTime,
                (t) => onPatch({ startDate: t }),
                (t) => onPatch({ startTime: t }),
                'HH:mm',
              )
            ) : (
              renderNativePair(d.startDate, d.startTime, 'startDate', 'startTime')
            )}
            <Text style={[styles.blockLabel, { marginTop: 10 }]}>종료</Text>
            {Platform.OS === 'web' ? (
              renderWebPair(
                d.endDate ?? '',
                d.endTime,
                (t) => onPatch({ endDate: t }),
                (t) => onPatch({ endTime: t }),
                'HH:mm',
              )
            ) : (
              renderNativePair(d.endDate ?? d.startDate, d.endTime, 'endDate', 'endTime')
            )}
            {badge ? (
              <View style={[styles.n박뱃지, { marginTop: 10 }]}>
                <Text style={styles.n박뱃지Text}>{badge}</Text>
              </View>
            ) : null}
          </>
        );
        break;
      case 'recurring':
        body = (
          <>
            {typeChips}
            <View style={styles.subTypeRow}>
              {(['daily', 'weekly', 'monthly'] as const).map((s) => (
                <Pressable
                  key={s}
                  onPress={() => onPatch({ subType: s })}
                  style={[styles.subTypeChip, d.subType === s && styles.subTypeChipOn]}>
                  <Text style={[styles.subTypeChipTxt, d.subType === s && styles.subTypeChipTxtOn]}>
                    {s === 'daily' ? '매일' : s === 'monthly' ? '매월' : '매주'}
                  </Text>
                </Pressable>
              ))}
            </View>
            {Platform.OS === 'web' ? (
              renderWebPair(
                d.startDate,
                d.startTime,
                (t) => onPatch({ startDate: t }),
                (t) => onPatch({ startTime: t }),
                'HH:mm',
              )
            ) : (
              renderNativePair(d.startDate, d.startTime, 'startDate', 'startTime')
            )}
          </>
        );
        break;
      case 'multi':
        body = (
          <>
            {typeChips}
            <Text style={styles.blockLabel}>여러 일정 안 (투표용 설명)</Text>
            <View style={styles.fieldRecess}>
              <TextInput
                ref={firstInputRef}
                value={d.textLabel ?? ''}
                onChangeText={(t) => onPatch({ textLabel: t })}
                placeholder="예: 내일 오후 vs 모레 오전"
                placeholderTextColor={INPUT_PLACEHOLDER}
                style={[styles.textInputBare, styles.multiInput]}
                multiline
              />
            </View>
            <Text style={[styles.blockLabel, { marginTop: 10 }]}>대표 날짜 (표시용)</Text>
            {Platform.OS === 'web' ? (
              renderWebPair(
                d.startDate,
                d.startTime,
                (t) => onPatch({ startDate: t }),
                (t) => onPatch({ startTime: t }),
                'HH:mm',
              )
            ) : (
              renderNativePair(d.startDate, d.startTime, 'startDate', 'startTime')
            )}
          </>
        );
        break;
      case 'flexible':
        body = (
          <>
            {typeChips}
            <Text style={styles.blockLabel}>유연 일정 (말로 적기)</Text>
            <View style={[styles.fieldRecess, styles.flexRecess]}>
              <TextInput
                ref={firstInputRef}
                value={d.textLabel ?? ''}
                onChangeText={(t) => onPatch({ textLabel: t })}
                placeholder="예: 시험 끝나는 주말쯤, 대략 저녁"
                placeholderTextColor={INPUT_PLACEHOLDER}
                style={[styles.textInputBare, styles.flexInput]}
                multiline
              />
            </View>
            <Text style={[styles.blockLabel, { marginTop: 10 }]}>참고 일시</Text>
            {Platform.OS === 'web' ? (
              renderWebPair(
                d.startDate,
                d.startTime,
                (t) => onPatch({ startDate: t }),
                (t) => onPatch({ startTime: t }),
                'HH:mm',
              )
            ) : (
              renderNativePair(d.startDate, d.startTime, 'startDate', 'startTime')
            )}
          </>
        );
        break;
      case 'tbd':
        body = (
          <>
            {typeChips}
            <Text style={styles.blockLabel}>기준일 (대략적인 주)</Text>
            {Platform.OS === 'web' ? (
              <View style={[styles.fieldRecess, styles.fieldRecessHalf]}>
                <TextInput
                  ref={firstInputRef}
                  value={d.startDate}
                  onChangeText={(t) => onPatch({ startDate: t })}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={INPUT_PLACEHOLDER}
                  style={styles.textInputBare}
                  autoCapitalize="none"
                />
              </View>
            ) : (
              <Pressable onPress={() => onOpenPicker('startDate')} style={styles.fieldRecess}>
                <Text style={styles.dateTimeLabel}>날짜</Text>
                <Text style={styles.dateTimeValue}>{d.startDate}</Text>
              </Pressable>
            )}
            <View style={[styles.fieldRecess, { marginTop: 10 }]}>
              <Text style={styles.dateTimeLabel}>시간</Text>
              <Text style={[styles.dateTimeValue, styles.tbdNeon]}>TBD</Text>
            </View>
          </>
        );
        break;
      case 'deadline':
        body = (
          <>
            {typeChips}
            <Text style={styles.blockLabel}>등록·준비 구간 시작</Text>
            {Platform.OS === 'web' ? (
              renderWebPair(
                d.startDate,
                d.startTime,
                (t) => onPatch({ startDate: t }),
                (t) => onPatch({ startTime: t }),
                'HH:mm',
              )
            ) : (
              renderNativePair(d.startDate, d.startTime, 'startDate', 'startTime')
            )}
            <Text style={[styles.blockLabel, { marginTop: 10 }]}>마감 일시</Text>
            {Platform.OS === 'web' ? (
              renderWebPair(
                d.endDate ?? '',
                d.endTime,
                (t) => onPatch({ endDate: t }),
                (t) => onPatch({ endTime: t }),
                'HH:mm',
              )
            ) : (
              renderNativePair(d.endDate ?? d.startDate, d.endTime, 'endDate', 'endTime')
            )}
            <DeadlineBar d={d} tick={deadlineTick} />
          </>
        );
        break;
      default:
        body = null;
    }
  }

  return (
    <VoteGlassShell reduceHeavyEffects={reduceHeavyEffects}>
      <View style={styles.inner}>
        {canDelete ? (
          <Pressable onPress={onRemove} style={styles.deleteIconBtn} accessibilityRole="button" accessibilityLabel="일시 후보 삭제">
            <Text style={styles.deleteIconText}>✕</Text>
          </Pressable>
        ) : null}
        {d.type === 'recurring' ? (
          <View style={styles.recurringCorner}>
            <NeonBadge text="RECURRING" color="orange" />
            <Text style={styles.loopIcon}>🔁</Text>
          </View>
        ) : null}

        <Text
          style={[
            styles.cardFieldTitle,
            !canDelete && styles.cardFieldTitleNoDelete,
            d.type === 'recurring' && styles.cardFieldTitleRecurring,
          ]}>
          일정 후보 {dateIndex + 1}
        </Text>

        {body}

        <Pressable onPress={onToggleExpanded} style={styles.detailToggle} accessibilityRole="button">
          <Text style={styles.detailToggleText}>{expanded ? '▲ 간단히 보기' : '▼ 상세 설정 (유형 변경)'}</Text>
        </Pressable>

        {!expanded && d.type === 'deadline' ? <DeadlineBar d={d} tick={deadlineTick} /> : null}
      </View>
    </VoteGlassShell>
  );
}

const styles = StyleSheet.create({
  glassWrap: {
    marginBottom: 10,
    borderRadius: 24,
    backgroundColor: Platform.OS === 'android' ? '#FFFFFF' : 'transparent',
    shadowColor: GinitTheme.glass.shadow,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 16,
    elevation: 12,
  },
  glassInner: {
    borderRadius: 24,
    padding: 12,
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: GinitTheme.colors.border,
    overflow: 'hidden',
  },
  inner: { position: 'relative' },
  deleteIconBtn: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
  },
  deleteIconText: { color: GinitTheme.colors.text, fontSize: 14, fontWeight: '700' },
  cardFieldTitle: {
    color: GinitTheme.colors.text,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
    paddingRight: 40,
    textShadowColor: 'transparent',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 0,
  },
  cardFieldTitleNoDelete: { paddingRight: 0 },
  cardFieldTitleRecurring: { marginTop: 22 },
  recurringCorner: {
    position: 'absolute',
    top: 0,
    left: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    zIndex: 2,
  },
  loopIcon: { fontSize: 16 },
  neonBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    backgroundColor: 'rgba(255, 138, 0, 0.12)',
  },
  neonBadgeText: { fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  row2: { flexDirection: 'row', gap: 8 },
  fieldRecess: {
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    borderColor: GinitTheme.colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  fieldRecessHalf: { flex: 1, minWidth: 0 },
  textInputBare: {
    backgroundColor: 'transparent',
    color: GinitTheme.colors.text,
    fontSize: 16,
    fontWeight: '600',
    padding: 0,
    margin: 0,
  },
  dateTimePressable: { gap: 2 },
  dateTimeLabel: { fontSize: 12, fontWeight: '600', color: GinitTheme.colors.textMuted },
  dateTimeValue: { fontSize: 15, fontWeight: '700', color: GinitTheme.colors.text },
  tbdNeon: {
    color: ORANGE,
    fontWeight: '900',
    letterSpacing: 2,
  },
  detailToggle: { marginTop: 8, paddingVertical: 4 },
  detailToggleText: {
    fontSize: 12,
    fontWeight: '800',
    color: GinitTheme.colors.textSub,
    textShadowColor: 'transparent',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 0,
  },
  typeChipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  typeChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: GinitTheme.colors.surfaceStrong,
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
  },
  typeChipOn: { backgroundColor: GinitTheme.colors.primarySoft, borderColor: GinitTheme.colors.accent },
  typeChipLabel: { fontSize: 11, fontWeight: '700', color: GinitTheme.colors.textSub },
  typeChipLabelOn: { color: GinitTheme.colors.text },
  blockLabel: { fontSize: 12, fontWeight: '800', color: GinitTheme.colors.textMuted, marginBottom: 6 },
  subTypeRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  subTypeChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 138, 0, 0.45)',
    backgroundColor: 'rgba(255, 138, 0, 0.08)',
  },
  subTypeChipOn: { backgroundColor: 'rgba(255, 138, 0, 0.16)', borderColor: ORANGE },
  subTypeChipTxt: { fontSize: 12, fontWeight: '800', color: ORANGE },
  subTypeChipTxtOn: { color: GinitTheme.colors.text },
  compactSummary: { paddingVertical: 4 },
  rangeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  rangeDate: { fontSize: 16, fontWeight: '800', color: GinitTheme.colors.text },
  rangeArrow: { fontSize: 18, fontWeight: '900', color: GinitTheme.colors.textSub },
  rangeTime: { marginTop: 6, fontSize: 14, fontWeight: '600', color: GinitTheme.colors.textMuted },
  n박뱃지: {
    alignSelf: 'flex-start',
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: GinitTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
  },
  n박뱃지Text: { fontSize: 12, fontWeight: '900', color: GinitTheme.colors.textSub },
  summaryText: { fontSize: 15, fontWeight: '700', color: GinitTheme.colors.text, lineHeight: 22 },
  flexPreview: { fontSize: 15, fontWeight: '600', color: GinitTheme.colors.text, lineHeight: 22, fontStyle: 'italic' },
  flexRecess: { backgroundColor: GinitTheme.colors.surfaceStrong, borderColor: GinitTheme.colors.border },
  flexInput: { minHeight: 72, textAlignVertical: 'top' },
  multiInput: { minHeight: 56, textAlignVertical: 'top' },
  deadlineBlock: { marginTop: 12 },
  deadlineTrack: {
    height: 6,
    borderRadius: 999,
    backgroundColor: GinitTheme.colors.surfaceStrong,
    overflow: 'hidden',
  },
  deadlineFill: {
    height: 6,
    borderRadius: 999,
    backgroundColor: ORANGE,
  },
  deadlineCountdown: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: '800',
    color: ORANGE,
    letterSpacing: -0.2,
  },
});
