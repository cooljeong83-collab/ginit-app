import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { ginitNotifyDbg } from '@/src/lib/ginit-notify-debug';
import { dispatchRemotePushToRecipients } from '@/src/lib/remote-push-hub';

export async function notifyFollowRequestReceived(params: {
  followeeAppUserId: string;
  followerAppUserId: string;
  followerDisplayName?: string;
}): Promise<void> {
  const name = (params.followerDisplayName ?? '').trim() || '새 팔로워';
  const data: Record<string, unknown> = {
    action: 'follow_request',
    followerAppUserId: normalizeParticipantId(params.followerAppUserId) ?? params.followerAppUserId,
  };

  ginitNotifyDbg('follow-push', 'dispatch', {
    followeeSuffix: String(params.followeeAppUserId).slice(-6),
  });
  await dispatchRemotePushToRecipients({
    toUserIds: [params.followeeAppUserId],
    title: '팔로우 요청이 왔어요',
    body: `${name}님이 팔로우 요청을 보냈어요. 눌러서 확인해 보세요.`,
    data,
  });
}

export function notifyFollowRequestReceivedFireAndForget(params: {
  followeeAppUserId: string;
  followerAppUserId: string;
  followerDisplayName?: string;
}): void {
  void notifyFollowRequestReceived(params).catch((err) => {
    ginitNotifyDbg('follow-push', 'error', { message: err instanceof Error ? err.message : String(err) });
    if (__DEV__) {
      console.warn('[follow-push]', err);
    }
  });
}
