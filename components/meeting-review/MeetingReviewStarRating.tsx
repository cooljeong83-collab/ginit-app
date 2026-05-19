import { StyleSheet, Text, View } from 'react-native';

import { GinitPressable } from '@/components/ui/GinitPressable';
import { GinitTheme } from '@/constants/ginit-theme';

const RATING_HINTS: Record<number, string> = {
  0: '',
  1: '아쉬웠어요',
  2: '그저 그랬어요',
  3: '괜찮았어요',
  4: '만족했어요',
  5: '최고였어요',
};

type MeetingReviewStarRatingProps = {
  value: number;
  onChange: (rating: number) => void;
  readOnly?: boolean;
};

export function MeetingReviewStarRating({ value, onChange, readOnly }: MeetingReviewStarRatingProps) {
  const hint = RATING_HINTS[Math.max(0, Math.min(5, value))] ?? '';

  return (
    <View style={styles.root}>
      <View style={styles.row}>
        {[1, 2, 3, 4, 5].map((star) => {
          const filled = star <= value;
          if (readOnly) {
            return (
              <View key={star} style={styles.starBtn}>
                <Text style={[styles.star, filled ? styles.starFilled : styles.starEmpty]}>★</Text>
              </View>
            );
          }
          return (
            <GinitPressable
              key={star}
              onPress={() => onChange(star)}
              style={({ pressed }) => [styles.starBtn, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
              accessibilityLabel={`${star}점`}>
              <Text style={[styles.star, filled ? styles.starFilled : styles.starEmpty]}>★</Text>
            </GinitPressable>
          );
        })}
      </View>
      {hint && !readOnly ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  starBtn: {
    padding: 6,
  },
  star: {
    fontSize: 32,
    lineHeight: 36,
  },
  starFilled: {
    color: GinitTheme.colors.primary,
  },
  starEmpty: {
    color: GinitTheme.colors.border,
  },
  hint: {
    fontSize: 13,
    fontWeight: '600',
    color: GinitTheme.colors.textMuted,
  },
});
