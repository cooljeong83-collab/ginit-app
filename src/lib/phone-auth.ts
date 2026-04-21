import auth, { FirebaseAuthTypes } from '@react-native-firebase/auth';

/**
 * Firebase Phone Auth (React Native Firebase)
 * - Android/iOS 모두 대응
 * - `verifyPhoneNumber`로 verificationId 확보 후, `signInWithCredential`로 코드 확정
 */

type UnsubLike = null | undefined | (() => void) | { remove?: () => void; unsubscribe?: () => void };

function safeUnsub(ref: { current: UnsubLike }) {
  const u = ref.current;
  if (!u) return;
  ref.current = null;
  try {
    if (typeof u === 'function') {
      u();
      return;
    }
    if (typeof u.remove === 'function') {
      u.remove();
      return;
    }
    if (typeof u.unsubscribe === 'function') {
      u.unsubscribe();
    }
  } catch {
    /* noop */
  }
}

export async function startPhoneVerification(phoneE164: string): Promise<string> {
  const session = auth().verifyPhoneNumber(phoneE164);
  return await new Promise<string>((resolve, reject) => {
    const unsubRef: { current: UnsubLike } = { current: null };
    const subscription = session.on(
      'state_changed',
      (snapshot: FirebaseAuthTypes.PhoneAuthSnapshot) => {
        if (snapshot.state === 'sent' || snapshot.state === 'timeout') {
          safeUnsub(unsubRef);
          resolve(snapshot.verificationId);
        } else if (snapshot.state === 'error') {
          safeUnsub(unsubRef);
          const msg =
            typeof snapshot.error === 'object' && snapshot.error && 'message' in snapshot.error
              ? String((snapshot.error as { message?: unknown }).message)
              : '전화번호 인증을 시작할 수 없습니다.';
          reject(new Error(msg));
        }
      },
      (e: unknown) => {
        safeUnsub(unsubRef);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
    unsubRef.current = subscription as UnsubLike;
  });
}

export async function confirmPhoneCode(verificationId: string, code: string): Promise<FirebaseAuthTypes.UserCredential> {
  const credential = auth.PhoneAuthProvider.credential(verificationId, code.trim());
  return await auth().signInWithCredential(credential);
}

