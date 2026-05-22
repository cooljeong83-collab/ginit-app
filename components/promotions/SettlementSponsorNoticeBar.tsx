import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { GinitPressable } from '@/components/ui/GinitPressable';
import { GinitTheme } from '@/constants/ginit-theme';
import type { MeetingPlacePromotion } from '@/src/lib/promotions/place-promotion-types';
import { submitPromotionMatchVerify } from '@/src/lib/promotions/place-promotions-api';

type Props = {
  meetingId: string;
  verifierAppUserId: string;
  promotion: MeetingPlacePromotion;
  headcount: number;
  totalAmountWon: number;
  onSubmitted: () => void;
};

/** 정산 완료 화면 인라인 Notice 바 — 중앙 팝업 없음 */
export function SettlementSponsorNoticeBar({
  meetingId,
  verifierAppUserId,
  promotion,
  headcount,
  totalAmountWon,
  onSubmitted,
}: Props) {
  const [submitting, setSubmitting] = useState(false);

  const onAnswer = (benefitReceived: boolean) => {
    if (submitting) return;
    setSubmitting(true);
    void (async () => {
      await submitPromotionMatchVerify({
        meetingId,
        verifierAppUserId,
        headcount,
        totalAmountWon,
        benefitReceived,
        matchSuccess: benefitReceived,
      });
      setSubmitting(false);
      onSubmitted();
    })();
  };

  const placeName = promotion.placeName.trim() || '제휴 가게';

  return (
    <View style={s.bar} accessibilityRole="text">
      <Text style={s.message}>
        {`💜 지닛 제휴 가게 '${placeName}' 방문이 확인되었습니다. 사장님이 등록한 혜택을 받으셨나요?`}
      </Text>
      <View style={s.actions}>
        <GinitPressable
          onPress={() => onAnswer(true)}
          disabled={submitting}
          style={({ pressed }) => [s.actionBtn, pressed && s.actionBtnPressed]}
          accessibilityRole="button"
          accessibilityLabel="혜택 받음, 예">
          {submitting ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={s.actionBtnText}>예</Text>
          )}
        </GinitPressable>
        <GinitPressable
          onPress={() => onAnswer(false)}
          disabled={submitting}
          style={({ pressed }) => [s.actionBtn, pressed && s.actionBtnPressed]}
          accessibilityRole="button"
          accessibilityLabel="혜택 받지 않음, 아니오">
          <Text style={s.actionBtnText}>아니오</Text>
        </GinitPressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  bar: {
    backgroundColor: GinitTheme.colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  message: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    lineHeight: 20,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
  },
  actionBtn: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.85)',
    borderRadius: 4,
    backgroundColor: 'transparent',
  },
  actionBtnPressed: {
    opacity: 0.88,
  },
  actionBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
