/** 탐색 피드 인라인 매치 카드 1건 */
export type FeedSponsoredPlace = {
  promotionId: string;
  campaignId: string;
  benefitLabel: string;
  badgeLabel: string;
  placeId: string;
  placeKey: string;
  placeName: string;
  roadAddress: string;
  category: string | null;
  preferredPhotoMediaUrl: string | null;
  naverPlaceLink: string | null;
  latitude: number | null;
  longitude: number | null;
  averageRating: number;
  reviewCount: number;
};

/** 장소 투표·배지용 제휴 요약 */
export type PlacePromotionSummary = {
  placeKey: string;
  placeId: string;
  isSponsored: boolean;
  benefitLabel: string;
  badgeLabel: string;
  campaignId: string;
  promotionId: string;
};

/** 정산 화면 Notice 바 */
export type MeetingPlacePromotion = {
  isSponsored: boolean;
  promotionId: string;
  campaignId: string;
  placeId: string;
  placeKey: string;
  placeName: string;
  benefitLabel: string;
  badgeLabel: string;
};

export type PromotionMatchVerifyPayload = {
  meetingId: string;
  verifierAppUserId: string;
  headcount: number;
  totalAmountWon: number;
  benefitReceived: boolean;
  matchSuccess?: boolean;
};
