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
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  ToastAndroid,
  useWindowDimensions,
  View,
} from 'react-native';
import type { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { SafeAreaView } from 'react-native-safe-area-context';

import { authScreenStyles as styles } from '@/components/auth/authScreenStyles';
import { phoneOtpInlineStyles as otpStyles } from '@/components/auth/phoneOtpStyles';
import { SnsEasySignUpSection } from '@/components/auth/SnsEasySignUpSection';
import { KeyboardAwareScreenScroll, ScreenShell } from '@/components/ui';
import { GinitTheme } from '@/constants/ginit-theme';
import { LOGIN_LOGO_IMAGE_PX, LOGIN_LOGO_INTRO_MS, SPLASH_LOGO_FRAME_PX } from '@/constants/login-logo-intro';
import { useUserSession, type AuthProfileSnapshot } from '@/src/context/UserSessionContext';
import { normalizeUserId } from '@/src/lib/app-user-id';
import { getFirebaseAuth } from '@/src/lib/firebase';
import {
  fetchGooglePeopleExtras,
  mapGooglePeopleGenderToProfileGender,
  type GooglePeopleExtras,
} from '@/src/lib/google-people-extras';
import {
  consumeGoogleRedirectResultWithMeta,
  REDIRECT_STARTED,
  signInWithGoogle,
} from '@/src/lib/google-sign-in';
import { isPhoneRegisteredLocally, registerSignupLocalKeys } from '@/src/lib/phone-registry';
import { normalizePhoneUserId } from '@/src/lib/phone-user-id';
import { writeSecureAuthSession } from '@/src/lib/secure-auth-session';
import { setPendingConsentAction } from '@/src/lib/terms-consent-flow';
import {
  applyGoogleSignupProfile,
  ensureUserProfile,
  generateRandomNickname,
  recordTermsAgreement,
  resolveSessionUserIdFromVerifiedPhone,
  updateUserProfile,
} from '@/src/lib/user-profile';
import { AuthService } from '@/src/services/AuthService';
import type { FirebaseAuthTypes } from '@react-native-firebase/auth';
import { serverTimestamp, Timestamp } from 'firebase/firestore';

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

function pickNicknameFromGoogle(displayName: string, email: string): string {
  const first = displayName.split(/\s+/)[0]?.trim() ?? '';
  if (first.length >= 2) return first.slice(0, 16);
  const local = email.split('@')[0]?.trim() ?? '';
  if (local.length >= 2) return local.slice(0, 16);
  return generateRandomNickname();
}

function snapshotFromPhoneUser(u: FirebaseAuthTypes.User): AuthProfileSnapshot {
  return {
    displayName: u.displayName ?? null,
    email: u.email ?? null,
    photoUrl: u.photoURL ?? null,
    firebaseUid: u.uid ?? null,
  };
}

function paramToString(v: string | string[] | undefined): string {
  if (v == null) return '';
  return Array.isArray(v) ? (v[0] ?? '') : v;
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

type LoginMemberStatus = 'unknown' | 'checking' | 'registered' | 'guest';

export default function LoginScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ phone?: string | string[] }>();
  const initialPhone = useMemo(() => paramToString(params.phone), [params.phone]);
  const win = useWindowDimensions();
  const { isHydrated, setAuthProfile, setUserId } = useUserSession();
  const [busyGoogle, setBusyGoogle] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [phoneField, setPhoneField] = useState('');
  const [loginMemberStatus, setLoginMemberStatus] = useState<LoginMemberStatus>('unknown');
  const [otpVerificationId, setOtpVerificationId] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const otpInputRef = useRef<TextInput | null>(null);
  const loginScrollRef = useRef<KeyboardAwareScrollView | null>(null);
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

  const debouncedPhone = useDebounced(phoneField, 480);
  const debouncedNormalized = useMemo(() => normalizePhoneUserId(debouncedPhone), [debouncedPhone]);
  const normalizedPhone = useMemo(() => normalizePhoneUserId(phoneField), [phoneField]);
  const loginPhoneDigitCount = useMemo(() => phoneField.replace(/\D/g, '').length, [phoneField]);

  useEffect(() => {
    setPhoneField((prev) => (initialPhone && prev === '' ? initialPhone : prev));
  }, [initialPhone]);

  useEffect(() => {
    let cancelled = false;
    if (!debouncedNormalized) {
      setLoginMemberStatus('unknown');
      return;
    }
    setLoginMemberStatus('checking');
    void (async () => {
      try {
        /** OTP 확인 시점과 동일: 실제 로그인 가능한 `users` 문서가 있을 때만 registered */
        const docId = await resolveSessionUserIdFromVerifiedPhone(debouncedNormalized);
        if (cancelled) return;
        if (docId) {
          setLoginMemberStatus('registered');
          return;
        }
        const localMember = await isPhoneRegisteredLocally(debouncedNormalized);
        if (cancelled) return;
        setLoginMemberStatus(localMember ? 'registered' : 'guest');
      } catch {
        if (!cancelled) setLoginMemberStatus('unknown');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debouncedNormalized]);

  useEffect(() => {
    setOtpVerificationId(null);
    setOtpCode('');
    setOtpError(null);
  }, [normalizedPhone]);

  const formatPhoneKrDisplay = useCallback((digitsOnly: string) => {
    const d = digitsOnly.replace(/\D/g, '').slice(0, 11);
    if (d.length <= 3) return d;
    if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
    return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7, 11)}`;
  }, []);

  /** debounce로 조회한 번호와 입력값이 같고, 그 번호로 로그인 가능할 때만 OTP 전송 가능 */
  const phoneMatchesDebouncedLookup =
    !!normalizedPhone && !!debouncedNormalized && normalizedPhone === debouncedNormalized;
  const canSendLoginOtp =
    loginPhoneDigitCount === 11 &&
    phoneMatchesDebouncedLookup &&
    loginMemberStatus === 'registered' &&
    !otpBusy;
  const canConfirmLoginOtp =
    !!otpVerificationId && otpCode.trim().length === 6 && !otpBusy;

  const onSendLoginOtp = useCallback(async () => {
    if (!normalizedPhone || !canSendLoginOtp) return;
    setOtpBusy(true);
    setOtpError(null);
    try {
      const { verificationId } = await AuthService.verifyPhoneNumber(normalizedPhone);
      setOtpVerificationId(verificationId);
      InteractionManager.runAfterInteractions(() => {
        requestAnimationFrame(() => {
          loginScrollRef.current?.scrollToEnd?.(true);
        });
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setOtpError(msg);
    } finally {
      setOtpBusy(false);
    }
  }, [normalizedPhone, canSendLoginOtp]);

  const onConfirmLoginOtp = useCallback(async () => {
    if (!otpVerificationId || !canConfirmLoginOtp || !normalizedPhone) return;
    setOtpBusy(true);
    setOtpError(null);
    try {
      const cred = await AuthService.confirmCode(otpVerificationId, otpCode);
      const uid = cred.user?.uid ?? '';
      if (!uid) throw new Error('인증은 완료됐지만 사용자 정보를 가져올 수 없습니다.');
      const e164 = cred.user.phoneNumber ?? normalizedPhone;
      const n = e164 ? normalizePhoneUserId(e164) : null;
      if (!n) throw new Error('전화번호를 확인할 수 없습니다.');
      const docId = await resolveSessionUserIdFromVerifiedPhone(n);
      if (!docId) {
        throw new Error('회원 정보를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.');
      }
      await setUserId(docId);
      await registerSignupLocalKeys(n, docId);
      await writeSecureAuthSession({ uid, userId: docId });
      await ensureUserProfile(docId);
      // 전화 OTP로 로그인한 경우에도 인증 상태를 사용자 문서에 기록합니다.
      await updateUserProfile(docId, {
        phone: n,
        phoneVerifiedAt: serverTimestamp(),
        lastLoginAt: serverTimestamp(),
        status: 'ACTIVE',
      });
      setAuthProfile(snapshotFromPhoneUser(cred.user));
      router.replace('/(tabs)');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setOtpError(msg);
    } finally {
      setOtpBusy(false);
    }
  }, [
    otpVerificationId,
    otpCode,
    canConfirmLoginOtp,
    normalizedPhone,
    setUserId,
    setAuthProfile,
    router,
  ]);

  useEffect(() => {
    try {
      const a = getFirebaseAuth();
      return onAuthStateChanged(a, (u) => {
        if (!u || u.isAnonymous) {
          peopleExtrasRef.current = null;
          setAuthProfile(null);
          return;
        }
        if (isGoogleSignedUser(u)) {
          const pe = peopleExtrasRef.current;
          setAuthProfile({
            ...snapshotFromFirebaseUser(u),
            gender: mapGooglePeopleGenderToProfileGender(pe?.gender ?? null),
            birthYear: pe?.birthYear ?? null,
          });
        } else {
          setAuthProfile(snapshotFromFirebaseUser(u));
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

      const email = user.email?.trim() ?? '';
      const emailPk = email ? normalizeUserId(email) : null;
      if (!emailPk) {
        throw new Error('이메일이 있는 Google 계정으로 시도해 주세요. (계정에 이메일이 없습니다)');
      }

      const display = user.displayName?.trim() ?? '';
      const nickname = pickNicknameFromGoogle(display, email);
      const photoUrl = user.photoURL?.trim() ? user.photoURL.trim() : null;
      const genderFs = mapGooglePeopleGenderToProfileGender(people?.gender ?? null);
      const py = people?.birthYear ?? null;
      const pm = people?.birthMonth ?? null;
      const pd = people?.birthDay ?? null;
      const birthDateTs =
        py != null && pm != null && pd != null
          ? Timestamp.fromDate(new Date(py, pm - 1, pd))
          : null;

      await applyGoogleSignupProfile(emailPk, {
        nickname,
        photoUrl,
        email: email || null,
        displayName: display ? display.slice(0, 64) : null,
        // Google SNS 가입은 전화 OTP 인증을 거치지 않으므로, 필드는 null로 "생성"만 해 둡니다.
        phone: null,
        phoneVerifiedAt: null,
        signupProvider: 'google_sns',
        // People API 동의 후에만 넘어오는 값만 병합(없으면 기존 문서 값을 덮어쓰지 않음)
        ...(genderFs ? { gender: genderFs } : {}),
        ...(birthDateTs
          ? {
              birthDate: birthDateTs,
              birthYear: py,
              birthMonth: pm,
              birthDay: pd,
            }
          : {}),
        firebaseUid: user.uid,
      });
      await setUserId(emailPk);
      await writeSecureAuthSession({ uid: user.uid, userId: emailPk });
      await registerSignupLocalKeys('', emailPk);
      await recordTermsAgreement(emailPk);
      await ensureUserProfile(emailPk);

      setAuthProfile({
        ...snapshotFromFirebaseUser(user),
        gender: genderFs ?? null,
        birthYear: people?.birthYear ?? null,
        ageBand: null,
      });
    } catch (e) {
      const code = e && typeof e === 'object' && 'code' in e ? String((e as { code?: string }).code) : '';
      const message = e instanceof Error ? e.message : '알 수 없는 오류';
      if (code === REDIRECT_STARTED) return;
      setLoginError(`${message}${code ? ` (${code})` : ''}`);
      Alert.alert('Google 연동 실패', code ? `${code}\n${message}` : message);
    } finally {
      setBusyGoogle(false);
    }
  }, [setAuthProfile, setUserId]);

  const isExpoGo = Constants.appOwnership === 'expo';

  const goSignUp = useCallback(() => {
    // 약관 동의 완료 후 회원가입 화면으로 이동 (로그인에 입력한 전화번호를 가입 화면에 전달)
    setPendingConsentAction(null);
    const digits = phoneField.replace(/\D/g, '').slice(0, 11);
    const phoneQuery =
      digits.length > 0 ? `&phone=${encodeURIComponent(formatPhoneKrDisplay(digits))}` : '';
    router.push({
      pathname: '/terms-agreement',
      params: { next: `/sign-up?consented=1${phoneQuery}` },
    });
  }, [router, phoneField, formatPhoneKrDisplay]);

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
            ref={loginScrollRef}
            contentContainerStyle={[styles.scroll, loginScreenStyles.scrollTweak]}
            extraScrollHeight={12}
            extraHeight={22}>
            <View style={loginScreenStyles.heroWrap}>
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
                  <Image source={require('@/assets/images/logo-symbol.png')} style={loginScreenStyles.logoImage} contentFit="contain" />
                </Animated.View>
              </Animated.View>

              <Animated.View style={[loginScreenStyles.heroTextCol, logoDest && introMotion ? { opacity: introMotion.contentOpacity } : { opacity: 0 }]}>
                <Text style={loginScreenStyles.brandKr}>지닛</Text>
                <Text style={loginScreenStyles.heroTitle}>우리만의 모임을{'\n'}가볍게 시작해요</Text>
                <Text style={loginScreenStyles.heroSub}>Google로 한 번에 시작하고, 필요한 정보는 나중에 채울 수 있어요.</Text>
              </Animated.View>
            </View>

            <Animated.View style={logoDest && introMotion ? { opacity: introMotion.contentOpacity } : { opacity: 0 }}>
              <View style={[styles.authCard, loginScreenStyles.authCardTight, loginScreenStyles.ctaCard]}>
                <BlurView
                  pointerEvents="none"
                  intensity={36}
                  tint="light"
                  style={StyleSheet.absoluteFill}
                  experimentalBlurMethod={Platform.OS === 'ios' ? 'dimezisBlurView' : undefined}
                />
                <View pointerEvents="none" style={styles.cardGlow} />
                <View pointerEvents="none" style={styles.cardBorder} />

                <View style={styles.authCardContent}>
                  {isExpoGo && Platform.OS !== 'web' ? (
                    <View style={[styles.expoGoBannerCompact, loginScreenStyles.expoGoBannerTight]}>
                      <Text style={styles.expoGoTitle}>개발 빌드가 필요해요</Text>
                      <Text style={styles.expoGoBody}>
                        Google 네이티브 로그인은 Expo Go에 포함되어 있지 않습니다.{' '}
                        <Text style={styles.expoGoMono}>npx expo run:android</Text>
                      </Text>
                    </View>
                  ) : null}

                  <SnsEasySignUpSection
                    onGooglePress={() => {
                      setPendingConsentAction(async () => {
                        await onGoogleSignUp();
                      });
                      router.push({ pathname: '/terms-agreement', params: { next: '/(tabs)' } });
                    }}
                    googleDisabled={isExpoGo && Platform.OS !== 'web'}
                    googleLoading={busyGoogle}
                  />

                  {loginError ? (
                    <View style={loginScreenStyles.errorPill}>
                      <Text style={[styles.errorText, loginScreenStyles.loginErrorTight]}>{loginError}</Text>
                    </View>
                  ) : null}

                  <Text style={loginScreenStyles.legalLine}>
                    계속하면 서비스 이용약관 및 개인정보 처리방침에 동의한 것으로 간주됩니다.
                  </Text>
                </View>
              </View>

              <Text style={[styles.footerCredit, loginScreenStyles.footerCreditTight]}>UI/UX Vision by Ginit Human-Connection Team.</Text>
            </Animated.View>
          </KeyboardAwareScreenScroll>
        </SafeAreaView>
      </ScreenShell>
    </Animated.View>
  );
}

const loginScreenStyles = StyleSheet.create({
  scrollTweak: {
    paddingTop: 14,
    paddingBottom: 22,
    gap: 14,
  },
  heroWrap: {
    paddingTop: 10,
    paddingBottom: 6,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
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
  heroTextCol: {
    alignSelf: 'stretch',
    alignItems: 'center',
    width: '100%',
    marginTop: 8,
  },
  brandKr: {
    fontSize: 24,
    fontWeight: '900',
    color: GinitTheme.colors.primary,
    letterSpacing: -0.5,
    textAlign: 'center',
    alignSelf: 'stretch',
    lineHeight: 29,
  },
  heroTitle: {
    marginTop: 10,
    fontSize: 22,
    fontWeight: '900',
    color: '#0f172a',
    letterSpacing: -0.6,
    textAlign: 'center',
    lineHeight: 28,
  },
  heroSub: {
    marginTop: 8,
    fontSize: 13,
    fontWeight: '700',
    color: '#64748b',
    lineHeight: 18,
    textAlign: 'center',
    paddingHorizontal: 18,
  },
  authCardTight: {
    padding: 14,
  },
  ctaCard: {
    paddingTop: 16,
    paddingBottom: 14,
  },
  expoGoBannerTight: {
    marginBottom: 8,
    padding: 10,
    gap: 4,
  },
  checkingRowTight: {
    marginBottom: 6,
  },
  /** 가입하기 버튼 바로 위(구분선 아래) */
  loginGuestHintAboveSignup: {
    marginTop: 2,
    marginBottom: 8,
    fontSize: 12,
    fontWeight: '700',
    color: '#b45309',
    lineHeight: 17,
    textAlign: 'center',
  },
  loginFieldBlock: {
    marginTop: 4,
    gap: 4,
  },
  phoneLoginSub: {
    marginTop: 0,
    marginBottom: 2,
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
    lineHeight: 16,
  },
  otpRowTight: {
    marginTop: 6,
  },
  phoneLoginDivider: {
    marginTop: 10,
    marginBottom: 8,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(15, 23, 42, 0.12)',
    alignSelf: 'stretch',
  },
  signupNavBtnTight: {
    marginTop: 8,
    minHeight: 46,
    paddingVertical: 12,
  },
  signupNavHintTight: {
    marginTop: 4,
    lineHeight: 16,
  },
  loginErrorTight: {
    marginTop: 0,
  },
  footerCreditTight: {
    marginTop: 10,
    marginBottom: 6,
    fontSize: 11,
    textAlign: 'center',
  },
  errorPill: {
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(220, 38, 38, 0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(220, 38, 38, 0.22)',
  },
  legalLine: {
    marginTop: 10,
    fontSize: 11,
    fontWeight: '600',
    color: '#94a3b8',
    lineHeight: 16,
    textAlign: 'center',
  },
});
