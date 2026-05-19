import { ScrollView, StyleSheet, View } from 'react-native';

import { FeedMeetingReviewCarouselCard } from '@/components/feed/meeting-review-carousel/FeedMeetingReviewCarouselCard';
import {
  REVIEW_CARD_GAP,
  REVIEW_SNAP_INTERVAL,
  REVIEW_SECTION_TOTAL_HEIGHT,
} from '@/src/lib/feed-meeting-review-carousel-layout';
import type { FeedMeetingReviewCarouselItem } from '@/src/lib/feed-meeting-reviews-api';

type FeedMeetingReviewSectionProps = {
  reviews: readonly FeedMeetingReviewCarouselItem[];
  onPressReview: (meetingId: string) => void;
};

export function FeedMeetingReviewSection({ reviews, onPressReview }: FeedMeetingReviewSectionProps) {
  if (reviews.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={REVIEW_SNAP_INTERVAL}
        snapToAlignment="start"
        disableIntervalMomentum
        nestedScrollEnabled
        contentContainerStyle={styles.carouselContent}>
        {reviews.map((item) => (
          <FeedMeetingReviewCarouselCard key={item.reviewId} item={item} onPress={onPressReview} />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    height: REVIEW_SECTION_TOTAL_HEIGHT,
    paddingVertical: 10,
    justifyContent: 'center',
  },
  carouselContent: {
    paddingRight: 4,
  },
});
