import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { GinitPressable } from '@/components/ui/GinitPressable';
import { GinitTheme } from '@/constants/ginit-theme';
import {
  REVIEW_CARD_GAP,
  REVIEW_CARD_HEIGHT,
  REVIEW_CARD_WIDTH,
} from '@/src/lib/feed-meeting-review-carousel-layout';
import { FeedMeetingReviewCommentMarquee } from '@/components/feed/meeting-review-carousel/FeedMeetingReviewCommentMarquee';
import {
  formatFeedReviewLocationDetail,
  formatFeedReviewParticipantLabel,
} from '@/src/lib/feed-meeting-review-card-format';
import { MEETING_LIST_IMAGE_BLURHASH } from '@/src/lib/expo-image-meeting-placeholder';
import type { FeedMeetingReviewCarouselItem } from '@/src/lib/feed-meeting-reviews-api';

const PHOTO_SIZE = 80;

type FeedMeetingReviewCarouselCardProps = {
  item: FeedMeetingReviewCarouselItem;
  onPress: (meetingId: string) => void;
};

function placeholderEmoji(placeName: string): string {
  const t = placeName.toLowerCase();
  if (/카페|커피|디저트|베이커/.test(t)) return '☕';
  if (/술|바|주점|포차|호프/.test(t)) return '🍺';
  if (/치킨|피자|버거|맛집|식당|음식|고기|삼겹|회/.test(t)) return '🍔';
  return '📍';
}

export function FeedMeetingReviewCarouselCard({ item, onPress }: FeedMeetingReviewCarouselCardProps) {
  const emoji = placeholderEmoji(item.placeName);
  const locationLine =
    formatFeedReviewLocationDetail(item.locationLabel) ??
    formatFeedReviewLocationDetail(item.regionNorm) ??
    null;
  const participantLabel = formatFeedReviewParticipantLabel(
    item.participantFirstName,
    item.participantCount,
  );
  const cardComments = item.comments;

  return (
    <GinitPressable
      onPress={() => onPress(item.meetingId)}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      accessibilityRole="button"
      accessibilityLabel={`${item.placeName} 후기`}>
      <View style={styles.textCol}>
        <View style={styles.titleRow}>
          <Text style={styles.placeName} numberOfLines={1}>
            {item.placeName}
          </Text>
          <Text style={styles.rating} numberOfLines={1}>
            💜 {item.avgRating.toFixed(1)}
          </Text>
        </View>

        {locationLine ? (
          <Text style={styles.location} numberOfLines={1}>
            📍 {locationLine}
          </Text>
        ) : null}

        {cardComments.length > 0 ? (
          <FeedMeetingReviewCommentMarquee
            comments={cardComments}
            laneStyle={styles.commentLane}
            textStyle={styles.commentText}
            emptyLabel=""
          />
        ) : null}

        {participantLabel ? (
          <Text style={styles.participants} numberOfLines={1}>
            👥 {participantLabel}
          </Text>
        ) : null}
      </View>

      <View style={styles.photoCol}>
        {item.photoUrl ? (
          <Image
            source={{ uri: item.photoUrl }}
            style={styles.photo}
            contentFit="cover"
            transition={120}
            cachePolicy="disk"
            recyclingKey={item.photoUrl}
            placeholder={{ blurhash: MEETING_LIST_IMAGE_BLURHASH }}
          />
        ) : (
          <View style={styles.photoFallback}>
            <Text style={styles.photoFallbackEmoji}>{emoji}</Text>
          </View>
        )}
      </View>
    </GinitPressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: REVIEW_CARD_WIDTH,
    height: REVIEW_CARD_HEIGHT,
    marginRight: REVIEW_CARD_GAP,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: GinitTheme.colors.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
  },
  cardPressed: {
    opacity: 0.88,
  },
  textCol: {
    flex: 7,
    minWidth: 0,
    paddingRight: 8,
    justifyContent: 'center',
    gap: 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  placeName: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '600',
    color: GinitTheme.colors.text,
    letterSpacing: -0.15,
    lineHeight: 18,
  },
  rating: {
    flexShrink: 0,
    marginLeft: 6,
    fontSize: 12,
    fontWeight: '700',
    color: GinitTheme.colors.primary,
    lineHeight: 18,
  },
  location: {
    fontSize: 11,
    fontWeight: '500',
    color: GinitTheme.colors.textSub,
    lineHeight: 15,
  },
  commentLane: {
    height: 16,
    paddingHorizontal: 0,
    alignSelf: 'stretch',
    width: '100%',
    overflow: 'hidden',
  },
  commentText: {
    fontSize: 11,
    fontWeight: '600',
    color: GinitTheme.colors.textSub,
    lineHeight: 15,
  },
  participants: {
    fontSize: 11,
    fontWeight: '500',
    color: GinitTheme.colors.textSub,
    lineHeight: 15,
  },
  photoCol: {
    flex: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photo: {
    width: PHOTO_SIZE,
    height: PHOTO_SIZE,
    borderRadius: 10,
  },
  photoFallback: {
    width: PHOTO_SIZE,
    height: PHOTO_SIZE,
    borderRadius: 10,
    backgroundColor: GinitTheme.colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoFallbackEmoji: {
    fontSize: 28,
    lineHeight: 32,
  },
});
