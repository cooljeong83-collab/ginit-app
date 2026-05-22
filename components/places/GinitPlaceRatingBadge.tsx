import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { GinitTheme } from '@/constants/ginit-theme';
import type { PlacePromotionSummary } from '@/src/lib/promotions/place-promotion-types';

export type GinitPlaceRatingBadgeProps = {
  averageRating: number;
  reviewCount: number;
  style?: StyleProp<ViewStyle>;
  /** 제휴 장소 — 평점 카드 왼쪽에 `💜 제휴 💜 평점` (평점 없으면 `💜 제휴`만) */
  promotion?: PlacePromotionSummary | null;
};

/** 지닛 장소 평점 배지 — review_count > 0 또는 제휴일 때 표시 */
export function GinitPlaceRatingBadge({
  averageRating,
  reviewCount,
  style,
  promotion,
}: GinitPlaceRatingBadgeProps) {
  const hasRating = reviewCount > 0 && Number.isFinite(averageRating);
  const hasPromo = promotion?.isSponsored === true;
  if (!hasRating && !hasPromo) return null;

  const ratingLabel = hasRating ? averageRating.toFixed(1) : null;
  const labelParts: string[] = [];
  if (hasPromo) labelParts.push('💜 제휴');
  if (hasRating && ratingLabel) labelParts.push(`💜 ${ratingLabel}`);
  const label = labelParts.join(' ');

  const a11yParts: string[] = [];
  if (hasPromo) a11yParts.push('제휴 업체');
  if (hasRating) a11yParts.push(`지닛 평점 ${ratingLabel}, 후기 ${reviewCount}건`);

  return (
    <View style={[styles.badge, style]} accessibilityLabel={a11yParts.join(', ')}>
      <Text style={styles.text} numberOfLines={1}>
        {label}
      </Text>
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
    flexShrink: 0,
  },
  text: {
    fontSize: 12,
    fontWeight: '700',
    color: GinitTheme.colors.deepPurple,
    letterSpacing: -0.2,
  },
});
