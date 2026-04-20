import { BlurView } from 'expo-blur';
import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  BackHandler,
  KeyboardAvoidingView,
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

import { GinitPlaceholderColor, GinitStyles } from '@/constants/GinitStyles';
import { GinitTheme } from '@/constants/ginit-theme';
import { ScreenShell } from '@/components/ui';
import { type AuthProfileSnapshot, useUserSession } from '@/src/context/UserSessionContext';
import { getFirebaseAuth } from '@/src/lib/firebase';
import { fetchGooglePeopleExtras, type GooglePeopleExtras } from '@/src/lib/google-people-extras';
import {
  consumeGoogleRedirectResultWithMeta,
  REDIRECT_STARTED,
  signInWithGoogle,
} from '@/src/lib/google-sign-in';
import { fetchAndroidPhoneHint } from '@/src/lib/phone-hint';
import { isPhoneRegistered, registerPhoneIfNew } from '@/src/lib/phone-registry';
import { formatNormalizedPhoneKrDisplay, normalizePhoneUserId } from '@/src/lib/phone-user-id';
import { applyGoogleSignupProfile, ensureUserProfile, generateRandomNickname } from '@/src/lib/user-profile';

const UI_LOG = '[GinitAuth:LoginUI]';

const LOGIN_BACKGROUND_URI =
  'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?auto=format&fit=crop&w=2160&q=85';

type MemberStatus = 'unknown' | 'checking' | 'member' | 'guest';

function logUi(step: string, extra?: Record<string, unknown>) {
  if (extra && Object.keys(extra).length > 0) {
    console.log(UI_LOG, new Date().toISOString(), step, extra);
  } else {
    console.log(UI_LOG, new Date().toISOString(), step);
  }
}

function isGoogleSignedUser(u: User | null): boolean {
  if (!u || u.isAnonymous) return false;
  return u.providerData.some((p) => p.providerId === 'google.com');
}

function snapshotFromFirebaseUser(u: User): AuthProfileSnapshot {
  return {
    displayName: u.displayName ?? null,
    email: u.email ?? null,
    photoUrl: u.photoURL ?? null,
    firebaseUid: u.uid ?? null,
  };
}

function buildAuthSnapshot(u: User, people: GooglePeopleExtras | null): AuthProfileSnapshot {
  return {
    ...snapshotFromFirebaseUser(u),
    gender: people?.gender ?? null,
    birthYear: people?.birthYear ?? null,
  };
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function ageFromBirthYear(year: number | null | undefined): number | null {
  if (year == null || !Number.isFinite(year)) return null;
  const y = new Date().getFullYear() - year;
  return y >= 0 && y < 130 ? y : null;
}

export default function LoginScreen() {
  const router = useRouter();
  const { isHydrated, setPhoneUserId, setAuthProfile } = useUserSession();
  const [phoneField, setPhoneField] = useState('');
  const [busyGoogle, setBusyGoogle] = useState(false);
  const [busyStart, setBusyStart] = useState(false);
  const [busyAutoLogin, setBusyAutoLogin] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [peopleExtrasState, setPeopleExtrasState] = useState<GooglePeopleExtras | null>(null);
  const [memberStatus, setMemberStatus] = useState<MemberStatus>('unknown');
  const fade = useRef(new Animated.Value(1)).current;
  const backPressRef = useRef(0);
  const phoneBindUidRef = useRef<string | null>(null);
  const peopleExtrasRef = useRef<GooglePeopleExtras | null>(null);
  const autoLoginPhoneRef = useRef<string | null>(null);
  const phoneFieldRef = useRef(phoneField);
  phoneFieldRef.current = phoneField;

  const debouncedPhone = useDebounced(phoneField, 480);
  const loginNormalized = normalizePhoneUserId(phoneField);

  useEffect(() => {
    if (!loginNormalized) autoLoginPhoneRef.current = null;
  }, [loginNormalized]);
  const debouncedNormalized = normalizePhoneUserId(debouncedPhone);
  const hasGoogleSession = isGoogleSignedUser(firebaseUser);
  /** 전화번호는 구글 계정이 아니라 기기(SIM, DeviceInfo)에서만 채웁니다. */
  const bindPhoneAfterGoogle = useCallback(async (_user: User, preserveNormalized: string | null) => {
    if (preserveNormalized) {
      setPhoneField(formatNormalizedPhoneKrDisplay(preserveNormalized));
      return;
    }
    if (Platform.OS === 'android') {
      const hinted = await fetchAndroidPhoneHint();
      if (hinted) {
        const n = normalizePhoneUserId(hinted);
        if (n) {
          setPhoneField(formatNormalizedPhoneKrDisplay(n));
          return;
        }
        setPhoneField(hinted);
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (Platform.OS === 'android') {
        try {
          const hinted = await fetchAndroidPhoneHint();
          if (cancelled) return;
          if (hinted) {
            const n = normalizePhoneUserId(hinted);
            setPhoneField(n ? formatNormalizedPhoneKrDisplay(n) : hinted);
          }
        } catch {
          /* */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      const a = getFirebaseAuth();
      setFirebaseUser(a.currentUser);
      return onAuthStateChanged(a, (u) => {
        setFirebaseUser(u);
        if (u && isGoogleSignedUser(u)) {
          const pe = peopleExtrasRef.current;
          setAuthProfile({
            ...snapshotFromFirebaseUser(u),
            gender: pe?.gender ?? null,
            birthYear: pe?.birthYear ?? null,
          });
        } else if (!u || !isGoogleSignedUser(u)) {
          setAuthProfile(null);
          peopleExtrasRef.current = null;
          setPeopleExtrasState(null);
        }
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(UI_LOG, 'Firebase Auth 구독 실패', msg);
      return undefined;
    }
  }, [setAuthProfile]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let alive = true;
    (async () => {
      try {
        const meta = await consumeGoogleRedirectResultWithMeta();
        if (!alive) return;
        if (meta.status === 'success') {
          logUi('web redirect consume SUCCESS', { uid: meta.user.uid });
          const preserved = normalizePhoneUserId(phoneFieldRef.current);
          setAuthProfile(snapshotFromFirebaseUser(meta.user));
          await bindPhoneAfterGoogle(meta.user, preserved);
        } else if (meta.status === 'error') {
          setLoginError(meta.message + (meta.code ? ` (${meta.code})` : ''));
          Alert.alert('리다이렉트 로그인 실패', meta.code ? `${meta.code}\n${meta.message}` : meta.message);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setLoginError(msg);
      }
    })();
    return () => {
      alive = false;
    };
  }, [setAuthProfile, bindPhoneAfterGoogle]);

  useEffect(() => {
    if (!firebaseUser || !isGoogleSignedUser(firebaseUser)) {
      phoneBindUidRef.current = null;
      return;
    }
    if (normalizePhoneUserId(phoneField)) return;
    if (phoneBindUidRef.current === firebaseUser.uid) return;
    phoneBindUidRef.current = firebaseUser.uid;
    void bindPhoneAfterGoogle(firebaseUser, null);
  }, [firebaseUser, phoneField, bindPhoneAfterGoogle]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const now = Date.now();
      if (now - backPressRef.current < 2200) {
        BackHandler.exitApp();
        return true;
      }
      backPressRef.current = now;
      ToastAndroid.show('한 번 더 누르면 앱이 종료돼요.', ToastAndroid.SHORT);
      return true;
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!debouncedNormalized) {
      setMemberStatus('unknown');
      return;
    }
    setMemberStatus('checking');
    (async () => {
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

  const goHomeAnimated = useCallback(() => {
    Animated.timing(fade, {
      toValue: 0,
      duration: 320,
      useNativeDriver: true,
    }).start(() => {
      router.replace('/(tabs)');
    });
  }, [fade, router]);

  useEffect(() => {
    if (memberStatus !== 'member' || !loginNormalized) return;
    if (autoLoginPhoneRef.current === loginNormalized) return;
    autoLoginPhoneRef.current = loginNormalized;
    let cancelled = false;
    setBusyAutoLogin(true);
    void (async () => {
      try {
        await registerPhoneIfNew(loginNormalized);
        await setPhoneUserId(loginNormalized);
        await ensureUserProfile(loginNormalized);
        logUi('기존 회원 자동 로그인', { normalized: loginNormalized });
        if (!cancelled) goHomeAnimated();
      } catch (e) {
        autoLoginPhoneRef.current = null;
        const msg = e instanceof Error ? e.message : String(e);
        if (!cancelled) {
          setLoginError(msg);
          Alert.alert('자동 로그인 실패', msg);
        }
      } finally {
        if (!cancelled) setBusyAutoLogin(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [memberStatus, loginNormalized, setPhoneUserId, goHomeAnimated]);

  const onGoogleSignUp = useCallback(async () => {
    setLoginError(null);
    setBusyGoogle(true);
    const preservedPhone = normalizePhoneUserId(phoneField);
    try {
      const { user, googleAccessToken } = await signInWithGoogle({ forRegistration: true });
      const people = await fetchGooglePeopleExtras(googleAccessToken);
      peopleExtrasRef.current = people;
      setPeopleExtrasState(people);
      setAuthProfile(buildAuthSnapshot(user, people));
      await bindPhoneAfterGoogle(user, preservedPhone);
    } catch (e) {
      const code = e && typeof e === 'object' && 'code' in e ? String((e as { code?: string }).code) : '';
      const message = e instanceof Error ? e.message : '알 수 없는 오류';
      if (code === REDIRECT_STARTED) return;
      setLoginError(`${message}${code ? ` (${code})` : ''}`);
      Alert.alert('가입 실패', code ? `${code}\n${message}` : message);
    } finally {
      setBusyGoogle(false);
    }
  }, [bindPhoneAfterGoogle, setAuthProfile, phoneField]);

  const onCompleteSignup = useCallback(async () => {
    const n = normalizePhoneUserId(phoneField);
    if (!n) {
      Alert.alert('안내', '전화번호를 확인해 주세요.');
      return;
    }
    if (!firebaseUser || !hasGoogleSession) {
      Alert.alert('안내', '먼저 하단에서 Google로 가입을 진행해 주세요.');
      return;
    }
    setLoginError(null);
    setBusyStart(true);
    try {
      const pe = peopleExtrasRef.current;
      const rawName = firebaseUser.displayName?.trim() ?? '';
      const nickBase = rawName.split(/\s+/)[0]?.trim() || '';
      const nickname = nickBase.slice(0, 16) || generateRandomNickname();
      await applyGoogleSignupProfile(n, {
        nickname,
        photoUrl: firebaseUser.photoURL ?? null,
        email: firebaseUser.email ?? null,
        displayName: firebaseUser.displayName ?? null,
        gender: pe?.gender ?? null,
        birthYear: pe?.birthYear ?? null,
        birthMonth: pe?.birthMonth ?? null,
        birthDay: pe?.birthDay ?? null,
        firebaseUid: firebaseUser.uid,
      });
      await registerPhoneIfNew(n);
      await setPhoneUserId(n);
      await ensureUserProfile(n);
      logUi('구글 가입 완료 후 홈 이동', { normalized: n });
      goHomeAnimated();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '저장에 실패했습니다.';
      setLoginError(msg);
      Alert.alert('가입 완료 실패', msg);
    } finally {
      setBusyStart(false);
    }
  }, [phoneField, firebaseUser, hasGoogleSession, setPhoneUserId, goHomeAnimated]);

  const isExpoGo = Constants.appOwnership === 'expo';
  const ageLabel = ageFromBirthYear(peopleExtrasState?.birthYear ?? null);
  const showSignupButton = memberStatus === 'guest' && !!loginNormalized && !busyAutoLogin;

  if (!isHydrated) {
    return (
      <View style={styles.bootCenter}>
        <ActivityIndicator size="large" color={GinitTheme.trustBlue} />
        <Text style={styles.bootHint}>불러오는 중…</Text>
      </View>
    );
  }

  const onPressSignup = async () => {
    const n = normalizePhoneUserId(phoneField);
    if (!n) {
      Alert.alert('안내', '전화번호를 확인해 주세요.');
      return;
    }
    if (memberStatus !== 'guest') return;
    if (busyGoogle || busyStart) return;
    if (isExpoGo && Platform.OS !== 'web') {
      Alert.alert('안내', 'Expo Go에서는 Google 네이티브 로그인을 지원하지 않아요. 개발 빌드로 테스트해 주세요.');
      return;
    }

    setLoginError(null);
    setBusyStart(true);
    try {
      // Google 연동 (기존 구글 연동과 동일)
      const { user, googleAccessToken } = await signInWithGoogle({ forRegistration: true });
      const people = await fetchGooglePeopleExtras(googleAccessToken);
      peopleExtrasRef.current = people;
      setPeopleExtrasState(people);
      setAuthProfile(buildAuthSnapshot(user, people));
      await bindPhoneAfterGoogle(user, n);

      // 가입 완료(프로필 + 레지스트리)까지 한 번에 처리
      const rawName = user.displayName?.trim() ?? '';
      const nickBase = rawName.split(/\s+/)[0]?.trim() || '';
      const nickname = nickBase.slice(0, 16) || generateRandomNickname();
      await applyGoogleSignupProfile(n, {
        nickname,
        photoUrl: user.photoURL ?? null,
        email: user.email ?? null,
        displayName: user.displayName ?? null,
        gender: people?.gender ?? null,
        birthYear: people?.birthYear ?? null,
        birthMonth: people?.birthMonth ?? null,
        birthDay: people?.birthDay ?? null,
        firebaseUid: user.uid,
      });
      await registerPhoneIfNew(n);
      await setPhoneUserId(n);
      await ensureUserProfile(n);
      logUi('가입하기 CTA 완료 후 홈 이동', { normalized: n });
      goHomeAnimated();
    } catch (e) {
      const code = e && typeof e === 'object' && 'code' in e ? String((e as { code?: string }).code) : '';
      const message = e instanceof Error ? e.message : '알 수 없는 오류';
      if (code === REDIRECT_STARTED) return;
      setLoginError(`${message}${code ? ` (${code})` : ''}`);
      Alert.alert('가입 실패', code ? `${code}\n${message}` : message);
    } finally {
      setBusyStart(false);
    }
  };

  return (
    <Animated.View style={[styles.rootWrap, { opacity: fade }]}>
      <ScreenShell padded={false} style={styles.screen}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : 'padding'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 6 : 0}>
          <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
            <ScrollView
              contentContainerStyle={styles.scroll}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}>
              <View style={styles.topBrand}>
                <Image source={require('@/assets/images/logo-symbol.png')} style={styles.brandSymbol} contentFit="contain" />
                <Text style={styles.brandName}>Ginit</Text>
                <Text style={styles.greeting}>반가워요!{'\n'}우리만의 모임을 시작해볼까요?</Text>
              </View>

              <View style={styles.authCard}>
                <BlurView
                  intensity={32}
                  tint="light"
                  style={StyleSheet.absoluteFill}
                  experimentalBlurMethod={Platform.OS === 'ios' ? 'dimezisBlurView' : undefined}
                />
                <View style={styles.cardGlow} />
                <View style={styles.cardBorder} />

                {isExpoGo && Platform.OS !== 'web' ? (
                  <View style={styles.expoGoBannerCompact}>
                    <Text style={styles.expoGoTitle}>개발 빌드가 필요해요</Text>
                    <Text style={styles.expoGoBody}>
                      Google 네이티브 로그인은 Expo Go에 포함되어 있지 않습니다.{' '}
                      <Text style={styles.expoGoMono}>npx expo run:android</Text>
                    </Text>
                  </View>
                ) : null}

                {busyAutoLogin ? (
                  <View style={styles.checkingRow}>
                    <ActivityIndicator color={GinitTheme.colors.primary} />
                    <Text style={styles.checkingLabel}>등록된 회원으로 로그인하는 중…</Text>
                  </View>
                ) : null}

                {memberStatus === 'checking' && debouncedNormalized && !busyAutoLogin ? (
                  <View style={styles.checkingRow}>
                    <ActivityIndicator color={GinitTheme.colors.primary} />
                    <Text style={styles.checkingLabel}>회원 여부 확인 중…</Text>
                  </View>
                ) : null}

                {memberStatus === 'member' && loginNormalized && !busyAutoLogin ? (
                  <Text style={styles.memberBadge}>이 번호는 이미 지닛에 등록되어 있어요. 잠시만 기다려 주세요.</Text>
                ) : null}

                <View style={styles.phoneRow}>
                  <Pressable
                    onPress={() => Alert.alert('준비중', '국가 코드는 현재 +82만 지원합니다.')}
                    style={({ pressed }) => [styles.countryCodeBtn, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel="국가 코드 선택">
                    <Text style={styles.countryCodeText}>+82</Text>
                    <Text style={styles.countryCodeArrow}>▾</Text>
                  </Pressable>
                  <TextInput
                    value={phoneField}
                    onChangeText={setPhoneField}
                    placeholder="전화번호 입력 (- 없이)"
                    placeholderTextColor="#94a3b8"
                    style={styles.phoneInputNew}
                    keyboardType="phone-pad"
                    autoCapitalize="none"
                    editable={!busyAutoLogin}
                  />
                </View>

                {showSignupButton ? (
                  <Pressable
                    onPress={() => void onPressSignup()}
                    disabled={busyStart || busyGoogle}
                    style={({ pressed }) => [
                      styles.signupBtn,
                      (busyStart || busyGoogle) && styles.btnDisabled,
                      pressed && !(busyStart || busyGoogle) && styles.pressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="가입하기">
                    <LinearGradient
                      colors={['rgba(134, 211, 183, 0.98)', 'rgba(115, 199, 255, 0.92)']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.signupBtnBg}
                    />
                    <View style={styles.signupBtnInner}>
                      <View style={styles.signupTextCol}>
                        <Text style={styles.signupBtnLabel}>{busyStart ? '[ 가입 중… ]' : '[ 가입하기 ]'}</Text>
                        <Text style={styles.signupBtnSub} numberOfLines={1}>
                          &gt; initiating_sign_up…
                        </Text>
                      </View>
                      <Image
                        source={require('@/assets/images/logo-symbol.png')}
                        style={styles.signupBtnIcon}
                        contentFit="contain"
                      />
                    </View>
                  </Pressable>
                ) : null}

                {loginError ? <Text style={styles.errorText}>{loginError}</Text> : null}
              </View>

              <Text style={styles.orLabel}>또는 소셜 계정으로 시작하기</Text>
              <View style={styles.socialRow}>
                <Pressable
                  onPress={onGoogleSignUp}
                  disabled={busyGoogle || (isExpoGo && Platform.OS !== 'web')}
                  style={({ pressed }) => [styles.socialBtn, pressed && styles.pressed, busyGoogle && styles.btnDisabled]}
                  accessibilityRole="button"
                  accessibilityLabel="Google 연동">
                  <Text style={[styles.socialLabel, styles.socialLabelGoogle]}>G</Text>
                </Pressable>
                <Pressable
                  onPress={() => Alert.alert('준비중', '네이버 연동은 준비 중입니다.')}
                  style={({ pressed }) => [styles.socialBtn, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel="네이버 연동">
                  <Text style={[styles.socialLabel, styles.socialLabelNaver]}>N</Text>
                </Pressable>
                <Pressable
                  onPress={() => Alert.alert('준비중', '카카오 연동은 준비 중입니다.')}
                  style={({ pressed }) => [styles.socialBtn, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel="카카오 연동">
                  <Text style={[styles.socialLabel, styles.socialLabelKakao]}>K</Text>
                </Pressable>
              </View>

              <View style={styles.footerRule} />
              <Text style={styles.footerCredit}>UI/UX Vision by Ginit Human-Connection Team.</Text>
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </ScreenShell>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  rootWrap: { flex: 1 },
  screen: { backgroundColor: GinitTheme.colors.bg },
  flex: { flex: 1 },
  bootCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GinitTheme.colors.bg,
    gap: 12,
  },
  bootHint: { fontSize: 14, fontWeight: '600', color: GinitTheme.colors.textMuted },
  safe: { flex: 1 },
  scroll: {
    paddingHorizontal: GinitTheme.spacing.xl,
    paddingTop: 18,
    paddingBottom: 34,
    flexGrow: 1,
    gap: 14,
  },

  topBrand: { alignItems: 'center', paddingTop: 10, paddingBottom: 6 },
  brandSymbol: { width: 92, height: 92 },
  brandName: {
    fontSize: 32,
    fontWeight: '900',
    color: GinitTheme.colors.primary,
    letterSpacing: -1.0,
    marginTop: 6,
  },
  greeting: {
    textAlign: 'center',
    marginTop: 10,
    fontSize: 18,
    fontWeight: '900',
    color: GinitTheme.colors.text,
    lineHeight: 24,
  },

  authCard: {
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
    backgroundColor: GinitTheme.colors.surface,
    padding: 18,
    shadowColor: GinitTheme.shadow.card.shadowColor,
    shadowOffset: GinitTheme.shadow.card.shadowOffset,
    shadowOpacity: GinitTheme.shadow.card.shadowOpacity,
    shadowRadius: GinitTheme.shadow.card.shadowRadius,
    elevation: GinitTheme.shadow.card.elevation,
  },
  cardGlow: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(134, 211, 183, 0.08)' },
  cardBorder: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.70)',
    pointerEvents: 'none',
  },

  expoGoBannerCompact: {
    borderRadius: 14,
    backgroundColor: 'rgba(255, 248, 230, 0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255, 138, 0, 0.35)',
    padding: 12,
    marginBottom: 12,
    gap: 6,
  },
  expoGoTitle: { fontSize: 14, fontWeight: '900', color: '#9a3412' },
  expoGoBody: { fontSize: 12, fontWeight: '600', color: '#7c2d12', lineHeight: 18 },
  expoGoMono: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontWeight: '800' },

  checkingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  checkingLabel: { fontSize: 13, fontWeight: '700', color: '#475569' },
  memberBadge: { fontSize: 13, fontWeight: '700', color: GinitTheme.trustBlue, marginBottom: 12, lineHeight: 19 },

  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  countryCodeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 48,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.65)',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.10)',
  },
  countryCodeText: { fontSize: 15, fontWeight: '800', color: '#0f172a' },
  countryCodeArrow: { fontSize: 14, fontWeight: '900', color: '#334155', marginTop: -2 },
  phoneInputNew: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.10)',
    backgroundColor: 'rgba(255, 255, 255, 0.65)',
    paddingHorizontal: 14,
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },

  signupBtn: { marginTop: 14, borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.35)' },
  signupBtnBg: { ...StyleSheet.absoluteFillObject },
  signupBtnInner: {
    paddingHorizontal: 18,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  signupTextCol: { flex: 1, minWidth: 0, gap: 4 },
  signupBtnLabel: { fontSize: 16, fontWeight: '900', color: '#e2e8f0' },
  signupBtnSub: { fontSize: 12, fontWeight: '700', color: 'rgba(226, 232, 240, 0.85)' },
  signupBtnIcon: { width: 34, height: 34, opacity: 0.92 },

  orLabel: { marginTop: 6, textAlign: 'center', fontSize: 13, fontWeight: '700', color: '#64748b' },
  socialRow: { flexDirection: 'row', justifyContent: 'center', gap: 18, marginTop: 6 },
  socialBtn: {
    width: 58,
    height: 58,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.75)',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.10)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0b1426',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 10,
  },
  socialLabel: { fontSize: 22, fontWeight: '900' },
  socialLabelGoogle: { color: '#1f2937' },
  socialLabelNaver: { color: '#16a34a' },
  socialLabelKakao: { color: '#111827' },

  footerRule: { height: 1, backgroundColor: 'rgba(148, 163, 184, 0.55)', marginTop: 10 },
  footerCredit: { marginTop: 10, textAlign: 'center', fontSize: 12, fontWeight: '600', color: '#64748b' },

  btnDisabled: { opacity: 0.48 },
  pressed: { opacity: 0.9 },
  errorText: { marginTop: 12, fontSize: 13, fontWeight: '700', color: '#DC2626', lineHeight: 18 },
});
