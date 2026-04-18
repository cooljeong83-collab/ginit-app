import { Redirect } from 'expo-router';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GinitPlaceholderColor, GinitStyles } from '@/constants/GinitStyles';
import { GinitTheme } from '@/constants/ginit-theme';
import { useUserSession } from '@/src/context/UserSessionContext';
import { getFirebaseAuth } from '@/src/lib/firebase';
import {
  consumeGoogleRedirectResultWithMeta,
  REDIRECT_STARTED,
  signInWithGoogle,
  signOutGoogle,
} from '@/src/lib/google-sign-in';
import { formatNormalizedPhoneKrDisplay, normalizePhoneUserId } from '@/src/lib/phone-user-id';
import { registerPhoneIfNew } from '@/src/lib/phone-registry';

/**
 * 안전 모드: `react-native-device-info` / SIM 자동 추출은 사용하지 않습니다.
 * // import { getPhoneNumber } from 'react-native-device-info';
 * // import { fetchDeviceSimPhoneNumber } from '@/src/lib/device-sim-phone';
 */
/** 전화번호 추출 없이 고정값만 사용 */
const HARDCODED_PHONE_DIGITS = '01012345678';
const _hardNorm = normalizePhoneUserId(HARDCODED_PHONE_DIGITS);
const HARDCODED_PHONE_DISPLAY = _hardNorm ? formatNormalizedPhoneKrDisplay(_hardNorm) : '010-1234-5678';

const UI_LOG = '[GinitAuth:UI]';

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

export default function LoginScreen() {
  const { phoneUserId, isHydrated, setPhoneUserId } = useUserSession();
  const [phoneField, setPhoneField] = useState(HARDCODED_PHONE_DISPLAY);
  const [simBanner] = useState<string | null>(
    '안전 모드: 기기 번호 자동 추출을 사용하지 않습니다. 테스트용 번호는 010-1234-5678로 고정되어 있습니다.',
  );
  const [busyLogin, setBusyLogin] = useState(false);
  const [busyGoogle, setBusyGoogle] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [googlePhoneModal, setGooglePhoneModal] = useState(false);
  const googlePhonePromptedForUid = useRef<string | null>(null);

  const loginNormalized = normalizePhoneUserId(phoneField);

  useEffect(() => {
    try {
      const a = getFirebaseAuth();
      setFirebaseUser(a.currentUser);
      return onAuthStateChanged(a, setFirebaseUser);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(UI_LOG, 'Firebase Auth 구독 실패(설정 확인)', msg);
      return undefined;
    }
  }, []);

  /** 구글 로그인 직후: Firebase 번호 없으면 기기 번호(SIM)로 PK 확정 모달 */
  useEffect(() => {
    if (!isHydrated || !firebaseUser || phoneUserId) return;
    if (!isGoogleSignedUser(firebaseUser)) return;
    if (googlePhonePromptedForUid.current === firebaseUser.uid) return;
    const linked = firebaseUser.phoneNumber?.trim();
    if (linked) {
      const n = normalizePhoneUserId(linked);
      if (n) {
        void setPhoneUserId(n).then(() => {
          googlePhonePromptedForUid.current = firebaseUser.uid;
        });
      }
      return;
    }
    if (!loginNormalized) return;
    googlePhonePromptedForUid.current = firebaseUser.uid;
    setGooglePhoneModal(true);
  }, [isHydrated, firebaseUser, phoneUserId, setPhoneUserId, loginNormalized]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let alive = true;
    (async () => {
      try {
        const meta = await consumeGoogleRedirectResultWithMeta();
        if (!alive) return;
        switch (meta.status) {
          case 'success':
            logUi('redirect consume SUCCESS', { uid: meta.user.uid });
            break;
          case 'error':
            setLoginError(meta.message + (meta.code ? ` (${meta.code})` : ''));
            Alert.alert('리다이렉트 로그인 실패', meta.code ? `${meta.code}\n${meta.message}` : meta.message);
            break;
          default:
            break;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setLoginError(msg);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const onLoginOrStart = useCallback(async () => {
    const n = normalizePhoneUserId(phoneField);
    if (!n) {
      Alert.alert('안내', '올바른 전화번호를 입력해 주세요.');
      return;
    }
    setLoginError(null);
    setBusyLogin(true);
    try {
      const { isNew } = await registerPhoneIfNew(n);
      await setPhoneUserId(n);
      logUi(isNew ? '신규 회원 등록 후 로그인' : '기존 회원 로그인', { normalized: n });
    } catch (e) {
      const msg = e instanceof Error ? e.message : '저장에 실패했습니다.';
      setLoginError(msg);
      Alert.alert('시작 실패', msg);
    } finally {
      setBusyLogin(false);
    }
  }, [phoneField, setPhoneUserId]);

  const onGoogleContinue = useCallback(async () => {
    if (!normalizePhoneUserId(phoneField)) {
      Alert.alert('안내', '전화번호를 확인한 뒤 구글 연동을 진행해 주세요.');
      return;
    }
    setLoginError(null);
    setBusyGoogle(true);
    try {
      await signInWithGoogle();
    } catch (e) {
      const code = e && typeof e === 'object' && 'code' in e ? String((e as { code?: string }).code) : '';
      const message = e instanceof Error ? e.message : '알 수 없는 오류';
      if (code === REDIRECT_STARTED) return;
      setLoginError(`${message}${code ? ` (${code})` : ''}`);
      Alert.alert('로그인 실패', code ? `${code}\n${message}` : message);
    } finally {
      setBusyGoogle(false);
    }
  }, [phoneField]);

  const onConfirmGooglePhone = useCallback(async () => {
    const n = normalizePhoneUserId(phoneField);
    if (!n) {
      Alert.alert('안내', '올바른 전화번호를 입력해 주세요.');
      return;
    }
    try {
      const { isNew } = await registerPhoneIfNew(n);
      await setPhoneUserId(n);
      logUi(isNew ? '구글 연동·신규 등록' : '구글 연동·기존 로그인', { normalized: n });
      setGooglePhoneModal(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '저장에 실패했습니다.';
      Alert.alert('오류', msg);
    }
  }, [phoneField, setPhoneUserId]);

  const onCancelGooglePhone = useCallback(async () => {
    setGooglePhoneModal(false);
    googlePhonePromptedForUid.current = null;
    try {
      await signOutGoogle();
    } catch {
      /* */
    }
  }, []);

  if (!isHydrated) {
    return (
      <View style={styles.bootCenter}>
        <ActivityIndicator size="large" color={GinitTheme.trustBlue} />
        <Text style={styles.bootHint}>불러오는 중…</Text>
      </View>
    );
  }

  if (isHydrated && phoneUserId) {
    return <Redirect href="/(tabs)" />;
  }

  return (
    <View style={GinitStyles.screenRoot}>
      <LinearGradient colors={['#DCEEFF', '#E8EEFF', '#FFF4ED']} locations={[0, 0.42, 1]} style={StyleSheet.absoluteFill} />
      {Platform.OS === 'web' ? (
        <View style={[StyleSheet.absoluteFill, GinitStyles.webVeil]} />
      ) : (
        <>
          <BlurView pointerEvents="none" intensity={GinitTheme.glassModal.blurIntensity} tint="light" style={StyleSheet.absoluteFill} />
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, GinitStyles.frostVeil]} />
        </>
      )}
      <KeyboardAvoidingView style={GinitStyles.flexFill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={styles.brand}>Ginit</Text>
            <Text style={styles.tagline}>지닛과 함께 모임을 만들어 보세요</Text>

            <View style={styles.glassCard}>
              {simBanner ? (
                <View style={styles.bannerBox}>
                  <Text style={styles.bannerText}>{simBanner}</Text>
                </View>
              ) : null}

              <Text style={styles.cardLabel}>전화번호</Text>
              <Text style={styles.cardHint}>테스트용 기본값이 채워져 있습니다. 필요 시 번호를 바꿔 주세요.</Text>
              <TextInput
                value={phoneField}
                onChangeText={setPhoneField}
                placeholder="010-1234-5678"
                placeholderTextColor={GinitPlaceholderColor}
                style={styles.phoneInput}
                editable={true}
                selectTextOnFocus={true}
                keyboardType="phone-pad"
                autoCapitalize="none"
              />

              <Pressable
                onPress={onLoginOrStart}
                disabled={busyLogin || busyGoogle || !loginNormalized}
                style={({ pressed }) => [
                  styles.btnPrimary,
                  (!loginNormalized || busyLogin || busyGoogle) && styles.btnDisabled,
                  pressed && loginNormalized && !busyLogin && !busyGoogle && styles.btnPressed,
                ]}>
                <Text style={styles.btnPrimaryLabel}>{busyLogin ? '처리 중…' : '로그인 / 시작하기'}</Text>
              </Pressable>

              <View style={styles.dividerRow}>
                <View style={styles.divider} />
                <Text style={styles.dividerText}>또는</Text>
                <View style={styles.divider} />
              </View>

              <Pressable
                onPress={onGoogleContinue}
                disabled={busyLogin || busyGoogle || !loginNormalized}
                style={({ pressed }) => [
                  styles.btnGoogle,
                  (!loginNormalized || busyLogin || busyGoogle) && styles.btnDisabled,
                  pressed && loginNormalized && !busyLogin && !busyGoogle && styles.btnPressed,
                ]}>
                <Text style={styles.btnGoogleLabel}>{busyGoogle ? '연결 중…' : '구글로 계속하기'}</Text>
              </Pressable>
              <Text style={styles.googleNote}>구글 연동 시에도 위 전화번호가 회원 고유 ID로 저장됩니다.</Text>

              {loginError ? <Text style={styles.errorText}>{loginError}</Text> : null}
            </View>
          </ScrollView>

          <Modal visible={googlePhoneModal} transparent animationType="fade" onRequestClose={onCancelGooglePhone}>
            <View style={styles.modalRoot}>
              <View style={styles.modalCard}>
                <Text style={styles.modalTitle}>전화번호 확인</Text>
                <Text style={styles.modalBody}>아래 전화번호가 회원 고유 ID로 등록됩니다.</Text>
                <TextInput
                  value={phoneField}
                  onChangeText={setPhoneField}
                  placeholder="010-1234-5678"
                  placeholderTextColor={GinitPlaceholderColor}
                  style={styles.phoneInput}
                  editable={true}
                  keyboardType="phone-pad"
                  autoCapitalize="none"
                />
                <Pressable onPress={onConfirmGooglePhone} style={({ pressed }) => [styles.btnPrimary, pressed && styles.btnPressed]}>
                  <Text style={styles.btnPrimaryLabel}>확인</Text>
                </Pressable>
                <Pressable onPress={onCancelGooglePhone} style={({ pressed }) => [styles.btnGhost, pressed && styles.btnPressed]}>
                  <Text style={styles.btnGhostLabel}>취소 · 다른 방식으로</Text>
                </Pressable>
              </View>
            </View>
          </Modal>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
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
    paddingTop: 28,
    paddingBottom: 40,
    flexGrow: 1,
  },
  brand: {
    fontSize: 36,
    fontWeight: '900',
    letterSpacing: -1,
    color: '#0f172a',
    marginBottom: 6,
  },
  tagline: {
    fontSize: 15,
    fontWeight: '600',
    color: '#475569',
    marginBottom: 22,
  },
  glassCard: {
    borderRadius: GinitTheme.radius.card,
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.45)',
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.22,
    shadowRadius: 22,
    elevation: 12,
  },
  loadingText: {
    marginTop: 14,
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '700',
    color: '#475569',
    lineHeight: 20,
  },
  inlineLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  inlineLoadingText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
    lineHeight: 18,
  },
  bannerBox: {
    borderRadius: 12,
    backgroundColor: 'rgba(254, 243, 199, 0.65)',
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.45)',
    padding: 12,
    marginBottom: 14,
    gap: 8,
  },
  bannerText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#92400e',
    lineHeight: 18,
  },
  btnGhostSmall: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  btnGhostSmallLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: '#2563eb',
    textDecorationLine: 'underline',
  },
  errorTitle: {
    fontSize: 17,
    fontWeight: '900',
    color: '#0f172a',
    marginBottom: 10,
  },
  errorBody: {
    fontSize: 14,
    fontWeight: '600',
    color: '#475569',
    lineHeight: 21,
    marginBottom: 18,
  },
  cardLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: '#1e293b',
    marginBottom: 6,
  },
  cardHint: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
    lineHeight: 17,
    marginBottom: 14,
  },
  phoneInput: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.5)',
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 14,
    elevation: 8,
  },
  phoneInputReadonly: {
    opacity: 0.95,
    backgroundColor: 'rgba(248, 250, 252, 0.95)',
  },
  btnPrimary: {
    backgroundColor: GinitTheme.trustBlue,
    borderRadius: GinitTheme.radius.button,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 4,
  },
  btnPrimaryLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  btnDisabled: { opacity: 0.45 },
  btnPressed: { opacity: 0.92 },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 18,
    gap: 10,
  },
  divider: { flex: 1, height: 1, backgroundColor: 'rgba(15, 23, 42, 0.12)' },
  dividerText: { fontSize: 12, fontWeight: '700', color: '#94a3b8' },
  btnGoogle: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: GinitTheme.radius.button,
    paddingVertical: 15,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.1)',
  },
  btnGoogleLabel: {
    color: '#334155',
    fontSize: 16,
    fontWeight: '800',
  },
  googleNote: {
    marginTop: 12,
    fontSize: 11,
    fontWeight: '600',
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 16,
  },
  errorText: {
    marginTop: 14,
    fontSize: 13,
    fontWeight: '700',
    color: '#DC2626',
    lineHeight: 18,
  },
  modalRoot: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.5)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
    elevation: 16,
  },
  modalTitle: { fontSize: 18, fontWeight: '900', color: '#0f172a', marginBottom: 10 },
  modalBody: { fontSize: 14, fontWeight: '600', color: '#475569', lineHeight: 20, marginBottom: 14 },
  btnGhost: { marginTop: 12, paddingVertical: 12, alignItems: 'center' },
  btnGhostLabel: { fontSize: 14, fontWeight: '700', color: '#64748b' },
});
