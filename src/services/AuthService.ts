import { signOutSupabase, supabase } from '@/src/lib/supabase';

export type PhoneVerificationResult = { verificationId: string };

/** 전화 OTP 확정 후 앱에서 쓰는 최소 사용자 정보 */
export type PhoneAuthConfirmResult = {
  uid: string;
  phoneNumber: string | null;
};

type PhoneOtpPayload = { mode: 'signin' | 'link'; phone: string };

function encodePhoneOtpHandle(payload: PhoneOtpPayload): string {
  return JSON.stringify(payload);
}

function decodePhoneOtpHandle(verificationId: string): PhoneOtpPayload {
  try {
    const o = JSON.parse(verificationId) as Partial<PhoneOtpPayload>;
    const phone = typeof o.phone === 'string' ? o.phone.trim() : '';
    const mode = o.mode === 'link' ? 'link' : 'signin';
    if (!phone) throw new Error('empty');
    return { mode, phone };
  } catch {
    throw new Error('인증 세션이 만료되었습니다. 인증번호를 다시 요청해 주세요.');
  }
}

export class AuthService {
  /**
   * 전화번호로 OTP 전송을 시작합니다.
   * - 로그인(세션 없음): Supabase `signInWithOtp`
   * - 연결(세션 있음): Supabase `updateUser({ phone })` 후 `phone_change` OTP
   */
  static async verifyPhoneNumber(phoneE164: string): Promise<PhoneVerificationResult> {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) {
        const { error } = await supabase.auth.updateUser({ phone: phoneE164 });
        if (error) throw error;
        return { verificationId: encodePhoneOtpHandle({ mode: 'link', phone: phoneE164 }) };
      }
      const { error } = await supabase.auth.signInWithOtp({ phone: phoneE164 });
      if (error) throw error;
      return { verificationId: encodePhoneOtpHandle({ mode: 'signin', phone: phoneE164 }) };
    } catch (e) {
      throw new Error(AuthService.humanizeError(e));
    }
  }

  static async confirmCode(verificationId: string, code: string): Promise<PhoneAuthConfirmResult> {
    try {
      const { mode, phone } = decodePhoneOtpHandle(verificationId);
      const type = mode === 'link' ? 'phone_change' : 'sms';
      const { data, error } = await supabase.auth.verifyOtp({
        phone,
        token: code.trim(),
        type,
      });
      if (error) throw error;
      const user = data.user;
      if (!user?.id) throw new Error('인증은 완료됐지만 사용자 정보를 가져올 수 없습니다.');
      return {
        uid: user.id,
        phoneNumber: user.phone ?? phone,
      };
    } catch (e) {
      throw new Error(AuthService.humanizeError(e));
    }
  }

  /**
   * (로그인 상태에서) 전화번호 OTP를 현재 계정에 연결합니다.
   * Supabase는 `updateUser` + `verifyOtp(type: phone_change)` 경로를 사용합니다.
   */
  static async linkPhoneWithCode(verificationId: string, code: string): Promise<PhoneAuthConfirmResult> {
    return await AuthService.confirmCode(verificationId, code);
  }

  static async signOut(): Promise<void> {
    await signOutSupabase();
  }

  static humanizeError(e: unknown): string {
    const code =
      typeof e === 'object' && e !== null && 'code' in e ? String((e as { code?: unknown }).code) : '';
    const message = e instanceof Error ? e.message : String(e);
    const hay = `${code} ${message}`.toLowerCase();

    if (hay.includes('invalid-phone-number') || hay.includes('invalid phone')) {
      return '전화번호 형식이 올바르지 않습니다.';
    }
    if (hay.includes('too_many_requests') || hay.includes('too-many-requests')) {
      return '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.';
    }
    if (hay.includes('over_email_send_rate_limit') || hay.includes('sms_send_failed')) {
      return '인증 문자 발송에 실패했습니다. 잠시 후 다시 시도해 주세요.';
    }
    if (hay.includes('otp_expired') || hay.includes('session-expired')) {
      return '인증 시간이 만료되었습니다. 다시 인증을 진행해 주세요.';
    }
    if (hay.includes('invalid otp') || hay.includes('invalid_token') || hay.includes('invalid-verification-code')) {
      return '인증번호가 올바르지 않습니다.';
    }
    if (hay.includes('network') || hay.includes('fetch')) {
      return '네트워크 연결이 불안정합니다. 잠시 후 다시 시도해 주세요.';
    }
    if (
      hay.includes('account-exists-with-different-credential') ||
      hay.includes('credential-already-in-use') ||
      hay.includes('phone-number-already-exists') ||
      hay.includes('user already registered')
    ) {
      return (
        '이미 다른 계정에 연결된 전화번호입니다.\n' +
        '다른 번호로 인증하거나, 해당 번호로 가입/로그인했던 계정으로 다시 로그인해 주세요.'
      );
    }
    if (hay.includes('provider-already-linked') || hay.includes('already been registered')) {
      return '이미 전화번호 인증이 완료된 계정입니다.';
    }
    if (hay.includes('billing') || hay.includes('billing-not-enabled')) {
      const tail = __DEV__ && (code || message) ? `\n(디버그: ${code || message})` : '';
      return '전화번호 인증을 사용할 수 없는 설정입니다. Supabase 대시보드의 SMS/Auth 설정을 확인해 주세요.' + tail;
    }

    return message || '알 수 없는 오류가 발생했습니다.';
  }
}
