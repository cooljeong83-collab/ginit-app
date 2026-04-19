import { doc, serverTimestamp, setDoc } from 'firebase/firestore';

import { getFirebaseFirestore } from '@/src/lib/firebase';
import { normalizePhoneUserId } from '@/src/lib/phone-user-id';

export const USER_EXPO_PUSH_TOKENS_COLLECTION = 'userExpoPushTokens';

/** 기기에서 받은 Expo Push 토큰을 Firestore에 저장(참가자 알림용). */
export async function saveUserExpoPushToken(phoneUserId: string, expoPushToken: string): Promise<void> {
  const uid = normalizePhoneUserId(phoneUserId.trim()) ?? phoneUserId.trim();
  if (!uid || !expoPushToken.trim()) return;
  await setDoc(
    doc(getFirebaseFirestore(), USER_EXPO_PUSH_TOKENS_COLLECTION, uid),
    {
      token: expoPushToken.trim(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}
