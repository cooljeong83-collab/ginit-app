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

import { PARTICIPANT_COUNT_MIN } from './GlassDualCapacityWheel';

const TRUST_BLUE = GinitTheme.colors.primary;

const ITEM_HEIGHT = 28;
const WHEEL_HEIGHT = 84;
const PAD = (WHEEL_HEIGHT - ITEM_HEIGHT) / 2;

const COUNT_OPTIONS: { value: number; label: string }[] = Array.from(
  { length: 100 - PARTICIPANT_COUNT_MIN + 1 },
  (_, i) => ({
    value: i + PARTICIPANT_COUNT_MIN,
    label: String(i + PARTICIPANT_COUNT_MIN),
  }),
);

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
    width: '100%',
    maxWidth: 220,
    height: WHEEL_HEIGHT,
    alignSelf: 'center',
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

export type GlassSingleCapacityWheelProps = {
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
};

export function GlassSingleCapacityWheel({ value, onChange, disabled }: GlassSingleCapacityWheelProps) {
  const a11y = useMemo(() => `참석 인원 ${value}명`, [value]);

  return (
    <View
      style={styles.shell}
      pointerEvents={disabled ? 'none' : 'auto'}
      accessible
      accessibilityLabel={a11y}>
      <WheelColumn options={COUNT_OPTIONS} value={value} onChange={onChange} disabled={disabled} />
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
    alignItems: 'center',
  },
});
