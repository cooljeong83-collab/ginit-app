import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform, ToastAndroid } from 'react-native';

import { type AuthProfileSnapshot, useUserSession } from '@/src/context/UserSessionContext';
import { normalizeUserId } from '@/src/lib/app-user-id';
import { registerPhoneIfNew, registerSignupLocalKeys } from '@/src/lib/phone-registry';
import { normalizePhoneUserId } from '@/src/lib/phone-user-id';
import { writeSecureAuthSession } from '@/src/lib/secure-auth-session';
import {
  applyGoogleSignupProfile,
  ensureUserProfile,
  generateRandomNickname,
  hasLoginableUserForPhoneE164,
  recordTermsAgreement,
} from '@/src/lib/user-profile';
import { serverTimestamp } from 'firebase/firestore';

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

/** Firestore `users.ageBand` — UI는 한글 라벨, 저장은 고정 코드 */
export type SignUpAgeBandCode = 'TEENS' | 'TWENTIES' | 'THIRTIES' | 'FORTIES' | 'FIFTIES' | 'SIXTY_PLUS';

export const SIGN_UP_AGE_BAND_OPTIONS: { code: SignUpAgeBandCode; label: string }[] = [
  { code: 'TEENS', label: '10대' },
  { code: 'TWENTIES', label: '20대' },
  { code: 'THIRTIES', label: '30대' },
  { code: 'FORTIES', label: '40대' },
  { code: 'FIFTIES', label: '50대' },
  { code: 'SIXTY_PLUS', label: '60대 이상' },
];

export function useSignUpFlow(initialPhone: string) {
  const { setUserId, setAuthProfile } = useUserSession();
  const [displayName, setDisplayName] = useState('');
  const [phoneField, setPhoneField] = useState(initialPhone);
  /** 전화 이펙트가 겹칠 때 이전 회원 조회 결과가 상태를 덮어쓰지 않게 함 */
  const memberPhoneCheckSeqRef = useRef(0);
  const [emailField, setEmailField] = useState('');
  const [memberStatus, setMemberStatus] = useState<SignUpMemberStatus>('unknown');
  const [genderCode, setGenderCode] = useState<SignUpGenderCode | null>(null);
  const [ageBandCode, setAgeBandCode] = useState<SignUpAgeBandCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    setPhoneField((prev) => (initialPhone && prev === '' ? initialPhone : prev));
  }, [initialPhone]);

  useEffect(() => {
    const mySeq = ++memberPhoneCheckSeqRef.current;
    const n = normalizePhoneUserId(phoneField);
    if (!n) {
      setMemberStatus('unknown');
      return;
    }
    const digitsOnly = phoneField.replace(/\D/g, '');
    /** 11자리 완성 시에는 바로 조회(인증번호 받기가 `guest`까지 기다리지 않게) */
    const delay = digitsOnly.length === 11 ? 0 : PHONE_MEMBER_CHECK_DEBOUNCE_MS;
    /** 입력 중 매 키마다 `checking`으로 리렌더하면 RN Web 등에서 전화 입력 값이 깨지는 경우가 있어,
     *  `checking`은 디바운스 타이머 안에서만 설정합니다. */
    const snapshotN = n;
    const t = setTimeout(() => {
      if (memberPhoneCheckSeqRef.current !== mySeq) return;
      setMemberStatus('checking');
      void (async () => {
        try {
          const MEMBER_CHECK_TIMEOUT_MS = 8000;
          const race = await Promise.race([
            hasLoginableUserForPhoneE164(snapshotN).then((v) => ({ kind: 'ok' as const, v })),
            new Promise<{ kind: 'timeout' }>((resolve) => setTimeout(() => resolve({ kind: 'timeout' }), MEMBER_CHECK_TIMEOUT_MS)),
          ]);
          if (memberPhoneCheckSeqRef.current !== mySeq) return;
          if (race.kind === 'timeout') {
            setMemberStatus('unknown');
            return;
          }
          setMemberStatus(race.v ? 'member' : 'guest');
        } catch {
          if (memberPhoneCheckSeqRef.current === mySeq) {
            setMemberStatus('unknown');
          }
        }
      })();
    }, delay);
    return () => {
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
    if (!ageBandCode) return false;
    return true;
  }, [emailField, displayName, normalizedPhone, memberStatus, genderCode, ageBandCode]);

  const selectGenderCode = useCallback((code: SignUpGenderCode) => {
    setGenderCode(code);
    setErrorText(null);
  }, []);

  const selectAgeBandCode = useCallback((code: SignUpAgeBandCode) => {
    setAgeBandCode(code);
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
      if (!ageBandCode) {
        const msg = '연령대를 선택해주세요.';
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
          ageBand: ageBandCode,
          birthYear: null,
        };
        setAuthProfile(snapshot);

        await applyGoogleSignupProfile(emailPk, {
          nickname,
          photoUrl: null,
          phone: n,
          phoneVerifiedAt: serverTimestamp(),
          email: emailTrim || null,
          displayName: name.slice(0, 64),
          signupProvider: 'phone_otp',
          gender: genderCode,
          ageBand: ageBandCode,
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
    [displayName, normalizedPhone, emailField, memberStatus, genderCode, ageBandCode, setAuthProfile, setUserId],
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
    ageBandCode,
    selectAgeBandCode,
    memberStatus,
    busy,
    errorText,
    canSubmit,
    runSignUp,
  };
}
