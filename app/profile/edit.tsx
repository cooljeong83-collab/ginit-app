import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  ToastAndroid,
  useWindowDimensions,
  View
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { GinitButton, GinitCard } from '@/components/ginit';
import { ScreenShell } from '@/components/ui';
import { GinitTheme } from '@/constants/ginit-theme';
import { HomeGlassStyles } from '@/constants/home-glass-styles';
import { useUserSession } from '@/src/context/UserSessionContext';
import { deleteFirebaseAuthUserStrict, purgeUserAccountRemote, purgeUserAccountRemoteByFirebaseUid, wipeLocalAppData } from '@/src/lib/account-deletion';
import { normalizeUserId } from '@/src/lib/app-user-id';
import { safeRouterBack } from '@/src/lib/router-safe';
import { mapGooglePeopleGenderToProfileGender } from '@/src/lib/google-people-extras';
import { formatNormalizedPhoneKrDisplay, normalizePhoneUserId } from '@/src/lib/phone-user-id';
import { uploadProfilePhoto } from '@/src/lib/profile-photo';
import { syncMeetingComplianceToSupabase } from '@/src/lib/supabase-profile-compliance';
import {
  ensureUserProfile,
  firestoreTimestampLikeToDate,
  hasTermsAgreementRecorded,
  isDemographicsIncomplete,
  isMeetingServiceComplianceComplete,
  isUserPhoneVerified,
  meetingDemographicsIncomplete,
  readGooglePeopleDemographicsLocks,
  updateUserProfile,
} from '@/src/lib/user-profile';
import { AuthService } from '@/src/services/AuthService';
import { serverTimestamp, Timestamp } from 'firebase/firestore';

export default function ProfileEditScreen() {
  const router = useRouter();
  const { userId, authProfile, signOutSession } = useUserSession();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const profilePk = useMemo(() => {
    const u = userId?.trim();
    if (u) return u;
    const em = authProfile?.email?.trim();
    if (em) return normalizeUserId(em) ?? '';
    return '';
  }, [userId, authProfile?.email]);

  const [profileBusy, setProfileBusy] = useState(false);
  const [photoUploadBusy, setPhotoUploadBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const [nickname, setNickname] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');

  // 서비스 이용 인증(정보 등록) 모달
  const [genderDemo, setGenderDemo] = useState<'MALE' | 'FEMALE' | null>(null);
  const [birthDemo, setBirthDemo] = useState<{ year: number; month: number; day: number }>(() => ({ year: 1983, month: 1, day: 1 }));
  const [verifiedPhoneLabel, setVerifiedPhoneLabel] = useState<string | null>(null);
  const [isPhoneVerified, setIsPhoneVerified] = useState(false);
  const [phoneField, setPhoneField] = useState('');
  const [otpVerificationId, setOtpVerificationId] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const otpAutoConfirmRef = useRef(false);
  const [authSheetVisible, setAuthSheetVisible] = useState(false);
  const [termsConsentChecked, setTermsConsentChecked] = useState(false);
  const [complianceBusy, setComplianceBusy] = useState(false);
  const [meetingAuthComplete, setMeetingAuthComplete] = useState(false);
  const [googleDemoGenderLocked, setGoogleDemoGenderLocked] = useState(false);
  const [googleDemoBirthLocked, setGoogleDemoBirthLocked] = useState(false);

  const authSheetLayout = useMemo(() => {
    const panelMax = Math.floor(windowHeight * 0.96);
    const panelPadBottom = Math.max(16, insets.bottom);
    const scrollMax = Math.max(280, panelMax - 18 - panelPadBottom - 12);
    return { panelMax, panelPadBottom, scrollMax };
  }, [windowHeight, insets.bottom]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!profilePk) return;
      try {
        const p = await ensureUserProfile(profilePk);
        if (!alive) return;
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
        const locks = readGooglePeopleDemographicsLocks(p);
        setGoogleDemoGenderLocked(locks.genderLocked);
        setGoogleDemoBirthLocked(locks.birthLocked);
        setMeetingAuthComplete(isMeetingServiceComplianceComplete(p, profilePk));
      } catch {
        if (!alive) return;
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
        setGoogleDemoGenderLocked(false);
        setGoogleDemoBirthLocked(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [profilePk]);

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

        const bdDateOpen = firestoreTimestampLikeToDate(p.birthDate);
        if (bdDateOpen) {
          setBirthDemo({
            year: bdDateOpen.getFullYear(),
            month: bdDateOpen.getMonth() + 1,
            day: bdDateOpen.getDate(),
          });
        } else {
          const y = typeof p.birthYear === 'number' ? p.birthYear : null;
          const m = typeof p.birthMonth === 'number' ? p.birthMonth : null;
          const d = typeof p.birthDay === 'number' ? p.birthDay : null;
          if (y) {
            setBirthDemo({ year: y, month: m ?? 1, day: d ?? 1 });
          }
        }
        const locksOpen = readGooglePeopleDemographicsLocks(p);
        setGoogleDemoGenderLocked(locksOpen.genderLocked);
        setGoogleDemoBirthLocked(locksOpen.birthLocked);
      } catch {
        if (!alive) return;
        setTermsConsentChecked(false);
        setMeetingAuthComplete(false);
        setGoogleDemoGenderLocked(false);
        setGoogleDemoBirthLocked(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [authSheetVisible, profilePk]);

  const onPickAndUploadPhoto = useCallback(async () => {
    if (!profilePk) {
      Alert.alert('안내', '로그인 후 업로드할 수 있어요.');
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
        // 선택 후 크롭(영역 지정) → 확인 버튼으로 진행
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
      setPhotoUrl(url);
      await updateUserProfile(profilePk, { photoUrl: url });
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (Platform.OS === 'android') ToastAndroid.show('프로필 사진이 반영됐어요.', ToastAndroid.SHORT);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '업로드에 실패했습니다.';
      Alert.alert('업로드 실패', msg);
    } finally {
      setPhotoUploadBusy(false);
    }
  }, [profilePk]);

  const onSaveProfile = useCallback(async () => {
    if (!profilePk) {
      Alert.alert('안내', '로그인 후 프로필을 저장할 수 있어요.');
      return;
    }
    setProfileBusy(true);
    try {
      const pCur = await ensureUserProfile(profilePk);
      const patch: Parameters<typeof updateUserProfile>[1] = {
        nickname: nickname.trim(),
        photoUrl: photoUrl.trim() || null,
      };
      /** SNS 가입 보완: 시트에서만 입력한 성별·생일은 별도 ‘인증 저장’ 전에도 닉네임 저장 시 함께 반영해야 뒤로 가도 사라지지 않음 */
      if (isDemographicsIncomplete(pCur)) {
        if (!googleDemoGenderLocked && genderDemo) {
          patch.gender = genderDemo;
        }
        if (
          !googleDemoBirthLocked &&
          birthDemo.year > 0 &&
          birthDemo.month > 0 &&
          birthDemo.day > 0
        ) {
          patch.birthDate = Timestamp.fromDate(new Date(birthDemo.year, birthDemo.month - 1, birthDemo.day));
        }
      }
      await updateUserProfile(profilePk, patch);
      await ensureUserProfile(profilePk);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('저장됨', '프로필을 반영했어요.');
      safeRouterBack(router);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '저장에 실패했습니다.';
      Alert.alert('저장 실패', msg);
    } finally {
      setProfileBusy(false);
    }
  }, [profilePk, nickname, photoUrl, router, genderDemo, birthDemo, googleDemoGenderLocked, googleDemoBirthLocked]);

  const canSendOtp = useMemo(() => {
    const normalized = normalizePhoneUserId(phoneField);
    return !!profilePk && !!normalized && !profileBusy && !otpBusy && !complianceBusy;
  }, [profilePk, phoneField, profileBusy, otpBusy, complianceBusy]);

  const canConfirmOtp = useMemo(() => {
    return !!profilePk && !!otpVerificationId && otpCode.replace(/\D/g, '').length === 6 && !profileBusy && !otpBusy && !complianceBusy;
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
      await updateUserProfile(profilePk, { phone: normalized, phoneVerifiedAt: serverTimestamp() });
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
    const digits = otpCode.replace(/\\D/g, '').slice(0, 6);
    if (digits.length < 6) {
      otpAutoConfirmRef.current = false;
      return;
    }
    if (otpAutoConfirmRef.current) return;
    if (!canConfirmOtp) return;
    otpAutoConfirmRef.current = true;
    void onConfirmOtp();
  }, [otpCode, otpVerificationId, canConfirmOtp, onConfirmOtp]);

  const refreshEditProfile = useCallback(async () => {
    if (!profilePk) return;
    const p = await ensureUserProfile(profilePk);
    setMeetingAuthComplete(isMeetingServiceComplianceComplete(p, profilePk));
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
  }, [profilePk]);

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
      const p = await ensureUserProfile(profilePk);
      const phoneE164 = p.phone?.trim() ?? normalizePhoneUserId(phoneField)?.trim() ?? '';
      if (!phoneE164 || !phoneE164.startsWith('+')) throw new Error('전화번호 정보를 찾지 못했습니다.');
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
      await refreshEditProfile();
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
    refreshEditProfile,
  ]);

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
      const res = sessionUserId ? await purgeUserAccountRemote(sessionUserId) : await purgeUserAccountRemoteByFirebaseUid(firebaseUid);
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

  const avatarInitial = useMemo(() => {
    const n = nickname.trim();
    if (!n) return '?';
    return n.slice(0, 1).toUpperCase();
  }, [nickname]);

  return (
    <ScreenShell padded={false} style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={[HomeGlassStyles.scrollPad, styles.scrollBottom]} showsVerticalScrollIndicator={false}>
          <View style={styles.heroWrap}>
            <View style={styles.heroInner}>
              <View style={styles.heroTopRow}>
                <Pressable
                  onPress={() => safeRouterBack(router)}
                  style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel="뒤로">
                  <Ionicons name="chevron-back" size={26} color={GinitTheme.colors.text} />
                </Pressable>
              </View>
              <Text style={styles.heroTitle}>프로필 편집</Text>
              <Text style={styles.heroSubtitle}>모임에서 보이는 이름과 사진을 바꿀 수 있어요.</Text>

              <Pressable
                onPress={() => void onPickAndUploadPhoto()}
                disabled={photoUploadBusy || profileBusy || deleteBusy || busy}
                style={({ pressed }) => [styles.avatarPress, pressed && !(photoUploadBusy || profileBusy || deleteBusy || busy) && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="프로필 사진 바꾸기"
                accessibilityHint="갤러리에서 사진을 선택합니다">
                <View style={styles.avatarRing}>
                  {photoUrl.trim() ? (
                    <Image source={{ uri: photoUrl.trim() }} style={styles.avatarImg} contentFit="cover" />
                  ) : (
                    <View style={styles.avatarFallback}>
                      <Text style={styles.avatarFallbackText}>{avatarInitial}</Text>
                    </View>
                  )}
                  <View style={styles.avatarCameraBadge} pointerEvents="none">
                    {photoUploadBusy ? (
                      <ActivityIndicator size="small" color={GinitTheme.colors.primary} />
                    ) : (
                      <Ionicons name="camera" size={16} color={GinitTheme.colors.primary} />
                    )}
                  </View>
                </View>
              </Pressable>
              <Text style={styles.avatarHint}></Text>
            </View>
          </View>

          <GinitCard appearance="light" style={[styles.card, styles.cardOverlap]}>
            
            <View style={styles.nicknameHeader}>
              <Text style={styles.labelInline}>닉네임</Text>
              <Text style={styles.charCount}>{nickname.length}/24</Text>
            </View>
            <TextInput
              value={nickname}
              onChangeText={setNickname}
              placeholder="모임에서 보이는 이름"
              placeholderTextColor={GinitTheme.colors.textMuted}
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={24}
              keyboardType="default"
              inputMode="text"
              editable={!profileBusy && !deleteBusy}
            />

            <View style={styles.saveBlock}>
              <GinitButton title={profileBusy ? '저장 중…' : '변경 사항 저장'} variant="primary" onPress={() => void onSaveProfile()} disabled={profileBusy} />
            </View>
          </GinitCard>
        </ScrollView>
      </SafeAreaView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: GinitTheme.colors.bg },
  safe: { flex: 1 },
  scrollBottom: { paddingTop: 0, paddingBottom: 36 },
  pressed: { opacity: 0.88 },

  heroWrap: {
    marginHorizontal: -20,
    marginBottom: 6,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    overflow: 'hidden',
  },
  heroInner: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 26,
    backgroundColor: GinitTheme.colors.surfaceStrong,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.95)',
  },
  heroTitle: {
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: -0.75,
    color: GinitTheme.colors.text,
  },
  heroSubtitle: {
    marginTop: 6,
    fontSize: 14,
    fontWeight: '600',
    color: GinitTheme.colors.textSub,
    lineHeight: 20,
    maxWidth: 340,
  },
  avatarPress: {
    alignSelf: 'center',
    marginTop: 18,
  },
  avatarRing: {
    width: 112,
    height: 112,
    borderRadius: 56,
    padding: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: 'rgba(15, 23, 42, 0.18)',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 1,
    shadowRadius: 22,
    elevation: 8,
  },
  avatarImg: {
    width: 104,
    height: 104,
    borderRadius: 52,
  },
  avatarFallback: {
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: 'rgba(31, 42, 68, 0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
  },
  avatarFallbackText: {
    fontSize: 38,
    fontWeight: '900',
    color: GinitTheme.colors.primary,
    letterSpacing: -1,
  },
  avatarCameraBadge: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: GinitTheme.colors.surfaceStrong,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
    shadowColor: 'rgba(15, 23, 42, 0.12)',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 4,
  },
  avatarHint: {
    marginTop: 10,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '700',
    color: GinitTheme.colors.textMuted,
  },

  card: {
    borderColor: 'rgba(255, 255, 255, 0.55)',
    marginBottom: GinitTheme.spacing.md,
  },
  cardOverlap: {
    marginTop: -34,
    zIndex: 2,
  },
  sectionEyebrow: {
    fontSize: 11,
    fontWeight: '800',
    color: GinitTheme.colors.textMuted,
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: -0.35,
    color: GinitTheme.colors.text,
    marginBottom: 8,
  },
  nicknameHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  labelInline: {
    fontSize: 12,
    fontWeight: '800',
    color: GinitTheme.colors.textMuted,
  },
  charCount: {
    fontSize: 12,
    fontWeight: '700',
    color: GinitTheme.colors.textMuted,
  },
  divider: {
    height: StyleSheet.hairlineWidth * 2,
    backgroundColor: GinitTheme.colors.border,
    marginVertical: GinitTheme.spacing.md,
  },
  label: { fontSize: 12, fontWeight: '700', color: '#64748b', marginTop: 12, marginBottom: 4 },
  subHint: {
    fontSize: 13,
    fontWeight: '600',
    color: GinitTheme.colors.textMuted,
    lineHeight: 18,
    marginBottom: GinitTheme.spacing.sm,
  },
  input: {
    minHeight: 48,
    borderRadius: 14,
    paddingHorizontal: GinitTheme.spacing.md,
    backgroundColor: GinitTheme.colors.bgAlt,
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
    color: GinitTheme.colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  saveBlock: {
    marginTop: GinitTheme.spacing.lg,
  },
  complianceHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: GinitTheme.spacing.md,
    marginBottom: GinitTheme.spacing.md,
  },
  complianceIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 15,
    backgroundColor: GinitTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  complianceTextCol: {
    flex: 1,
    minWidth: 0,
  },
  complianceTitle: {
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: -0.3,
    color: GinitTheme.colors.text,
  },
  complianceSub: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: '600',
    color: GinitTheme.colors.textMuted,
    lineHeight: 18,
  },

  deleteAccountBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 0,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(220, 38, 38, 0.22)',
    backgroundColor: 'rgba(254, 242, 242, 0.65)',
  },
  deleteAccountBtnPressed: { opacity: 0.88 },
  deleteIcon: { marginTop: 1 },
  deleteAccountLabel: { fontSize: 15, fontWeight: '900', color: GinitTheme.colors.danger },

  sheetKbWrap: { flex: 1 },
  sheetRoot: { flex: 1 },
  sheetBackdropFill: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15, 23, 42, 0.45)' },
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
  sheetScrollContent: { paddingBottom: 4 },
  sheetGrabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(15, 23, 42, 0.12)',
    marginBottom: 12,
  },
  sheetTitle: { fontSize: 20, fontWeight: '900', color: '#0f172a', marginBottom: 6 },
  sheetLead: { fontSize: 14, fontWeight: '600', color: '#64748b', lineHeight: 20, marginBottom: 14 },
  termsRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 4 },
  termsRowLocked: { opacity: 0.92 },
  termsBox: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  termsBoxUnchecked: { borderColor: '#FF8A00', backgroundColor: 'rgba(255, 138, 0, 0.08)' },
  termsBoxChecked: { borderColor: '#0052CC', backgroundColor: 'rgba(0, 82, 204, 0.12)' },
  termsCheckMark: { fontSize: 16, fontWeight: '900', color: '#0052CC' },
  termsLabel: { flex: 1, fontSize: 14, fontWeight: '800', color: '#0f172a', lineHeight: 20 },
  termsLabelLocked: { color: '#64748b' },
  phoneVerifiedDone: {
    marginTop: 6,
    fontSize: 15,
    fontWeight: '800',
    color: '#0f766e',
    lineHeight: 22,
  },
  phoneVerifiedBanner: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(134, 211, 183, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(134, 211, 183, 0.28)',
  },
  phoneVerifiedBadge: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(15, 118, 110, 0.14)',
    color: '#0f766e',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: -0.1,
    overflow: 'hidden',
  },
  phoneVerifiedText: {
    flex: 1,
    color: '#0f172a',
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 20,
  },
  otpBlock: {
    marginTop: 10,
    padding: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  otpLabel: { fontSize: 13, fontWeight: '900', color: '#0f172a', marginBottom: 8 },
  otpRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
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
  otpSendText: { fontSize: 13, fontWeight: '900', color: '#061a3b' },
  otpConfirmBtn: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    backgroundColor: 'rgba(0, 82, 204, 0.16)',
  },
  otpConfirmText: { fontSize: 13, fontWeight: '900', color: '#061a3b' },
  otpBtnDisabled: { opacity: 0.35 },
  otpError: { marginTop: 8, fontSize: 12, fontWeight: '700', color: '#b91c1c' },
});

