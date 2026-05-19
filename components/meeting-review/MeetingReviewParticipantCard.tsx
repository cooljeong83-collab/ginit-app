import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { MeetingReviewCompactStars } from '@/components/meeting-review/MeetingReviewCompactStars';
import { GinitTheme } from '@/constants/ginit-theme';
import type { MeetingReviewSummaryItem } from '@/src/lib/meeting-review/meeting-review-api';

type MeetingReviewParticipantCardProps = {
  review: MeetingReviewSummaryItem;
  isLast?: boolean;
};

function nicknameInitial(name: string): string {
  return name.trim().slice(0, 1) || '회';
}

export function MeetingReviewParticipantCard({ review, isLast }: MeetingReviewParticipantCardProps) {
  const name = review.displayName.trim() || '회원';
  const comment = review.comment?.trim() ?? '';

  return (
    <View style={[styles.card, !isLast && styles.cardBorder]}>
      <View style={styles.row}>
        {review.avatarUrl ? (
          <Image source={{ uri: review.avatarUrl }} style={styles.avatar} contentFit="cover" />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.avatarInitial}>{nicknameInitial(name)}</Text>
          </View>
        )}
        <View style={styles.body}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>
              {name}
            </Text>
            <MeetingReviewCompactStars rating={review.rating} />
          </View>
          {comment ? <Text style={styles.comment}>{comment}</Text> : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingVertical: 14,
  },
  cardBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: GinitTheme.colors.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  avatarFallback: {
    backgroundColor: GinitTheme.colors.noticeSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 15,
    fontWeight: '700',
    color: GinitTheme.colors.primary,
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  name: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    fontWeight: '700',
    color: GinitTheme.colors.text,
  },
  comment: {
    fontSize: 14,
    fontWeight: '600',
    color: GinitTheme.colors.textSub,
    lineHeight: 21,
  },
});
