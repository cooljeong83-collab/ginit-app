import { StyleSheet, Text, View } from 'react-native';

import { GinitTheme } from '@/constants/ginit-theme';

type MeetingReviewCompactStarsProps = {
  rating: number;
};

export function MeetingReviewCompactStars({ rating }: MeetingReviewCompactStarsProps) {
  const value = Math.max(1, Math.min(5, Math.round(rating)));
  const stars = `${'★'.repeat(value)}${'☆'.repeat(5 - value)}`;

  return (
    <View style={styles.wrap}>
      <Text style={styles.score}>{value}</Text>
      <Text style={styles.stars}>{stars}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  score: {
    fontSize: 14,
    fontWeight: '800',
    color: GinitTheme.colors.primary,
    minWidth: 14,
    textAlign: 'right',
  },
  stars: {
    fontSize: 11,
    color: GinitTheme.colors.primary,
    letterSpacing: 0.3,
  },
});
