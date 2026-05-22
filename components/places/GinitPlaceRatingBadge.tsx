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
  const a11yParts: string[] = [];
  if (hasPromo) a11yParts.push('제휴 업체');
  if (hasRating) a11yParts.push(`지닛 평점 ${ratingLabel}, 후기 ${reviewCount}건`);

  return (
    <View
      style={[styles.badge, styles.row, style]}
      accessibilityLabel={a11yParts.join(', ')}>
      {hasPromo ? <Text style={styles.text}>💜 제휴</Text> : null}
      {hasRating ? <Text style={styles.text}>💜 {ratingLabel}</Text> : null}
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
    flexShrink: 1,
    maxWidth: '92%',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  text: {
    fontSize: 12,
    fontWeight: '700',
    color: GinitTheme.colors.deepPurple,
    letterSpacing: -0.2,
  },
});
