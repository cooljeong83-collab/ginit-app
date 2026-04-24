import {
  PhoneAuthProvider as JsPhoneAuthProvider,
  linkWithCredential,
  type UserCredential,
} from 'firebase/auth';
import {
  FirebaseAuthTypes,
  PhoneAuthProvider,
  getAuth,
  onAuthStateChanged as onFirebaseAuthStateChanged,
  signInWithCredential,
  signOut as firebaseSignOut,
  verifyPhoneNumber as startFirebasePhoneVerification,
} from '@react-native-firebase/auth';

import { getFirebaseAuth } from '@/src/lib/firebase';

export type PhoneVerificationResult = { verificationId: string };

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

export class AuthService {
  /**
   * 전화번호로 OTP 전송을 시작합니다.
   * - 실패(번호 형식/쿼터/Play Services 등) 시 사람이 읽기 쉬운 메시지로 throw 합니다.
   */
  static async verifyPhoneNumber(phoneE164: string): Promise<PhoneVerificationResult> {
    try {
      const auth = getAuth();
      /** `false` = 기본 자동검증 타임아웃(60초)·강제 재전송 없음 — 구 `auth().verifyPhoneNumber(phone)`과 동일 */
      const session = startFirebasePhoneVerification(auth, phoneE164, false);
      const verificationId = await new Promise<string>((resolve, reject) => {
        const unsubRef: { current: UnsubLike } = { current: null };
        let timer: ReturnType<typeof setTimeout> | null = null;
        const done = (fn: () => void) => {
          safeUnsub(unsubRef);
          if (timer) clearTimeout(timer);
          timer = null;
          fn();
        };
        // 이벤트가 영원히 안 오는 케이스(네트워크/서비스 이슈)를 대비해 상한을 둡니다.
        timer = setTimeout(() => {
          done(() => reject(new Error('인증번호 요청이 지연되고 있어요. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.')));
        }, 20000);
        const subscription = session.on(
          'state_changed',
          (snapshot: FirebaseAuthTypes.PhoneAuthSnapshot) => {
            if (snapshot.state === 'sent' || snapshot.state === 'timeout') {
              done(() => resolve(snapshot.verificationId));
            } else if (snapshot.state === 'error') {
              done(() => reject(snapshot.error ?? new Error('전화번호 인증을 시작할 수 없습니다.')));
            }
          },
          (e: unknown) => {
            done(() => reject(e));
          },
        );
        unsubRef.current = subscription as UnsubLike;
      });
      return { verificationId };
    } catch (e) {
      throw new Error(AuthService.humanizeError(e));
    }
  }

  /** OTP 코드 확정 → Firebase 로그인 */
  static async confirmCode(verificationId: string, code: string): Promise<FirebaseAuthTypes.UserCredential> {
    try {
      const auth = getAuth();
      const credential = PhoneAuthProvider.credential(verificationId, code.trim());
      return await signInWithCredential(auth, credential);
    } catch (e) {
      throw new Error(AuthService.humanizeError(e));
    }
  }

  /**
   * (로그인 상태에서) 전화번호 OTP를 현재 계정에 연결합니다.
   * - Google SNS 가입자가 프로필에서 전화번호 인증을 진행할 때 사용
   * - 이미 phone이 연결된 계정이면 에러 메시지를 사람이 읽기 쉽게 throw
   */
  /**
   * 구글 등은 `firebase/auth`(getFirebaseAuth) 세션만 있고 RN Firebase `getAuth().currentUser`는 비어 있을 수 있음.
   * 전화 OTP 전용 로그인은 반대로 RN 세션만 있는 경우가 있어 둘 다 시도합니다.
   */
  static async linkPhoneWithCode(verificationId: string, code: string): Promise<UserCredential> {
    try {
      const trimmed = code.trim();
      const jsUser = getFirebaseAuth().currentUser;
      if (jsUser && !jsUser.isAnonymous) {
        const credential = JsPhoneAuthProvider.credential(verificationId, trimmed);
        return await linkWithCredential(jsUser, credential);
      }
      const rnUser = getAuth().currentUser;
      if (rnUser) {
        const credential = PhoneAuthProvider.credential(verificationId, trimmed);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        const linked = await (rnUser as unknown as { linkWithCredential: (c: unknown) => Promise<FirebaseAuthTypes.UserCredential> }).linkWithCredential(
          credential,
        );
        return linked as unknown as UserCredential;
      }
      throw new Error('로그인 상태를 확인할 수 없습니다.');
    } catch (e) {
      throw new Error(AuthService.humanizeError(e));
    }
  }

  /** 앱 재실행 시 자동 로그인용 auth state 감제 */
  static onAuthStateChanged(cb: (u: FirebaseAuthTypes.User | null) => void): () => void {
    return onFirebaseAuthStateChanged(getAuth(), cb);
  }

  static async signOut(): Promise<void> {
    await firebaseSignOut(getAuth());
  }

  static humanizeError(e: unknown): string {
    const code =
      typeof e === 'object' && e !== null && 'code' in e ? String((e as { code?: unknown }).code) : '';
    const message = e instanceof Error ? e.message : String(e);
    const hay = `${code} ${message}`.toLowerCase();

    // 자주 만나는 케이스(Phone Auth)
    if (hay.includes('invalid-phone-number')) return '전화번호 형식이 올바르지 않습니다.';
    if (hay.includes('too-many-requests')) return '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.';
    if (hay.includes('quota-exceeded')) return 'SMS 인증 요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.';
    if (hay.includes('session-expired')) return '인증 시간이 만료되었습니다. 다시 인증을 진행해 주세요.';
    if (hay.includes('invalid-verification-code')) return '인증번호가 올바르지 않습니다.';
    if (hay.includes('network-request-failed')) return '네트워크 연결이 불안정합니다. 잠시 후 다시 시도해 주세요.';

    // Firebase Phone Auth는 프로젝트 설정/요금제에 따라 "billing not enabled" 류 에러가 발생할 수 있음.
    // 일부 환경에서는 message로만 `billing_hot_enabled` 같은 키가 노출되기도 함.
    if (hay.includes('billing') || hay.includes('billing_hot_enabled') || hay.includes('billing-not-enabled')) {
      const tail = __DEV__ && (code || message) ? `\n(디버그: ${code || message})` : '';
      return (
        '전화번호 인증을 사용할 수 없는 설정입니다.\n' +
        'Firebase 콘솔에서 Phone Auth 사용을 위해 결제(Blaze) 설정/프로젝트 설정을 확인해 주세요.' +
        tail
      );
    }

    return message || '알 수 없는 오류가 발생했습니다.';
  }
}

