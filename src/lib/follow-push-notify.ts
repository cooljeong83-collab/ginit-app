import { doc, getDoc } from 'firebase/firestore';

import { sendExpoPushMessages, type ExpoPushMessage } from '@/src/lib/expo-push-api';
import { getFirebaseFirestore } from '@/src/lib/firebase';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { USER_EXPO_PUSH_TOKENS_COLLECTION } from '@/src/lib/user-expo-push-token';

async function fetchExpoPushTokenForUser(userId: string): Promise<string | null> {
  const uid = normalizeParticipantId(userId.trim());
  if (!uid) return null;
  const snap = await getDoc(doc(getFirebaseFirestore(), USER_EXPO_PUSH_TOKENS_COLLECTION, uid));
  const t = snap.data()?.token;
  if (typeof t === 'string' && (t.startsWith('ExponentPushToken') || t.startsWith('ExpoPushToken'))) {
    return t;
  }
  return null;
}

export async function notifyFollowRequestReceived(params: {
  followeeAppUserId: string;
  followerAppUserId: string;
  followerDisplayName?: string;
}): Promise<void> {
  const toToken = await fetchExpoPushTokenForUser(params.followeeAppUserId);
  if (!toToken) return;

  const name = (params.followerDisplayName ?? '').trim() || '새 팔로워';
  const msg: ExpoPushMessage = {
    to: toToken,
    title: '팔로우 요청이 왔어요',
    body: `${name}님이 팔로우 요청을 보냈어요. 눌러서 확인해 보세요.`,
    sound: 'default',
    priority: 'high',
    channelId: 'default',
    data: {
      action: 'follow_request',
      followerAppUserId: normalizeParticipantId(params.followerAppUserId) ?? params.followerAppUserId,
    },
  };

  await sendExpoPushMessages([msg]);
}

export function notifyFollowRequestReceivedFireAndForget(params: {
  followeeAppUserId: string;
  followerAppUserId: string;
  followerDisplayName?: string;
}): void {
  void notifyFollowRequestReceived(params).catch((err) => {
    if (__DEV__) {
      console.warn('[follow-push]', err);
    }
  });
}

