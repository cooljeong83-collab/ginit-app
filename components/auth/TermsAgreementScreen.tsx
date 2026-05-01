import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenShell } from '@/components/ui';
import { GinitTheme } from '@/constants/ginit-theme';
import { consumePendingConsentAction } from '@/src/lib/terms-consent-flow';

type TermKey = 'tos' | 'privacy';

const TERM_LABELS: Record<TermKey, { title: string; required: boolean }> = {
  tos: { title: '서비스 이용약관', required: true },
  privacy: { title: '개인정보 처리방침', required: true },
};

function termBody(key: TermKey): string {
  if (key === 'tos') {
    return (
      '서비스 이용약관(필수)\n\n' +
      '- (여기에 실제 약관 전문 또는 링크를 연결하세요.)\n'
    );
  }
  return (
    '개인정보 처리방침(필수)\n\n' +
    '- (여기에 실제 처리방침 전문 또는 링크를 연결하세요.)\n'
  );
}

export default function TermsAgreementScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ next?: string | string[] }>();
  const next = useMemo(() => {
    const raw = params.next;
    const v = Array.isArray(raw) ? raw[0] : raw;
    const t = String(v ?? '').trim();
    return t || null;
  }, [params.next]);
  const [checked, setChecked] = useState<Record<TermKey, boolean>>({ tos: false, privacy: false });
  const [detailKey, setDetailKey] = useState<TermKey | null>(null);
  const [busy, setBusy] = useState(false);

  const allRequiredChecked = checked.tos && checked.privacy;
  const allChecked = allRequiredChecked;

  const toggleAll = useCallback(() => {
    const next = !allChecked;
    setChecked({ tos: next, privacy: next });
  }, [allChecked]);

  const toggleOne = useCallback((key: TermKey) => {
    setChecked((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const close = useCallback(() => {
    if (detailKey) {
      setDetailKey(null);
      return;
    }
    try {
      router.back();
    } catch {
      router.replace('/login');
    }
  }, [detailKey, router]);

  const onNext = useCallback(async () => {
    if (!allRequiredChecked || busy) return;
    const fn = consumePendingConsentAction();
    setBusy(true);
    try {
      if (fn) {
        await fn();
        // LoginScreen 등: 약관 동의 후 목적지가 명확하면 여기서 replace로 마무리합니다.
        // SignUpScreen 등: pending action이 자체적으로 라우팅(가입 완료 후 이동)을 책임질 수 있으므로
        // next가 없으면 추가 내비게이션을 하지 않습니다.
        if (next) {
          router.replace(next as any);
        }
        return;
      }
      if (next) {
        router.replace(next as any);
        return;
      }
      close();
    } finally {
      setBusy(false);
    }
  }, [allRequiredChecked, busy, close, next, router]);

  const detailTitle = useMemo(() => (detailKey ? TERM_LABELS[detailKey].title : ''), [detailKey]);
  const detailText = useMemo(() => (detailKey ? termBody(detailKey) : ''), [detailKey]);

  return (
    <ScreenShell padded={false} style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.topBar}>
          <Pressable onPress={close} hitSlop={10} accessibilityRole="button" accessibilityLabel="뒤로">
            <Ionicons name="chevron-back" size={26} color={GinitTheme.colors.text} />
          </Pressable>
          <Text style={styles.topTitle}>지닛 시작을 위한 약관 동의</Text>
          <View style={{ width: 26 }} />
        </View>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <Pressable
            onPress={toggleAll}
            style={({ pressed }) => [styles.allRow, pressed && styles.pressed]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: allChecked }}
            accessibilityLabel="전체 동의">
            <Ionicons
              name={allChecked ? 'checkmark-circle' : 'ellipse-outline'}
              size={22}
              color={allChecked ? GinitTheme.colors.primary : '#94a3b8'}
            />
            <Text style={styles.allText}>전체 동의</Text>
          </Pressable>

          <View style={styles.card}>
            {(Object.keys(TERM_LABELS) as TermKey[]).map((key, idx) => {
              const label = TERM_LABELS[key];
              const isChecked = checked[key];
              const last = idx === 1;
              return (
                <View key={key} style={[styles.termRow, last && styles.termRowLast]}>
                  <Pressable
                    onPress={() => toggleOne(key)}
                    style={({ pressed }) => [styles.termLeft, pressed && styles.pressed]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: isChecked }}
                    accessibilityLabel={`${label.required ? '[필수] ' : ''}${label.title} 동의`}>
                    <Ionicons
                      name={isChecked ? 'checkmark-circle' : 'ellipse-outline'}
                      size={20}
                      color={isChecked ? GinitTheme.colors.primary : '#94a3b8'}
                    />
                    <Text style={styles.termTitle}>
                      {label.required ? '[필수] ' : ''}
                      {label.title}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setDetailKey(key)}
                    hitSlop={10}
                    style={({ pressed }) => [styles.viewBtn, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel={`${label.title} 보기`}>
                    <Text style={styles.viewBtnText}>&gt;</Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        </ScrollView>

        <View style={styles.bottom}>
          <Pressable
            onPress={() => void onNext()}
            disabled={!allRequiredChecked || busy}
            style={({ pressed }) => [
              styles.nextBtn,
              (!allRequiredChecked || busy) && styles.nextBtnDisabled,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="다음">
            <Text style={styles.nextBtnText}>{busy ? '처리 중…' : '다음'}</Text>
          </Pressable>
        </View>

        <Modal visible={detailKey != null} animationType="slide" onRequestClose={() => setDetailKey(null)}>
          <SafeAreaView style={styles.detailSafe} edges={['top', 'bottom']}>
            <View style={styles.detailHeader}>
              <Text style={styles.detailTitle}>{detailTitle}</Text>
              <Pressable onPress={() => setDetailKey(null)} hitSlop={10} accessibilityRole="button" accessibilityLabel="닫기">
                <Ionicons name="close" size={22} color={GinitTheme.colors.text} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.detailBody}>
              <Text style={styles.detailText}>{detailText}</Text>
            </ScrollView>
          </SafeAreaView>
        </Modal>
      </SafeAreaView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: GinitTheme.colors.bg },
  safe: { flex: 1 },
  pressed: { opacity: 0.82 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(15, 23, 42, 0.08)',
    backgroundColor: '#fff',
  },
  topTitle: { fontSize: 14, fontWeight: '900', color: '#0f172a' },
  scroll: { padding: 16, gap: 12 },
  allRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.10)',
  },
  allText: { fontSize: 14, fontWeight: '900', color: '#0f172a' },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.10)',
    overflow: 'hidden',
  },
  termRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(15, 23, 42, 0.08)',
    gap: 10,
  },
  termRowLast: { borderBottomWidth: 0 },
  termLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 },
  termTitle: { fontSize: 13, fontWeight: '600', color: '#0f172a' },
  viewBtn: { paddingHorizontal: 8, paddingVertical: 6 },
  viewBtnText: { fontSize: 16, fontWeight: '900', color: GinitTheme.colors.primary },
  bottom: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 14,
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(15, 23, 42, 0.08)',
  },
  nextBtn: {
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: GinitTheme.colors.primary,
    alignItems: 'center',
  },
  nextBtnDisabled: { opacity: 0.45 },
  nextBtnText: { fontSize: 15, fontWeight: '900', color: '#fff' },
  detailSafe: { flex: 1, backgroundColor: '#fff' },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(15, 23, 42, 0.10)',
  },
  detailTitle: { fontSize: 16, fontWeight: '900', color: '#0f172a' },
  detailBody: { paddingHorizontal: 16, paddingVertical: 14 },
  detailText: { fontSize: 13, lineHeight: 20, color: '#0f172a' },
});

