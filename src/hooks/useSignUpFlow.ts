import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Platform, ToastAndroid } from 'react-native';

import { type AuthProfileSnapshot, useUserSession } from '@/src/context/UserSessionContext';
import { normalizeUserId } from '@/src/lib/app-user-id';
import { isPhoneRegistered, registerPhoneIfNew, registerSignupLocalKeys } from '@/src/lib/phone-registry';
import { normalizePhoneUserId } from '@/src/lib/phone-user-id';
import { writeSecureAuthSession } from '@/src/lib/secure-auth-session';
import { applyGoogleSignupProfile, ensureUserProfile, generateRandomNickname, recordTermsAgreement } from '@/src/lib/user-profile';

/** 전화번호 입력이 멈춘 뒤 짧게 기다렸다가 회원 조회(과도한 호출·레이스 완화) */
const PHONE_MEMBER_CHECK_DEBOUNCE_MS = 220;

function isValidEmailRequired(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
}

export type SignUpMemberStatus = 'unknown' | 'checking' | 'member' | 'guest';

/** Firestore `users.gender` 등에 저장하는 성별 코드 */
export type SignUpGenderCode = 'MALE' | 'FEMALE';

export function useSignUpFlow(initialPhone: string) {
  const { setUserId, setAuthProfile } = useUserSession();
  const [displayName, setDisplayName] = useState('');
  const [phoneField, setPhoneField] = useState(initialPhone);
  const [emailField, setEmailField] = useState('');
  const [memberStatus, setMemberStatus] = useState<SignUpMemberStatus>('unknown');
  const [genderCode, setGenderCode] = useState<SignUpGenderCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    setPhoneField((prev) => (initialPhone && prev === '' ? initialPhone : prev));
  }, [initialPhone]);

  useEffect(() => {
    let cancelled = false;
    const n = normalizePhoneUserId(phoneField);
    if (!n) {
      setMemberStatus('unknown');
      return;
    }
    setMemberStatus('checking');
    const t = setTimeout(() => {
      void (async () => {
        try {
          const ok = await isPhoneRegistered(n);
          if (cancelled) return;
          setMemberStatus(ok ? 'member' : 'guest');
        } catch {
          // 네트워크 실패 시 OTP까지 막지 않음(서버에서 중복 가입은 이후 단계에서 걸림)
          if (!cancelled) setMemberStatus('guest');
        }
      })();
    }, PHONE_MEMBER_CHECK_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [phoneField]);

  const normalizedPhone = useMemo(() => normalizePhoneUserId(phoneField), [phoneField]);

  const canSubmit = useMemo(() => {
    if (!isValidEmailRequired(emailField)) return false;
    if (!displayName.trim()) return false;
    if (!normalizedPhone) return false;
    if (memberStatus !== 'guest') return false;
    if (!genderCode) return false;
    return true;
  }, [emailField, displayName, normalizedPhone, memberStatus, genderCode]);

  const selectGenderCode = useCallback((code: SignUpGenderCode) => {
    setGenderCode(code);
    setErrorText(null);
  }, []);

  const runSignUp = useCallback(
    async (firebaseUid: string, onComplete: () => void) => {
      const name = displayName.trim();
      const n = normalizedPhone;
      const uid = firebaseUid.trim();
      const emailTrim = emailField.trim();
      const emailPk = normalizeUserId(emailTrim);
      if (!emailPk) {
        Alert.alert('안내', '이메일 형식을 확인해 주세요.');
        return;
      }
      if (!name) {
        Alert.alert('안내', '이름을 입력해 주세요.');
        return;
      }
      if (!n) {
        Alert.alert('안내', '전화번호를 확인해 주세요.');
        return;
      }
      if (!uid) {
        Alert.alert('안내', '전화번호 인증(OTP)을 먼저 완료해 주세요.');
        return;
      }
      if (memberStatus === 'member') {
        Alert.alert('안내', '이미 가입된 번호예요. 로그인 화면으로 돌아가 주세요.');
        return;
      }
      if (memberStatus !== 'guest') {
        Alert.alert('안내', '회원 여부를 확인하는 중이에요. 잠시만 기다려 주세요.');
        return;
      }
      if (!genderCode) {
        const msg = '성별을 선택해주세요.';
        setErrorText(msg);
        if (Platform.OS === 'android') {
          ToastAndroid.show(msg, ToastAndroid.SHORT);
        }
        return;
      }

      setErrorText(null);
      setBusy(true);
      try {
        const nickBase = name.split(/\s+/)[0]?.trim().slice(0, 16) || '';
        const nickname = nickBase || generateRandomNickname();

        const snapshot: AuthProfileSnapshot = {
          displayName: name.slice(0, 64),
          email: emailTrim || null,
          photoUrl: null,
          firebaseUid: uid,
          gender: genderCode,
          birthYear: null,
        };
        setAuthProfile(snapshot);

        await applyGoogleSignupProfile(emailPk, {
          nickname,
          photoUrl: null,
          phone: n,
          email: emailTrim || null,
          displayName: name.slice(0, 64),
          gender: genderCode,
          birthYear: null,
          birthMonth: null,
          birthDay: null,
          firebaseUid: uid,
        });
        await registerPhoneIfNew(n);
        await registerSignupLocalKeys(n, emailPk);
        await setUserId(emailPk);
        await writeSecureAuthSession({ uid, userId: emailPk });
        await ensureUserProfile(emailPk);
        await recordTermsAgreement(emailPk);
        onComplete();
      } catch (e) {
        const code = e && typeof e === 'object' && 'code' in e ? String((e as { code?: string }).code) : '';
        const message = e instanceof Error ? e.message : '알 수 없는 오류';
        setErrorText(`${message}${code ? ` (${code})` : ''}`);
        Alert.alert('가입 실패', code ? `${code}\n${message}` : message);
      } finally {
        setBusy(false);
      }
    },
    [displayName, normalizedPhone, emailField, memberStatus, genderCode, setAuthProfile, setUserId],
  );

  return {
    displayName,
    setDisplayName,
    phoneField,
    setPhoneField,
    emailField,
    setEmailField,
    genderCode,
    selectGenderCode,
    memberStatus,
    busy,
    errorText,
    canSubmit,
    runSignUp,
  };
}
