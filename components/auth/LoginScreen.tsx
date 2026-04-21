import { BlurView } from 'expo-blur';
import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  Animated,
  BackHandler,
  Easing,
  InteractionManager,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  ToastAndroid,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LOGIN_LOGO_IMAGE_PX, LOGIN_LOGO_INTRO_MS, SPLASH_LOGO_FRAME_PX } from '@/constants/login-logo-intro';
import { GinitTheme } from '@/constants/ginit-theme';
import { authScreenStyles as styles } from '@/components/auth/authScreenStyles';
import { SnsEasySignUpSection } from '@/components/auth/SnsEasySignUpSection';
import { KeyboardAwareScreenScroll, ScreenShell } from '@/components/ui';
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
import { ensureUserProfile } from '@/src/lib/user-profile';

const UI_LOG = '[GinitAuth:LoginUI]';

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

type LogoDest = { x: number; y: number; width: number; height: number };

export default function LoginScreen() {
  const router = useRouter();
  const routeParams = useLocalSearchParams<{ phone?: string | string[] }>();
  const win = useWindowDimensions();
  const { isHydrated, setPhoneUserId, setAuthProfile } = useUserSession();
  const [phoneField, setPhoneField] = useState('');
  const [busyGoogle, setBusyGoogle] = useState(false);
  const [busyAutoLogin, setBusyAutoLogin] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [memberStatus, setMemberStatus] = useState<MemberStatus>('unknown');
  const fade = useRef(new Animated.Value(1)).current;
  const intro = useRef(new Animated.Value(0)).current;
  /** -1…1 → 좌우 갸우뚱(인사) */
  const logoTilt = useRef(new Animated.Value(0)).current;
  const logoTiltRotate = useMemo(
    () =>
      logoTilt.interpolate({
        inputRange: [-1, 0, 1],
        outputRange: ['-11deg', '0deg', '11deg'],
      }),
    [logoTilt],
  );
  const logoWrapRef = useRef<View>(null);
  const [logoDest, setLogoDest] = useState<LogoDest | null>(null);
  const introStartedRef = useRef(false);
  const backPressRef = useRef(0);
  const phoneBindUidRef = useRef<string | null>(null);
  const peopleExtrasRef = useRef<GooglePeopleExtras | null>(null);
  const autoLoginPhoneRef = useRef<string | null>(null);
  const phoneFieldRef = useRef(phoneField);
  const prefillFromRouteDoneRef = useRef(false);
  phoneFieldRef.current = phoneField;

  const debouncedPhone = useDebounced(phoneField, 480);
  const loginNormalized = normalizePhoneUserId(phoneField);

  useEffect(() => {
    if (prefillFromRouteDoneRef.current) return;
    const raw = routeParams.phone;
    const s = Array.isArray(raw) ? raw[0] : raw;
    if (typeof s === 'string' && s.trim()) {
      prefillFromRouteDoneRef.current = true;
      setPhoneField(s.trim());
    }
  }, [routeParams.phone]);

  useEffect(() => {
    if (!loginNormalized) autoLoginPhoneRef.current = null;
  }, [loginNormalized]);
  const debouncedNormalized = normalizePhoneUserId(debouncedPhone);
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
      setAuthProfile(buildAuthSnapshot(user, people));
      await bindPhoneAfterGoogle(user, preservedPhone);
    } catch (e) {
      const code = e && typeof e === 'object' && 'code' in e ? String((e as { code?: string }).code) : '';
      const message = e instanceof Error ? e.message : '알 수 없는 오류';
      if (code === REDIRECT_STARTED) return;
      setLoginError(`${message}${code ? ` (${code})` : ''}`);
      Alert.alert('Google 연동 실패', code ? `${code}\n${message}` : message);
    } finally {
      setBusyGoogle(false);
    }
  }, [bindPhoneAfterGoogle, setAuthProfile, phoneField]);

  const isExpoGo = Constants.appOwnership === 'expo';

  const goSignUp = useCallback(() => {
    const trimmed = phoneField.trim();
    if (trimmed) {
      router.push({ pathname: '/sign-up', params: { phone: trimmed } });
    } else {
      router.push('/sign-up');
    }
  }, [router, phoneField]);

  const onIntroLogoLayout = useCallback(() => {
    if (logoDest != null) return;
    const node = logoWrapRef.current;
    if (!node) return;
    node.measureInWindow((x, y, w, h) => {
      if (w <= 0 || h <= 0) return;
      setLogoDest({ x, y, width: w, height: h });
    });
  }, [logoDest]);

  const introMotion = useMemo(() => {
    if (!logoDest) return null;
    const { x, y, width, height } = logoDest;
    const tx = intro.interpolate({
      inputRange: [0, 1],
      outputRange: [win.width / 2 - width / 2 - x, 0],
    });
    const ty = intro.interpolate({
      inputRange: [0, 1],
      outputRange: [win.height / 2 - height / 2 - y, 0],
    });
    const scale = intro.interpolate({
      inputRange: [0, 1],
      outputRange: [SPLASH_LOGO_FRAME_PX / width, 1],
    });
    const contentOpacity = intro.interpolate({
      inputRange: [0, 0.18, 1],
      outputRange: [0, 0.92, 1],
    });
    return { tx, ty, scale, contentOpacity };
  }, [logoDest, win.width, win.height, intro]);

  useLayoutEffect(() => {
    if (!logoDest || introStartedRef.current) return;
    if (Platform.OS === 'web') {
      intro.setValue(1);
      introStartedRef.current = true;
      return;
    }
    introStartedRef.current = true;
    intro.setValue(0);
    const run = () => {
      void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
        if (reduce) {
          intro.setValue(1);
          return;
        }
        Animated.timing(intro, {
          toValue: 1,
          duration: LOGIN_LOGO_INTRO_MS,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start();
      });
    };
    const task = InteractionManager.runAfterInteractions(() => {
      requestAnimationFrame(run);
    });
    return () => {
      task.cancel();
    };
  }, [logoDest, intro]);

  useEffect(() => {
    if (!logoDest || Platform.OS === 'web') return;
    let cancelled = false;
    let loop: Animated.CompositeAnimation | null = null;
    const start = () => {
      if (cancelled) return;
      void AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
        if (cancelled || reduced) return;
        logoTilt.setValue(0);
        loop = Animated.loop(
          Animated.sequence([
            Animated.timing(logoTilt, {
              toValue: 1,
              duration: 620,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
            Animated.timing(logoTilt, {
              toValue: -1,
              duration: 720,
              easing: Easing.inOut(Easing.cubic),
              useNativeDriver: true,
            }),
            Animated.timing(logoTilt, {
              toValue: 0,
              duration: 620,
              easing: Easing.in(Easing.cubic),
              useNativeDriver: true,
            }),
            Animated.delay(560),
          ]),
        );
        loop.start();
      });
    };
    const t = setTimeout(start, LOGIN_LOGO_INTRO_MS + 120);
    return () => {
      cancelled = true;
      clearTimeout(t);
      loop?.stop();
      logoTilt.setValue(0);
    };
  }, [logoDest, logoTilt]);

  if (!isHydrated) {
    return (
      <View style={styles.bootCenter}>
        <ActivityIndicator size="large" color={GinitTheme.trustBlue} />
        <Text style={styles.bootHint}>불러오는 중…</Text>
      </View>
    );
  }

  return (
    <Animated.View style={[styles.rootWrap, { opacity: fade }]}>
      <ScreenShell padded={false} style={styles.screen}>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <KeyboardAwareScreenScroll
            contentContainerStyle={[styles.scroll, loginScreenStyles.scrollTweak]}
            extraScrollHeight={18}
            extraHeight={32}>
            <View style={[styles.topBrand, loginScreenStyles.topBrand]}>
              <Animated.View
                ref={logoWrapRef}
                nativeID="logo_shared"
                testID="logo_shared"
                onLayout={onIntroLogoLayout}
                collapsable={false}
                style={[
                  loginScreenStyles.logoFrame,
                  logoDest && introMotion
                    ? {
                        opacity: 1,
                        transform: [
                          { translateX: introMotion.tx },
                          { translateY: introMotion.ty },
                          { scale: introMotion.scale },
                        ],
                      }
                    : { opacity: 0 },
                ]}>
                <Animated.View style={{ transform: [{ rotate: logoTiltRotate }] }}>
                  <Image
                    source={require('@/assets/images/logo-symbol.png')}
                    style={loginScreenStyles.logoImage}
                    contentFit="contain"
                  />
                </Animated.View>
              </Animated.View>
              <Animated.View
                style={[
                  logoDest && introMotion ? { opacity: introMotion.contentOpacity } : { opacity: 0 },
                  loginScreenStyles.brandTextCol,
                ]}>
                <Text style={loginScreenStyles.brandKr}>지닛</Text>
                <Text style={[styles.greeting, loginScreenStyles.greetingCenter]}>
                  반가워요!{'\n'}우리만의 모임을 시작해볼까요?
                </Text>
              </Animated.View>
            </View>

            <Animated.View style={logoDest && introMotion ? { opacity: introMotion.contentOpacity } : { opacity: 0 }}>
              <View style={styles.authCard}>
                <BlurView
                  pointerEvents="none"
                  intensity={32}
                  tint="light"
                  style={StyleSheet.absoluteFill}
                  experimentalBlurMethod={Platform.OS === 'ios' ? 'dimezisBlurView' : undefined}
                />
                <View pointerEvents="none" style={styles.cardGlow} />
                <View pointerEvents="none" style={styles.cardBorder} />

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
                  <View style={[styles.countryCodeBtn, styles.countryCodeBtnReadOnly]} pointerEvents="none">
                    <Text style={styles.countryCodeText}>+82</Text>
                    <Text style={styles.countryCodeArrow}>▾</Text>
                  </View>
                  <TextInput
                    value={phoneField}
                    placeholder="전화번호 입력 (- 없이)"
                    placeholderTextColor="#94a3b8"
                    style={[styles.phoneInputNew, styles.phoneInputReadOnly]}
                    keyboardType="phone-pad"
                    autoCapitalize="none"
                    editable={false}
                  />
                </View>

                <Pressable
                  onPress={goSignUp}
                  disabled={busyAutoLogin}
                  style={({ pressed }) => [
                    styles.signupNavBtn,
                    busyAutoLogin && styles.btnDisabled,
                    pressed && !busyAutoLogin && styles.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="가입하기 — 회원가입 화면으로 이동">
                  <Text style={styles.signupNavBtnLabel}>가입하기</Text>
                </Pressable>
                <Text style={styles.signupNavHint}>신규 회원은 회원가입 화면에서 정보를 입력합니다.</Text>

                <SnsEasySignUpSection
                  onGooglePress={() => void onGoogleSignUp()}
                  googleDisabled={busyAutoLogin || (isExpoGo && Platform.OS !== 'web')}
                  googleLoading={busyGoogle}
                />

                {loginError ? <Text style={styles.errorText}>{loginError}</Text> : null}
              </View>

              <View style={styles.footerRule} />
              <Text style={styles.footerCredit}>UI/UX Vision by Ginit Human-Connection Team.</Text>
            </Animated.View>
          </KeyboardAwareScreenScroll>
        </SafeAreaView>
      </ScreenShell>
    </Animated.View>
  );
}

const loginScreenStyles = StyleSheet.create({
  scrollTweak: {
    paddingTop: 10,
    gap: 20,
  },
  topBrand: {
    paddingTop: 16,
    paddingBottom: 22,
    gap: 0,
  },
  logoFrame: {
    width: LOGIN_LOGO_IMAGE_PX,
    height: LOGIN_LOGO_IMAGE_PX,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  logoImage: {
    width: LOGIN_LOGO_IMAGE_PX,
    height: LOGIN_LOGO_IMAGE_PX,
  },
  brandTextCol: {
    alignSelf: 'stretch',
    alignItems: 'center',
    width: '100%',
    marginTop: 14,
  },
  brandKr: {
    fontSize: 28,
    fontWeight: '900',
    color: GinitTheme.colors.primary,
    letterSpacing: -0.55,
    textAlign: 'center',
    alignSelf: 'stretch',
    lineHeight: 34,
  },
  greetingCenter: {
    marginTop: 14,
    paddingTop: 2,
    textAlign: 'center',
    alignSelf: 'stretch',
  },
});
