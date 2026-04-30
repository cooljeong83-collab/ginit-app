import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { ginitNotifyDbg } from '@/src/lib/ginit-notify-debug';
import { dispatchRemotePushToRecipients } from '@/src/lib/remote-push-hub';

export async function notifyFriendRequestReceived(params: {
  addresseeAppUserId: string;
  requesterAppUserId: string;
  requesterDisplayName?: string;
}): Promise<void> {
  const name = (params.requesterDisplayName ?? '').trim() || '새 친구';
  const data: Record<string, unknown> = {
    action: 'friend_request',
    requesterAppUserId: normalizeParticipantId(params.requesterAppUserId) ?? params.requesterAppUserId,
  };

  ginitNotifyDbg('friend-push', 'dispatch', {
    addresseeSuffix: String(params.addresseeAppUserId).slice(-6),
  });
  await dispatchRemotePushToRecipients({
    toUserIds: [params.addresseeAppUserId],
    title: '친구 요청이 왔어요',
    body: `${name}님이 친구 요청을 보냈어요. 눌러서 확인해 보세요.`,
    data,
  });
}

export function notifyFriendRequestReceivedFireAndForget(params: {
  addresseeAppUserId: string;
  requesterAppUserId: string;
  requesterDisplayName?: string;
}): void {
  void notifyFriendRequestReceived(params).catch((err) => {
    ginitNotifyDbg('friend-push', 'error', { message: err instanceof Error ? err.message : String(err) });
    if (__DEV__) {
      console.warn('[friend-push]', err);
    }
  });
}
