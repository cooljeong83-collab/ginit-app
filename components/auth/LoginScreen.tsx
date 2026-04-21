import { BlurView } from 'expo-blur';
import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
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
import { setPendingConsentAction } from '@/src/lib/terms-consent-flow';

const UI_LOG = '[GinitAuth:LoginUI]';

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

type LogoDest = { x: number; y: number; width: number; height: number };

export default function LoginScreen() {
  const router = useRouter();
  const win = useWindowDimensions();
  const { isHydrated, setAuthProfile } = useUserSession();
  const [busyGoogle, setBusyGoogle] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
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
  const peopleExtrasRef = useRef<GooglePeopleExtras | null>(null);

  useEffect(() => {
    try {
      const a = getFirebaseAuth();
      return onAuthStateChanged(a, (u) => {
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
          setAuthProfile(snapshotFromFirebaseUser(meta.user));
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
  }, [setAuthProfile]);

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

  const onGoogleSignUp = useCallback(async () => {
    setLoginError(null);
    setBusyGoogle(true);
    try {
      const { user, googleAccessToken } = await signInWithGoogle({ forRegistration: true });
      const people = await fetchGooglePeopleExtras(googleAccessToken);
      peopleExtrasRef.current = people;
      setAuthProfile(buildAuthSnapshot(user, people));
    } catch (e) {
      const code = e && typeof e === 'object' && 'code' in e ? String((e as { code?: string }).code) : '';
      const message = e instanceof Error ? e.message : '알 수 없는 오류';
      if (code === REDIRECT_STARTED) return;
      setLoginError(`${message}${code ? ` (${code})` : ''}`);
      Alert.alert('Google 연동 실패', code ? `${code}\n${message}` : message);
    } finally {
      setBusyGoogle(false);
    }
  }, [setAuthProfile]);

  const isExpoGo = Constants.appOwnership === 'expo';

  const goSignUp = useCallback(() => {
    // 약관 동의 완료 후 회원가입 화면으로 이동
    setPendingConsentAction(null);
    router.push({ pathname: '/terms-agreement', params: { next: '/sign-up?consented=1' } });
  }, [router]);

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

                <Pressable
                  onPress={goSignUp}
                  disabled={false}
                  style={({ pressed }) => [
                    styles.signupNavBtn,
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="가입하기 — 회원가입 화면으로 이동">
                  <Text style={styles.signupNavBtnLabel}>가입하기</Text>
                </Pressable>
                <Text style={styles.signupNavHint}>회원가입 화면에서 전화번호 인증과 필수 정보를 입력합니다.</Text>

                <SnsEasySignUpSection
                  onGooglePress={() => {
                    setPendingConsentAction(async () => {
                      await onGoogleSignUp();
                      // 약관 동의 화면이 최종 이동을 담당합니다.
                    });
                    router.push({ pathname: '/terms-agreement', params: { next: '/(tabs)' } });
                  }}
                  googleDisabled={isExpoGo && Platform.OS !== 'web'}
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
