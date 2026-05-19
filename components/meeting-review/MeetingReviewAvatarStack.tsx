import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { GinitTheme } from '@/constants/ginit-theme';
import type { MeetingReviewSummaryParticipant } from '@/src/lib/meeting-review/meeting-review-api';

const AVATAR_SIZE = 34;
const OVERLAP = 10;

type MeetingReviewAvatarStackProps = {
  participants: readonly MeetingReviewSummaryParticipant[];
  maxVisible?: number;
  showPendingState?: boolean;
};

function nicknameInitial(name: string): string {
  const t = name.trim();
  return t.slice(0, 1) || '회';
}

export function MeetingReviewAvatarStack({
  participants,
  maxVisible = 10,
  showPendingState,
}: MeetingReviewAvatarStackProps) {
  const sorted = showPendingState
    ? [...participants].sort((a, b) => Number(b.hasReviewed) - Number(a.hasReviewed))
    : participants;
  const visible = sorted.slice(0, maxVisible);
  const overflow = Math.max(0, sorted.length - maxVisible);
  const reviewedCount = participants.filter((p) => p.hasReviewed).length;

  if (visible.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {visible.map((p, index) => {
          const pending = showPendingState && !p.hasReviewed;
          return (
            <View
              key={`${p.appUserId}-${index}`}
              style={[styles.avatarWrap, index > 0 && { marginLeft: -OVERLAP }, { zIndex: visible.length - index }]}>
              {p.avatarUrl ? (
                <Image
                  source={{ uri: p.avatarUrl }}
                  style={[styles.avatar, pending && styles.avatarPending]}
                  contentFit="cover"
                />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback, pending && styles.avatarPending]}>
                  <Text style={styles.avatarInitial}>{nicknameInitial(p.displayName)}</Text>
                </View>
              )}
            </View>
          );
        })}
        {overflow > 0 ? (
          <View style={[styles.avatarWrap, { marginLeft: -OVERLAP }, styles.overflowBadge]}>
            <Text style={styles.overflowText}>+{overflow}</Text>
          </View>
        ) : null}
      </View>
      {showPendingState ? (
        <Text style={styles.legend}>
          {reviewedCount}명 작성
          {participants.length - reviewedCount > 0 ? ` · ${participants.length - reviewedCount}명 미작성` : ''}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 6,
    paddingTop: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarWrap: {
    borderRadius: AVATAR_SIZE / 2,
    borderWidth: 2,
    borderColor: GinitTheme.colors.bg,
    overflow: 'hidden',
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
  },
  avatarPending: {
    opacity: 0.4,
  },
  avatarFallback: {
    backgroundColor: GinitTheme.colors.noticeSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 13,
    fontWeight: '700',
    color: GinitTheme.colors.textSub,
  },
  overflowBadge: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: GinitTheme.colors.noticeSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overflowText: {
    fontSize: 10,
    fontWeight: '700',
    color: GinitTheme.colors.textMuted,
  },
  legend: {
    fontSize: 12,
    fontWeight: '600',
    color: GinitTheme.colors.textMuted,
  },
});
