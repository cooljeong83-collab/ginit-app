import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MeetingReviewKeywordSummaryBadges } from '@/components/meeting-review/MeetingReviewKeywordSummaryBadges';
import { MeetingReviewParticipantCard } from '@/components/meeting-review/MeetingReviewParticipantCard';
import { meetingReviewStyles as s } from '@/components/meeting-review/meeting-review-styles';
import { MeetingReviewStarRating } from '@/components/meeting-review/MeetingReviewStarRating';
import { MeetingReviewTopSummary } from '@/components/meeting-review/MeetingReviewTopSummary';
import { GinitPressable } from '@/components/ui/GinitPressable';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { GinitTheme } from '@/constants/ginit-theme';
import type { Category } from '@/src/lib/categories';
import type { MeetingReviewSummary } from '@/src/lib/meeting-review/meeting-review-api';
import type { MeetingReviewPlaceContext } from '@/src/lib/meeting-review/meeting-review-place-context';
import type { Meeting } from '@/src/lib/meetings';

type SummaryBoardProps = {
  meeting: Meeting;
  place: MeetingReviewPlaceContext;
  categories: readonly Category[];
  onOpenPlaceUrl: (url: string, title: string) => void;
  receiptPlaceVerified?: boolean;
  summary: MeetingReviewSummary | undefined;
  loading?: boolean;
  /** 탐색 피드 모임 후기 목록에서 진입한 경우에만 true */
  showNextMeetingSection?: boolean;
  onCreateMeetingAtPlace?: () => void;
};

export function SummaryBoard({
  meeting,
  place,
  categories,
  onOpenPlaceUrl,
  receiptPlaceVerified,
  summary,
  loading,
  showNextMeetingSection = false,
  onCreateMeetingAtPlace,
}: SummaryBoardProps) {
  const insets = useSafeAreaInsets();
  if (loading && !summary) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator color={GinitTheme.colors.primary} />
        <Text style={s.muted}>리뷰를 불러오는 중…</Text>
      </View>
    );
  }

  const avg = summary?.averageRating ?? 0;
  const reviewCount = summary?.reviewCount ?? 0;
  const participants = summary?.participants ?? [];
  const totalParticipants = participants.length;
  const roundedAvg = reviewCount > 0 ? Math.round(avg) : 0;
  const reviews = summary?.reviews ?? [];
  const pendingReviewCount = Math.max(0, totalParticipants - reviewCount);

  const participationLine =
    totalParticipants > 0
      ? [
          reviewCount > 0 ? `${reviewCount}명 참여` : null,
          `전체 ${totalParticipants}명`,
          pendingReviewCount > 0 ? `${pendingReviewCount}명 미작성` : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : reviewCount > 0
        ? `${reviewCount}명 참여`
        : '';

  return (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={[s.scrollContent, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}
      showsVerticalScrollIndicator={false}>
      <MeetingReviewTopSummary
        meeting={meeting}
        place={place}
        categories={categories}
        onOpenPlaceUrl={onOpenPlaceUrl}
        receiptPlaceVerified={receiptPlaceVerified}
      />

      <View style={s.formBlock}>
        <View style={styles.sectionHeaderRow}>
          <Text style={s.sectionLabel}>종합 만족도</Text>
          {participationLine ? (
            <Text style={styles.participationText} numberOfLines={2}>
              {participationLine}
            </Text>
          ) : null}
        </View>
        <View style={styles.scoreRow}>
          <Text style={styles.scoreValue}>{reviewCount > 0 ? avg.toFixed(1) : '—'}</Text>
          <Text style={styles.scoreUnit}>/ 5.0</Text>
        </View>
        {reviewCount > 0 ? <MeetingReviewStarRating value={roundedAvg} onChange={() => {}} readOnly /> : null}
        <Text style={s.sectionLabel}>키워드</Text>
        {(summary?.keywordStats.length ?? 0) === 0 ? (
          <Text style={s.emptyHint}>아직 선택된 키워드가 없어요.</Text>
        ) : (
          <MeetingReviewKeywordSummaryBadges items={summary!.keywordStats} compact />
        )}
        <View style={s.divider} />

        <Text style={s.sectionLabel}>참여자 후기</Text>
        {reviews.length === 0 ? (
          <Text style={s.emptyHint}>아직 남긴 후기가 없어요.</Text>
        ) : (
          <View style={styles.reviewsList}>
            {reviews.map((review, index) => (
              <MeetingReviewParticipantCard
                key={`${review.appUserId}-${review.createdAt}-${index}`}
                review={review}
                isLast={index === reviews.length - 1}
              />
            ))}
          </View>
        )}

        {showNextMeetingSection && onCreateMeetingAtPlace ? (
          <>
            <View style={styles.nextMeetingDivider} />
            <View style={styles.nextMeetingSection}>
              <Text style={s.sectionLabel}>다음 모임</Text>
              <Text style={s.sectionHint}>이 장소로 새 모임을 열 수 있어요</Text>
              <GinitPressable
                onPress={onCreateMeetingAtPlace}
                style={({ pressed }) => [s.createMeetingAtPlaceBtn, pressed && { opacity: 0.88 }]}
                accessibilityRole="button"
                accessibilityLabel="이 장소로 모임 만들기">
                <GinitSymbolicIcon name="add-circle-outline" size={20} color="#fff" />
                <Text style={s.createMeetingAtPlaceBtnText}>이 장소로 모임 만들기</Text>
              </GinitPressable>
            </View>
          </>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: GinitTheme.colors.bg,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  participationText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: GinitTheme.colors.textMuted,
    textAlign: 'right',
    lineHeight: 17,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
    marginTop: 4,
  },
  scoreValue: {
    fontSize: 28,
    fontWeight: '800',
    color: GinitTheme.colors.text,
    letterSpacing: -0.5,
  },
  scoreUnit: {
    fontSize: 14,
    fontWeight: '600',
    color: GinitTheme.colors.textMuted,
    paddingBottom: 3,
  },
  reviewsList: {
    marginTop: 4,
  },
  nextMeetingDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: GinitTheme.colors.border,
    marginTop: 20,
  },
  nextMeetingSection: {
    marginTop: 8,
    gap: 8,
  },
});
