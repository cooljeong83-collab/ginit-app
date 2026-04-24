import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  BackHandler,
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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { GinitButton, GinitCard } from '@/components/ginit';
import { ScreenShell } from '@/components/ui';
import { HomeGlassStyles } from '@/constants/home-glass-styles';
import { GinitTheme } from '@/constants/ginit-theme';
import { authScreenStyles as authFormStyles } from '@/components/auth/authScreenStyles';
import { BirthdateWheel } from '@/components/auth/BirthdateWheel';
import { useUserSession } from '@/src/context/UserSessionContext';
import { normalizeUserId } from '@/src/lib/app-user-id';
import { deleteFirebaseAuthUserBestEffort, purgeUserAccountRemote, purgeUserAccountRemoteByFirebaseUid, wipeLocalAppData } from '@/src/lib/account-deletion';
import { Timestamp, serverTimestamp } from 'firebase/firestore';
import { formatNormalizedPhoneKrDisplay, normalizePhoneUserId } from '@/src/lib/phone-user-id';
import { syncMeetingComplianceToSupabase } from '@/src/lib/supabase-profile-compliance';
import { AuthService } from '@/src/services/AuthService';
import {
  ensureUserProfile,
  firestoreTimestampLikeToDate,
  isGoogleSnsDemographicsIncomplete,
  isUserPhoneVerified,
  updateUserProfile,
} from '@/src/lib/user-profile';
import { uploadProfilePhoto } from '@/src/lib/profile-photo';

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
  const [needsSnsDemographics, setNeedsSnsDemographics] = useState(false);
  const [genderDemo, setGenderDemo] = useState<'MALE' | 'FEMALE' | null>(null);
  const [birthDemo, setBirthDemo] = useState<{ year: number; month: number; day: number }>(() => ({ year: 1983, month: 1, day: 1 }));
  const [verifiedPhoneLabel, setVerifiedPhoneLabel] = useState<string | null>(null);
  const [isPhoneVerified, setIsPhoneVerified] = useState(false);
  const [phoneField, setPhoneField] = useState('');
  const [otpVerificationId, setOtpVerificationId] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [authSheetVisible, setAuthSheetVisible] = useState(false);
  const [termsConsentChecked, setTermsConsentChecked] = useState(false);
  const [complianceBusy, setComplianceBusy] = useState(false);

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
        setNeedsSnsDemographics(isGoogleSnsDemographicsIncomplete(p));
        setIsPhoneVerified(isUserPhoneVerified(p));
        const phone = p.phone?.trim();
        setVerifiedPhoneLabel(phone ? formatNormalizedPhoneKrDisplay(phone) : null);
        setPhoneField(phone ? formatNormalizedPhoneKrDisplay(phone) : '');
        const g = p.gender?.trim();
        setGenderDemo(g === 'MALE' || g === 'FEMALE' ? g : null);
        const bd = p.birthDate as unknown;
        const bdDate =
          bd && typeof bd === 'object' && 'toDate' in bd && typeof (bd as { toDate?: unknown }).toDate === 'function'
            ? (bd as { toDate: () => Date }).toDate()
            : null;
        if (bdDate) {
          setBirthDemo({ year: bdDate.getFullYear(), month: bdDate.getMonth() + 1, day: bdDate.getDate() });
        }
      } catch {
        if (!alive) return;
        setNickname('');
        setPhotoUrl('');
        setNeedsSnsDemographics(false);
        setIsPhoneVerified(false);
        setVerifiedPhoneLabel(null);
        setPhoneField('');
        setOtpVerificationId(null);
        setOtpCode('');
        setOtpError(null);
        setGenderDemo(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [profilePk]);

  useEffect(() => {
    if (authSheetVisible) setTermsConsentChecked(false);
  }, [authSheetVisible]);

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
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
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
      });
      setPhotoUrl(url);
      await updateUserProfile(profilePk, { photoUrl: url });
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('업로드 완료', '프로필 사진을 업데이트했어요.');
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
      await ensureUserProfile(profilePk);
      await updateUserProfile(profilePk, {
        nickname: nickname.trim(),
        photoUrl: photoUrl.trim() || null,
      });
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('저장됨', '닉네임과 프로필 사진 설정을 반영했어요.');
      router.back();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '저장에 실패했습니다.';
      Alert.alert('저장 실패', msg);
    } finally {
      setProfileBusy(false);
    }
  }, [profilePk, nickname, photoUrl, router]);

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

  const refreshEditProfile = useCallback(async () => {
    if (!profilePk) return;
    const p = await ensureUserProfile(profilePk);
    setNeedsSnsDemographics(isGoogleSnsDemographicsIncomplete(p));
    setIsPhoneVerified(isUserPhoneVerified(p));
    const phone = p.phone?.trim();
    setVerifiedPhoneLabel(phone ? formatNormalizedPhoneKrDisplay(phone) : null);
    setPhoneField(phone ? formatNormalizedPhoneKrDisplay(phone) : '');
  }, [profilePk]);

  const onSubmitMeetingCompliance = useCallback(async () => {
    if (!profilePk) {
      Alert.alert('안내', '로그인 후 진행할 수 있어요.');
      return;
    }
    if (!termsConsentChecked) {
      Alert.alert('동의 필요', '모임 이용 정보 수집 및 이용에 동의해 주세요.');
      return;
    }
    if (needsSnsDemographics) {
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
      await ensureUserProfile(profilePk);
      const compliancePatch: Parameters<typeof updateUserProfile>[1] = { termsAgreedAt: serverTimestamp() };
      if (needsSnsDemographics && genderDemo) {
        compliancePatch.gender = genderDemo;
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
    needsSnsDemographics,
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
      await deleteFirebaseAuthUserBestEffort();
      await signOutSession();
      await wipeLocalAppData();
      const doneMsg = '탈퇴가 완료되었습니다. 그동안 지닛과 함께해주셔서 감사합니다.';
      if (Platform.OS === 'android') {
        ToastAndroid.show(doneMsg, ToastAndroid.LONG);
        setTimeout(() => BackHandler.exitApp(), 400);
        return;
      }
      Alert.alert('탈퇴 완료', doneMsg, [{ text: '확인', onPress: () => router.replace('/login') }]);
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
        '• 진행 중인 모임의 방장인 경우 탈퇴할 수 없습니다(모임 폐쇄 또는 방장 위임 후 가능).\n' +
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
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={[HomeGlassStyles.scrollPad, styles.scrollBottom]} showsVerticalScrollIndicator={false}>
          <View style={styles.topRow}>
            <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]} accessibilityRole="button">
              <Text style={styles.backText}>←</Text>
            </Pressable>
            <Text style={styles.screenTitle}>프로필 편집</Text>
            <View style={{ width: 40 }} />
          </View>

          <GinitCard appearance="light" style={styles.card}>
            <Text style={styles.label}>닉네임</Text>
            <TextInput
              value={nickname}
              onChangeText={setNickname}
              placeholder="모임에서 보이는 이름"
              placeholderTextColor="#94a3b8"
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={24}
              keyboardType="default"
              inputMode="text"
              editable={!profileBusy && !deleteBusy}
            />

            <Text style={styles.label}>프로필 사진 URL (선택)</Text>
            <Text style={styles.subHint}>HTTPS 이미지 주소를 넣으면 모임 참여자 목록에 표시돼요.</Text>
            <GinitButton
              title={photoUploadBusy ? '사진 업로드 중…' : '프로필 사진 업로드'}
              variant="secondary"
              onPress={() => void onPickAndUploadPhoto()}
              disabled={photoUploadBusy || profileBusy || deleteBusy || busy}
            />
            <TextInput
              value={photoUrl}
              onChangeText={setPhotoUrl}
              placeholder="https://…"
              placeholderTextColor="#94a3b8"
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              editable={!profileBusy && !deleteBusy}
            />

            {photoUrl.trim() ? (
              <View style={styles.previewWrap}>
                <Image source={{ uri: photoUrl.trim() }} style={styles.preview} contentFit="cover" />
              </View>
            ) : null}

            <GinitButton title={profileBusy ? '저장 중…' : '저장'} variant="primary" onPress={() => void onSaveProfile()} disabled={profileBusy} />

            <View style={{ marginTop: 10 }}>
              <GinitButton
                title="서비스 이용 인증(정보 등록)"
                variant="secondary"
                onPress={() => setAuthSheetVisible(true)}
                disabled={complianceBusy || otpBusy || profileBusy}
              />
            </View>
          </GinitCard>

          <GinitCard appearance="light" style={styles.card}>
            <GinitButton title="로그아웃" variant="secondary" onPress={onSignOut} disabled={busy || deleteBusy} />
            <Pressable
              onPress={onRequestDeleteAccount}
              disabled={deleteBusy || profileBusy}
              style={({ pressed }) => [styles.deleteAccountBtn, pressed && styles.deleteAccountBtnPressed]}
              accessibilityRole="button"
              accessibilityLabel="회원 탈퇴">
              <Text style={styles.deleteAccountLabel}>{deleteBusy ? '탈퇴 처리 중…' : '회원 탈퇴'}</Text>
            </Pressable>
          </GinitCard>
        </ScrollView>

        <Modal
          visible={authSheetVisible}
          animationType="fade"
          transparent
          onRequestClose={() => {
            if (!complianceBusy) setAuthSheetVisible(false);
          }}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetKbWrap}>
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
                <View style={[styles.sheetPanel, { maxHeight: authSheetLayout.panelMax, paddingBottom: authSheetLayout.panelPadBottom }]}>
                  <ScrollView
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                    style={{ maxHeight: authSheetLayout.scrollMax }}
                    contentContainerStyle={styles.sheetScrollContent}>
                    <Text style={styles.sheetTitle}>서비스 이용 인증</Text>
                    <Text style={styles.sheetLead}>모임 만들기·참여를 위해 정보 수집 동의와 전화번호 인증이 필요해요.</Text>

                    <Pressable
                      onPress={() => !complianceBusy && setTermsConsentChecked(!termsConsentChecked)}
                      style={({ pressed }) => [styles.termsRow, pressed && !complianceBusy && styles.pressed]}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: termsConsentChecked }}
                      accessibilityLabel="모임 이용 정보 수집 및 이용 동의">
                      <View
                        style={[
                          styles.termsBox,
                          termsConsentChecked ? styles.termsBoxChecked : styles.termsBoxUnchecked,
                        ]}>
                        {termsConsentChecked ? <Text style={styles.termsCheckMark}>✓</Text> : null}
                      </View>
                      <Text style={styles.termsLabel}>모임 이용 정보 수집 및 이용 동의 (필수)</Text>
                    </Pressable>

                    {needsSnsDemographics ? (
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
                                disabled={profileBusy || complianceBusy}
                                onPress={() => setGenderDemo(code)}
                                style={({ pressed }) => [
                                  authFormStyles.genderBinaryBtn,
                                  selected ? authFormStyles.genderBinaryBtnSelected : authFormStyles.genderBinaryBtnIdle,
                                  pressed && !(profileBusy || complianceBusy) && authFormStyles.pressed,
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
                        <BirthdateWheel value={birthDemo} onChange={setBirthDemo} disabled={profileBusy || complianceBusy} />
                      </>
                    ) : null}

                    <Text style={[styles.label, { marginTop: 16 }]}>전화번호 인증 (필수)</Text>
                    <Text style={styles.subHint}>
                      {isPhoneVerified ? `인증 완료${verifiedPhoneLabel ? ` · ${verifiedPhoneLabel}` : ''}` : '아직 인증되지 않았어요.'}
                    </Text>

                    <View style={styles.otpBlock}>
                      <Text style={styles.otpLabel}>전화번호</Text>
                      <View style={styles.otpRow}>
                        <TextInput
                          value={phoneField}
                          onChangeText={(t) => {
                            const digits = t.replace(/\\D/g, '').slice(0, 11);
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
                          editable={!otpBusy && !profileBusy && !complianceBusy}
                        />
                        <Pressable
                          onPress={() => void onSendOtp()}
                          disabled={!canSendOtp}
                          style={({ pressed }) => [styles.otpSendBtn, !canSendOtp && styles.otpBtnDisabled, pressed && canSendOtp && styles.pressed]}
                          accessibilityRole="button"
                          accessibilityLabel="인증번호 받기">
                          <Text style={styles.otpSendText}>{otpBusy ? '전송 중…' : '인증번호 받기'}</Text>
                        </Pressable>
                      </View>

                      {otpVerificationId ? (
                        <View style={[styles.otpRow, { marginTop: 8 }]}>
                          <TextInput
                            value={otpCode}
                            onChangeText={(t) => setOtpCode(t.replace(/\\D/g, '').slice(0, 6))}
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

                    <GinitButton
                      title={complianceBusy ? '저장 중…' : '인증 및 정보 저장'}
                      variant="primary"
                      onPress={() => void onSubmitMeetingCompliance()}
                      disabled={complianceBusy || otpBusy || profileBusy}
                    />
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
  safe: { flex: 1 },
  scrollBottom: { paddingTop: 8, paddingBottom: 32 },
  pressed: { opacity: 0.88 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  backBtn: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 20, fontWeight: '900', color: '#0f172a' },
  screenTitle: { fontSize: 20, fontWeight: '900', color: '#0f172a', letterSpacing: -0.4 },
  card: { borderColor: 'rgba(255, 255, 255, 0.55)', marginBottom: 14 },
  label: { fontSize: 12, fontWeight: '700', color: '#64748b', marginTop: 12, marginBottom: 4 },
  subHint: { fontSize: 12, color: '#94a3b8', marginBottom: 6 },
  input: {
    minHeight: 46,
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    color: '#0f172a',
    fontWeight: '800',
  },
  previewWrap: {
    marginTop: 12,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.12)',
  },
  preview: { width: '100%', height: 160 },
  deleteAccountBtn: {
    marginTop: 10,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.12)',
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
  },
  deleteAccountBtnPressed: { opacity: 0.88 },
  deleteAccountLabel: { fontSize: 14, fontWeight: '900', color: '#b91c1c' },

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
  sheetTitle: { fontSize: 20, fontWeight: '900', color: '#0f172a', marginBottom: 6 },
  sheetLead: { fontSize: 14, fontWeight: '600', color: '#64748b', lineHeight: 20, marginBottom: 14 },
  termsRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 4 },
  termsBox: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  termsBoxUnchecked: { borderColor: '#FF8A00', backgroundColor: 'rgba(255, 138, 0, 0.08)' },
  termsBoxChecked: { borderColor: '#0052CC', backgroundColor: 'rgba(0, 82, 204, 0.12)' },
  termsCheckMark: { fontSize: 16, fontWeight: '900', color: '#0052CC' },
  termsLabel: { flex: 1, fontSize: 14, fontWeight: '800', color: '#0f172a', lineHeight: 20 },
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

