import { Alert } from 'react-native';

import { alertBodyForArrivalRpc, type MeetingArrivalRpcResult } from '@/src/lib/meeting-arrival-verify';
import { cancelMeetingArrivalReminderLocalNotifications } from '@/src/lib/meeting-arrival-verify-reminders';
import type { Meeting } from '@/src/lib/meetings';

export type MeetingArrivalVerifyRpcUiPayload = {
  rpc: MeetingArrivalRpcResult | null;
  errorMessage: string | null;
};

/**
 * 장소 인증 RPC 결과에 대한 알림·리마인더 취소·상세 갱신.
 * 전용 라우트에서 `router.back()` 등을 `onAfterResolved`로 넘깁니다.
 */
export function presentMeetingArrivalVerifyRpcOutcome(
  payload: MeetingArrivalVerifyRpcUiPayload,
  ctx: {
    meeting: Meeting | null;
    userId: string;
    refetchMeetingDetail: () => void | Promise<unknown>;
    onAfterResolved: () => void;
  },
): void {
  const { rpc, errorMessage } = payload;
  const m = ctx.meeting;
  const uid = ctx.userId.trim();
  if (!m?.id?.trim() || !uid) return;
  if (errorMessage && errorMessage !== 'mock_location' && errorMessage !== 'accuracy_too_low') {
    Alert.alert('장소 인증', errorMessage);
    return;
  }
  if (!rpc) return;
  if (rpc.ok) {
    void cancelMeetingArrivalReminderLocalNotifications(m.id, uid);
    Alert.alert(
      '인증 완료',
      `도착이 확인됐어요.\nXP +${rpc.xp_granted} · 신뢰 +${rpc.trust_granted}\n\n(gTrust·XP는 서버 정책에 따라만 반영됩니다.)`,
      [
        {
          text: '확인',
          onPress: () => {
            void ctx.refetchMeetingDetail();
            ctx.onAfterResolved();
          },
        },
      ],
    );
    return;
  }
  if (rpc.ok === false && rpc.code === 'already_verified') {
    void cancelMeetingArrivalReminderLocalNotifications(m.id, uid);
    void ctx.refetchMeetingDetail();
    ctx.onAfterResolved();
    return;
  }
  Alert.alert('장소 인증', alertBodyForArrivalRpc(rpc));
}
