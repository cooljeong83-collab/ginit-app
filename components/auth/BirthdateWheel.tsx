import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
    NativeScrollEvent,
    NativeSyntheticEvent,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';

import { GinitTheme } from '@/constants/ginit-theme';

const TRUST_BLUE = GinitTheme.colors.primary;

const ITEM_HEIGHT = 28;
const WHEEL_HEIGHT = 84;
const PAD = (WHEEL_HEIGHT - ITEM_HEIGHT) / 2;

type Opt = { value: number; label: string };

function range(start: number, end: number): number[] {
  const out: number[] = [];
  for (let v = start; v <= end; v += 1) out.push(v);
  return out;
}

function daysInMonth(year: number, month1: number): number {
  const m = Math.min(12, Math.max(1, month1));
  // JS Date: month is 0-based, day=0 means last day of previous month
  return new Date(year, m, 0).getDate();
}

type WheelColumnProps = {
  options: Opt[];
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
};

function WheelColumn({ options, value, onChange, disabled }: WheelColumnProps) {
  const scrollRef = useRef<ScrollView>(null);
  const skipNextScrollSyncRef = useRef(false);

  const indexFor = useCallback(
    (v: number) => {
      const i = options.findIndex((o) => o.value === v);
      return i >= 0 ? i : 0;
    },
    [options],
  );

  const scrollToIndex = useCallback(
    (i: number) => {
      const y = Math.max(0, Math.min(i, options.length - 1)) * ITEM_HEIGHT;
      scrollRef.current?.scrollTo({ y, animated: false });
    },
    [options.length],
  );

  useEffect(() => {
    if (skipNextScrollSyncRef.current) {
      skipNextScrollSyncRef.current = false;
      return;
    }
    const id = requestAnimationFrame(() => scrollToIndex(indexFor(value)));
    return () => cancelAnimationFrame(id);
  }, [indexFor, scrollToIndex, value]);

  const emitFromOffset = useCallback(
    (y: number) => {
      const i = Math.min(options.length - 1, Math.max(0, Math.round(y / ITEM_HEIGHT)));
      const next = options[i]!.value;
      skipNextScrollSyncRef.current = true;
      onChange(next);
    },
    [onChange, options],
  );

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (disabled) return;
      emitFromOffset(e.nativeEvent.contentOffset.y);
    },
    [disabled, emitFromOffset],
  );

  const onMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (disabled) return;
      const y = e.nativeEvent.contentOffset.y;
      const i = Math.min(options.length - 1, Math.max(0, Math.round(y / ITEM_HEIGHT)));
      const targetY = i * ITEM_HEIGHT;
      if (Math.abs(y - targetY) > 0.5) {
        scrollRef.current?.scrollTo({ y: targetY, animated: true });
      }
      emitFromOffset(targetY);
    },
    [disabled, emitFromOffset, options.length],
  );

  const selectedIdx = indexFor(value);

  return (
    <View style={col.wheelClip}>
      <View pointerEvents="none" style={col.selectionBand} />
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
        scrollEnabled={!disabled}
        snapToInterval={ITEM_HEIGHT}
        snapToAlignment="start"
        decelerationRate="fast"
        scrollEventThrottle={16}
        contentContainerStyle={col.scrollContent}
        onScroll={onScroll}
        onMomentumScrollEnd={onMomentumEnd}
        keyboardShouldPersistTaps="handled">
        {options.map((opt, idx) => (
          <View key={`${opt.value}-${idx}`} style={col.item}>
            <Text style={[col.itemText, idx === selectedIdx && col.itemTextSelected]} numberOfLines={1}>
              {opt.label}
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const col = StyleSheet.create({
  wheelClip: {
    flex: 1,
    minWidth: 0,
    height: WHEEL_HEIGHT,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  selectionBand: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: PAD,
    height: ITEM_HEIGHT,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(31, 42, 68, 0.55)',
    backgroundColor: 'rgba(31, 42, 68, 0.10)',
    zIndex: 1,
  },
  scrollContent: { paddingVertical: PAD },
  item: { height: ITEM_HEIGHT, justifyContent: 'center', alignItems: 'center' },
  itemText: { fontSize: 14, fontWeight: '700', color: GinitTheme.colors.textMuted },
  itemTextSelected: {
    color: TRUST_BLUE,
    fontWeight: '900',
    ...Platform.select({
      ios: {
        textShadowColor: 'rgba(31, 42, 68, 0.55)',
        textShadowOffset: { width: 0, height: 0 },
        textShadowRadius: 8,
      },
      default: {},
    }),
  },
});

export type BirthdateValue = { year: number; month: number; day: number };

export type BirthdateWheelProps = {
  value: BirthdateValue;
  onChange: (v: BirthdateValue) => void;
  disabled?: boolean;
  /** 기본 1950~(현재연도-10) */
  yearRange?: { min: number; max: number };
};

export function BirthdateWheel({ value, onChange, disabled, yearRange }: BirthdateWheelProps) {
  const nowYear = new Date().getFullYear();
  const yr = yearRange ?? { min: 1950, max: nowYear - 10 };

  const yearOptions = useMemo<Opt[]>(
    () => range(yr.min, yr.max).reverse().map((y) => ({ value: y, label: `${y}` })),
    [yr.max, yr.min],
  );
  const monthOptions = useMemo<Opt[]>(
    () => range(1, 12).map((m) => ({ value: m, label: `${m}` })),
    [],
  );
  const maxDay = useMemo(() => daysInMonth(value.year, value.month), [value.month, value.year]);
  const dayOptions = useMemo<Opt[]>(
    () => range(1, maxDay).map((d) => ({ value: d, label: `${d}` })),
    [maxDay],
  );

  // 월/년 변경으로 day가 범위를 넘어가면 자동 보정
  useEffect(() => {
    if (value.day <= maxDay) return;
    onChange({ ...value, day: maxDay });
  }, [maxDay, onChange, value]);

  return (
    <View style={styles.shell} pointerEvents={disabled ? 'none' : 'auto'} accessible accessibilityLabel="생년월일 선택">
      <View style={styles.row}>
        <View style={styles.colInline}>
          <Text style={styles.sideLabel}>년</Text>
          <WheelColumn
            options={yearOptions}
            value={value.year}
            onChange={(year) => onChange({ ...value, year })}
            disabled={disabled}
          />
        </View>
        <View style={styles.colInline}>
          <Text style={styles.sideLabel}>월</Text>
          <WheelColumn
            options={monthOptions}
            value={value.month}
            onChange={(month) => onChange({ ...value, month })}
            disabled={disabled}
          />
        </View>
        <View style={styles.colInline}>
          <Text style={styles.sideLabel}>일</Text>
          <WheelColumn
            options={dayOptions}
            value={Math.min(value.day, maxDay)}
            onChange={(day) => onChange({ ...value, day })}
            disabled={disabled}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    marginTop: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    paddingVertical: 6,
    paddingHorizontal: 8,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4 },
  colInline: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  sideLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: GinitTheme.colors.textMuted,
    width: 16,
    textAlign: 'right',
    letterSpacing: 0.2,
  },
});

