import { useCallback, useState } from 'react';
import { Alert } from 'react-native';

import { showTransientBottomMessage } from '@/components/ui/TransientBottomMessage';
import { inviteFriendsToMeeting } from '@/src/lib/meeting-friend-invite';

export function useMeetingFriendInvite(params: {
  meetingId: string | null | undefined;
  inviterAppUserId: string | null | undefined;
}) {
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);

  const openInviteModal = useCallback(() => {
    if (!params.meetingId?.trim() || !params.inviterAppUserId?.trim()) {
      Alert.alert('안내', '로그인 후 친구를 초대할 수 있어요.');
      return;
    }
    setInviteModalOpen(true);
  }, [params.meetingId, params.inviterAppUserId]);

  const closeInviteModal = useCallback(() => {
    if (inviteBusy) return;
    setInviteModalOpen(false);
  }, [inviteBusy]);

  const submitInvite = useCallback(
    async (inviteeAppUserIds: string[]) => {
      const meetingId = params.meetingId?.trim() ?? '';
      const inviter = params.inviterAppUserId?.trim() ?? '';
      if (!meetingId || !inviter) {
        Alert.alert('안내', '로그인 후 친구를 초대할 수 있어요.');
        return;
      }
      setInviteBusy(true);
      try {
        const res = await inviteFriendsToMeeting({
          meetingId,
          inviterAppUserId: inviter,
          inviteeAppUserIds,
        });
        if (!res.ok) {
          Alert.alert('초대 실패', res.message);
          return;
        }
        if (res.sent <= 0) {
          const parts: string[] = [];
          const s = res.skipped;
          if (s?.already_joined) parts.push(`이미 참여 중 ${s.already_joined}명`);
          if (s?.not_friend) parts.push(`친구 아님 ${s.not_friend}명`);
          Alert.alert(
            '초대할 수 없어요',
            parts.length > 0 ? parts.join('\n') : '선택한 친구에게 초대를 보낼 수 없어요.',
          );
          return;
        }
        setInviteModalOpen(false);
        const suffix =
          res.skipped && Object.values(res.skipped).some((n) => (n ?? 0) > 0)
            ? ' (일부는 이미 참여 중이거나 초대할 수 없어요)'
            : '';
        showTransientBottomMessage(`친구 ${res.sent}명에게 초대 알림을 보냈어요.${suffix}`);
      } catch (e) {
        Alert.alert('초대 실패', e instanceof Error ? e.message : '다시 시도해 주세요.');
      } finally {
        setInviteBusy(false);
      }
    },
    [params.meetingId, params.inviterAppUserId],
  );

  return {
    inviteModalOpen,
    inviteBusy,
    openInviteModal,
    closeInviteModal,
    submitInvite,
  };
}
