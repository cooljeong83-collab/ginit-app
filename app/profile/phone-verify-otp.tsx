import { useLocalSearchParams, useRouter } from 'expo-router';
import { serverTimestamp } from 'firebase/firestore';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenShell } from '@/components/ui';
import { GinitTheme } from '@/constants/ginit-theme';
import { useUserSession } from '@/src/context/UserSessionContext';
import { normalizeUserId } from '@/src/lib/app-user-id';
import { MEETING_PHONE_VERIFICATION_UI_ENABLED } from '@/src/lib/meeting-phone-verification-ui';
import { normalizePhoneUserId } from '@/src/lib/phone-user-id';
import { ensureUserProfile, updateUserProfile } from '@/src/lib/user-profile';
import { AuthService } from '@/src/services/AuthService';

function paramToString(v: string | string[] | undefined): string {
  if (v == null) return '';
  return Array.isArray(v) ? (v[0] ?? '') : v;
}

export default function ProfilePhoneVerifyOtpScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ verificationId?: string | string[]; phoneE164?: string | string[] }>();
  const verificationId = useMemo(() => paramToString(params.verificationId), [params.verificationId]);
  const phoneE164Param = useMemo(() => paramToString(params.phoneE164), [params.phoneE164]);

  const { userId, authProfile } = useUserSession();
  const profilePk = useMemo(() => {
    const u = userId?.trim();
    if (u) return u;
    const em = authProfile?.email?.trim();
    if (em) return normalizeUserId(em) ?? '';
    return '';
  }, [userId, authProfile?.email]);

  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const codeInputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!MEETING_PHONE_VERIFICATION_UI_ENABLED) {
      router.replace('/profile/settings');
    }
  }, [router]);

  const canVerify = verificationId.trim().length > 0 && code.trim().length === 6 && !busy;

  const onVerify = useCallback(async () => {
    if (!canVerify) return;
    if (!profilePk) {
      Alert.alert('안내', '로그인 상태를 확인할 수 없습니다.');
      return;
    }
    setBusy(true);
    try {
      const cred = await AuthService.linkPhoneWithCode(verificationId, code);
      const e164 = cred.user.phoneNumber ?? phoneE164Param;
      const normalized = e164 ? normalizePhoneUserId(e164) : null;
      if (!normalized) {
        Alert.alert('인증 실패', '전화번호를 확인할 수 없습니다. 다시 시도해 주세요.');
        return;
      }
      await ensureUserProfile(profilePk);
      await updateUserProfile(profilePk, { phone: normalized, phoneVerifiedAt: serverTimestamp() });
      Alert.alert('인증 완료', '전화번호 인증이 완료되었습니다.');
      router.replace('/(tabs)/profile');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const hay = msg.toLowerCase();
      if (hay.includes('provider-already-linked')) {
        const normalized = phoneE164Param ? normalizePhoneUserId(phoneE164Param) : null;
        if (!normalized) {
          Alert.alert('인증 실패', msg);
          return;
        }
        await ensureUserProfile(profilePk);
        await updateUserProfile(profilePk, { phone: normalized, phoneVerifiedAt: serverTimestamp() });
        Alert.alert('인증 완료', '전화번호 인증이 완료되었습니다.');
        router.replace('/(tabs)/profile');
        return;
      }
      Alert.alert('인증 실패', msg);
    } finally {
      setBusy(false);
    }
  }, [canVerify, profilePk, verificationId, code, phoneE164Param, router]);

  return (
    <ScreenShell padded={false} style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text style={styles.title}>인증번호</Text>
          <Text style={styles.sub}>SMS로 받은 6자리 코드를 입력해 주세요.</Text>
        </View>

        <View style={styles.form}>
          <TextInput
            ref={codeInputRef}
            value={code}
            onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            placeholderTextColor="#94a3b8"
            keyboardType="number-pad"
            inputMode="numeric"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            style={styles.otpInput}
            editable={!busy}
            onSubmitEditing={() => void onVerify()}
          />

          <Pressable
            onPress={() => void onVerify()}
            disabled={!canVerify}
            style={({ pressed }) => [
              styles.verifyBtn,
              !canVerify && styles.verifyBtnDisabled,
              pressed && canVerify && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="인증 완료">
            <Text style={styles.verifyText}>{busy ? '확인 중…' : '인증 완료'}</Text>
          </Pressable>

          <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.cancelBtn, pressed && styles.pressed]}>
            <Text style={styles.cancelText}>뒤로</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  safe: { flex: 1 },
  pressed: { opacity: 0.85 },
  header: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 10, gap: 6 },
  title: { fontSize: 22, fontWeight: '600', color: '#0f172a', letterSpacing: -0.3 },
  sub: { fontSize: 13, fontWeight: '600', color: '#64748b', lineHeight: 19 },
  form: { paddingHorizontal: 20, paddingTop: 14, gap: 12 },
  otpInput: {
    marginTop: 10,
    height: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.12)',
    paddingHorizontal: 14,
    fontSize: 20,
    fontWeight: '600',
    letterSpacing: 6,
    color: '#0f172a',
    textAlign: 'center',
  },
  verifyBtn: {
    marginTop: 10,
    height: 50,
    borderRadius: 12,
    backgroundColor: GinitTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  verifyBtnDisabled: { opacity: 0.35 },
  verifyText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  cancelBtn: { height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 14, fontWeight: '600', color: '#475569' },
});

