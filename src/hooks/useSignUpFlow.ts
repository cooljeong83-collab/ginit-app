import { signInAnonymously, signOut } from 'firebase/auth';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Platform, ToastAndroid } from 'react-native';

import { type AuthProfileSnapshot, useUserSession } from '@/src/context/UserSessionContext';
import { getFirebaseAuth } from '@/src/lib/firebase';
import { fetchAndroidPhoneHint } from '@/src/lib/phone-hint';
import { isPhoneRegistered, registerPhoneIfNew } from '@/src/lib/phone-registry';
import { formatNormalizedPhoneKrDisplay, normalizePhoneUserId } from '@/src/lib/phone-user-id';
import { applyGoogleSignupProfile, ensureUserProfile, generateRandomNickname, recordTermsAgreement } from '@/src/lib/user-profile';

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function isValidEmailOptional(raw: string): boolean {
  const t = raw.trim();
  if (!t) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
}

export type SignUpMemberStatus = 'unknown' | 'checking' | 'member' | 'guest';

/** Firestore `users.gender` 등에 저장하는 성별 코드 */
export type SignUpGenderCode = 'MALE' | 'FEMALE';

export function useSignUpFlow(initialPhone: string) {
  const { setPhoneUserId, setAuthProfile } = useUserSession();
  const [displayName, setDisplayName] = useState('');
  const [phoneField, setPhoneField] = useState(initialPhone);
  const [emailField, setEmailField] = useState('');
  const [memberStatus, setMemberStatus] = useState<SignUpMemberStatus>('unknown');
  const [genderCode, setGenderCode] = useState<SignUpGenderCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const debouncedPhone = useDebounced(phoneField, 480);
  const debouncedNormalized = normalizePhoneUserId(debouncedPhone);

  useEffect(() => {
    setPhoneField((prev) => (initialPhone && prev === '' ? initialPhone : prev));
  }, [initialPhone]);

  useEffect(() => {
    let cancelled = false;
    if (Platform.OS === 'android' && !normalizePhoneUserId(initialPhone)) {
      (async () => {
        try {
          const hinted = await fetchAndroidPhoneHint();
          if (cancelled || !hinted) return;
          const n = normalizePhoneUserId(hinted);
          setPhoneField((prev) => (prev.trim() ? prev : n ? formatNormalizedPhoneKrDisplay(n) : hinted));
        } catch {
          /* */
        }
      })();
    }
    return () => {
      cancelled = true;
    };
  }, [initialPhone]);

  useEffect(() => {
    let cancelled = false;
    if (!debouncedNormalized) {
      setMemberStatus('unknown');
      return;
    }
    setMemberStatus('checking');
    void (async () => {
      try {
        const ok = await isPhoneRegistered(debouncedNormalized);
        if (cancelled) return;
        setMemberStatus(ok ? 'member' : 'guest');
      } catch {
        if (!cancelled) setMemberStatus('unknown');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debouncedNormalized]);

  const normalizedPhone = useMemo(() => normalizePhoneUserId(phoneField), [phoneField]);

  const canSubmit = useMemo(() => {
    if (!displayName.trim()) return false;
    if (!normalizedPhone) return false;
    if (memberStatus !== 'guest') return false;
    if (!genderCode) return false;
    if (!isValidEmailOptional(emailField)) return false;
    return true;
  }, [displayName, normalizedPhone, memberStatus, emailField, genderCode]);

  const selectGenderCode = useCallback((code: SignUpGenderCode) => {
    setGenderCode(code);
    setErrorText(null);
  }, []);

  const runSignUp = useCallback(
    async (onComplete: () => void) => {
      const name = displayName.trim();
      const n = normalizedPhone;
      if (!name) {
        Alert.alert('안내', '이름을 입력해 주세요.');
        return;
      }
      if (!n) {
        Alert.alert('안내', '전화번호를 확인해 주세요.');
        return;
      }
      if (!isValidEmailOptional(emailField)) {
        Alert.alert('안내', '이메일 형식을 확인해 주세요.');
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
        const auth = getFirebaseAuth();
        try {
          await signOut(auth);
        } catch {
          /* 기존 Firebase 세션 없음 */
        }
        const { user } = await signInAnonymously(auth);
        if (!user?.uid) {
          throw new Error('가입용 인증 계정을 만들 수 없습니다.');
        }

        const nickBase = name.split(/\s+/)[0]?.trim().slice(0, 16) || '';
        const nickname = nickBase || generateRandomNickname();
        const emailTrim = emailField.trim();

        const snapshot: AuthProfileSnapshot = {
          displayName: name.slice(0, 64),
          email: emailTrim || null,
          photoUrl: null,
          firebaseUid: user.uid,
          gender: genderCode,
          birthYear: null,
        };
        setAuthProfile(snapshot);

        await applyGoogleSignupProfile(n, {
          nickname,
          photoUrl: null,
          email: emailTrim || null,
          displayName: name.slice(0, 64),
          gender: genderCode,
          birthYear: null,
          birthMonth: null,
          birthDay: null,
          firebaseUid: user.uid,
        });
        await registerPhoneIfNew(n);
        await setPhoneUserId(n);
        await ensureUserProfile(n);
        await recordTermsAgreement(n);
        onComplete();
      } catch (e) {
        const code = e && typeof e === 'object' && 'code' in e ? String((e as { code?: string }).code) : '';
        const message = e instanceof Error ? e.message : '알 수 없는 오류';
        if (code === 'auth/operation-not-allowed' || code === 'auth/admin-restricted-operation') {
          const hint =
            'Firebase 콘솔 → Authentication → 로그인 방법에서「익명」을 켠 뒤 다시 시도해 주세요.';
          setErrorText(hint);
          Alert.alert('가입 실패', hint);
        } else {
          setErrorText(`${message}${code ? ` (${code})` : ''}`);
          Alert.alert('가입 실패', code ? `${code}\n${message}` : message);
        }
      } finally {
        setBusy(false);
      }
    },
    [
      displayName,
      normalizedPhone,
      emailField,
      memberStatus,
      genderCode,
      setAuthProfile,
      setPhoneUserId,
    ],
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
