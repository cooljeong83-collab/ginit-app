import { useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenShell } from '@/components/ui';
import { GinitTheme } from '@/constants/ginit-theme';
import { normalizePhoneUserId } from '@/src/lib/phone-user-id';
import { AuthService } from '@/src/services/AuthService';

type Country = { label: string; dial: string };
const COUNTRIES: Country[] = [
  { label: '대한민국', dial: '+82' },
  { label: '미국', dial: '+1' },
  { label: '일본', dial: '+81' },
];

function digitsOnly(s: string): string {
  return s.replace(/\D/g, '');
}

export default function PhoneEntryScreen() {
  const router = useRouter();
  const [dial, setDial] = useState('+82');
  const [countryOpen, setCountryOpen] = useState(false);
  const [phoneDigits, setPhoneDigits] = useState('');
  const [busy, setBusy] = useState(false);
  const phoneInputRef = useRef<TextInput>(null);

  const phoneE164 = useMemo(() => {
    // +82 + 010... 케이스를 normalizePhoneUserId에 맞춰 "0으로 시작하는 로컬" 형태로 조립
    const local = phoneDigits.trim();
    if (!local) return null;
    if (dial === '+82') {
      const with0 = local.startsWith('0') ? local : `0${local}`;
      return normalizePhoneUserId(with0);
    }
    // 단순화: 해외는 +국가코드 + 숫자 로우
    const raw = `${dial}${local}`;
    return normalizePhoneUserId(raw);
  }, [dial, phoneDigits]);

  const canNext = !!phoneE164 && !busy;

  const onNext = useCallback(async () => {
    if (!phoneE164 || busy) return;
    setBusy(true);
    try {
      const { verificationId } = await AuthService.verifyPhoneNumber(phoneE164);
      router.push({ pathname: '/otp', params: { verificationId, phoneE164 } });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // 텔레그램식: 과한 Alert 대신 1줄 안내(지금은 최소 변경으로 Alert)
      // TODO: Toast/Snackbar로 교체 가능
      alert(msg);
    } finally {
      setBusy(false);
    }
  }, [phoneE164, busy, router]);

  return (
    <ScreenShell padded={false} style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text style={styles.title}>전화번호</Text>
          <Text style={styles.sub}>인증을 위해 SMS로 코드를 보내드릴게요.</Text>
        </View>

        <View style={styles.form}>
          <View style={styles.row}>
            <Pressable
              onPress={() => setCountryOpen(true)}
              style={({ pressed }) => [styles.dialBtn, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="국가 코드 선택">
              <Text style={styles.dialText}>{dial}</Text>
              <Text style={styles.dialArrow}>▾</Text>
            </Pressable>
            <View style={styles.phonePress}>
              <TextInput
                ref={phoneInputRef}
                value={phoneDigits}
                onChangeText={(t) => setPhoneDigits(digitsOnly(t).slice(0, 15))}
                placeholder="전화번호 입력"
                placeholderTextColor="#94a3b8"
                keyboardType="phone-pad"
                inputMode="tel"
                autoComplete="tel"
                textContentType="telephoneNumber"
                style={styles.phoneInput}
                returnKeyType="done"
                enterKeyHint="done"
                editable={!busy}
                selectTextOnFocus
              />
            </View>
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
            accessibilityLabel="다음">
            <Text style={styles.nextText}>{busy ? '전송 중…' : '다음'}</Text>
          </Pressable>
          <Text style={styles.hint}>번호가 맞는지 확인한 뒤 SMS 인증을 진행해 주세요.</Text>
        </View>

        <Modal visible={countryOpen} transparent animationType="fade" onRequestClose={() => setCountryOpen(false)}>
          <Pressable style={styles.dim} onPress={() => setCountryOpen(false)}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>국가 선택</Text>
              {COUNTRIES.map((c) => (
                <Pressable
                  key={c.dial}
                  onPress={() => {
                    setDial(c.dial);
                    setCountryOpen(false);
                  }}
                  style={({ pressed }) => [styles.countryRow, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`${c.label} ${c.dial}`}>
                  <Text style={styles.countryLabel}>{c.label}</Text>
                  <Text style={styles.countryDial}>{c.dial}</Text>
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Modal>
      </SafeAreaView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  safe: { flex: 1 },
  pressed: { opacity: 0.85 },
  header: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 10, gap: 6 },
  title: { fontSize: 24, fontWeight: '600', color: '#0f172a', letterSpacing: -0.3 },
  sub: { fontSize: 14, fontWeight: '600', color: '#64748b', lineHeight: 20 },
  form: { paddingHorizontal: 20, paddingTop: 16, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dialBtn: {
    height: 48,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.12)',
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dialText: { fontSize: 15, fontWeight: '600', color: '#0f172a' },
  dialArrow: { fontSize: 12, fontWeight: '600', color: '#64748b', marginTop: -1 },
  phoneInput: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.12)',
    backgroundColor: '#fff',
    paddingHorizontal: 14,
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  phonePress: { flex: 1 },
  nextBtn: {
    marginTop: 6,
    height: 50,
    borderRadius: 12,
    backgroundColor: GinitTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextBtnDisabled: { opacity: 0.35 },
  nextText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  hint: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94a3b8',
    marginTop: 4,
  },
  dim: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.35)', padding: 18, justifyContent: 'center' },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.12)',
  },
  modalTitle: { fontSize: 14, fontWeight: '600', color: '#0f172a', marginBottom: 10 },
  countryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  countryLabel: { fontSize: 14, fontWeight: '600', color: '#0f172a' },
  countryDial: { fontSize: 14, fontWeight: '600', color: '#64748b' },
});

