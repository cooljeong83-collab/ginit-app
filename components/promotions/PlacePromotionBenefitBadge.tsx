import { GinitMatchBenefitBadge } from '@/components/promotions/GinitMatchBenefitBadge';
import type { PlacePromotionSummary } from '@/src/lib/promotions/place-promotion-types';

type Props = {
  promotion: PlacePromotionSummary;
  compact?: boolean;
};

/** 장소 투표 리스트·칩 옆 제휴 혜택 배지 */
export function PlacePromotionBenefitBadge({ promotion, compact }: Props) {
  if (!promotion.isSponsored) return null;
  const label = promotion.benefitLabel.trim() || '제휴 혜택';
  return <GinitMatchBenefitBadge label={label} compact={compact} />;
}
