import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { presentAppDialogAlert } from '@/src/lib/app-dialog-present';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { NaverPlaceWebViewModal } from '@/components/NaverPlaceWebViewModal';
import { ReviewForm } from '@/components/meeting-review/ReviewForm';
import { SummaryBoard } from '@/components/meeting-review/SummaryBoard';
import { meetingReviewStyles } from '@/components/meeting-review/meeting-review-styles';
import { SettlementAccountsScreenTopBar } from '@/components/settlement/SettlementAccountsScreenTopBar';
import { ScreenShell } from '@/components/ui';
import { GinitPressable } from '@/components/ui/GinitPressable';
import { showTransientBottomMessage } from '@/components/ui/TransientBottomMessage';
import { GinitTheme } from '@/constants/ginit-theme';
import { useMeetingCategories } from '@/src/context/MeetingCategoriesContext';
import { useUserSession } from '@/src/context/UserSessionContext';
import { onMeetingPlaceReviewSubmitted } from '@/src/lib/meeting-place-review-dismiss';
import { useAndroidOverlayHardwareBack } from '@/src/hooks/use-android-overlay-hardware-back';
import { useMeetingDetailQuery } from '@/src/hooks/use-meeting-detail-query';
import { useMeetingPlaceReviewSummary } from '@/src/hooks/use-meeting-place-review-summary';
import { useMeetingSettlementReceiptPlaceVerified } from '@/src/hooks/use-meeting-settlement-receipt-place-verified';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { presentGamificationReward } from '@/src/lib/gamification-stat-change-present';
import {
  fetchMeetingPlaceReviewSummary,
  meetingPlaceReviewSummaryQueryKey,
  submitMeetingPlaceReview,
  type MeetingReviewMyReview,
  type MeetingReviewSummary,
} from '@/src/lib/meeting-review/meeting-review-api';
import { getPinnedFormKeywords } from '@/src/lib/meeting-review/meeting-review-keywords';
import { resolveMeetingReviewPlaceContext } from '@/src/lib/meeting-review/meeting-review-place-context';
import { layoutAnimateEaseInEaseOut } from '@/src/lib/android-layout-animation';
import { useTransitionRouter } from '@/src/lib/screen-transition-navigation';
import { safeRouterBack } from '@/src/lib/router-safe';

type ReviewPhase = 'form' | 'summary';

function orderedParticipantIds(meeting: {
  createdBy?: string | null;
  participantIds?: string[] | null;
}): string[] {
  const hostRaw = meeting.createdBy?.trim() ?? '';
  const host = hostRaw ? normalizeParticipantId(hostRaw) : '';
  const seen = new Set<string>();
  const out: string[] = [];
  if (host) {
    seen.add(host);
    out.push(host);
  }
  for (const x of meeting.participantIds ?? []) {
    const id = normalizeParticipantId(String(x));
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function applyMyReviewToForm(
  myReview: MeetingReviewMyReview,
  setters: {
    setRating: (n: number) => void;
    setSelectedKeywords: (k: string[]) => void;
    setComment: (c: string) => void;
  },
): void {
  setters.setRating(myReview.rating);
  setters.setSelectedKeywords([...myReview.selectedKeywords]);
  setters.setComment(myReview.comment ?? '');
}

export default function MeetingReviewScreen() {
  const router = useTransitionRouter();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const { userId } = useUserSession();
  const params = useLocalSearchParams<{ meetingId: string | string[] }>();
  const meetingId = Array.isArray(params.meetingId)
    ? (params.meetingId[0] ?? '').trim()
    : typeof params.meetingId === 'string'
      ? params.meetingId.trim()
      : '';

  const { categories } = useMeetingCategories();
  const { meeting, loading, loadError, refetch } = useMeetingDetailQuery(meetingId);
  const sessionPk = useMemo(() => (userId?.trim() ? normalizeParticipantId(userId.trim()) : ''), [userId]);
  const orderedList = useMemo(() => (meeting ? orderedParticipantIds(meeting) : []), [meeting]);
  const isParticipant = useMemo(
    () => Boolean(sessionPk && orderedList.includes(sessionPk)),
    [sessionPk, orderedList],
  );
  const isSettled = meeting?.lifecycleStatus === 'SETTLED';
  const placeContext = useMemo(() => (meeting ? resolveMeetingReviewPlaceContext(meeting) : null), [meeting]);
  const canViewReview = Boolean(meeting && isSettled && placeContext);
  const canWriteReview = canViewReview && isParticipant;

  const [naverPlaceWebModal, setNaverPlaceWebModal] = useState<{ url: string; title: string } | null>(null);
  const onOpenPlaceUrl = useCallback((url: string, title: string) => {
    setNaverPlaceWebModal({ url, title });
  }, []);

  const summaryQuery = useMeetingPlaceReviewSummary(meetingId, userId, {
    enabled: canViewReview,
  });

  const receiptPlaceVerifiedQuery = useMeetingSettlementReceiptPlaceVerified(
    meetingId,
    placeContext,
    meeting,
    canViewReview,
  );
  const receiptPlaceVerified = receiptPlaceVerifiedQuery.data === true;

  const hasReviewed = useMemo(() => {
    if (!sessionPk) return false;
    if (summaryQuery.data?.myReview) return true;
    return (summaryQuery.data?.participants ?? []).some(
      (p) => normalizeParticipantId(p.appUserId) === sessionPk && p.hasReviewed,
    );
  }, [sessionPk, summaryQuery.data]);

  const [phaseOverride, setPhaseOverride] = useState<ReviewPhase | null>(null);
  const [rating, setRating] = useState(0);
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>([]);
  const [pinnedFormKeywords, setPinnedFormKeywords] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const initialPhaseResolved = summaryQuery.isSuccess || summaryQuery.isError;
  const phase: ReviewPhase = !canWriteReview
    ? 'summary'
    : (phaseOverride ?? (hasReviewed ? 'summary' : 'form'));

  const onBack = useCallback(() => safeRouterBack(router), [router]);
  useAndroidOverlayHardwareBack(onBack);

  useEffect(() => {
    if (!meetingId) {
      safeRouterBack(router);
    }
  }, [meetingId, router]);

  useEffect(() => {
    setPinnedFormKeywords([]);
  }, [meetingId]);

  const switchToSummary = useCallback(() => {
    layoutAnimateEaseInEaseOut();
    setPinnedFormKeywords([]);
    setPhaseOverride('summary');
  }, []);

  const switchToForm = useCallback(async () => {
    const uid = userId?.trim() ?? '';
    if (meetingId && uid) {
      try {
        const summary = await queryClient.fetchQuery({
          queryKey: meetingPlaceReviewSummaryQueryKey(meetingId),
          queryFn: async (): Promise<MeetingReviewSummary> => {
            const res = await fetchMeetingPlaceReviewSummary(meetingId, uid);
            if (!res.ok) throw new Error(res.message);
            return res.summary;
          },
        });
        if (summary.myReview && placeContext) {
          applyMyReviewToForm(summary.myReview, { setRating, setSelectedKeywords, setComment });
          setPinnedFormKeywords(
            getPinnedFormKeywords(placeContext.keywordCategory, summary.myReview.selectedKeywords),
          );
        }
      } catch {
        const cached = queryClient.getQueryData<MeetingReviewSummary>(
          meetingPlaceReviewSummaryQueryKey(meetingId),
        );
        if (cached?.myReview && placeContext) {
          applyMyReviewToForm(cached.myReview, { setRating, setSelectedKeywords, setComment });
          setPinnedFormKeywords(
            getPinnedFormKeywords(placeContext.keywordCategory, cached.myReview.selectedKeywords),
          );
        }
      }
    }
    layoutAnimateEaseInEaseOut();
    setPhaseOverride('form');
  }, [meetingId, userId, queryClient, placeContext]);

  const onToggleKeyword = useCallback((keyword: string) => {
    setSelectedKeywords((prev) => {
      if (prev.includes(keyword)) return prev.filter((k) => k !== keyword);
      return [...prev, keyword];
    });
  }, []);

  const onSubmit = useCallback(async () => {
    if (!canWriteReview || !meetingId || !userId?.trim() || !placeContext) return;
    if (rating < 1) {
      presentAppDialogAlert({ title: '별점', body: '별점을 선택해 주세요.' });
      return;
    }
    setSubmitting(true);
    try {
      const res = await submitMeetingPlaceReview({
        meetingId,
        appUserId: userId.trim(),
        placeId: placeContext.placeId,
        rating,
        selectedKeywords,
        comment: comment.trim() || null,
      });
      if (!res.ok) {
        presentAppDialogAlert({ title: '리뷰', body: res.message });
        return;
      }
      void onMeetingPlaceReviewSubmitted(meetingId, userId.trim());
      void queryClient.invalidateQueries({ queryKey: meetingPlaceReviewSummaryQueryKey(meetingId) });
      if (res.result.rewardsApplied && (res.result.xpGranted > 0 || res.result.trustGranted > 0)) {
        presentGamificationReward({
          title: '리뷰 완료',
          body: '후기를 남겼어요.',
          xp: res.result.xpGranted,
          trust: res.result.trustGranted,
          footnote: '(보상은 서버 정책에 따라 최초 1회만 지급됩니다.)',
          primaryLabel: '결과 보기',
          onPrimary: switchToSummary,
        });
      } else {
        switchToSummary();
      }
    } finally {
      setSubmitting(false);
    }
  }, [
    meetingId,
    userId,
    placeContext,
    rating,
    selectedKeywords,
    comment,
    queryClient,
    switchToSummary,
    canWriteReview,
  ]);

  if (!meetingId) {
    return null;
  }

  const topBar = (title: string, onEdit?: () => void) => (
    <SettlementAccountsScreenTopBar title={title} onBack={onBack} onEdit={onEdit} />
  );

  if (loading && !meeting) {
    return (
      <ScreenShell padded={false} style={styles.rootShell}>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          {topBar('모임 후기')}
          <View style={styles.centered}>
            <ActivityIndicator color={GinitTheme.colors.primary} />
          </View>
        </SafeAreaView>
      </ScreenShell>
    );
  }

  if (loadError) {
    return (
      <ScreenShell padded={false} style={styles.rootShell}>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          {topBar('모임 후기')}
          <View style={styles.centered}>
            <Text style={styles.muted}>모임 정보를 불러오지 못했어요.</Text>
            <GinitPressable onPress={() => void refetch()} style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.88 }]}>
              <Text style={styles.retryText}>다시 시도</Text>
            </GinitPressable>
          </View>
        </SafeAreaView>
      </ScreenShell>
    );
  }

  if (!canViewReview) {
    const reason = !isSettled
      ? '정산이 완료된 모임에서만 후기를 확인할 수 있어요.'
      : '확정된 장소 정보가 없어 후기를 확인할 수 없어요.';
    return (
      <ScreenShell padded={false} style={styles.rootShell}>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          {topBar('모임 후기')}
          <View style={styles.centered}>
            <Text style={styles.muted}>{reason}</Text>
          </View>
        </SafeAreaView>
      </ScreenShell>
    );
  }

  if (!initialPhaseResolved) {
    return (
      <ScreenShell padded={false} style={styles.rootShell}>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          {topBar('모임 후기')}
          <View style={styles.centered}>
            <ActivityIndicator color={GinitTheme.colors.primary} />
          </View>
        </SafeAreaView>
      </ScreenShell>
    );
  }

  const isEditing = phase === 'form' && hasReviewed;
  const screenTitle = '모임 후기';
  const submitLabel = isEditing ? '수정 내용 저장' : '후기 제출하고 결과 보기';

  return (
    <ScreenShell padded={false} style={styles.rootShell}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {topBar(
          screenTitle,
          canWriteReview && phase === 'summary' && hasReviewed ? () => void switchToForm() : undefined,
        )}
        <View style={styles.body}>
          {phase === 'form' ? (
            <ReviewForm
              meeting={meeting!}
              place={placeContext!}
              categories={categories}
              onOpenPlaceUrl={onOpenPlaceUrl}
              receiptPlaceVerified={receiptPlaceVerified}
              rating={rating}
              onRatingChange={setRating}
              selectedKeywords={selectedKeywords}
              pinnedKeywords={pinnedFormKeywords}
              onToggleKeyword={onToggleKeyword}
              onKeywordMaxReached={() => showTransientBottomMessage('키워드는 최대 3개까지 선택할 수 있어요.', 2200)}
              comment={comment}
              onCommentChange={setComment}
            />
          ) : (
            <SummaryBoard
              meeting={meeting!}
              place={placeContext!}
              categories={categories}
              onOpenPlaceUrl={onOpenPlaceUrl}
              receiptPlaceVerified={receiptPlaceVerified}
              summary={summaryQuery.data}
              loading={summaryQuery.isLoading || summaryQuery.isFetching}
            />
          )}
        </View>
        {phase === 'form' && canWriteReview ? (
          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            <GinitPressable
              onPress={() => void onSubmit()}
              disabled={submitting || rating < 1}
              style={({ pressed }) => [
                meetingReviewStyles.primaryBtn,
                (rating < 1 || submitting) && meetingReviewStyles.primaryBtnDisabled,
                pressed && rating >= 1 && !submitting && { opacity: 0.88 },
              ]}>
              {submitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={meetingReviewStyles.primaryBtnText}>{submitLabel}</Text>
              )}
            </GinitPressable>
          </View>
        ) : null}
        <NaverPlaceWebViewModal
          visible={naverPlaceWebModal != null}
          url={naverPlaceWebModal?.url ?? ''}
          title={naverPlaceWebModal?.title ?? '장소'}
          onClose={() => setNaverPlaceWebModal(null)}
        />
      </SafeAreaView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  rootShell: {
    flex: 1,
    backgroundColor: GinitTheme.colors.bg,
  },
  safe: {
    flex: 1,
    backgroundColor: GinitTheme.colors.bg,
  },
  body: {
    flex: 1,
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: GinitTheme.colors.border,
    backgroundColor: GinitTheme.colors.bg,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 20,
  },
  muted: {
    fontSize: 14,
    fontWeight: '600',
    color: GinitTheme.colors.textMuted,
    textAlign: 'center',
  },
  retryBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
  },
  retryText: {
    fontSize: 14,
    fontWeight: '700',
    color: GinitTheme.colors.text,
  },
});
