import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { GinitTheme } from '@/constants/ginit-theme';

export type GinitPlaceRatingBadgeProps = {
  averageRating: number;
  reviewCount: number;
  style?: StyleProp<ViewStyle>;
};

/** 지닛 장소 평점 배지 — review_count > 0 일 때만 표시 */
export function GinitPlaceRatingBadge({
  averageRating,
  reviewCount,
  style,
}: GinitPlaceRatingBadgeProps) {
  if (reviewCount <= 0 || !Number.isFinite(averageRating)) return null;
  const label = averageRating.toFixed(1);
  return (
    <View style={[styles.badge, style]} accessibilityLabel={`지닛 평점 ${label}, 후기 ${reviewCount}건`}>
      <Text style={styles.text}>💜 {label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: GinitTheme.colors.primarySoft,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: 12,
    fontWeight: '700',
    color: GinitTheme.colors.deepPurple,
    letterSpacing: -0.2,
  },
});
