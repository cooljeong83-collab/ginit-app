import { useRouter } from 'expo-router';
import { serverTimestamp, Timestamp } from 'firebase/firestore';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  ToastAndroid,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BirthdateWheel } from '@/components/auth/BirthdateWheel';
import { authScreenStyles as authFormStyles } from '@/components/auth/authScreenStyles';
import { GinitButton } from '@/components/ginit';
import { GinitTheme } from '@/constants/ginit-theme';
import { useOtpSmsRetriever } from '@/src/hooks/useOtpSmsRetriever';
import { type SignUpGenderCode } from '@/src/hooks/useSignUpFlow';
import { normalizeUserId } from '@/src/lib/app-user-id';
import { getFirebaseAuth } from '@/src/lib/firebase';
import { fetchGooglePeopleExtras, mapGooglePeopleGenderToProfileGender } from '@/src/lib/google-people-extras';
import { addGooglePeopleScopesAndGetAccessToken, REDIRECT_STARTED, signInWithGoogle } from '@/src/lib/google-sign-in';
import { MEETING_PHONE_VERIFICATION_UI_ENABLED } from '@/src/lib/meeting-phone-verification-ui';
import { requestPhoneNumberHint } from '@/src/lib/phone-number-hint';
import { formatNormalizedPhoneKrDisplay, normalizePhoneUserId } from '@/src/lib/phone-user-id';
import { syncMeetingComplianceToSupabase, syncMeetingDemographicsToSupabase } from '@/src/lib/supabase-profile-compliance';
import {
  buildGooglePeopleDemographicsMetadataPatch,
  ensureUserProfile,
  firestoreTimestampLikeToDate,
  isDemographicsIncomplete,
  isMeetingServiceComplianceComplete,
  isUserPhoneVerified,
  meetingDemographicsIncomplete,
  readGooglePeopleDemographicsLocks,
  updateUserProfile,
  type UserProfile,
} from '@/src/lib/user-profile';
import { AuthService } from '@/src/services/AuthService';

export type MeetingServiceAuthModalProps = {
  visible: boolean;
  onRequestClose: () => void;
  profilePk: string;
  onAfterComplianceSuccess?: () => void | Promise<void>;
};

function isFirebaseGoogleLinked(): boolean {
  try {
    const u = getFirebaseAuth().currentUser;
    if (!u || u.isAnonymous) return false;
    return u.providerData.some((p) => p.providerId === 'google.com');
  } catch {
    return false;
  }
}

/**
 * 프로필·설정 등에서 공통으로 쓰는「서비스 이용 인증」전체 화면 모달.
 */
export function MeetingServiceAuthModal({
  visible,
  onRequestClose,
  profilePk,
  onAfterComplianceSuccess,
}: MeetingServiceAuthModalProps) {
  const router = useRouter();
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const [profileBusy] = useState(false);
  const [genderDemo, setGenderDemo] = useState<SignUpGenderCode | null>(null);
  const [birthDemo, setBirthDemo] = useState<{ year: number; month: number; day: number }>(() => ({
    year: 1983,
    month: 1,
    day: 1,
  }));
  const [verifiedPhoneLabel, setVerifiedPhoneLabel] = useState<string | null>(null);
  const [isPhoneVerified, setIsPhoneVerified] = useState(false);
  const [phoneField, setPhoneField] = useState('');
  const [otpVerificationId, setOtpVerificationId] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const otpAutoConfirmRef = useRef(false);
  const [meetingAuthComplete, setMeetingAuthComplete] = useState(false);
  const [complianceBusy, setComplianceBusy] = useState(false);
  const [googleDemographicsBusy, setGoogleDemographicsBusy] = useState(false);
  const [hydratedProfile, setHydratedProfile] = useState<UserProfile | null>(null);
  const [googleDemoGenderLocked, setGoogleDemoGenderLocked] = useState(false);
  const [googleDemoBirthLocked, setGoogleDemoBirthLocked] = useState(false);
  const [profileHasStoredGender, setProfileHasStoredGender] = useState(false);
  const [profileHasStoredBirth, setProfileHasStoredBirth] = useState(false);

  const authSheetLayout = useMemo(() => {
    const panelMax = Math.floor(windowHeight * 0.96);
    const panelPadBottom = Math.max(16, insets.bottom);
    const scrollMax = Math.max(280, panelMax - 18 - panelPadBottom - 12);
    return { panelMax, panelPadBottom, scrollMax };
  }, [windowHeight, insets.bottom]);

  const pk = profilePk.trim();

  const otpSmsUserConsent = useOtpSmsRetriever({
    onCode: (code) => setOtpCode(code.replace(/\D/g, '').slice(0, 6)),
  });

  useEffect(() => {
    if (!visible) otpSmsUserConsent.stop();
  }, [visible, otpSmsUserConsent]);

  useEffect(() => {
    if (!otpVerificationId) otpSmsUserConsent.stop();
  }, [otpVerificationId, otpSmsUserConsent]);

  useEffect(() => {
    if (otpCode.replace(/\D/g, '').length >= 6) otpSmsUserConsent.stop();
  }, [otpCode, otpSmsUserConsent]);

  useEffect(() => {
    if (!visible || !pk) return;
    let alive = true;
    void (async () => {
      try {
        const p = await ensureUserProfile(pk);
        if (!alive) return;
        setHydratedProfile(p);
        const complete = isMeetingServiceComplianceComplete(p, pk);
        setMeetingAuthComplete(complete);

        const authPhone = getFirebaseAuth().currentUser?.phoneNumber?.trim() ?? '';
        const phone = p.phone?.trim() || authPhone;
        setIsPhoneVerified(isUserPhoneVerified(p) || !!authPhone);
        const phoneDisplayRaw = phone ? formatNormalizedPhoneKrDisplay(phone) : '';
        const phoneDigits = phoneDisplayRaw.replace(/\D/g, '').slice(0, 11);
        const phoneDisplay =
          phoneDigits.length <= 3
            ? phoneDigits
            : phoneDigits.length <= 7
              ? `${phoneDigits.slice(0, 3)}-${phoneDigits.slice(3)}`
              : `${phoneDigits.slice(0, 3)}-${phoneDigits.slice(3, 7)}-${phoneDigits.slice(7)}`;
        setVerifiedPhoneLabel(phoneDisplay ? phoneDisplay : null);
        setPhoneField(phoneDisplay);

        if (MEETING_PHONE_VERIFICATION_UI_ENABLED && Platform.OS === 'android' && !isUserPhoneVerified(p) && !phone) {
          const hintedE164 = await requestPhoneNumberHint();
          if (!alive) return;
          if (hintedE164) {
            const rawDisplay = formatNormalizedPhoneKrDisplay(hintedE164);
            const d = rawDisplay.replace(/\D/g, '').slice(0, 11);
            const hintedFormatted =
              d.length <= 3
                ? d
                : d.length <= 7
                  ? `${d.slice(0, 3)}-${d.slice(3)}`
                  : `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
            if (hintedFormatted) setPhoneField(hintedFormatted);
          }
        }

        const gRaw = p.gender?.trim() ?? '';
        const gNorm =
          gRaw === 'MALE' || gRaw === 'FEMALE' ? gRaw : mapGooglePeopleGenderToProfileGender(gRaw);
        setGenderDemo(gNorm);

        const locks = readGooglePeopleDemographicsLocks(p);
        setGoogleDemoGenderLocked(locks.genderLocked);
        setGoogleDemoBirthLocked(locks.birthLocked);

        setProfileHasStoredGender(Boolean(p.gender?.trim()));
        const bdDateForLock = firestoreTimestampLikeToDate(p.birthDate);
        setProfileHasStoredBirth(
          Boolean(bdDateForLock) ||
            (typeof p.birthYear === 'number' &&
              Number.isFinite(p.birthYear) &&
              typeof p.birthMonth === 'number' &&
              Number.isFinite(p.birthMonth) &&
              typeof p.birthDay === 'number' &&
              Number.isFinite(p.birthDay)),
        );

        const bdDate = firestoreTimestampLikeToDate(p.birthDate);
        if (bdDate) {
          setBirthDemo({
            year: bdDate.getFullYear(),
            month: bdDate.getMonth() + 1,
            day: bdDate.getDate(),
          });
        } else {
          const y = typeof p.birthYear === 'number' ? p.birthYear : null;
          const m = typeof p.birthMonth === 'number' ? p.birthMonth : null;
          const d = typeof p.birthDay === 'number' ? p.birthDay : null;
          if (y) {
            setBirthDemo({ year: y, month: m ?? 1, day: d ?? 1 });
          }
        }
      } catch {
        if (!alive) return;
        setHydratedProfile(null);
        setMeetingAuthComplete(false);
        setGoogleDemoGenderLocked(false);
        setGoogleDemoBirthLocked(false);
        setProfileHasStoredGender(false);
        setProfileHasStoredBirth(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [visible, pk]);

  const showGoogleDemographicsCta = useMemo(() => {
    return (
      !meetingAuthComplete &&
      isFirebaseGoogleLinked() &&
      hydratedProfile != null &&
      isDemographicsIncomplete(hydratedProfile)
    );
  }, [meetingAuthComplete, hydratedProfile]);

  const persistMeetingComplianceCore = useCallback(
    async (args: {
      gender: SignUpGenderCode | null;
      birth: { year: number; month: number; day: number };
      metadata?: Record<string, unknown> | null;
      skipConfirmDialog?: boolean;
    }) => {
      if (!pk) {
        Alert.alert('안내', '로그인 후 진행할 수 있어요.');
        return;
      }

      if (!args.skipConfirmDialog) {
        const ok = await new Promise<boolean>((resolve) => {
          Alert.alert(
            '저장 전 확인',
            '모임 이용을 위한 인증정보는 한 번 저장하면 이후 변경할 수 없어요.\n\n계속 저장할까요?',
            [
              { text: '취소', style: 'cancel', onPress: () => resolve(false) },
              { text: '저장', style: 'destructive', onPress: () => resolve(true) },
            ],
          );
        });
        if (!ok) return;
      }

      const p0 = await ensureUserProfile(pk);
      if (isDemographicsIncomplete(p0)) {
        if (!args.gender || !args.birth.year || !args.birth.month || !args.birth.day) {
          Alert.alert('입력 확인', '성별과 생년월일을 모두 선택해 주세요.');
          return;
        }
      }
      if (MEETING_PHONE_VERIFICATION_UI_ENABLED && !isPhoneVerified) {
        Alert.alert('전화 인증', '전화번호 인증을 먼저 완료해 주세요.');
        return;
      }
      setComplianceBusy(true);
      try {
        const compliancePatch: Parameters<typeof updateUserProfile>[1] = { termsAgreedAt: serverTimestamp() };
        if (
          pk.includes('@') &&
          (p0.signupProvider == null || String(p0.signupProvider).trim() === '') &&
          meetingDemographicsIncomplete(p0, pk)
        ) {
          compliancePatch.signupProvider = 'google_sns';
        }
        if (args.gender) {
          compliancePatch.gender = args.gender;
        }
        if (args.birth.year && args.birth.month && args.birth.day) {
          compliancePatch.birthDate = Timestamp.fromDate(
            new Date(args.birth.year, args.birth.month - 1, args.birth.day),
          );
        }
        if (args.metadata && Object.keys(args.metadata).length > 0) {
          compliancePatch.metadata = args.metadata;
        }
        await updateUserProfile(pk, compliancePatch);
        let p = await ensureUserProfile(pk);
        if (!p.gender && args.gender) {
          await updateUserProfile(pk, { gender: args.gender });
          p = await ensureUserProfile(pk);
        }
        const phoneE164 = p.phone?.trim() ?? normalizePhoneUserId(phoneField)?.trim() ?? '';
        if (MEETING_PHONE_VERIFICATION_UI_ENABLED) {
          if (!phoneE164 || !phoneE164.startsWith('+')) {
            throw new Error('전화번호 정보를 찾지 못했습니다.');
          }
        }
        const verifiedDate = firestoreTimestampLikeToDate(p.phoneVerifiedAt);
        const termsDate = firestoreTimestampLikeToDate(p.termsAgreedAt) ?? new Date();
        const nicknameForSync = p.nickname?.trim() ?? '';
        const sync = await syncMeetingComplianceToSupabase({
          appUserId: pk,
          nickname: nicknameForSync,
          phoneE164: phoneE164.startsWith('+') ? phoneE164 : '',
          phoneVerifiedAtIso: verifiedDate ? verifiedDate.toISOString() : null,
          termsAgreedAtIso: termsDate.toISOString(),
        });
        if (!sync.ok) {
          Alert.alert('동기화 안내', `Supabase 반영에 실패했어요. 잠시 후 다시 시도해 주세요.\n${sync.message}`);
        }

        if (args.gender && args.birth.year && args.birth.month && args.birth.day) {
          const demoSync = await syncMeetingDemographicsToSupabase({
            appUserId: pk,
            gender: args.gender,
            birthYear: args.birth.year,
            birthMonth: args.birth.month,
            birthDay: args.birth.day,
          });
          if (!demoSync.ok) {
            Alert.alert('동기화 안내', `성별/생년월일 반영에 실패했어요. 잠시 후 다시 시도해 주세요.\n${demoSync.message}`);
          }
        }
        setHydratedProfile(p);
        setMeetingAuthComplete(isMeetingServiceComplianceComplete(p, pk));
        await onAfterComplianceSuccess?.();
        onRequestClose();
        const doneMsg = '이제 모든 모임 기능을 이용할 수 있습니다';
        if (Platform.OS === 'android') ToastAndroid.show(doneMsg, ToastAndroid.LONG);
        else Alert.alert('완료', doneMsg);
      } catch (e) {
        const msg = e instanceof Error ? e.message : '저장에 실패했습니다.';
        Alert.alert('저장 실패', msg);
      } finally {
        setComplianceBusy(false);
      }
    },
    [pk, isPhoneVerified, phoneField, onAfterComplianceSuccess, onRequestClose],
  );

  const onSubmitMeetingCompliance = useCallback(async () => {
    await persistMeetingComplianceCore({
      gender: genderDemo,
      birth: birthDemo,
      skipConfirmDialog: false,
    });
  }, [persistMeetingComplianceCore, genderDemo, birthDemo]);

  const onGoogleDemographicsImport = useCallback(async () => {
    if (!pk) {
      Alert.alert('안내', '로그인 후 진행할 수 있어요.');
      return;
    }
    if (!isFirebaseGoogleLinked()) {
      Alert.alert('안내', 'Google로 로그인한 계정에서만 사용할 수 있어요.');
      return;
    }
    const p0 = await ensureUserProfile(pk);
    if (MEETING_PHONE_VERIFICATION_UI_ENABLED && !isPhoneVerified) {
      Alert.alert('전화 인증', '전화번호 인증을 먼저 완료해 주세요.');
      return;
    }
    setGoogleDemographicsBusy(true);
    try {
      let googleAccessToken: string | null = null;
      if (Platform.OS !== 'web') {
        googleAccessToken = await addGooglePeopleScopesAndGetAccessToken();
      } else {
        const { user, googleAccessToken: at } = await signInWithGoogle({
          forRegistration: true,
          promptSelectAccount: false,
        });
        googleAccessToken = at;
        const email = user.email?.trim() ?? '';
        const emailPk = email ? normalizeUserId(email) : null;
        if (!emailPk || emailPk !== pk) {
          Alert.alert(
            '계정 확인',
            '현재 이 프로필과 동일한 Google 계정으로 다시 로그인해 주세요.',
          );
          return;
        }
      }
      if (Platform.OS !== 'web') {
        const u = getFirebaseAuth().currentUser;
        const email = u?.email?.trim() ?? '';
        const emailPk = email ? normalizeUserId(email) : null;
        if (!emailPk || emailPk !== pk) {
          Alert.alert(
            '계정 확인',
            '현재 이 프로필과 동일한 Google 계정으로 로그인돼 있어야 해요.',
          );
          return;
        }
      }
      const people = await fetchGooglePeopleExtras(googleAccessToken);
      const genderFs = mapGooglePeopleGenderToProfileGender(people?.gender ?? null);
      const py = people?.birthYear ?? null;
      const pm = people?.birthMonth ?? null;
      const pd = people?.birthDay ?? null;
      if (!genderFs || py == null || pm == null || pd == null) {
        Alert.alert(
          'Google 정보',
          '성별과 생년월일을 Google에서 받지 못했어요. Google 계정에 정보가 있고, 동의 화면에서 모두 허용했는지 확인해 주세요.',
        );
        return;
      }
      const googleDemoMeta = buildGooglePeopleDemographicsMetadataPatch({
        genderFromGoogle: true,
        birthFromGoogle: true,
      });
      setGenderDemo(genderFs);
      setBirthDemo({ year: py, month: pm, day: pd });
      await persistMeetingComplianceCore({
        gender: genderFs,
        birth: { year: py, month: pm, day: pd },
        metadata: Object.keys(googleDemoMeta).length > 0 ? googleDemoMeta : null,
        skipConfirmDialog: true,
      });
    } catch (e) {
      const code = e && typeof e === 'object' && 'code' in e ? String((e as { code?: string }).code) : '';
      if (code === REDIRECT_STARTED) return;
      const msg = e instanceof Error ? e.message : 'Google 연동에 실패했습니다.';
      Alert.alert('Google 연동 실패', msg);
    } finally {
      setGoogleDemographicsBusy(false);
    }
  }, [pk, isPhoneVerified, persistMeetingComplianceCore]);

  const canSendOtp = useMemo(() => {
    const normalized = normalizePhoneUserId(phoneField);
    return !!pk && !!normalized && !profileBusy && !otpBusy && !complianceBusy && !googleDemographicsBusy;
  }, [pk, phoneField, profileBusy, otpBusy, complianceBusy, googleDemographicsBusy]);

  const canConfirmOtp = useMemo(() => {
    return (
      !!pk &&
      !!otpVerificationId &&
      otpCode.replace(/\D/g, '').length === 6 &&
      !profileBusy &&
      !otpBusy &&
      !complianceBusy &&
      !googleDemographicsBusy
    );
  }, [pk, otpVerificationId, otpCode, profileBusy, otpBusy, complianceBusy, googleDemographicsBusy]);

  const onSendOtp = useCallback(async () => {
    if (!pk) {
      Alert.alert('안내', '로그인 후 인증할 수 있어요.');
      return;
    }
    const normalized = normalizePhoneUserId(phoneField);
    if (!normalized) {
      Alert.alert('입력 확인', '전화번호를 정확히 입력해 주세요.');
      return;
    }
    otpSmsUserConsent.stop();
    setOtpError(null);
    setOtpBusy(true);
    try {
      const { verificationId } = await AuthService.verifyPhoneNumber(normalized);
      setOtpVerificationId(verificationId);
      setOtpCode('');
      // Firebase verifyPhoneNumber가 이미 Android SMS User Consent를 사용하므로,
      // 여기서 react-native-sms-user-consent를 다시 시작하면 Play 서비스와 충돌해 프로세스가 종료될 수 있음.
      if (Platform.OS === 'android') ToastAndroid.show('인증번호를 전송했어요.', ToastAndroid.SHORT);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '인증번호 전송에 실패했습니다.';
      setOtpError(msg);
      Alert.alert('인증 실패', msg);
    } finally {
      setOtpBusy(false);
    }
  }, [pk, phoneField, otpSmsUserConsent]);

  const onConfirmOtp = useCallback(async () => {
    if (!pk) {
      Alert.alert('안내', '로그인 후 인증할 수 있어요.');
      return;
    }
    if (!otpVerificationId) return;
    const normalized = normalizePhoneUserId(phoneField);
    if (!normalized) {
      Alert.alert('입력 확인', '전화번호를 정확히 입력해 주세요.');
      return;
    }
    const code = otpCode.replace(/\D/g, '').slice(0, 6);
    if (code.length !== 6) {
      Alert.alert('입력 확인', '인증번호 6자리를 입력해 주세요.');
      return;
    }
    setOtpError(null);
    setOtpBusy(true);
    try {
      await AuthService.linkPhoneWithCode(otpVerificationId, code);
      await updateUserProfile(pk, {
        phone: normalized,
        phoneVerifiedAt: serverTimestamp(),
      });
      const label = formatNormalizedPhoneKrDisplay(normalized);
      setIsPhoneVerified(true);
      setVerifiedPhoneLabel(label);
      setOtpVerificationId(null);
      setOtpCode('');
      if (Platform.OS === 'android') ToastAndroid.show('전화번호 인증이 완료됐어요.', ToastAndroid.SHORT);
      else Alert.alert('인증 완료', '전화번호 인증이 완료됐어요.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : '인증 확인에 실패했습니다.';
      setOtpError(msg);
      Alert.alert('인증 실패', msg);
    } finally {
      setOtpBusy(false);
    }
  }, [pk, otpVerificationId, otpCode, phoneField]);

  useEffect(() => {
    if (!otpVerificationId) {
      otpAutoConfirmRef.current = false;
      return;
    }
    const digits = otpCode.replace(/\D/g, '').slice(0, 6);
    if (digits.length < 6) {
      otpAutoConfirmRef.current = false;
      return;
    }
    if (otpAutoConfirmRef.current) return;
    if (!canConfirmOtp) return;
    otpAutoConfirmRef.current = true;
    void onConfirmOtp();
  }, [otpCode, otpVerificationId, canConfirmOtp, onConfirmOtp]);

  if (!pk) return null;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={() => {
        if (!complianceBusy && !googleDemographicsBusy) onRequestClose();
      }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
        style={styles.sheetKbWrap}>
        <View style={styles.sheetRoot}>
          <Pressable
            style={styles.sheetBackdropFill}
            onPress={() => {
              if (!complianceBusy && !googleDemographicsBusy) onRequestClose();
            }}
            accessibilityRole="button"
            accessibilityLabel="닫기"
          />
          <View style={styles.sheetCenterWrap} pointerEvents="box-none">
            <View
              style={[
                styles.sheetPanel,
                { maxHeight: authSheetLayout.panelMax, paddingBottom: authSheetLayout.panelPadBottom },
              ]}>
              <ScrollView
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                style={{ maxHeight: authSheetLayout.scrollMax }}
                contentContainerStyle={styles.sheetScrollContent}>
                <Text style={styles.sheetTitle}>서비스 이용 인증</Text>
                <Text style={styles.sheetLead}>
                  {meetingAuthComplete
                    ? '이용 인증이 완료된 계정이에요. 아래에서 등록된 정보를 확인할 수 있어요.'
                    : MEETING_PHONE_VERIFICATION_UI_ENABLED
                      ? '모임 만들기·참여를 위해 정보 수집 동의와 전화번호 인증이 필요해요.'
                      : '모임 만들기·참여를 위해 정보 수집 동의와 필수 프로필 정보 입력이 필요해요.'}
                </Text>
                {(googleDemoGenderLocked ||
                  googleDemoBirthLocked ||
                  profileHasStoredGender ||
                  profileHasStoredBirth) &&
                !meetingAuthComplete ? (
                  <Text style={styles.sheetGoogleLockHint}>
                    Google에서 동의해 받은 정보 또는 이미 프로필에 저장된 성별·생년월일은 수정할 수 없어요.
                  </Text>
                ) : null}

                {showGoogleDemographicsCta ? (
                  <Text style={styles.googleCtaHint}>
                    Google에서 생년월일·성별 제공에 동의하면 바로 저장되고 모임 인증이 완료돼요.
                  </Text>
                ) : null}

                {!meetingAuthComplete &&
                hydratedProfile &&
                isDemographicsIncomplete(hydratedProfile) &&
                !isFirebaseGoogleLinked() ? (
                  <View style={{ marginBottom: 12 }}>
                    <Text style={styles.googleCtaHint}>
                      성별·생년월일은 프로필 편집에서 입력한 뒤, 아래에서 저장을 진행해 주세요.
                    </Text>
                    <Pressable
                      onPress={() => {
                        if (!complianceBusy && !googleDemographicsBusy) {
                          onRequestClose();
                          router.push('/profile/edit');
                        }
                      }}
                      disabled={complianceBusy || googleDemographicsBusy}
                      style={({ pressed }) => [styles.profileEditLink, pressed && styles.pressed]}
                      accessibilityRole="button"
                      accessibilityLabel="프로필 편집으로 이동">
                      <Text style={styles.profileEditLinkText}>프로필 편집으로 이동</Text>
                    </Pressable>
                  </View>
                ) : null}

                <View
                  style={[styles.termsRow, styles.termsRowLocked]}
                  accessibilityRole="text"
                  accessibilityLabel="모임 이용 정보 수집 및 이용 동의 필수 항목, 동의됨">
                  <View style={[styles.termsBox, styles.termsBoxChecked]}>
                    <Text style={styles.termsCheckMark}>✓</Text>
                  </View>
                  <Text style={[styles.termsLabel, styles.termsLabelLocked]}>
                    모임 이용 정보 수집 및 이용 동의 (필수)
                  </Text>
                </View>

                {!showGoogleDemographicsCta ? (
                  <>
                    <Text style={[styles.label, { marginTop: 14 }]}>성별 (필수)</Text>
                    <View style={authFormStyles.genderBinaryWrap} accessibilityRole="radiogroup" accessibilityLabel="성별 선택">
                      {(
                        [
                          { code: 'MALE' as const, label: '남자' },
                          { code: 'FEMALE' as const, label: '여자' },
                        ] as const
                      ).map(({ code, label }) => {
                        const selected = genderDemo === code;
                        return (
                          <Pressable
                            key={code}
                            disabled={
                              profileBusy ||
                              complianceBusy ||
                              googleDemographicsBusy ||
                              meetingAuthComplete ||
                              googleDemoGenderLocked ||
                              profileHasStoredGender
                            }
                            onPress={() => setGenderDemo(code)}
                            style={({ pressed }) => [
                              authFormStyles.genderBinaryBtn,
                              selected ? authFormStyles.genderBinaryBtnSelected : authFormStyles.genderBinaryBtnIdle,
                              pressed &&
                                !(
                                  profileBusy ||
                                  complianceBusy ||
                                  googleDemographicsBusy ||
                                  meetingAuthComplete ||
                                  googleDemoGenderLocked ||
                                  profileHasStoredGender
                                ) &&
                                authFormStyles.pressed,
                            ]}
                            accessibilityRole="radio"
                            accessibilityState={{ selected, checked: selected }}
                            accessibilityLabel={label}>
                            <Text style={selected ? authFormStyles.genderBinaryLabelSelected : authFormStyles.genderBinaryLabel}>
                              {label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    <Text style={[styles.label, { marginTop: 14 }]}>생년월일 (필수)</Text>
                    <BirthdateWheel
                      value={birthDemo}
                      onChange={setBirthDemo}
                      disabled={
                        profileBusy ||
                        complianceBusy ||
                        googleDemographicsBusy ||
                        meetingAuthComplete ||
                        googleDemoBirthLocked ||
                        profileHasStoredBirth
                      }
                    />
                  </>
                ) : null}

                {MEETING_PHONE_VERIFICATION_UI_ENABLED ? (
                  <>
                    <Text style={[styles.label, { marginTop: 16 }]}>전화번호 인증 (필수)</Text>
                    {isPhoneVerified ? (
                      <Text style={styles.phoneVerifiedDone}>
                        전화번호 인증 완료{verifiedPhoneLabel ? ` · ${verifiedPhoneLabel}` : ''}
                      </Text>
                    ) : (
                      <>
                        <Text style={styles.subHint}>
                          {isPhoneVerified
                            ? `인증 완료${verifiedPhoneLabel ? ` · ${verifiedPhoneLabel}` : ''}`
                            : '아직 인증되지 않았어요.'}
                        </Text>
                        <View style={styles.otpBlock}>
                          <Text style={styles.otpLabel}>전화번호</Text>
                          <View style={styles.otpRow}>
                            <TextInput
                              value={phoneField}
                              onChangeText={(t) => {
                                const digits = t.replace(/\D/g, '').slice(0, 11);
                                const v =
                                  digits.length <= 3
                                    ? digits
                                    : digits.length <= 7
                                      ? `${digits.slice(0, 3)}-${digits.slice(3)}`
                                      : `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
                                setPhoneField(v);
                              }}
                              placeholder="010-1234-5678"
                              placeholderTextColor="#94a3b8"
                              style={styles.otpPhoneInput}
                              keyboardType="phone-pad"
                              inputMode="tel"
                              editable={!otpBusy && !profileBusy && !complianceBusy && !isPhoneVerified}
                            />
                            <Pressable
                              onPress={() => void onSendOtp()}
                              disabled={!canSendOtp || isPhoneVerified}
                              style={({ pressed }) => [
                                styles.otpSendBtn,
                                (!canSendOtp || isPhoneVerified) && styles.otpBtnDisabled,
                                pressed && canSendOtp && !isPhoneVerified && styles.pressed,
                              ]}
                              accessibilityRole="button"
                              accessibilityLabel="인증번호 받기">
                              <Text style={styles.otpSendText}>{otpBusy ? '전송 중…' : '인증번호 받기'}</Text>
                            </Pressable>
                          </View>

                          {otpVerificationId ? (
                            <View style={[styles.otpRow, { marginTop: 8 }]}>
                              <TextInput
                                value={otpCode}
                                onChangeText={(t) => setOtpCode(t.replace(/\D/g, '').slice(0, 6))}
                                placeholder="인증번호 6자리"
                                placeholderTextColor="#94a3b8"
                                style={styles.otpCodeInput}
                                keyboardType="number-pad"
                                inputMode="numeric"
                                textContentType="oneTimeCode"
                                editable={!otpBusy && !profileBusy && !complianceBusy}
                              />
                              <Pressable
                                onPress={() => void onConfirmOtp()}
                                disabled={!canConfirmOtp}
                                style={({ pressed }) => [
                                  styles.otpConfirmBtn,
                                  !canConfirmOtp && styles.otpBtnDisabled,
                                  pressed && canConfirmOtp && styles.pressed,
                                ]}
                                accessibilityRole="button"
                                accessibilityLabel="인증 확인">
                                <Text style={styles.otpConfirmText}>{otpBusy ? '확인 중…' : '확인'}</Text>
                              </Pressable>
                            </View>
                          ) : null}

                          {otpError ? <Text style={styles.otpError}>{otpError}</Text> : null}
                        </View>
                      </>
                    )}
                  </>
                ) : null}

                {showGoogleDemographicsCta ? (
                  <GinitButton
                    title={googleDemographicsBusy ? 'Google 연동 중…' : 'Google 인증하기'}
                    variant="primary"
                    onPress={() => void onGoogleDemographicsImport()}
                    disabled={complianceBusy || googleDemographicsBusy || otpBusy || profileBusy}
                  />
                ) : null}

                {!meetingAuthComplete && !showGoogleDemographicsCta ? (
                  <GinitButton
                    title={complianceBusy ? '저장 중…' : '인증 및 정보 저장'}
                    variant="primary"
                    onPress={() => void onSubmitMeetingCompliance()}
                    disabled={complianceBusy || googleDemographicsBusy || otpBusy || profileBusy}
                  />
                ) : null}
              </ScrollView>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheetKbWrap: {
    flex: 1,
  },
  sheetRoot: {
    flex: 1,
  },
  sheetBackdropFill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  sheetCenterWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  sheetPanel: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.98)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.65)',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 12,
  },
  sheetScrollContent: {
    paddingBottom: 4,
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#0f172a',
    marginBottom: 6,
  },
  sheetLead: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748b',
    lineHeight: 20,
    marginBottom: 14,
  },
  sheetGoogleLockHint: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748b',
    lineHeight: 19,
    marginBottom: 12,
  },
  googleCtaHint: {
    fontSize: 13,
    fontWeight: '600',
    color: GinitTheme.themeMainColor,
    lineHeight: 19,
    marginBottom: 10,
  },
  profileEditLink: {
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  profileEditLinkText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0052CC',
    textDecorationLine: 'underline',
  },
  termsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  termsRowLocked: {
    opacity: 0.92,
  },
  termsBox: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  termsBoxUnchecked: {
    borderColor: '#FF8A00',
    backgroundColor: 'rgba(255, 138, 0, 0.08)',
  },
  termsBoxChecked: {
    borderColor: '#0052CC',
    backgroundColor: 'rgba(0, 82, 204, 0.12)',
  },
  termsCheckMark: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0052CC',
  },
  termsLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
    lineHeight: 20,
  },
  termsLabelLocked: {
    color: '#64748b',
  },
  phoneVerifiedDone: {
    marginTop: 6,
    fontSize: 15,
    fontWeight: '600',
    color: '#0f766e',
    lineHeight: 22,
  },
  subHint: {
    fontSize: 12,
    color: '#94a3b8',
    marginBottom: 6,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
    marginTop: 12,
    marginBottom: 4,
  },
  otpBlock: {
    marginTop: 10,
    padding: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  otpLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0f172a',
    marginBottom: 8,
  },
  otpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  otpPhoneInput: {
    flex: 1,
    minHeight: 46,
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    color: '#0f172a',
    fontWeight: '600',
  },
  otpCodeInput: {
    flex: 1,
    minHeight: 46,
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    color: '#0f172a',
    fontWeight: '600',
    letterSpacing: 2,
  },
  otpSendBtn: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    backgroundColor: 'rgba(0, 82, 204, 0.16)',
  },
  otpSendText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#061a3b',
  },
  otpConfirmBtn: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    backgroundColor: 'rgba(255, 138, 0, 0.14)',
  },
  otpConfirmText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#7c2d12',
  },
  otpBtnDisabled: {
    opacity: 0.5,
  },
  otpError: {
    marginTop: 8,
    color: '#b91c1c',
    fontSize: 12,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.85,
  },
});
