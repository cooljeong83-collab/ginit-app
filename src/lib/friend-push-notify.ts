import { doc, getDoc } from 'firebase/firestore';
import { Platform } from 'react-native';

import { sendExpoPushMessages, type ExpoPushMessage } from '@/src/lib/expo-push-api';
import { sendFcmPushToUsersFireAndForget } from '@/src/lib/fcm-push-api';
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
  const name = (params.requesterDisplayName ?? '').trim() || '새 친구';
  const data: Record<string, unknown> = {
    action: 'friend_request',
    requesterAppUserId: normalizeParticipantId(params.requesterAppUserId) ?? params.requesterAppUserId,
  };

  // Android(FCM) 서버 경유: 수신자 앱이 종료돼 있어도 OS 트레이로 표시될 수 있게 합니다.
  sendFcmPushToUsersFireAndForget({
    toUserIds: [params.addresseeAppUserId],
    title: '친구 요청이 왔어요',
    body: `${name}님이 친구 요청을 보냈어요. 눌러서 확인해 보세요.`,
    data,
  });
  // Android는 Expo Push도 FCM을 타므로 중복 방지: FCM만 사용
  if (Platform.OS === 'android') return;

  const toToken = await fetchExpoPushTokenForUser(params.addresseeAppUserId);
  if (!toToken) return;
  const msg: ExpoPushMessage = {
    to: toToken,
    title: '친구 요청이 왔어요',
    body: `${name}님이 친구 요청을 보냈어요. 눌러서 확인해 보세요.`,
    sound: 'default',
    priority: 'high',
    channelId: 'default',
    data,
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

