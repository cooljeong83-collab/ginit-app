import { useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenShell } from '@/components/ui';
import { GinitTheme } from '@/constants/ginit-theme';
import { AuthService } from '@/src/services/AuthService';
import { normalizePhoneUserId } from '@/src/lib/phone-user-id';

function digitsOnly(s: string): string {
  return s.replace(/\D/g, '');
}

export default function ProfilePhoneVerifyEntryScreen() {
  const router = useRouter();
  const [phoneDigits, setPhoneDigits] = useState('');
  const [busy, setBusy] = useState(false);
  const phoneInputRef = useRef<TextInput>(null);

  const phoneE164 = useMemo(() => {
    const local = phoneDigits.trim();
    if (!local) return null;
    // 프로필 인증은 우선 KR(+82)만 지원(앱의 주 타겟 플로우와 동일)
    const with0 = local.startsWith('0') ? local : `0${local}`;
    return normalizePhoneUserId(with0);
  }, [phoneDigits]);

  const canNext = !!phoneE164 && !busy;

  const onNext = useCallback(async () => {
    if (!phoneE164 || busy) return;
    setBusy(true);
    try {
      const { verificationId } = await AuthService.verifyPhoneNumber(phoneE164);
      router.push({ pathname: '/profile/phone-verify-otp', params: { verificationId, phoneE164 } });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert('인증 실패', msg);
    } finally {
      setBusy(false);
    }
  }, [phoneE164, busy, router]);

  return (
    <ScreenShell padded={false} style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text style={styles.title}>전화번호 인증</Text>
          <Text style={styles.sub}>모임 참여를 위해 SMS 인증이 필요해요.</Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.label}>전화번호(대한민국)</Text>
          <View style={styles.row}>
            <View style={styles.prefixBox}>
              <Text style={styles.prefixText}>+82</Text>
            </View>
            <TextInput
              ref={phoneInputRef}
              value={phoneDigits}
              onChangeText={(t) => setPhoneDigits(digitsOnly(t).slice(0, 15))}
              placeholder="01012345678"
              placeholderTextColor="#94a3b8"
              keyboardType="phone-pad"
              inputMode="tel"
              autoComplete="tel"
              textContentType="telephoneNumber"
              style={styles.phoneInput}
              editable={!busy}
              returnKeyType="done"
              enterKeyHint="done"
              onSubmitEditing={() => void onNext()}
            />
          </View>

          <Pressable
            onPress={() => void onNext()}
            disabled={!canNext}
            style={({ pressed }) => [
              styles.nextBtn,
              !canNext && styles.nextBtnDisabled,
              pressed && canNext && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="인증번호 받기">
            <Text style={styles.nextText}>{busy ? '전송 중…' : '인증번호 받기'}</Text>
          </Pressable>

          <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.cancelBtn, pressed && styles.pressed]}>
            <Text style={styles.cancelText}>취소</Text>
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
  title: { fontSize: 22, fontWeight: '900', color: '#0f172a', letterSpacing: -0.3 },
  sub: { fontSize: 13, fontWeight: '600', color: '#64748b', lineHeight: 19 },
  form: { paddingHorizontal: 20, paddingTop: 14, gap: 12 },
  label: { fontSize: 12, fontWeight: '800', color: '#0f172a' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  prefixBox: {
    height: 48,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.12)',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  prefixText: { fontSize: 14, fontWeight: '900', color: '#0f172a' },
  phoneInput: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.12)',
    backgroundColor: '#fff',
    paddingHorizontal: 14,
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  nextBtn: {
    marginTop: 6,
    height: 50,
    borderRadius: 12,
    backgroundColor: GinitTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextBtnDisabled: { opacity: 0.35 },
  nextText: { fontSize: 16, fontWeight: '900', color: '#fff' },
  cancelBtn: { height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 14, fontWeight: '800', color: '#475569' },
});

