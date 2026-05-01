import { useFocusEffect } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  LayoutChangeEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  ToastAndroid,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GinitCard } from '@/components/ginit';
import { ScreenShell } from '@/components/ui';
import { GinitTheme } from '@/constants/ginit-theme';
import { HomeGlassStyles } from '@/constants/home-glass-styles';
import { useUserSession } from '@/src/context/UserSessionContext';
import { normalizeUserId } from '@/src/lib/app-user-id';
import {
  effectiveGTrust,
  levelBarFillColorForTrust,
  trustTierForUser,
  xpProgressWithinLevel,
} from '@/src/lib/ginit-trust';
import { uploadProfilePhoto } from '@/src/lib/profile-photo';
import { ensureUserProfile, updateUserProfile, type UserProfile } from '@/src/lib/user-profile';

import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';

export default function ProfileTab() {
  const router = useRouter();
  const { userId, authProfile } = useUserSession();
  const scrollRef = useRef<ScrollView>(null);
  const profilePk = useMemo(() => {
    const u = userId?.trim();
    if (u) return u;
    const em = authProfile?.email?.trim();
    if (em) return normalizeUserId(em) ?? '';
    return '';
  }, [userId, authProfile?.email]);

  const [photoUploadBusy, setPhotoUploadBusy] = useState(false);
  const [nickname, setNickname] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
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
      const nextTrust = effectiveGTrust(p);
      setGTrust(nextTrust);
      setGXp(typeof p.gXp === 'number' && Number.isFinite(p.gXp) ? Math.trunc(p.gXp) : 0);
      setGLevel(typeof p.gLevel === 'number' && Number.isFinite(p.gLevel) ? Math.max(1, Math.trunc(p.gLevel)) : 1);
      setPenaltyCount(typeof p.penaltyCount === 'number' && Number.isFinite(p.penaltyCount) ? Math.max(0, Math.trunc(p.penaltyCount)) : 0);
      setIsRestricted(p.isRestricted === true);
    } catch {
      setNickname('');
      setPhotoUrl('');
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

  const onGoEditProfile = useCallback(() => {
    router.push('/profile/edit');
  }, [router]);

  const onPressProfileMenu = useCallback(() => {
    router.push('/profile/settings');
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

  // 프로필 편집(닉네임/사진 업로드 등)은 `/profile/edit`에서 수행합니다.

  const onGoLogin = useCallback(() => {
    router.replace('/login');
  }, [router]);

  return (
    <ScreenShell padded={false} style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={[styles.fixedHeader, { paddingHorizontal: 20 }]}>
          <View style={styles.headerTop}>
            <Text style={styles.screenHeaderTitle} accessibilityRole="header">
              프로필
            </Text>
            <View style={styles.headerIcons}>
              <Pressable
                accessibilityLabel="프로필 편집"
                hitSlop={8}
                onPress={onGoEditProfile}
                style={styles.iconBtn}>
                <GinitSymbolicIcon name="account-edit-outline" size={22} color="#0f172a" />
              </Pressable>
              <Pressable
                accessibilityLabel="설정"
                hitSlop={8}
                onPress={onPressProfileMenu}
                style={styles.iconBtn}>
                <GinitSymbolicIcon name="settings-outline" size={22} color="#0f172a" />
              </Pressable>
            </View>
          </View>
        </View>

        <ScrollView
          ref={scrollRef}
          style={styles.scrollFlex}
          contentContainerStyle={[HomeGlassStyles.scrollPad, styles.scrollBottom]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.headerWrap}>
            <View style={styles.headerRow}>
              <Pressable
                onPress={() => void onPickHeaderProfilePhoto()}
                disabled={photoUploadBusy}
                style={({ pressed }) => [styles.avatarWrap, pressed && !photoUploadBusy && styles.pressed]}
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

          {!isSignedIn ? (
            <View style={styles.menuListWrap}>
              <Pressable
                onPress={onGoLogin}
                style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="로그인">
                <View style={styles.menuLeft}>
                  <View style={styles.menuIconWrap}>
                    <GinitSymbolicIcon name="log-in-outline" size={18} color="#0f172a" />
                  </View>
                  <View style={styles.menuTextCol}>
                    <Text style={styles.menuTitle}>로그인</Text>
                  </View>
                </View>
                <Text style={styles.menuChevron}>›</Text>
              </Pressable>
            </View>
          ) : null}
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
  scrollFlex: { flex: 1 },
  fixedHeader: {
    paddingTop: 12,
    paddingBottom: 10,
    backgroundColor: GinitTheme.colors.bg,
    zIndex: 3,
  },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  screenHeaderTitle: { fontSize: 20, fontWeight: '700', color: GinitTheme.colors.text, flex: 1 },
  headerIcons: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  iconBtn: { padding: 6, borderRadius: 10 },
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
    fontWeight: '600',
    color: '#0f172a',
  },
  headerTextCol: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  headerName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#0f172a',
    letterSpacing: -0.3,
  },
  headerSub: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
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
    fontWeight: '600',
    color: '#0f172a',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0f172a',
    marginBottom: 10,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 11,
    paddingHorizontal: 14,
    backgroundColor: 'transparent',
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
    fontWeight: '600',
    color: '#0f172a',
  },
  menuTitleDanger: {
    fontSize: 15,
    fontWeight: '600',
    color: '#b91c1c',
  },
  menuSub: {
    fontSize: 12,
    fontWeight: '600',
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
  menuListWrap: {
    marginTop: 12,
  },
  menuSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: GinitTheme.colors.border,
    marginLeft: 44,
  },
  trustInlineSection: {
    position: 'relative',
    marginBottom: 8,
    padding: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(15, 23, 42, 0.04)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.34)',
  },
  trustCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  trustCardTitle: {
    fontSize: 16,
    fontWeight: '600',
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
    fontWeight: '600',
    color: '#0f172a',
  },
  trustScoreBig: {
    fontSize: 36,
    fontWeight: '600',
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
    fontWeight: '600',
    color: '#b91c1c',
  },
  levelLine: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: '600',
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
    fontWeight: '600',
    color: '#FF3B30',
  },
  screenTitle: {
    fontSize: 22,
    fontWeight: '600',
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
    fontWeight: '600',
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
    fontWeight: '600',
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
    fontWeight: '600',
    color: '#b91c1c',
    textDecorationLine: 'underline',
  },
});
