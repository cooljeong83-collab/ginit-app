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

export async function notifyFriendRequestReceived(params: {
  addresseeAppUserId: string;
  requesterAppUserId: string;
  requesterDisplayName?: string;
}): Promise<void> {
  const toToken = await fetchExpoPushTokenForUser(params.addresseeAppUserId);
  if (!toToken) return;

  const name = (params.requesterDisplayName ?? '').trim() || '새 친구';
  const msg: ExpoPushMessage = {
    to: toToken,
    title: '친구 요청이 왔어요',
    body: `${name}님이 친구 요청을 보냈어요. 눌러서 확인해 보세요.`,
    sound: 'default',
    priority: 'high',
    channelId: 'default',
    data: {
      action: 'friend_request',
      requesterAppUserId: normalizeParticipantId(params.requesterAppUserId) ?? params.requesterAppUserId,
    },
  };

  await sendExpoPushMessages([msg]);
}

export function notifyFriendRequestReceivedFireAndForget(params: {
  addresseeAppUserId: string;
  requesterAppUserId: string;
  requesterDisplayName?: string;
}): void {
  void notifyFriendRequestReceived(params).catch((err) => {
    if (__DEV__) {
      console.warn('[friend-push]', err);
    }
  });
}

