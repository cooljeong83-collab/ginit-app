import { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

const STAR_COLOR = '#FF8A00';
const STAR_EMPTY = '#E2E8F0';

const STAR_SIZE = 44;

type Props = {
  value: number;
  onChange: (next: number) => void;
};

export function PlaceHalfStarRating({ value, onChange }: Props) {
  const onPressStar = useCallback(
    (index: number, locationX: number) => {
      const half = locationX < STAR_SIZE / 2 ? 0.5 : 1;
      const next = Math.min(5, Math.max(0.5, index + half));
      const stepped = Math.round(next * 2) / 2;
      onChange(stepped);
    },
    [onChange],
  );

  return (
    <View style={styles.row}>
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = Math.min(1, Math.max(0, value - i));
        return (
          <Pressable
            key={i}
            onPressIn={(e) => onPressStar(i, e.nativeEvent.locationX)}
            style={styles.starHit}
            accessibilityRole="button"
            accessibilityLabel={`별 ${i + 1}`}>
            <View style={styles.starBox} collapsable={false}>
              <Text style={[styles.starBase, { color: STAR_EMPTY }]}>★</Text>
              <View style={[styles.starFillClip, { width: STAR_SIZE * fill }]} pointerEvents="none">
                <Text style={[styles.starFill, { color: STAR_COLOR }]}>★</Text>
              </View>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  starHit: {
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  starBox: {
    width: STAR_SIZE,
    height: STAR_SIZE,
    position: 'relative',
    overflow: 'hidden',
  },
  starBase: {
    position: 'absolute',
    left: 0,
    top: 0,
    fontSize: STAR_SIZE,
    lineHeight: STAR_SIZE,
    includeFontPadding: false,
  },
  starFillClip: {
    position: 'absolute',
    left: 0,
    top: 0,
    height: STAR_SIZE,
    overflow: 'hidden',
  },
  starFill: {
    fontSize: STAR_SIZE,
    lineHeight: STAR_SIZE,
    includeFontPadding: false,
    width: STAR_SIZE,
  },
});
