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
  const showSignupFooter =
    memberStatus === 'guest' && !!debouncedNormalized && !hasGoogleSession && !busyAutoLogin;
  const showSignupComplete = memberStatus === 'guest' && hasGoogleSession && !!loginNormalized;
  const ageLabel = ageFromBirthYear(peopleExtrasState?.birthYear ?? null);

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
      <View style={GinitStyles.screenRoot}>
        <Image
          source={{ uri: LOGIN_BACKGROUND_URI }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          accessibilityIgnoresInvertColors
        />
        <LinearGradient
          colors={['rgba(220, 238, 255, 0.88)', 'rgba(246, 250, 255, 0.72)', 'rgba(255, 244, 237, 0.82)']}
          locations={[0, 0.45, 1]}
          style={StyleSheet.absoluteFill}
        />
        {Platform.OS === 'web' ? (
          <View style={[StyleSheet.absoluteFill, GinitStyles.webVeil]} />
        ) : (
          <>
            <BlurView
              pointerEvents="none"
              intensity={GinitTheme.blur.intensityStrong}
              tint="light"
              style={StyleSheet.absoluteFill}
            />
            <View pointerEvents="none" style={[StyleSheet.absoluteFill, GinitStyles.frostVeil]} />
          </>
        )}

        <KeyboardAvoidingView
          style={GinitStyles.flexFill}
          behavior={Platform.OS === 'ios' ? 'padding' : 'padding'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 6 : 0}>
          <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
            <ScrollView
              contentContainerStyle={styles.scroll}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}>
              <View style={styles.brandRow}>
                <Text style={styles.brand}>Ginit</Text>
                <View style={styles.brandAccent} />
              </View>
              <Text style={styles.tagline}>지닛과 함께 모임을 만들어 보세요</Text>
              <Text style={styles.subTag}>2026 Modern Glassmorphism</Text>

              <View style={styles.glassCard}>
                <BlurView
                  intensity={GinitTheme.glassModal.blurIntensity}
                  tint="light"
                  style={StyleSheet.absoluteFill}
                  experimentalBlurMethod={Platform.OS === 'ios' ? 'dimezisBlurView' : undefined}
                />
                <View style={styles.glassVeil} />
                <View style={styles.glassInnerBorder} />

                <View style={styles.cardBody}>
                  {isExpoGo && Platform.OS !== 'web' ? (
                    <View style={styles.expoGoBanner}>
                      <Text style={styles.expoGoTitle}>개발 빌드가 필요해요</Text>
                      <Text style={styles.expoGoBody}>
                        Google 네이티브 로그인은 Expo Go에 포함되어 있지 않습니다.{'\n'}
                        <Text style={styles.expoGoMono}>npx expo run:android</Text> 로 설치형 빌드를 만든 뒤
                        테스트해 주세요.
                      </Text>
                    </View>
                  ) : null}

                  {busyAutoLogin ? (
                    <View style={styles.checkingRow}>
                      <ActivityIndicator color={GinitTheme.trustBlue} />
                      <Text style={styles.checkingLabel}>등록된 회원으로 로그인하는 중…</Text>
                    </View>
                  ) : null}

                  {memberStatus === 'checking' && debouncedNormalized && !busyAutoLogin ? (
                    <View style={styles.checkingRow}>
                      <ActivityIndicator color={GinitTheme.trustBlue} />
                      <Text style={styles.checkingLabel}>회원 여부 확인 중…</Text>
                    </View>
                  ) : null}

                  {memberStatus === 'member' && loginNormalized && !busyAutoLogin ? (
                    <Text style={styles.memberBadge}>이 번호는 이미 지닛에 등록되어 있어요. 잠시만 기다려 주세요.</Text>
                  ) : null}

                  {firebaseUser && hasGoogleSession ? (
                    <View style={styles.profileRow}>
                      {firebaseUser.photoURL ? (
                        <Image
                          source={{ uri: firebaseUser.photoURL }}
                          style={styles.avatar}
                          accessibilityLabel="프로필 사진"
                        />
                      ) : (
                        <View style={[styles.avatar, styles.avatarFallback]}>
                          <Text style={styles.avatarInitial}>
                            {(firebaseUser.displayName ?? firebaseUser.email ?? '?').slice(0, 1).toUpperCase()}
                          </Text>
                        </View>
                      )}
                      <View style={styles.profileTextCol}>
                        <Text style={styles.profileName} numberOfLines={1}>
                          {firebaseUser.displayName ?? '지닛 회원'}
                        </Text>
                        <Text style={styles.profileEmail} numberOfLines={1}>
                          {firebaseUser.email ?? ''}
                        </Text>
                        {(peopleExtrasState?.gender || ageLabel != null) && (
                          <Text style={styles.profileExtra} numberOfLines={2}>
                            {[
                              peopleExtrasState?.gender ? `성별: ${peopleExtrasState.gender}` : null,
                              ageLabel != null ? `나이(추정): ${ageLabel}세` : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </Text>
                        )}
                      </View>
                    </View>
                  ) : memberStatus === 'guest' ? (
                    <Text style={styles.preSignHint}>
                      전화번호로 가입 여부를 확인해요. 아직 회원이 아니라면 아래에서 Google로 가입할 수 있어요.
                    </Text>
                  ) : (
                    <Text style={styles.preSignHint}>
                      {Platform.OS === 'android'
                        ? '전화번호를 SIM에서 자동으로 읽는 중이에요.'
                        : '전화번호를 입력해 주세요.'}
                    </Text>
                  )}

                  <Text style={styles.fieldLabel}>전화번호 (회원 ID)</Text>
                  <Text style={styles.fieldHint}>
                    {Platform.OS === 'android'
                      ? '실행 시 SIM 전화번호를 자동으로 읽으며(권한 허용 시), 보안을 위해 이 화면에서는 수정할 수 없어요.'
                      : '전화번호를 입력해 주세요.'}
                  </Text>
                  <TextInput
                    value={phoneField}
                    onChangeText={setPhoneField}
                    placeholder="010-1234-5678"
                    placeholderTextColor={GinitPlaceholderColor}
                    style={[styles.phoneInput, 
                      Platform.OS === 'android' && styles.phoneInputReadonly
                      ]}
                    selectTextOnFocus={Platform.OS !== 'android'}
                    keyboardType="phone-pad"
                    autoCapitalize="none"
                    //테스트 완료 후 주석 제거 예정
                    //editable={Platform.OS !== 'android' && !busyAutoLogin}
                    editable={true} // 항상 편집 가능하게
                  />

                  {showSignupComplete ? (
                    <Pressable
                      onPress={onCompleteSignup}
                      disabled={busyStart || !loginNormalized}
                      style={({ pressed }) => [
                        styles.btnPrimary,
                        (!loginNormalized || busyStart) && styles.btnDisabled,
                        pressed && loginNormalized && !busyStart && styles.btnPressed,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel="가입 완료하고 시작">
                      <Text style={styles.btnPrimaryLabel}>
                        {busyStart ? '저장 중…' : '가입 완료하고 지닛 시작하기'}
                      </Text>
                    </Pressable>
                  ) : null}

                  <View style={styles.orangeRule} />

                  {loginError ? <Text style={styles.errorText}>{loginError}</Text> : null}
                </View>
              </View>

              {showSignupFooter ? (
                <View style={[styles.glassCard, styles.signupCard]}>
                  <BlurView
                    intensity={GinitTheme.glassModal.blurIntensity}
                    tint="light"
                    style={StyleSheet.absoluteFill}
                    experimentalBlurMethod={Platform.OS === 'ios' ? 'dimezisBlurView' : undefined}
                  />
                  <View style={styles.glassVeil} />
                  <View style={styles.glassInnerBorder} />
                  <View style={styles.cardBody}>
                    <Text style={styles.signupTitle}>가입하기</Text>
                    <Text style={styles.signupHint}>
                      전화번호는 위에서 휴대폰(SIM, 기기 API)으로만 가져옵니다. Google에서는 이름·이메일을 가져오고,
                      동의 시 성별·생일도 불러와 프로필에 반영해요. (People API는 GCP에서 사용 설정이 필요할 수 있어요.)
                    </Text>
                    <Pressable
                      onPress={onGoogleSignUp}
                      disabled={busyGoogle || (isExpoGo && Platform.OS !== 'web')}
                      style={({ pressed }) => [
                        styles.btnGoogle,
                        busyGoogle && styles.btnDisabled,
                        pressed && !busyGoogle && styles.btnPressed,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel="Google로 가입">
                      <Text style={styles.btnGoogleLabel}>{busyGoogle ? '연결 중…' : 'Google로 가입하기'}</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  rootWrap: {
    flex: 1,
  },
  bootCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F0F6FF',
    gap: 12,
  },
  bootHint: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748b',
  },
  safe: { flex: 1 },
  scroll: {
    paddingHorizontal: 22,
    paddingTop: 20,
    paddingBottom: 40,
    flexGrow: 1,
    gap: 16,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  brand: {
    fontSize: 40,
    fontWeight: '900',
    letterSpacing: -1.2,
    color: '#0b1220',
  },
  brandAccent: {
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: GinitTheme.pointOrange,
  },
  tagline: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1e293b',
    marginBottom: 4,
  },
  subTag: {
    fontSize: 12,
    fontWeight: '600',
    color: GinitTheme.trustBlue,
    letterSpacing: 0.4,
    marginBottom: 22,
  },
  glassCard: {
    borderRadius: GinitTheme.radius.card,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.55)',
    shadowColor: '#0b1426',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.28,
    shadowRadius: 32,
    elevation: 20,
  },
  signupCard: {
    marginTop: 4,
  },
  glassVeil: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 255, 255, 0.38)',
  },
  glassInnerBorder: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: GinitTheme.radius.card,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.45)',
    pointerEvents: 'none',
  },
  cardBody: {
    padding: 20,
    gap: 0,
  },
  checkingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  checkingLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
  },
  memberBadge: {
    fontSize: 13,
    fontWeight: '700',
    color: GinitTheme.trustBlue,
    marginBottom: 14,
    lineHeight: 19,
  },
  signupTitle: {
    fontSize: 17,
    fontWeight: '900',
    color: '#0b1220',
    marginBottom: 8,
  },
  signupHint: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
    lineHeight: 18,
    marginBottom: 14,
  },
  expoGoBanner: {
    borderRadius: 12,
    backgroundColor: 'rgba(255, 248, 230, 0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255, 138, 0, 0.35)',
    padding: 14,
    marginBottom: 16,
    gap: 6,
  },
  expoGoTitle: {
    fontSize: 14,
    fontWeight: '900',
    color: '#9a3412',
  },
  expoGoBody: {
    fontSize: 13,
    fontWeight: '600',
    color: '#7c2d12',
    lineHeight: 19,
  },
  expoGoMono: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontWeight: '800',
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 18,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.9)',
  },
  avatarFallback: {
    backgroundColor: GinitTheme.trustBlue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 22,
    fontWeight: '900',
    color: '#fff',
  },
  profileTextCol: {
    flex: 1,
    gap: 4,
  },
  profileName: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0b1220',
  },
  profileEmail: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },
  profileExtra: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
    marginTop: 2,
  },
  preSignHint: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
    lineHeight: 19,
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: '#1e293b',
    marginBottom: 6,
  },
  fieldHint: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
    lineHeight: 17,
    marginBottom: 12,
  },
  phoneInput: {
    borderRadius: GinitTheme.radius.button,
    borderWidth: 1,
    borderColor: GinitTheme.glassModal.inputBorder,
    backgroundColor: GinitTheme.glassModal.inputFill,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 10,
    shadowColor: '#0b1426',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 14,
    elevation: 6,
  },
  phoneInputReadonly: {
    opacity: 0.92,
    backgroundColor: 'rgba(248, 250, 252, 0.92)',
  },
  btnPrimary: {
    backgroundColor: GinitTheme.trustBlue,
    borderRadius: GinitTheme.radius.button,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 6,
  },
  btnPrimaryLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  btnGoogle: {
    borderRadius: GinitTheme.radius.button,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 6,
    borderWidth: 2,
    borderColor: GinitTheme.pointOrange,
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
  },
  btnGoogleLabel: {
    color: '#1e293b',
    fontSize: 16,
    fontWeight: '800',
  },
  orangeRule: {
    height: 3,
    marginTop: 18,
    borderRadius: 2,
    backgroundColor: GinitTheme.pointOrange,
    opacity: 0.85,
  },
  btnDisabled: { opacity: 0.48 },
  btnPressed: { opacity: 0.9 },
  errorText: {
    marginTop: 14,
    fontSize: 13,
    fontWeight: '700',
    color: '#DC2626',
    lineHeight: 18,
  },
});
