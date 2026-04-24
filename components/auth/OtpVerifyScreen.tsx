import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenShell } from '@/components/ui';
import { GinitTheme } from '@/constants/ginit-theme';
import { useUserSession } from '@/src/context/UserSessionContext';
import { AuthService } from '@/src/services/AuthService';
import { readAppIntroComplete } from '@/src/lib/onboarding-storage';
import { normalizePhoneUserId } from '@/src/lib/phone-user-id';
import {
  ensureUserProfile,
  findUserRowByPhoneE164,
  isUserProfileWithdrawn,
  reactivateWithdrawnUserForOtpSignup,
  recordTermsAgreement,
} from '@/src/lib/user-profile';
import { getAuth } from '@react-native-firebase/auth';

type TermKey = 'tos' | 'privacy' | 'safety';
const TERM_LABELS: Record<TermKey, { title: string; required: boolean }> = {
  tos: { title: '서비스 이용약관', required: true },
  privacy: { title: '개인정보 처리방침', required: true },
  safety: { title: '안전 고지(회사 무관 · 당사자 책임)', required: true },
};

const SAFETY_DISCLAIMER_TEXT =
  '지닛(Ginit)을 통해 생성·조율된 모든 만남은 회사와 무관하며, 발생하는 모든 책임은 만남 당사자에게 있습니다.\n' +
  '회사는 당사자 간 분쟁·사고에 대해 중개/보증/책임을 부담하지 않습니다.';

function paramToString(v: string | string[] | undefined): string {
  if (v == null) return '';
  return Array.isArray(v) ? (v[0] ?? '') : v;
}

export default function OtpVerifyScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ verificationId?: string | string[]; phoneE164?: string | string[] }>();
  const verificationId = useMemo(() => paramToString(params.verificationId), [params.verificationId]);
  const phoneE164 = useMemo(() => paramToString(params.phoneE164), [params.phoneE164]);
  const { setUserId } = useUserSession();

  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const [checked, setChecked] = useState<Record<TermKey, boolean>>({ tos: false, privacy: false, safety: false });
  /** 약관 동의 후 `ensureUserProfile`에 쓸 Firestore 문서 ID(레거시 전화 또는 이메일) */
  const [pendingProfileDocId, setPendingProfileDocId] = useState<string | null>(null);

  const allRequiredChecked = checked.tos && checked.privacy && checked.safety;

  const canVerify = verificationId.trim().length > 0 && code.trim().length === 6 && !busy;

  const proceedToHome = useCallback(
    async (resolvedUserId: string) => {
      await setUserId(resolvedUserId);
      await ensureUserProfile(resolvedUserId);
      const introSeen = await readAppIntroComplete();
      if (introSeen) {
        router.replace('/(tabs)');
        return;
      }
      router.replace({ pathname: '/onboarding', params: { next: 'tabs', flow: 'postOtpSignup' } });
    },
    [setUserId, router],
  );

  const onVerify = useCallback(async () => {
    if (!canVerify) return;
    setBusy(true);
    try {
      const cred = await AuthService.confirmCode(verificationId, code);
      const e164 = cred.user.phoneNumber ?? phoneE164;
      const normalized = e164 ? normalizePhoneUserId(e164) : null;
      if (!normalized) {
        Alert.alert('인증 실패', '전화번호를 확인할 수 없습니다. 다시 시도해 주세요.');
        return;
      }

      const row = await findUserRowByPhoneE164(normalized);
      if (row && !isUserProfileWithdrawn(row.profile)) {
        await proceedToHome(row.docId);
        return;
      }
      if (row && isUserProfileWithdrawn(row.profile)) {
        const docId = await reactivateWithdrawnUserForOtpSignup(normalized);
        setPendingProfileDocId(docId);
        setTermsOpen(true);
        return;
      }
      setPendingProfileDocId(normalized);
      setTermsOpen(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert('오류', msg);
    } finally {
      setBusy(false);
    }
  }, [canVerify, verificationId, phoneE164, code, proceedToHome]);

  const onAgreeTerms = useCallback(async () => {
    if (!allRequiredChecked || busy) return;
    setBusy(true);
    try {
      const e164 = getAuth().currentUser?.phoneNumber ?? phoneE164;
      const normalized = e164 ? normalizePhoneUserId(e164) : null;
      if (!normalized) {
        Alert.alert('오류', '전화번호 세션을 확인할 수 없습니다.');
        return;
      }
      const docId = pendingProfileDocId?.trim() || normalized;
      await ensureUserProfile(docId);
      await recordTermsAgreement(docId);
      await proceedToHome(docId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert('오류', msg);
    } finally {
      setBusy(false);
      setTermsOpen(false);
      setPendingProfileDocId(null);
    }
  }, [allRequiredChecked, busy, phoneE164, pendingProfileDocId, proceedToHome]);

  const toggleOne = useCallback((k: TermKey) => setChecked((p) => ({ ...p, [k]: !p[k] })), []);
  const toggleAll = useCallback(() => {
    const next = !(checked.tos && checked.privacy && checked.safety);
    setChecked({ tos: next, privacy: next, safety: next });
  }, [checked.tos, checked.privacy, checked.safety]);

  return (
    <ScreenShell padded={false} style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel="뒤로">
            <Ionicons name="chevron-back" size={26} color="#0f172a" />
          </Pressable>
          <Text style={styles.topTitle}>인증번호</Text>
          <View style={{ width: 26 }} />
        </View>

        <View style={styles.body}>
          <Text style={styles.h1}>6자리 코드를 입력해 주세요</Text>
          <Text style={styles.h2}>SMS로 받은 인증번호를 입력해 주세요.</Text>

          <TextInput
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
            accessibilityLabel="인증하기">
            <Text style={styles.verifyText}>{busy ? '확인 중…' : '인증하기'}</Text>
          </Pressable>
        </View>

        <Modal visible={termsOpen} transparent animationType="fade" onRequestClose={() => {}}>
          <View style={styles.dim}>
            <View style={styles.termsCard}>
              <Text style={styles.termsTitle}>약관 동의</Text>
              <Text style={styles.termsSub}>최초 가입 시에만 필요해요.</Text>

              <Pressable onPress={toggleAll} style={({ pressed }) => [styles.allRow, pressed && styles.pressed]}>
                <Ionicons
                  name={allRequiredChecked ? 'checkmark-circle' : 'ellipse-outline'}
                  size={22}
                  color={allRequiredChecked ? GinitTheme.colors.primary : '#94a3b8'}
                />
                <Text style={styles.allText}>전체 동의</Text>
              </Pressable>

              {(Object.keys(TERM_LABELS) as TermKey[]).map((k) => {
                const label = TERM_LABELS[k];
                const isChecked = checked[k];
                return (
                  <View key={k} style={styles.termBlock}>
                    <Pressable
                      onPress={() => toggleOne(k)}
                      style={({ pressed }) => [styles.termRow, pressed && styles.pressed]}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: isChecked }}
                      accessibilityLabel={`${label.title} 동의`}>
                      <Ionicons
                        name={isChecked ? 'checkmark-circle' : 'ellipse-outline'}
                        size={20}
                        color={isChecked ? GinitTheme.colors.primary : '#94a3b8'}
                      />
                      <Text style={styles.termText}>{label.required ? `[필수] ${label.title}` : label.title}</Text>
                    </Pressable>
                    {k === 'safety' ? <Text style={styles.safetyBody}>{SAFETY_DISCLAIMER_TEXT}</Text> : null}
                  </View>
                );
              })}

              <Pressable
                onPress={() => void onAgreeTerms()}
                disabled={!allRequiredChecked || busy}
                style={({ pressed }) => [
                  styles.agreeBtn,
                  (!allRequiredChecked || busy) && styles.agreeBtnDisabled,
                  pressed && allRequiredChecked && styles.pressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="동의하고 시작하기">
                <Text style={styles.agreeText}>{busy ? '처리 중…' : '동의하고 시작하기'}</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  safe: { flex: 1 },
  pressed: { opacity: 0.85 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(15, 23, 42, 0.08)',
  },
  topTitle: { fontSize: 14, fontWeight: '900', color: '#0f172a' },
  body: { paddingHorizontal: 20, paddingTop: 18, gap: 10 },
  h1: { fontSize: 20, fontWeight: '900', color: '#0f172a', letterSpacing: -0.3 },
  h2: { fontSize: 13, fontWeight: '600', color: '#64748b', lineHeight: 18 },
  otpInput: {
    marginTop: 10,
    height: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.12)',
    paddingHorizontal: 14,
    fontSize: 20,
    fontWeight: '900',
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
  verifyText: { fontSize: 16, fontWeight: '900', color: '#fff' },
  dim: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.35)', padding: 18, justifyContent: 'center' },
  termsCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.12)',
    gap: 10,
  },
  termsTitle: { fontSize: 16, fontWeight: '900', color: '#0f172a' },
  termsSub: { fontSize: 12, fontWeight: '600', color: '#64748b' },
  allRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  allText: { fontSize: 14, fontWeight: '900', color: '#0f172a' },
  termRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  termText: { fontSize: 13, fontWeight: '800', color: '#0f172a' },
  termBlock: { gap: 6 },
  safetyBody: {
    paddingLeft: 30,
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
    lineHeight: 17,
  },
  agreeBtn: {
    marginTop: 6,
    height: 48,
    borderRadius: 12,
    backgroundColor: GinitTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  agreeBtnDisabled: { opacity: 0.35 },
  agreeText: { fontSize: 15, fontWeight: '900', color: '#fff' },
});
