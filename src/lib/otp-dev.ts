import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * 개발용 OTP(문자 수신 대신).
 * - 실제 SMS 인증을 붙이면 이 파일을 Firebase Phone Auth/Twilio 구현으로 교체하세요.
 */

const OTP_KEY_PREFIX = 'ginit.devOtp.v1.';
const OTP_TTL_MS = 3 * 60 * 1000;

type StoredOtp = { code: string; expiresAt: number };

function random6(): string {
  const n = Math.floor(100000 + Math.random() * 900000);
  return String(n);
}

export async function requestDevOtp(normalizedPhoneUserId: string): Promise<void> {
  const code = random6();
  const payload: StoredOtp = { code, expiresAt: Date.now() + OTP_TTL_MS };
  await AsyncStorage.setItem(OTP_KEY_PREFIX + normalizedPhoneUserId, JSON.stringify(payload));
  // 개발 편의를 위해 콘솔에 출력(프로덕션에서는 제거)
  console.log('[GinitOTP:DEV] issued', { phoneUserId: normalizedPhoneUserId, code });
}

export async function verifyDevOtp(normalizedPhoneUserId: string, input: string): Promise<boolean> {
  const raw = await AsyncStorage.getItem(OTP_KEY_PREFIX + normalizedPhoneUserId);
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as StoredOtp;
    if (!parsed?.code || !parsed?.expiresAt) return false;
    if (Date.now() > parsed.expiresAt) return false;
    return parsed.code === input.trim();
  } catch {
    return false;
  }
}

