import { GinitPressable } from '@/components/ui/GinitPressable';
import { serverTimestamp, Timestamp } from '@/src/lib/ginit-timestamp';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, ToastAndroid, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BirthdateWheel } from '@/components/auth/BirthdateWheel';
import { authScreenStyles as authFormStyles } from '@/components/auth/authScreenStyles';
import { GinitButton } from '@/components/ginit';
import { GinitTheme } from '@/constants/ginit-theme';
import { useOtpSmsRetriever } from '@/src/hooks/useOtpSmsRetriever';
import { type SignUpGenderCode } from '@/src/hooks/useSignUpFlow';
import { normalizeUserId } from '@/src/lib/app-user-id';
import { mapGooglePeopleGenderToProfileGender } from '@/src/lib/google-people-extras';
import {
  googlePeopleDemographicsFailureMessage,
  googlePeopleDemographicsPartialSavedMessage,
  type GooglePeopleDemographicField,
  importGooglePeopleDemographicsWithIncrementalConsent,
  profileHasCompleteBirth,
  profileHasCompleteGender,
  REDIRECT_STARTED,
} from '@/src/lib/google-people-demographics-consent';
import { MEETING_PHONE_VERIFICATION_UI_ENABLED } from '@/src/lib/meeting-phone-verification-ui';
import { requestPhoneNumberHint } from '@/src/lib/phone-number-hint';
import { formatNormalizedPhoneKrDisplay, normalizePhoneUserId } from '@/src/lib/phone-user-id';
import { useTransitionRouter } from '@/src/lib/screen-transition-navigation';
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
import { supabase } from '@/src/lib/supabase';
import { presentGooglePeopleDemographicsSupportDialog } from '@/src/features/support/support-inquiry-google-auth';
import { presentAppDialogAlert, presentAppDialogConfirm } from '@/src/lib/app-dialog-present';

export type MeetingServiceAuthModalProps = {
  visible: boolean;
  onRequestClose: () => void;
  profilePk: string;
  onAfterComplianceSuccess?: () => void | Promise<void>;
};

/**
 * 프로필·설정 등에서 공통으로 쓰는「서비스 이용 인증」전체 화면 모달.
 */
export function MeetingServiceAuthModal({
  visible,
  onRequestClose,
  profilePk,
  onAfterComplianceSuccess,
}: MeetingServiceAuthModalProps) {
  const router = useTransitionRouter();
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const presentGoogleDemographicsInquiryDialog = useCallback(
    (
      title: string,
      body: string,
      stillMissing: readonly GooglePeopleDemographicField[],
    ) => {
      if (!pk.trim()) {
        presentAppDialogAlert({ title, body });
        return;
      }
      presentGooglePeopleDemographicsSupportDialog(router, {
        appUserId: pk,
        title,
        body,
        stillMissing,
      });
    },
    [pk, router],
  );

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
  const [hydratingProfile, setHydratingProfile] = useState(false);
  const [googleDemoGenderLocked, setGoogleDemoGenderLocked] = useState(false);
  const [googleDemoBirthLocked, setGoogleDemoBirthLocked] = useState(false);
  const [profileHasStoredGender, setProfileHasStoredGender] = useState(false);
  const [profileHasStoredBirth, setProfileHasStoredBirth] = useState(false);
  const [supabaseGoogleLinked, setSupabaseGoogleLinked] = useState(false);

  useEffect(() => {
    if (!visible) {
      setSupabaseGoogleLinked(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      const u = data.session?.user;
      setSupabaseGoogleLinked(u?.identities?.some((i) => i.provider === 'google') ?? false);
    })();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, s) => {
      const u = s?.user;
      setSupabaseGoogleLinked(u?.identities?.some((i) => i.provider === 'google') ?? false);
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [visible]);

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
    if (!visible || !pk) {
      setHydratingProfile(false);
      return;
    }
    let alive = true;
    setHydratingProfile(true);
    setHydratedProfile(null);
    void (async () => {
      try {
        const p = await ensureUserProfile(pk);
        if (!alive) return;
        setHydratedProfile(p);
        const complete = isMeetingServiceComplianceComplete(p, pk);
        setMeetingAuthComplete(complete);

        const {
          data: { session },
        } = await supabase.auth.getSession();
        const authPhone = session?.user?.phone?.trim() ?? '';
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
      } finally {
        if (alive) setHydratingProfile(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [visible, pk]);

  const showGoogleDemographicsCta = useMemo(() => {
    return (
      !meetingAuthComplete &&
      supabaseGoogleLinked &&
      hydratedProfile != null &&
      isDemographicsIncomplete(hydratedProfile)
    );
  }, [meetingAuthComplete, supabaseGoogleLinked, hydratedProfile]);

  const persistMeetingComplianceCore = useCallback(
    async (args: {
      gender: SignUpGenderCode | null;
      birth: { year: number; month: number; day: number };
      metadata?: Record<string, unknown> | null;
      skipConfirmDialog?: boolean;
      /** Google 점진적 동의 — 받은 항목만 저장하고 모달 유지 */
      allowPartialGoogleSave?: boolean;
      /** false면 해당 필드를 프로필 패치에 넣지 않음(부분 Google 저장용) */
      applyGender?: boolean;
      applyBirth?: boolean;
    }) => {
      if (!pk) {
        presentAppDialogAlert({ title: '안내', body: '로그인 후 진행할 수 있어요.' });
        return;
      }

      if (!args.skipConfirmDialog) {
        const ok = await new Promise<boolean>((resolve) => {
          presentAppDialogConfirm({ title: '저장 전 확인', body: '모임 이용을 위한 인증정보는 한 번 저장하면 이후 변경할 수 없어요.\n\n계속 저장할까요?', confirmLabel: '저장', confirmVariant: 'destructive', onConfirm: () => resolve(true), onCancel: () => resolve(false) });
        });
        if (!ok) return;
      }

      const p0 = await ensureUserProfile(pk);
      if (isDemographicsIncomplete(p0) && !args.allowPartialGoogleSave) {
        if (!args.gender || !args.birth.year || !args.birth.month || !args.birth.day) {
          presentAppDialogAlert({ title: '입력 확인', body: '성별과 생년월일을 모두 선택해 주세요.' });
          return;
        }
      }
      if (
        args.allowPartialGoogleSave &&
        isDemographicsIncomplete(p0) &&
        !args.gender &&
        !(args.birth.year && args.birth.month && args.birth.day)
      ) {
        return;
      }
      if (MEETING_PHONE_VERIFICATION_UI_ENABLED && !isPhoneVerified) {
        presentAppDialogAlert({ title: '전화 인증', body: '전화번호 인증을 먼저 완료해 주세요.' });
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
        const applyGender = args.applyGender !== false;
        const applyBirth = args.applyBirth !== false;
        if (applyGender && args.gender) {
          compliancePatch.gender = args.gender;
        }
        if (applyBirth && args.birth.year && args.birth.month && args.birth.day) {
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
          presentAppDialogAlert({ title: '동기화 안내', body: `Supabase 반영에 실패했어요. 잠시 후 다시 시도해 주세요.\n${sync.message}` });
        }

        if (
          applyGender &&
          applyBirth &&
          args.gender &&
          args.birth.year &&
          args.birth.month &&
          args.birth.day
        ) {
          const demoSync = await syncMeetingDemographicsToSupabase({
            appUserId: pk,
            gender: args.gender,
            birthYear: args.birth.year,
            birthMonth: args.birth.month,
            birthDay: args.birth.day,
          });
          if (!demoSync.ok) {
            presentAppDialogAlert({ title: '동기화 안내', body: `성별/생년월일 반영에 실패했어요. 잠시 후 다시 시도해 주세요.\n${demoSync.message}` });
          }
        }
        setHydratedProfile(p);
        const complete = isMeetingServiceComplianceComplete(p, pk);
        setMeetingAuthComplete(complete);
        if (complete) {
          await onAfterComplianceSuccess?.();
          onRequestClose();
          const doneMsg = '이제 모든 모임 기능을 이용할 수 있습니다';
          if (Platform.OS === 'android') ToastAndroid.show(doneMsg, ToastAndroid.LONG);
          else presentAppDialogAlert({ title: '완료', body: doneMsg });
        } else if (args.allowPartialGoogleSave) {
          const stillMissing: ('gender' | 'birth')[] = [];
          if (!profileHasCompleteGender(p)) stillMissing.push('gender');
          if (!profileHasCompleteBirth(p)) stillMissing.push('birth');
          presentGoogleDemographicsInquiryDialog(
            '일부 저장됨',
            googlePeopleDemographicsPartialSavedMessage(stillMissing),
            stillMissing,
          );
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : '저장에 실패했습니다.';
        presentAppDialogAlert({ title: '저장 실패', body: msg });
      } finally {
        setComplianceBusy(false);
      }
    },
    [pk, isPhoneVerified, phoneField, onAfterComplianceSuccess, onRequestClose, presentGoogleDemographicsInquiryDialog],
  );

  const onSubmitMeetingCompliance = useCallback(async () => {
    await persistMeetingComplianceCore({
      gender: genderDemo,
      birth: birthDemo,
      skipConfirmDialog: false,
    });
  }, [persistMeetingComplianceCore, genderDemo, birthDemo]);

  const googleAuthButtonTitle = useMemo(() => {
    if (googleDemographicsBusy) return 'Google 연동 중…';
    const p = hydratedProfile;
    if (!p) return 'Google 인증하기';
    const hasG = profileHasCompleteGender(p);
    const hasB = profileHasCompleteBirth(p);
    if (!hasG && hasB) return 'Google에서 성별 가져오기';
    if (hasG && !hasB) return 'Google에서 생년월일 가져오기';
    return 'Google 인증하기';
  }, [googleDemographicsBusy, hydratedProfile]);

  const onGoogleDemographicsImport = useCallback(async () => {
    if (!pk) {
      presentAppDialogAlert({ title: '안내', body: '로그인 후 진행할 수 있어요.' });
      return;
    }
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const hasGoogle = session?.user?.identities?.some((i) => i.provider === 'google') ?? false;
    if (!hasGoogle) {
      presentAppDialogAlert({ title: '안내', body: 'Google로 로그인한 계정에서만 사용할 수 있어요.' });
      return;
    }
    const email = session?.user?.email?.trim() ?? '';
    const emailPk = email ? normalizeUserId(email) : null;
    if (!emailPk || emailPk !== pk) {
      presentAppDialogAlert({
        title: '계정 확인',
        body:
          Platform.OS === 'web'
            ? '현재 이 프로필과 동일한 Google 계정으로 다시 로그인해 주세요.'
            : '현재 이 프로필과 동일한 Google 계정으로 로그인돼 있어야 해요.',
      });
      return;
    }
    const p0 = await ensureUserProfile(pk);
    if (MEETING_PHONE_VERIFICATION_UI_ENABLED && !isPhoneVerified) {
      presentAppDialogAlert({ title: '전화 인증', body: '전화번호 인증을 먼저 완료해 주세요.' });
      return;
    }
    setGoogleDemographicsBusy(true);
    try {
      const resolved = await importGooglePeopleDemographicsWithIncrementalConsent(p0);
      if (resolved.gender) setGenderDemo(resolved.gender);
      if (resolved.birth) setBirthDemo(resolved.birth);

      const googleDemoMeta = buildGooglePeopleDemographicsMetadataPatch({
        genderFromGoogle: resolved.genderFromGoogle,
        birthFromGoogle: resolved.birthFromGoogle,
      });
      const meta =
        Object.keys(googleDemoMeta).length > 0 ? googleDemoMeta : null;

      if (resolved.stillMissing.length > 0) {
        const gotNewFromGoogle = resolved.genderFromGoogle || resolved.birthFromGoogle;
        if (gotNewFromGoogle) {
          await persistMeetingComplianceCore({
            gender: resolved.gender,
            birth: resolved.birth ?? birthDemo,
            applyGender: resolved.genderFromGoogle,
            applyBirth: resolved.birthFromGoogle,
            metadata: meta,
            skipConfirmDialog: true,
            allowPartialGoogleSave: true,
          });
          const pRefresh = await ensureUserProfile(pk);
          const locks = readGooglePeopleDemographicsLocks(pRefresh);
          setGoogleDemoGenderLocked(locks.genderLocked);
          setGoogleDemoBirthLocked(locks.birthLocked);
          setProfileHasStoredGender(profileHasCompleteGender(pRefresh));
          setProfileHasStoredBirth(profileHasCompleteBirth(pRefresh));
        } else {
          presentGoogleDemographicsInquiryDialog(
            'Google 정보',
            googlePeopleDemographicsFailureMessage(resolved.stillMissing),
            resolved.stillMissing,
          );
        }
        return;
      }

      if (!resolved.gender || !resolved.birth) {
        presentGoogleDemographicsInquiryDialog(
          'Google 정보',
          googlePeopleDemographicsFailureMessage(['gender', 'birth']),
          ['gender', 'birth'],
        );
        return;
      }

      await persistMeetingComplianceCore({
        gender: resolved.gender,
        birth: resolved.birth,
        applyGender: true,
        applyBirth: true,
        metadata: meta,
        skipConfirmDialog: true,
      });
    } catch (e) {
      const code = e && typeof e === 'object' && 'code' in e ? String((e as { code?: string }).code) : '';
      if (code === REDIRECT_STARTED) return;
      const msg = e instanceof Error ? e.message : 'Google 연동에 실패했습니다.';
      presentAppDialogAlert({ title: 'Google 연동 실패', body: msg });
    } finally {
      setGoogleDemographicsBusy(false);
    }
  }, [pk, isPhoneVerified, persistMeetingComplianceCore, birthDemo]);

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
      presentAppDialogAlert({ title: '안내', body: '로그인 후 인증할 수 있어요.' });
      return;
    }
    const normalized = normalizePhoneUserId(phoneField);
    if (!normalized) {
      presentAppDialogAlert({ title: '입력 확인', body: '전화번호를 정확히 입력해 주세요.' });
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
      presentAppDialogAlert({ title: '인증 실패', body: msg });
    } finally {
      setOtpBusy(false);
    }
  }, [pk, phoneField, otpSmsUserConsent]);

  const onConfirmOtp = useCallback(async () => {
    if (!pk) {
      presentAppDialogAlert({ title: '안내', body: '로그인 후 인증할 수 있어요.' });
      return;
    }
    if (!otpVerificationId) return;
    const normalized = normalizePhoneUserId(phoneField);
    if (!normalized) {
      presentAppDialogAlert({ title: '입력 확인', body: '전화번호를 정확히 입력해 주세요.' });
      return;
    }
    const code = otpCode.replace(/\D/g, '').slice(0, 6);
    if (code.length !== 6) {
      presentAppDialogAlert({ title: '입력 확인', body: '인증번호 6자리를 입력해 주세요.' });
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
      else presentAppDialogAlert({ title: '인증 완료', body: '전화번호 인증이 완료됐어요.' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : '인증 확인에 실패했습니다.';
      setOtpError(msg);
      presentAppDialogAlert({ title: '인증 실패', body: msg });
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
          <GinitPressable
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
                {hydratingProfile ? (
                  <View style={styles.authLoadingBox}>
                    <Text style={styles.sheetLead}>인증 정보를 불러오는 중이에요.</Text>
                  </View>
                ) : (
                  <>
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
                !supabaseGoogleLinked ? (
                  <View style={{ marginBottom: 12 }}>
                    <Text style={styles.googleCtaHint}>
                      성별·생년월일은 프로필 편집에서 입력한 뒤, 아래에서 저장을 진행해 주세요.
                    </Text>
                    <GinitPressable
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
                    </GinitPressable>
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
                          <GinitPressable
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
                          </GinitPressable>
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
                            <GinitPressable
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
                            </GinitPressable>
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
                              <GinitPressable
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
                              </GinitPressable>
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
                    title={googleAuthButtonTitle}
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
                  </>
                )}
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
  authLoadingBox: {
    minHeight: 180,
    justifyContent: 'center',
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
