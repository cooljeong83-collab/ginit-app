import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { GinitTheme } from '@/constants/ginit-theme';
import type { PlacePromotionSummary } from '@/src/lib/promotions/place-promotion-types';

type Props = {
  promotion: PlacePromotionSummary;
  style?: StyleProp<ViewStyle>;
  /** 썸네일 좌상단 오버레이 */
  overlay?: boolean;
};

/** 장소 투표 — `GinitPlaceRatingBadge`와 동일 스타일(overlay는 배경만 살짝 투명) */
export function PlacePromotionBenefitBadge({ promotion, style, overlay }: Props) {
  if (!promotion.isSponsored) return null;
  const label = promotion.benefitLabel.trim() || '제휴 혜택';
  return (
    <View
      style={[styles.badge, overlay && styles.badgeOverlay, style]}
      accessibilityLabel={`제휴 혜택 ${label}`}>
      <Text style={styles.text} numberOfLines={1}>
        💜 {label}
      </Text>
    </View>
  );
}

/** 평점 배지 `primarySoft` 톤 — 썸네일 위에서만 약간 더 투명 */
const OVERLAY_BADGE_BG = 'rgba(237, 231, 246, 0.78)';

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: GinitTheme.colors.primarySoft,
    alignSelf: 'flex-start',
    flexShrink: 0,
    maxWidth: '52%',
  },
  text: {
    fontSize: 12,
    fontWeight: '700',
    color: GinitTheme.colors.deepPurple,
    letterSpacing: -0.2,
  },
  badgeOverlay: {
    maxWidth: 140,
    backgroundColor: OVERLAY_BADGE_BG,
  },
});
