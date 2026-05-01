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
export const CAPACITY_UNLIMITED = 999;

const ITEM_HEIGHT = 28;
const WHEEL_HEIGHT = 84;
const PAD = (WHEEL_HEIGHT - ITEM_HEIGHT) / 2;

const MIN_OPTIONS: { value: number; label: string }[] = Array.from({ length: 100 }, (_, i) => ({
  value: i + 1,
  label: String(i + 1),
}));

function buildMaxOptions(min: number): { value: number; label: string }[] {
  const list: { value: number; label: string }[] = [];
  for (let v = min; v <= 100; v += 1) {
    list.push({ value: v, label: String(v) });
  }
  list.push({ value: CAPACITY_UNLIMITED, label: '무제한' });
  return list;
}

type WheelColumnProps = {
  options: { value: number; label: string }[];
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
    (i: number, animated: boolean) => {
      const y = Math.max(0, Math.min(i, options.length - 1)) * ITEM_HEIGHT;
      scrollRef.current?.scrollTo({ y, animated });
    },
    [options.length],
  );

  useEffect(() => {
    if (skipNextScrollSyncRef.current) {
      skipNextScrollSyncRef.current = false;
      return;
    }
    const id = requestAnimationFrame(() => scrollToIndex(indexFor(value), false));
    return () => cancelAnimationFrame(id);
  }, [indexFor, options, scrollToIndex, value]);

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
            <Text
              style={[col.itemText, idx === selectedIdx && col.itemTextSelected]}
              numberOfLines={1}>
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
  scrollContent: {
    paddingVertical: PAD,
  },
  item: {
    height: ITEM_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  itemText: {
    fontSize: 14,
    fontWeight: '700',
    color: GinitTheme.colors.textMuted,
  },
  itemTextSelected: {
    color: TRUST_BLUE,
    fontWeight: '600',
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

export type GlassDualCapacityWheelProps = {
  minValue: number;
  maxValue: number;
  onMinChange: (n: number) => void;
  onMaxChange: (n: number) => void;
  disabled?: boolean;
};

export function GlassDualCapacityWheel({
  minValue,
  maxValue,
  onMinChange,
  onMaxChange,
  disabled,
}: GlassDualCapacityWheelProps) {
  const maxOptions = useMemo(() => buildMaxOptions(minValue), [minValue]);

  const a11ySummary = useMemo(() => {
    const maxLabel = maxValue === CAPACITY_UNLIMITED ? '무제한' : `${maxValue}명`;
    return `최소 ${minValue}명, 최대 ${maxLabel}`;
  }, [maxValue, minValue]);

  return (
    <View
      style={styles.shell}
      pointerEvents={disabled ? 'none' : 'auto'}
      accessible
      accessibilityLabel={a11ySummary}>
      <View style={styles.row}>
        <View style={styles.colInline}>
          <Text style={styles.sideLabel}>최소</Text>
          <WheelColumn options={MIN_OPTIONS} value={minValue} onChange={onMinChange} disabled={disabled} />
        </View>

        <Text style={styles.tilde}>~</Text>

        <View style={styles.colInline}>
          <Text style={styles.sideLabel}>최대</Text>
          <WheelColumn options={maxOptions} value={maxValue} onChange={onMaxChange} disabled={disabled} />
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
  },
  colInline: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
  },
  sideLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: GinitTheme.colors.textMuted,
    width: 26,
    textAlign: 'right',
    letterSpacing: 0.2,
  },
  tilde: {
    fontSize: 15,
    fontWeight: '600',
    color: GinitTheme.colors.textMuted,
    paddingBottom: 2,
  },
});
