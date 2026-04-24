import { useFocusEffect } from '@react-navigation/native';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  BackHandler,
  Easing,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  ToastAndroid,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { authScreenStyles as authFormStyles } from '@/components/auth/authScreenStyles';
import { GinitButton, GinitCard } from '@/components/ginit';
import { ScreenShell } from '@/components/ui';
import { HomeGlassStyles } from '@/constants/home-glass-styles';
import { GinitTheme } from '@/constants/ginit-theme';
import { useUserSession } from '@/src/context/UserSessionContext';
import { normalizeUserId } from '@/src/lib/app-user-id';
import {
  type SignUpGenderCode,
} from '@/src/hooks/useSignUpFlow';
import {
  deleteFirebaseAuthUserBestEffort,
  purgeUserAccountRemote,
  purgeUserAccountRemoteByFirebaseUid,
  wipeLocalAppData,
} from '@/src/lib/account-deletion';
import {
  effectiveGTrust,
  levelBarFillColorForTrust,
  trustTierForUser,
  xpProgressWithinLevel,
} from '@/src/lib/ginit-trust';
import {
  ensureUserProfile,
  isGoogleSnsDemographicsIncomplete,
  isUserPhoneVerified,
  type UserProfile,
  updateUserProfile,
} from '@/src/lib/user-profile';
import { formatNormalizedPhoneKrDisplay, normalizePhoneUserId } from '@/src/lib/phone-user-id';
import { AuthService } from '@/src/services/AuthService';
import { Timestamp, serverTimestamp } from 'firebase/firestore';

import { BirthdateWheel } from '@/components/auth/BirthdateWheel';
import { uploadProfilePhoto } from '@/src/lib/profile-photo';

export default function ProfileTab() {
  const router = useRouter();
  const { userId, authProfile, signOutSession } = useUserSession();
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
  const [demoBusy, setDemoBusy] = useState(false);
  const [nickname, setNickname] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [needsSnsDemographics, setNeedsSnsDemographics] = useState(false);
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
  const [photoUploadBusy, setPhotoUploadBusy] = useState(false);

  const [gTrust, setGTrust] = useState(100);
  const [gXp, setGXp] = useState(0);
  const [gLevel, setGLevel] = useState(1);
  const [penaltyCount, setPenaltyCount] = useState(0);
  const [isRestricted, setIsRestricted] = useState(false);
  const prevTrustRef = useRef<number | null>(null);
  const [trustDropFx, setTrustDropFx] = useState<{ delta: number; id: number } | null>(null);
  const trustDropOpacity = useRef(new Animated.Value(0)).current;
  const trustDropTranslate = useRef(new Animated.Value(0)).current;

  const refreshProfile = useCallback(async () => {
    if (!profilePk) return;
    try {
      const p = await ensureUserProfile(profilePk);
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
    } catch {
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
      void refreshProfile();
    }, [refreshProfile]),
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
      Alert.alert('저장됨', '닉네임과 프로필 사진 설정을 반영했어요.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : '저장에 실패했습니다.';
      Alert.alert('저장 실패', msg);
    } finally {
      setProfileBusy(false);
    }
  }, [profilePk, nickname, photoUrl]);

  const onSaveDemographics = useCallback(async () => {
    if (!profilePk) {
      Alert.alert('안내', '로그인 후 저장할 수 있어요.');
      return;
    }
    if (!genderDemo || !birthDemo.year || !birthDemo.month || !birthDemo.day) {
      Alert.alert('입력 확인', '성별과 생년월일을 모두 선택해 주세요.');
      return;
    }
    setDemoBusy(true);
    try {
      await ensureUserProfile(profilePk);
      const birthDateTs = Timestamp.fromDate(new Date(birthDemo.year, birthDemo.month - 1, birthDemo.day));
      await updateUserProfile(profilePk, {
        gender: genderDemo,
        birthDate: birthDateTs,
      });
      const p = await ensureUserProfile(profilePk);
      setNeedsSnsDemographics(isGoogleSnsDemographicsIncomplete(p));
      setIsPhoneVerified(isUserPhoneVerified(p));
      const phone = p.phone?.trim();
      setVerifiedPhoneLabel(phone ? formatNormalizedPhoneKrDisplay(phone) : null);
      const g = p.gender?.trim();
      setGenderDemo(g === 'MALE' || g === 'FEMALE' ? g : null);
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
      Alert.alert('저장됨', '성별과 생년월일을 반영했어요. 이제 모임을 만들고 참여할 수 있어요.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : '저장에 실패했습니다.';
      Alert.alert('저장 실패', msg);
    } finally {
      setDemoBusy(false);
    }
  }, [profilePk, genderDemo, birthDemo.day, birthDemo.month, birthDemo.year]);

  const canSendOtp = useMemo(() => {
    const normalized = normalizePhoneUserId(phoneField);
    return !!profilePk && !!normalized && !demoBusy && !profileBusy && !otpBusy;
  }, [profilePk, phoneField, demoBusy, profileBusy, otpBusy]);

  const canConfirmOtp = useMemo(() => {
    return !!profilePk && !!otpVerificationId && otpCode.replace(/\D/g, '').length === 6 && !demoBusy && !profileBusy && !otpBusy;
  }, [profilePk, otpVerificationId, otpCode, demoBusy, profileBusy, otpBusy]);

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
      Alert.alert('인증 완료', '전화번호 인증이 완료됐어요.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : '인증 확인에 실패했습니다.';
      setOtpError(msg);
      Alert.alert('인증 실패', msg);
    } finally {
      setOtpBusy(false);
    }
  }, [profilePk, otpVerificationId, otpCode, phoneField]);

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
      Alert.alert('업로드 완료', '프로필 사진을 업데이트했어요.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : '업로드에 실패했습니다.';
      Alert.alert('업로드 실패', msg);
    } finally {
      setPhotoUploadBusy(false);
    }
  }, [profilePk]);

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
      await deleteFirebaseAuthUserBestEffort();
      await signOutSession();
      await wipeLocalAppData();
      const doneMsg = '탈퇴가 완료되었습니다. 그동안 지닛과 함께해주셔서 감사합니다.';
      if (Platform.OS === 'android') {
        ToastAndroid.show(doneMsg, ToastAndroid.LONG);
        setTimeout(() => BackHandler.exitApp(), 400);
        return;
      }
      Alert.alert('탈퇴 완료', doneMsg, [
        {
          text: '확인',
          onPress: () => router.replace('/login'),
        },
      ]);
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
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView
          contentContainerStyle={[HomeGlassStyles.scrollPad, styles.scrollBottom]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <Text style={styles.screenTitle}>프로필</Text>

          <View style={styles.trustCardWrap}>
            <BlurView
              intensity={Platform.OS === 'ios' ? 58 : 36}
              tint="light"
              style={StyleSheet.absoluteFillObject}
              experimentalBlurMethod={Platform.OS === 'ios' ? 'dimezisBlurView' : undefined}
            />
            <LinearGradient
              colors={['rgba(255,255,255,0.55)', 'rgba(255,255,255,0.1)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.trustCardInner}>
              <View style={styles.trustCardTop}>
                <Text style={styles.trustCardTitle}>나의 신뢰도</Text>
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

              <Text style={[styles.label, { marginTop: 14, color: '#475569' }]}>레벨 진행</Text>
              <Text style={styles.levelLine}>
                Lv {gLevel} · XP {gXp} / {xpBar.nextAt}
              </Text>
              <View style={styles.levelTrack}>
                <View
                  style={[styles.levelFill, { width: `${Math.round(xpBar.ratio * 100)}%`, backgroundColor: levelBarColor }]}
                />
              </View>
            </LinearGradient>
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
          </View>

          <GinitCard appearance="light" style={styles.snsGuideCard}>
            <Text style={styles.title}>모임 이용을 위한 정보</Text>
            <Text style={styles.hint}>
              {needsSnsDemographics
                ? 'SNS 간편 가입으로 들어오셨어요. 성별과 연령대를 선택한 뒤 저장하면 모임 만들기·모임 참여를 할 수 있어요. 앱 소개 투어는 그대로 이용할 수 있어요.'
                : '모임 참여를 위해 전화번호 인증이 필요해요. 성별과 연령대는 언제든 수정할 수 있어요.'}
            </Text>

            <Text style={styles.label}>성별 (필수)</Text>
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
                    disabled={demoBusy}
                    onPress={() => setGenderDemo(code)}
                    style={({ pressed }) => [
                      authFormStyles.genderBinaryBtn,
                      selected ? authFormStyles.genderBinaryBtnSelected : authFormStyles.genderBinaryBtnIdle,
                      pressed && !demoBusy && authFormStyles.pressed,
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
            <BirthdateWheel value={birthDemo} onChange={setBirthDemo} disabled={demoBusy} />

            <GinitButton
              title={needsSnsDemographics ? '성별·생년월일 저장' : '성별·생년월일 저장(수정)'}
              variant="primary"
              onPress={() => void onSaveDemographics()}
              disabled={demoBusy || profileBusy}
            />

            <View style={{ height: 14 }} />
            <Text style={styles.label}>전화번호 인증 (필수)</Text>
            <Text style={styles.subHint}>
              {isPhoneVerified ? `인증 완료${verifiedPhoneLabel ? ` · ${verifiedPhoneLabel}` : ''}` : '아직 인증되지 않았어요.'}
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
                  editable={!otpBusy && !demoBusy && !profileBusy}
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
                    onChangeText={(t) => setOtpCode(t.replace(/\D/g, '').slice(0, 6))}
                    placeholder="인증번호 6자리"
                    placeholderTextColor="#94a3b8"
                    style={styles.otpCodeInput}
                    keyboardType="number-pad"
                    inputMode="numeric"
                    textContentType="oneTimeCode"
                    editable={!otpBusy && !demoBusy && !profileBusy}
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
          </GinitCard>

          <GinitCard appearance="light" style={styles.profileCard}>
            <Text style={styles.title}>계정 정보</Text>
            <Text style={styles.hint}>
              {needsSnsDemographics
                ? '닉네임과 프로필 사진은 SNS 연동 시 자동으로 채워질 수 있어요. 위 카드에서 성별·연령대를 저장하면 모임 기능이 열려요.'
                : '닉네임과 프로필 사진(이미지 주소)을 변경할 수 있어요. 가입 직후에는 닉네임이 자동 생성될 수 있어요.'}
            </Text>

            <Text style={styles.label}>회원 ID</Text>
            <Text style={styles.phone}>
              {userId?.trim()
                ? userId
                : authProfile?.email?.trim()
                  ? authProfile.email
                  : authProfile?.firebaseUid?.trim()
                    ? authProfile.firebaseUid
                    : '(없음)'}
            </Text>

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
            />
            {photoUrl.trim() ? (
              <View style={styles.previewWrap}>
                <Image source={{ uri: photoUrl.trim() }} style={styles.preview} contentFit="cover" />
              </View>
            ) : null}

            <GinitButton title="프로필 저장" variant="primary" onPress={() => void onSaveProfile()} disabled={profileBusy} />
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

          <GinitButton
            title="히스토리"
            variant="secondary"
            onPress={() => router.push('/profile/meeting-history')}
            style={styles.historyBtn}
          />
          <Text style={styles.historyHint}>참가했던 모임(참여 중인 모임)을 모아서 확인해요.</Text>
        </ScrollView>
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
  trustCardWrap: {
    marginBottom: 14,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.55)',
    minHeight: 168,
  },
  trustCardInner: {
    padding: 16,
    paddingBottom: 18,
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
    fontSize: 44,
    fontWeight: '900',
    color: '#0f172a',
    letterSpacing: -1,
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
    right: 18,
    top: 52,
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
  snsGuideCard: {
    marginBottom: 14,
    borderColor: 'rgba(245, 158, 11, 0.35)',
    backgroundColor: 'rgba(255, 251, 235, 0.92)',
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
