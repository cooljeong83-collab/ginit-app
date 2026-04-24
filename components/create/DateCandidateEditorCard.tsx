/**
 * 일시 후보 카드 — 날짜/시간 입력 전용 (VoteCandidatesForm 전용).
 */
import { useMemo, useRef, type ReactNode, type RefObject } from 'react';
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

import type { DateCandidate } from '@/src/lib/meeting-place-bridge';
import { deferSoftInputUntilUserTapProps } from '@/src/lib/defer-soft-input-until-user-tap';

import { GinitTheme } from '@/constants/ginit-theme';

const INPUT_PLACEHOLDER = GinitTheme.colors.textMuted;

export type DatePickerField = 'startDate' | 'startTime';

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

export function DateCandidateEditorCard({
  d,
  dateIndex,
  expanded: _expanded,
  onToggleExpanded: _onToggleExpanded,
  canDelete,
  onRemove,
  onPatch,
  reduceHeavyEffects,
  onOpenPicker,
  deadlineTick: _deadlineTick,
  onSubmitLastFieldInCard,
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
  /** 웹 텍스트 입력에서 마지막 필드의 Submit(엔터) — 다음 카드/필드로 넘길 때 */
  onSubmitLastFieldInCard?: () => void;
}) {
  const firstInputRef = useRef<TextInput>(null);
  const deferKbByRef = useMemo(
    () =>
      new Map<RefObject<TextInput | null>, ReturnType<typeof deferSoftInputUntilUserTapProps>>([
        [firstInputRef, deferSoftInputUntilUserTapProps(firstInputRef)],
      ]),
    [],
  );
  const deferFor = (r: RefObject<TextInput | null> | undefined) =>
    r ? (deferKbByRef.get(r) ?? {}) : {};

  const renderWebPair = () => (
    <View style={styles.row2}>
      <View style={[styles.fieldRecess, styles.fieldRecessHalf]}>
        <TextInput
          ref={firstInputRef}
          {...deferFor(firstInputRef)}
          value={d.startDate}
          onChangeText={(t) => onPatch({ startDate: t })}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={INPUT_PLACEHOLDER}
          style={styles.textInputBare}
          autoCapitalize="none"
          returnKeyType="next"
          blurOnSubmit={false}
        />
      </View>
      <View style={[styles.fieldRecess, styles.fieldRecessHalf]}>
        <TextInput
          value={d.startTime ?? ''}
          onChangeText={(t) => onPatch({ startTime: t })}
          placeholder="HH:mm"
          placeholderTextColor={INPUT_PLACEHOLDER}
          style={styles.textInputBare}
          autoCapitalize="none"
          returnKeyType={onSubmitLastFieldInCard ? 'next' : 'done'}
          blurOnSubmit={false}
          onSubmitEditing={() => onSubmitLastFieldInCard?.()}
        />
      </View>
    </View>
  );

  const renderNativePair = () => (
    <View style={styles.row2}>
      <Pressable
        onPress={() => onOpenPicker('startDate')}
        style={({ pressed }) => [styles.chipPressable, pressed && styles.chipPressed]}
        accessibilityRole="button"
        accessibilityLabel="일시 후보 날짜 선택">
        <View style={styles.chipClip}>
          <Text style={styles.chipLabel} numberOfLines={1}>
            {d.startDate}
          </Text>
        </View>
      </Pressable>
      <Pressable
        onPress={() => onOpenPicker('startTime')}
        style={({ pressed }) => [styles.chipPressable, pressed && styles.chipPressed]}
        accessibilityRole="button"
        accessibilityLabel="일시 후보 시간 선택">
        <View style={styles.chipClip}>
          <Text style={styles.chipLabel} numberOfLines={1}>
            {d.startTime ?? '—'}
          </Text>
        </View>
      </Pressable>
    </View>
  );

  return (
    <VoteGlassShell reduceHeavyEffects={reduceHeavyEffects}>
      <View style={styles.inner}>
        {canDelete ? (
          <Pressable onPress={onRemove} style={styles.deleteIconBtn} accessibilityRole="button" hitSlop={6}>
            <Text style={styles.deleteIconText}>✕</Text>
          </Pressable>
        ) : null}

        <Text style={[styles.cardFieldTitle, !canDelete && styles.cardFieldTitleNoDelete]}>
          일정 후보 {dateIndex + 1}
        </Text>

        {Platform.OS === 'web' ? renderWebPair() : renderNativePair()}
      </View>
    </VoteGlassShell>
  );
}

const styles = StyleSheet.create({
  glassWrap: {
    marginBottom: 10,
    borderRadius: 24,
    backgroundColor: 'transparent',
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
  },
  cardFieldTitleNoDelete: { paddingRight: 0 },
  row2: { flexDirection: 'row', gap: 10 },
  /** 웹 입력 래퍼(기존 호환) */
  fieldRecess: {
    borderRadius: 16,
    overflow: 'hidden',
    paddingHorizontal: 12,
    paddingVertical: 8,
    justifyContent: 'center',
    minHeight: 34,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.55)',
    backgroundColor: 'rgba(255, 255, 255, 0.82)',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 1,
  },
  fieldRecessHalf: { flex: 1 },
  chipPressable: {
    flex: 1,
    borderRadius: 20,
    minHeight: 34,
  },
  chipPressed: { opacity: 0.92, transform: [{ scale: 0.98 }] },
  chipClip: {
    borderRadius: 16,
    overflow: 'hidden',
    paddingHorizontal: 12,
    paddingVertical: 8,
    justifyContent: 'center',
    minHeight: 34,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.55)',
    backgroundColor: 'rgba(255, 255, 255, 0.82)',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 1,
  },
  chipLabel: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
    textAlign: 'center',
    lineHeight: 18,
    letterSpacing: -0.2,
  },
  textInputBare: {
    padding: 0,
    margin: 0,
    fontSize: 15,
    fontWeight: '700',
    color: GinitTheme.colors.text,
  },
});

