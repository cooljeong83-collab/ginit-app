import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  KeyboardAvoidingView,
  LayoutChangeEvent,
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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { authScreenStyles as authFormStyles } from '@/components/auth/authScreenStyles';
import { GinitButton, GinitCard } from '@/components/ginit';
import { ScreenShell } from '@/components/ui';
import { GinitTheme } from '@/constants/ginit-theme';
import { HomeGlassStyles } from '@/constants/home-glass-styles';
import { useUserSession } from '@/src/context/UserSessionContext';
import {
  type SignUpGenderCode,
} from '@/src/hooks/useSignUpFlow';
import {
  deleteFirebaseAuthUserStrict,
  purgeUserAccountRemote,
  purgeUserAccountRemoteByFirebaseUid,
  wipeLocalAppData,
} from '@/src/lib/account-deletion';
import { normalizeUserId } from '@/src/lib/app-user-id';
import {
  effectiveGTrust,
  levelBarFillColorForTrust,
  trustTierForUser,
  xpProgressWithinLevel,
} from '@/src/lib/ginit-trust';
import { formatNormalizedPhoneKrDisplay, normalizePhoneUserId } from '@/src/lib/phone-user-id';
import {
  isProfileRegisterInfoParamOn,
  PROFILE_REGISTER_INFO_QUERY,
} from '@/src/lib/profile-register-info';
import { syncMeetingComplianceToSupabase, syncMeetingDemographicsToSupabase } from '@/src/lib/supabase-profile-compliance';
import { mapGooglePeopleGenderToProfileGender } from '@/src/lib/google-people-extras';
import {
  ensureUserProfile,
  firestoreTimestampLikeToDate,
  hasTermsAgreementRecorded,
  isDemographicsIncomplete,
  isMeetingServiceComplianceComplete,
  meetingDemographicsIncomplete,
  isUserPhoneVerified,
  updateUserProfile,
  type UserProfile,
} from '@/src/lib/user-profile';
import { uploadProfilePhoto } from '@/src/lib/profile-photo';
import { AuthService } from '@/src/services/AuthService';
import { serverTimestamp, Timestamp } from 'firebase/firestore';

import { BirthdateWheel } from '@/components/auth/BirthdateWheel';

export default function ProfileTab() {
  const router = useRouter();
  const { registerInfo: registerInfoParam } = useLocalSearchParams<{ registerInfo?: string | string[] }>();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { userId, authProfile, signOutSession } = useUserSession();
  const scrollRef = useRef<ScrollView>(null);
  const profilePk = useMemo(() => {
    const u = userId?.trim();
    if (u) return u;
    const em = authProfile?.email?.trim();
    if (em) return normalizeUserId(em) ?? '';
    return '';
  }, [userId, authProfile?.email]);

  const [busy, setBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [photoUploadBusy, setPhotoUploadBusy] = useState(false);
  const [nickname, setNickname] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [genderDemo, setGenderDemo] = useState<SignUpGenderCode | null>(null);
  const [birthDemo, setBirthDemo] = useState<{ year: number; month: number; day: number }>(() => {
    return { year: 1983, month: 1, day: 1 };
  });
  const [verifiedPhoneLabel, setVerifiedPhoneLabel] = useState<string | null>(null);
  const [isPhoneVerified, setIsPhoneVerified] = useState(false);
  const [phoneField, setPhoneField] = useState('');
  const [otpVerificationId, setOtpVerificationId] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const otpAutoConfirmRef = useRef(false);
  const [meetingAuthComplete, setMeetingAuthComplete] = useState(false);
  const [meetingAuthGateReady, setMeetingAuthGateReady] = useState(false);
  const [authSheetVisible, setAuthSheetVisible] = useState(false);
  const [termsConsentChecked, setTermsConsentChecked] = useState(false);
  const [complianceBusy, setComplianceBusy] = useState(false);

  /** 인증 모달: 화면 대부분을 쓰되 패딩·타이틀 영역을 빼고 스크롤 영역 높이 확보 */
  const authSheetLayout = useMemo(() => {
    const panelMax = Math.floor(windowHeight * 0.96);
    const panelPadBottom = Math.max(16, insets.bottom);
    const scrollMax = Math.max(280, panelMax - 18 - panelPadBottom - 12);
    return { panelMax, panelPadBottom, scrollMax };
  }, [windowHeight, insets.bottom]);

  const [gTrust, setGTrust] = useState(100);
  const [gXp, setGXp] = useState(0);
  const [gLevel, setGLevel] = useState(1);
  const [penaltyCount, setPenaltyCount] = useState(0);
  const [isRestricted, setIsRestricted] = useState(false);
  const prevTrustRef = useRef<number | null>(null);
  const [trustDropFx, setTrustDropFx] = useState<{ delta: number; id: number } | null>(null);
  const trustDropOpacity = useRef(new Animated.Value(0)).current;
  const trustDropTranslate = useRef(new Animated.Value(0)).current;
  const [trustSectionY, setTrustSectionY] = useState<number | null>(null);
  const isSignedIn = !!profilePk;

  const refreshProfile = useCallback(async () => {
    if (!profilePk) return;
    try {
      const p = await ensureUserProfile(profilePk);
      setNickname(p.nickname);
      setPhotoUrl(p.photoUrl ?? '');
      setIsPhoneVerified(isUserPhoneVerified(p));
      const phone = p.phone?.trim();
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
      const gRaw = p.gender?.trim() ?? '';
      const gNorm =
        gRaw === 'MALE' || gRaw === 'FEMALE' ? gRaw : mapGooglePeopleGenderToProfileGender(gRaw);
      setGenderDemo(gNorm);
      const bd = p.birthDate as unknown;
      const bdDate =
        bd && typeof bd === 'object' && 'toDate' in bd && typeof (bd as { toDate?: unknown }).toDate === 'function'
          ? (bd as { toDate: () => Date }).toDate()
          : null;
      if (bdDate) {
        setBirthDemo({ year: bdDate.getFullYear(), month: bdDate.getMonth() + 1, day: bdDate.getDate() });
      } else {
        const y = typeof p.birthYear === 'number' ? p.birthYear : null;
        const m = typeof p.birthMonth === 'number' ? p.birthMonth : null;
        const d = typeof p.birthDay === 'number' ? p.birthDay : null;
        if (y && m && d) setBirthDemo({ year: y, month: m, day: d });
      }
      const nextTrust = effectiveGTrust(p);
      setGTrust(nextTrust);
      setGXp(typeof p.gXp === 'number' && Number.isFinite(p.gXp) ? Math.trunc(p.gXp) : 0);
      setGLevel(typeof p.gLevel === 'number' && Number.isFinite(p.gLevel) ? Math.max(1, Math.trunc(p.gLevel)) : 1);
      setPenaltyCount(typeof p.penaltyCount === 'number' && Number.isFinite(p.penaltyCount) ? Math.max(0, Math.trunc(p.penaltyCount)) : 0);
      setIsRestricted(p.isRestricted === true);
      setMeetingAuthComplete(isMeetingServiceComplianceComplete(p, profilePk));
      setMeetingAuthGateReady(true);
    } catch {
      setNickname('');
      setPhotoUrl('');
      setIsPhoneVerified(false);
      setVerifiedPhoneLabel(null);
      setPhoneField('');
      setOtpVerificationId(null);
      setOtpCode('');
      setOtpError(null);
      setGenderDemo(null);
      setMeetingAuthComplete(false);
      setMeetingAuthGateReady(true);
    }
  }, [profilePk]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!profilePk) return;
      try {
        await refreshProfile();
      } finally {
        if (cancelled) return;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profilePk, refreshProfile]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      let clearParamTimer: ReturnType<typeof setTimeout> | undefined;
      void (async () => {
        try {
          await refreshProfile();
        } catch {
          /* refreshProfile 내부에서 상태 처리 */
        }
        if (cancelled) return;
        if (isProfileRegisterInfoParamOn(registerInfoParam)) {
          setAuthSheetVisible(true);
          clearParamTimer = setTimeout(() => {
            router.setParams({ [PROFILE_REGISTER_INFO_QUERY]: undefined });
          }, 0);
        }
      })();
      return () => {
        cancelled = true;
        if (clearParamTimer) clearTimeout(clearParamTimer);
      };
    }, [refreshProfile, registerInfoParam, router]),
  );

  useEffect(() => {
    const prev = prevTrustRef.current;
    if (prev != null && gTrust < prev) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      setTrustDropFx({ delta: prev - gTrust, id: Date.now() });
    }
    prevTrustRef.current = gTrust;
  }, [gTrust]);

  useEffect(() => {
    if (!trustDropFx) return;
    trustDropOpacity.setValue(1);
    trustDropTranslate.setValue(0);
    Animated.parallel([
      Animated.timing(trustDropTranslate, {
        toValue: -28,
        duration: 900,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(trustDropOpacity, {
        toValue: 0,
        duration: 900,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(() => setTrustDropFx(null));
  }, [trustDropFx, trustDropOpacity, trustDropTranslate]);

  const trustTier = useMemo(
    () => trustTierForUser({ nickname: '', photoUrl: null, gTrust, isRestricted } as UserProfile),
    [gTrust, isRestricted],
  );
  const xpBar = useMemo(
    () => xpProgressWithinLevel({ nickname: '', photoUrl: null, gLevel, gXp } as UserProfile),
    [gLevel, gXp],
  );
  const levelBarColor = useMemo(() => levelBarFillColorForTrust(gTrust), [gTrust]);

  const onGoEditProfile = useCallback(() => {
    router.push('/profile/edit');
  }, [router]);

  const onPickHeaderProfilePhoto = useCallback(async () => {
    if (!profilePk) {
      Alert.alert('안내', '로그인 후 사진을 바꿀 수 있어요.');
      return;
    }
    setPhotoUploadBusy(true);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('권한 필요', '사진을 선택하려면 사진 보관함 권한이 필요합니다.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 1,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      const uri = asset?.uri?.trim() ?? '';
      if (!uri) throw new Error('이미지 정보를 가져오지 못했습니다.');

      const url = await uploadProfilePhoto({
        userId: profilePk,
        localImageUri: uri,
        naturalWidth: asset?.width,
        naturalHeight: asset?.height,
      });
      await updateUserProfile(profilePk, { photoUrl: url });
      setPhotoUrl(url);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (Platform.OS === 'android') ToastAndroid.show('프로필 사진이 반영됐어요.', ToastAndroid.SHORT);
      await refreshProfile();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '업로드에 실패했습니다.';
      Alert.alert('업로드 실패', msg);
    } finally {
      setPhotoUploadBusy(false);
    }
  }, [profilePk, refreshProfile]);

  const onGoTrust = useCallback(() => {
    if (trustSectionY == null) return;
    scrollRef.current?.scrollTo({ y: Math.max(0, trustSectionY - 8), animated: true });
  }, [trustSectionY]);

  useEffect(() => {
    if (!authSheetVisible || !profilePk) return;
    let alive = true;
    void (async () => {
      try {
        const p = await ensureUserProfile(profilePk);
        if (!alive) return;
        const complete = isMeetingServiceComplianceComplete(p, profilePk);
        setMeetingAuthComplete(complete);
        // 완료 상태면 체크가 항상 보이도록(terms_agreed_at 누락 등 예외에도 잠금 UI 유지)
        setTermsConsentChecked(complete ? true : hasTermsAgreementRecorded(p));

        // 인증 팝업 진입 시: 이미 저장된 정보를 state에 다시 세팅(로그아웃/재로그인 후에도 잠금 유지)
        setIsPhoneVerified(isUserPhoneVerified(p));
        const phone = p.phone?.trim();
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

        const gRaw = p.gender?.trim() ?? '';
        const gNorm =
          gRaw === 'MALE' || gRaw === 'FEMALE' ? gRaw : mapGooglePeopleGenderToProfileGender(gRaw);
        setGenderDemo(gNorm);

        const y = typeof p.birthYear === 'number' ? p.birthYear : null;
        const m = typeof p.birthMonth === 'number' ? p.birthMonth : null;
        const d = typeof p.birthDay === 'number' ? p.birthDay : null;
        if (y) {
          // month/day가 비어 있어도 저장된 year는 반드시 표시합니다.
          setBirthDemo({ year: y, month: m ?? 1, day: d ?? 1 });
        }
      } catch {
        if (!alive) return;
        setTermsConsentChecked(false);
        setMeetingAuthComplete(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [authSheetVisible, profilePk]);

  const onSubmitMeetingCompliance = useCallback(async () => {
    if (!profilePk) {
      Alert.alert('안내', '로그인 후 진행할 수 있어요.');
      return;
    }

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

    const p0 = await ensureUserProfile(profilePk);
    if (!hasTermsAgreementRecorded(p0) && !termsConsentChecked) {
      Alert.alert('동의 필요', '모임 이용 정보 수집 및 이용에 동의해 주세요.');
      return;
    }
    if (isDemographicsIncomplete(p0)) {
      if (!genderDemo || !birthDemo.year || !birthDemo.month || !birthDemo.day) {
        Alert.alert('입력 확인', '성별과 생년월일을 모두 선택해 주세요.');
        return;
      }
    }
    if (!isPhoneVerified) {
      Alert.alert('전화 인증', '전화번호 인증을 먼저 완료해 주세요.');
      return;
    }
    setComplianceBusy(true);
    try {
      const compliancePatch: Parameters<typeof updateUserProfile>[1] = { termsAgreedAt: serverTimestamp() };
      if (
        profilePk.includes('@') &&
        (p0.signupProvider == null || String(p0.signupProvider).trim() === '') &&
        meetingDemographicsIncomplete(p0, profilePk)
      ) {
        compliancePatch.signupProvider = 'google_sns';
      }
      if (genderDemo) {
        compliancePatch.gender = genderDemo;
      }
      if (birthDemo.year && birthDemo.month && birthDemo.day) {
        compliancePatch.birthDate = Timestamp.fromDate(new Date(birthDemo.year, birthDemo.month - 1, birthDemo.day));
      }
      await updateUserProfile(profilePk, compliancePatch);
      // 일부 환경에서 RPC 배포 지연/스키마 캐시 문제로 demographic 필드가 반영되지 않는 케이스가 있어,
      // 저장 직후 한 번 더 확인하고 누락이면 보강 저장합니다.
      let p = await ensureUserProfile(profilePk);
      if (!p.gender && genderDemo) {
        await updateUserProfile(profilePk, { gender: genderDemo });
        p = await ensureUserProfile(profilePk);
      }
      const phoneE164 = p.phone?.trim() ?? normalizePhoneUserId(phoneField)?.trim() ?? '';
      if (!phoneE164 || !phoneE164.startsWith('+')) {
        throw new Error('전화번호 정보를 찾지 못했습니다.');
      }
      const verifiedDate = firestoreTimestampLikeToDate(p.phoneVerifiedAt) ?? new Date();
      const termsDate = firestoreTimestampLikeToDate(p.termsAgreedAt) ?? new Date();
      const sync = await syncMeetingComplianceToSupabase({
        appUserId: profilePk,
        nickname: nickname.trim() || p.nickname,
        phoneE164,
        phoneVerifiedAtIso: verifiedDate.toISOString(),
        termsAgreedAtIso: termsDate.toISOString(),
      });
      if (!sync.ok) {
        Alert.alert('동기화 안내', `Supabase 반영에 실패했어요. 잠시 후 다시 시도해 주세요.\n${sync.message}`);
      }

      // 서버에 값이 정상인데도 재로그인 후 인증 정보가 사라져 보이는 케이스를 막기 위해,
      // demographics(성별·생년월일)도 Supabase에 한 번 더 명시적으로 반영합니다.
      if (genderDemo && birthDemo.year && birthDemo.month && birthDemo.day) {
        const demoSync = await syncMeetingDemographicsToSupabase({
          appUserId: profilePk,
          gender: genderDemo,
          birthYear: birthDemo.year,
          birthMonth: birthDemo.month,
          birthDay: birthDemo.day,
        });
        if (!demoSync.ok) {
          Alert.alert('동기화 안내', `성별/생년월일 반영에 실패했어요. 잠시 후 다시 시도해 주세요.\n${demoSync.message}`);
        }
      }
      await refreshProfile();
      setAuthSheetVisible(false);
      const doneMsg = '이제 모든 모임 기능을 이용할 수 있습니다';
      if (Platform.OS === 'android') ToastAndroid.show(doneMsg, ToastAndroid.LONG);
      else Alert.alert('완료', doneMsg);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '저장에 실패했습니다.';
      Alert.alert('저장 실패', msg);
    } finally {
      setComplianceBusy(false);
    }
  }, [
    profilePk,
    termsConsentChecked,
    genderDemo,
    birthDemo.year,
    birthDemo.month,
    birthDemo.day,
    isPhoneVerified,
    phoneField,
    nickname,
    refreshProfile,
  ]);

  const canSendOtp = useMemo(() => {
    const normalized = normalizePhoneUserId(phoneField);
    return !!profilePk && !!normalized && !profileBusy && !otpBusy && !complianceBusy;
  }, [profilePk, phoneField, profileBusy, otpBusy, complianceBusy]);

  const canConfirmOtp = useMemo(() => {
    return (
      !!profilePk &&
      !!otpVerificationId &&
      otpCode.replace(/\D/g, '').length === 6 && !profileBusy && !otpBusy && !complianceBusy
    );
  }, [profilePk, otpVerificationId, otpCode, profileBusy, otpBusy, complianceBusy]);

  const onSendOtp = useCallback(async () => {
    if (!profilePk) {
      Alert.alert('안내', '로그인 후 인증할 수 있어요.');
      return;
    }
    const normalized = normalizePhoneUserId(phoneField);
    if (!normalized) {
      Alert.alert('입력 확인', '전화번호를 정확히 입력해 주세요.');
      return;
    }
    setOtpError(null);
    setOtpBusy(true);
    try {
      const { verificationId } = await AuthService.verifyPhoneNumber(normalized);
      setOtpVerificationId(verificationId);
      setOtpCode('');
      if (Platform.OS === 'android') ToastAndroid.show('인증번호를 전송했어요.', ToastAndroid.SHORT);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '인증번호 전송에 실패했습니다.';
      setOtpError(msg);
      Alert.alert('인증 실패', msg);
    } finally {
      setOtpBusy(false);
    }
  }, [profilePk, phoneField]);

  const onConfirmOtp = useCallback(async () => {
    if (!profilePk) {
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
      await updateUserProfile(profilePk, {
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
  }, [profilePk, otpVerificationId, otpCode, phoneField]);

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

  // 프로필 편집(닉네임/사진 업로드 등)은 `/profile/edit`에서 수행합니다.

  const onGoLogin = useCallback(() => {
    router.replace('/login');
  }, [router]);

  const onSignOut = useCallback(async () => {
    setBusy(true);
    try {
      await signOutSession();
      router.replace('/login');
    } catch (e) {
      const msg = e instanceof Error ? e.message : '알 수 없는 오류';
      Alert.alert('로그아웃 실패', msg);
    } finally {
      setBusy(false);
    }
  }, [router, signOutSession]);

  const runDeleteAccount = useCallback(async () => {
    const sessionUserId = userId?.trim() ?? '';
    const firebaseUid = authProfile?.firebaseUid?.trim() ?? '';
    if (!sessionUserId && !firebaseUid) {
      Alert.alert('안내', '로그인된 계정만 탈퇴할 수 있어요.');
      return;
    }
    setDeleteBusy(true);
    try {
      const res = sessionUserId
        ? await purgeUserAccountRemote(sessionUserId)
        : await purgeUserAccountRemoteByFirebaseUid(firebaseUid);
      if (!res.ok) {
        Alert.alert('탈퇴를 완료하지 못했어요', res.message);
        return;
      }
      const authDel = await deleteFirebaseAuthUserStrict();
      if (!authDel.ok) {
        Alert.alert('탈퇴를 완료하지 못했어요', authDel.message);
        return;
      }
      await signOutSession();
      await wipeLocalAppData();
      const doneMsg = '탈퇴가 완료되었습니다. 그동안 지닛과 함께해주셔서 감사합니다.';
      if (Platform.OS === 'android') {
        ToastAndroid.show(doneMsg, ToastAndroid.LONG);
        // Android에서 `BackHandler.exitApp()` 직후 네비게이터가 GO_BACK을 처리하려다
        // "The action 'GO_BACK' was not handled" 경고가 나는 케이스가 있어, 로그인으로만 전환합니다.
        router.replace('/login');
      } else {
        Alert.alert('탈퇴 완료', doneMsg, [{ text: '확인', onPress: () => router.replace('/login') }]);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '알 수 없는 오류';
      Alert.alert('탈퇴 실패', msg);
    } finally {
      setDeleteBusy(false);
    }
  }, [userId, authProfile?.firebaseUid, router, signOutSession]);

  const onRequestDeleteAccount = useCallback(() => {
    const sessionUserId = userId?.trim() ?? '';
    const firebaseUid = authProfile?.firebaseUid?.trim() ?? '';
    if (!sessionUserId && !firebaseUid) {
      Alert.alert('안내', '로그인된 계정만 탈퇴할 수 있어요.');
      return;
    }
    Alert.alert(
      '회원 탈퇴',
      '탈퇴 시 이름·연락처·이메일·프로필 사진 등 개인 식별 정보는 서버에서 즉시 삭제(비식별화)됩니다.\n\n' +
        '• 채팅·투표·모임 참여 기록은 서비스 운영을 위해 익명 상태로 보관될 수 있습니다.\n' +
        '• 내가 만든 모임에 나 혼자만 있다면 해당 모임은 자동으로 삭제됩니다.\n' +
        '• 내가 만든 모임에 참여자가 2명 이상 있다면, 방장 권한이 다음 참여자에게 자동으로 이관되고 저는 모임에서 탈퇴합니다.\n' +
        '• 팔로워/팔로잉/맞팔(요청 포함) 관계는 모두 삭제됩니다.\n' +
        '• 이 기기에 저장된 로그인·캐시 등은 모두 지워집니다.',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '다음',
          style: 'destructive',
          onPress: () => {
            Alert.alert('최종 확인', '정말 지닛에서 탈퇴할까요?', [
              { text: '아니오', style: 'cancel' },
              { text: '탈퇴하기', style: 'destructive', onPress: () => void runDeleteAccount() },
            ]);
          },
        },
      ],
    );
  }, [userId, authProfile?.firebaseUid, runDeleteAccount]);

  return (
    <ScreenShell padded={false} style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[HomeGlassStyles.scrollPad, styles.scrollBottom]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.headerWrap}>
            <View style={styles.headerRow}>
              <Pressable
                onPress={() => void onPickHeaderProfilePhoto()}
                disabled={photoUploadBusy || busy || deleteBusy}
                style={({ pressed }) => [styles.avatarWrap, pressed && !(photoUploadBusy || busy || deleteBusy) && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="프로필 사진 바꾸기"
                accessibilityHint="갤러리에서 고르고 확인하면 바로 저장돼요">
                {photoUrl.trim() ? (
                  <Image source={{ uri: photoUrl.trim() }} style={styles.avatar} contentFit="cover" />
                ) : (
                  <View style={styles.avatarFallback}>
                    <Text style={styles.avatarFallbackText}>{(nickname?.trim() || 'G').slice(0, 1)}</Text>
                  </View>
                )}
                {photoUploadBusy ? (
                  <View style={styles.avatarUploadOverlay} pointerEvents="none">
                    <ActivityIndicator color="#fff" />
                  </View>
                ) : null}
              </Pressable>
              <View style={styles.headerTextCol}>
                <Text style={styles.headerName} numberOfLines={1}>
                  {nickname?.trim() || '사용자'}
                </Text>
                <Text style={styles.headerSub} numberOfLines={1}>
                  {userId?.trim()
                    ? userId
                    : authProfile?.email?.trim()
                      ? authProfile.email
                      : authProfile?.firebaseUid?.trim()
                        ? authProfile.firebaseUid
                        : '(세션 없음)'}
                </Text>
              </View>
              <Pressable
                onPress={onGoEditProfile}
                style={({ pressed }) => [styles.headerEditBtn, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="프로필 편집">
                <Text style={styles.headerEditText}>프로필 편집</Text>
              </Pressable>
            </View>
          </View>

          <GinitCard
            appearance="light"
            style={styles.profileCard}
            onLayout={(e: LayoutChangeEvent) => setTrustSectionY(e.nativeEvent.layout.y)}>
            <Text style={styles.sectionTitle}>나의 신뢰도</Text>
            <View style={styles.trustInlineSection}>
              {trustDropFx ? (
                <Animated.View
                  pointerEvents="none"
                  style={[
                    styles.trustDropFx,
                    { opacity: trustDropOpacity, transform: [{ translateY: trustDropTranslate }] },
                  ]}>
                  <Text style={styles.trustDropFxText}>−{trustDropFx.delta}</Text>
                </Animated.View>
              ) : null}
              <View style={styles.trustCardTop}>
                <Text style={styles.trustCardTitle}>현재 점수</Text>
                <View style={styles.trustTierPill}>
                  <Text style={styles.trustTierPillText}>{trustTier.label}</Text>
                </View>
              </View>
              <Text style={styles.trustScoreBig}>{gTrust}</Text>
              <Text style={styles.trustScoreUnit}>gTrust 점수</Text>
              {penaltyCount > 0 ? (
                <Text style={styles.trustPenaltyHint}>누적 패널티 {penaltyCount}회 · 체크인 완료로 신뢰를 회복할 수 있어요</Text>
              ) : (
                <Text style={styles.trustPenaltyHint}>약속을 지키면 신뢰 점수가 유지돼요</Text>
              )}
              {isRestricted ? <Text style={styles.trustRestricted}>현재 모임 참여가 제한된 상태예요.</Text> : null}

              <Text style={[styles.label, { marginTop: 14, marginBottom: 6, color: '#475569' }]}>레벨 진행</Text>
              <Text style={styles.levelLine}>
                Lv {gLevel} · XP {gXp} / {xpBar.nextAt}
              </Text>
              <View style={styles.levelTrack}>
                <View
                  style={[
                    styles.levelFill,
                    { width: `${Math.round(xpBar.ratio * 100)}%`, backgroundColor: levelBarColor },
                  ]}
                />
              </View>
            </View>
          </GinitCard>

          <Pressable
            onPress={() => router.push('/profile/meeting-history')}
            style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="모임 히스토리">
            <View style={styles.menuLeft}>
              <View style={styles.menuIconWrap}>
                <Ionicons name="time-outline" size={18} color="#0f172a" />
              </View>
              <View style={styles.menuTextCol}>
                <Text style={styles.menuTitle}>모임 히스토리</Text>
              </View>
            </View>
            <Text style={styles.menuChevron}>›</Text>
          </Pressable>

          <Pressable
            onPress={() => setAuthSheetVisible(true)}
            disabled={complianceBusy || otpBusy || profileBusy}
            style={({ pressed }) => [
              styles.menuRow,
              (complianceBusy || otpBusy || profileBusy) && styles.menuRowDisabled,
              pressed && !(complianceBusy || otpBusy || profileBusy) && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="인증 정보 등록">
            <View style={styles.menuLeft}>
              <View style={styles.menuIconWrap}>
                <Ionicons name="shield-checkmark-outline" size={18} color="#0f172a" />
              </View>
              <View style={styles.menuTextCol}>
                <Text style={styles.menuTitle}>인증 정보 등록</Text>
                <Text
                  style={[styles.menuSub, meetingAuthComplete ? styles.menuSubOk : styles.menuSubWarn]}
                  numberOfLines={1}>
                  {meetingAuthComplete ? '인증 완료' : '미완료 · 눌러서 진행'}
                </Text>
              </View>
            </View>
            <Text style={styles.menuChevron}>›</Text>
          </Pressable>

          {isSignedIn ? (
            <>
              <Pressable
                onPress={onSignOut}
                disabled={busy || deleteBusy}
                style={({ pressed }) => [
                  styles.menuRow,
                  (busy || deleteBusy) && styles.menuRowDisabled,
                  pressed && !(busy || deleteBusy) && styles.pressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="로그아웃">
                <View style={styles.menuLeft}>
                  <View style={styles.menuIconWrap}>
                    <Ionicons name="log-out-outline" size={18} color="#0f172a" />
                  </View>
                  <View style={styles.menuTextCol}>
                    <Text style={styles.menuTitle}>로그아웃</Text>
                  </View>
                </View>
                <Text style={styles.menuChevron}>›</Text>
              </Pressable>

              <Pressable
                onPress={onRequestDeleteAccount}
                disabled={deleteBusy || profileBusy}
                style={({ pressed }) => [
                  styles.menuRow,
                  (deleteBusy || profileBusy) && styles.menuRowDisabled,
                  pressed && !(deleteBusy || profileBusy) && styles.pressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="회원 탈퇴">
                <View style={styles.menuLeft}>
                  <View style={[styles.menuIconWrap, styles.menuIconWrapDanger]}>
                    <Ionicons name="warning-outline" size={18} color="#b91c1c" />
                  </View>
                  <View style={styles.menuTextCol}>
                    <Text style={styles.menuTitleDanger}>{deleteBusy ? '탈퇴 처리 중…' : '회원 탈퇴'}</Text>
                  </View>
                </View>
                <Text style={styles.menuChevronDanger}>›</Text>
              </Pressable>
            </>
          ) : (
            <Pressable
              onPress={onGoLogin}
              style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="로그인">
              <View style={styles.menuLeft}>
                <View style={styles.menuIconWrap}>
                  <Ionicons name="log-in-outline" size={18} color="#0f172a" />
                </View>
                <View style={styles.menuTextCol}>
                  <Text style={styles.menuTitle}>로그인</Text>
                </View>
              </View>
              <Text style={styles.menuChevron}>›</Text>
            </Pressable>
          )}
        </ScrollView>

        <Modal
          visible={authSheetVisible}
          animationType="fade"
          transparent
          onRequestClose={() => {
            if (!complianceBusy) setAuthSheetVisible(false);
          }}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.sheetKbWrap}>
            <View style={styles.sheetRoot}>
              <Pressable
                style={styles.sheetBackdropFill}
                onPress={() => {
                  if (!complianceBusy) setAuthSheetVisible(false);
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
                    : '모임 만들기·참여를 위해 정보 수집 동의와 전화번호 인증이 필요해요.'}
                </Text>

                <Pressable
                  onPress={() =>
                    !complianceBusy && !meetingAuthComplete && setTermsConsentChecked(!termsConsentChecked)
                  }
                  disabled={complianceBusy || meetingAuthComplete}
                  style={({ pressed }) => [
                    styles.termsRow,
                    meetingAuthComplete && styles.termsRowLocked,
                    pressed && !complianceBusy && !meetingAuthComplete && styles.pressed,
                  ]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: termsConsentChecked || meetingAuthComplete, disabled: meetingAuthComplete }}
                  accessibilityLabel="모임 이용 정보 수집 및 이용 동의">
                  <View
                    style={[
                      styles.termsBox,
                      termsConsentChecked || meetingAuthComplete ? styles.termsBoxChecked : styles.termsBoxUnchecked,
                    ]}>
                    {termsConsentChecked || meetingAuthComplete ? <Text style={styles.termsCheckMark}>✓</Text> : null}
                  </View>
                  <Text style={[styles.termsLabel, meetingAuthComplete && styles.termsLabelLocked]}>
                    모임 이용 정보 수집 및 이용 동의 (필수)
                  </Text>
                </Pressable>

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
                          disabled={profileBusy || complianceBusy || meetingAuthComplete}
                          onPress={() => setGenderDemo(code)}
                          style={({ pressed }) => [
                            authFormStyles.genderBinaryBtn,
                            selected ? authFormStyles.genderBinaryBtnSelected : authFormStyles.genderBinaryBtnIdle,
                            pressed &&
                              !(profileBusy || complianceBusy || meetingAuthComplete) &&
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
                    disabled={profileBusy || complianceBusy || meetingAuthComplete}
                  />
                </>

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

                    {!meetingAuthComplete ? (
                      <GinitButton
                        title={complianceBusy ? '저장 중…' : '인증 및 정보 저장'}
                        variant="primary"
                        onPress={() => void onSubmitMeetingCompliance()}
                        disabled={complianceBusy || otpBusy || profileBusy}
                      />
                    ) : null}
                  </ScrollView>
                </View>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </SafeAreaView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: GinitTheme.colors.bg },
  safe: {
    flex: 1,
  },
  scrollBottom: {
    paddingTop: 8,
    paddingBottom: 32,
  },
  headerWrap: {
    marginBottom: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.55)',
    backgroundColor: 'rgba(255, 255, 255, 0.78)',
    padding: 14,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatarWrap: {
    width: 56,
    height: 56,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.12)',
    backgroundColor: 'rgba(15, 23, 42, 0.06)',
    position: 'relative',
  },
  avatarUploadOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.42)',
  },
  avatar: {
    width: '100%',
    height: '100%',
  },
  avatarFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarFallbackText: {
    fontSize: 20,
    fontWeight: '900',
    color: '#0f172a',
  },
  headerTextCol: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  headerName: {
    fontSize: 18,
    fontWeight: '900',
    color: '#0f172a',
    letterSpacing: -0.3,
  },
  headerSub: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
  },
  headerEditBtn: {
    flexShrink: 0,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.12)',
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
  },
  headerEditText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#0f172a',
  },
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 14,
  },
  quickItem: {
    width: '31%',
    minWidth: 92,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.55)',
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  quickLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0f172a',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#0f172a',
    marginBottom: 10,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.55)',
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    marginTop: 12,
  },
  menuRowDisabled: { opacity: 0.55 },
  menuLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 },
  menuIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.06)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.10)',
  },
  menuIconWrapDanger: {
    backgroundColor: 'rgba(185, 28, 28, 0.06)',
    borderColor: 'rgba(185, 28, 28, 0.18)',
  },
  menuTextCol: { flex: 1, minWidth: 0, gap: 2 },
  menuTitle: {
    fontSize: 15,
    fontWeight: '900',
    color: '#0f172a',
  },
  menuTitleDanger: {
    fontSize: 15,
    fontWeight: '900',
    color: '#b91c1c',
  },
  menuSub: {
    fontSize: 12,
    fontWeight: '800',
    color: '#64748b',
  },
  menuSubOk: {
    color: '#0f766e',
  },
  menuSubWarn: {
    color: '#b91c1c',
  },
  menuChevron: {
    fontSize: 28,
    fontWeight: '300',
    color: '#94a3b8',
    marginLeft: 4,
  },
  menuChevronDanger: {
    fontSize: 28,
    fontWeight: '300',
    color: 'rgba(185, 28, 28, 0.7)',
    marginLeft: 4,
  },
  trustInlineSection: {
    position: 'relative',
    marginBottom: 8,
    padding: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(15, 23, 42, 0.04)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.1)',
  },
  trustCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  trustCardTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#0f172a',
  },
  trustTierPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(15, 23, 42, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.45)',
  },
  trustTierPillText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#0f172a',
  },
  trustScoreBig: {
    fontSize: 36,
    fontWeight: '900',
    color: '#0f172a',
    letterSpacing: -0.8,
  },
  trustScoreUnit: {
    marginTop: -4,
    fontSize: 13,
    fontWeight: '700',
    color: '#64748b',
  },
  trustPenaltyHint: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
    lineHeight: 17,
  },
  trustRestricted: {
    marginTop: 8,
    fontSize: 13,
    fontWeight: '800',
    color: '#b91c1c',
  },
  levelLine: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: '800',
    color: '#334155',
  },
  levelTrack: {
    marginTop: 8,
    height: 9,
    borderRadius: 6,
    backgroundColor: 'rgba(15, 23, 42, 0.08)',
    overflow: 'hidden',
  },
  levelFill: {
    height: '100%',
    borderRadius: 6,
  },
  trustDropFx: {
    position: 'absolute',
    right: 10,
    top: 44,
  },
  trustDropFxText: {
    fontSize: 28,
    fontWeight: '900',
    color: '#FF3B30',
  },
  screenTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: GinitTheme.colors.text,
    marginBottom: 16,
    letterSpacing: -0.4,
    textShadowColor: 'rgba(255, 255, 255, 0.7)',
    textShadowOffset: { width: 0, height: 0.5 },
    textShadowRadius: 2,
  },
  authMenuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.55)',
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
  },
  authMenuOrangeBadge: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 2.5,
    borderColor: '#FF8A00',
    backgroundColor: 'rgba(255, 138, 0, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  authMenuOrangeInner: {
    width: 10,
    height: 10,
    borderRadius: 3,
    backgroundColor: '#FF8A00',
  },
  authMenuTextCol: {
    flex: 1,
  },
  authMenuTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#0f172a',
  },
  authMenuSub: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
    lineHeight: 16,
  },
  authMenuChevron: {
    fontSize: 28,
    fontWeight: '300',
    color: '#94a3b8',
    marginLeft: 4,
  },
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
    fontWeight: '900',
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
    fontWeight: '900',
    color: '#0052CC',
  },
  termsLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
    lineHeight: 20,
  },
  termsLabelLocked: {
    color: '#64748b',
  },
  phoneVerifiedDone: {
    marginTop: 6,
    fontSize: 15,
    fontWeight: '800',
    color: '#0f766e',
    lineHeight: 22,
  },
  profileCard: {
    marginTop: 0,
    borderColor: 'rgba(255, 255, 255, 0.55)',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
    color: '#0f172a',
  },
  hint: {
    fontSize: 14,
    color: '#64748b',
    lineHeight: 20,
    marginBottom: 16,
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
  phone: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0f172a',
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
    fontWeight: '900',
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
    fontWeight: '800',
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
    fontWeight: '900',
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
    fontWeight: '900',
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
    fontWeight: '900',
    color: '#7c2d12',
  },
  otpBtnDisabled: {
    opacity: 0.5,
  },
  otpError: {
    marginTop: 8,
    color: '#b91c1c',
    fontSize: 12,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.85,
  },
  input: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#0f172a',
    backgroundColor: '#fff',
  },
  previewWrap: {
    marginTop: 10,
    alignSelf: 'center',
    borderRadius: 40,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#e2e8f0',
  },
  preview: {
    width: 80,
    height: 80,
  },
  historyBtn: {
    marginTop: 20,
  },
  historyHint: {
    marginTop: 8,
    fontSize: 13,
    color: '#64748b',
    lineHeight: 18,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  deleteAccountBtn: {
    marginTop: 18,
    alignSelf: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  deleteAccountBtnPressed: {
    opacity: 0.75,
  },
  deleteAccountLabel: {
    fontSize: 14,
    fontWeight: '800',
    color: '#b91c1c',
    textDecorationLine: 'underline',
  },
});
