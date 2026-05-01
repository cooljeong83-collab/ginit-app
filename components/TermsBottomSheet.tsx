import { Ionicons } from '@expo/vector-icons';
import { useCallback, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GinitTheme } from '@/constants/ginit-theme';

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

export type TermsBottomSheetProps = {
  visible: boolean;
  onClose: () => void;
  onAgreeStart: () => void | Promise<void>;
};

export function TermsBottomSheet({ visible, onClose, onAgreeStart }: TermsBottomSheetProps) {
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

  const title = '지닛 시작을 위한 약관 동의';

  const onAgree = useCallback(async () => {
    if (!allRequiredChecked || busy) return;
    setBusy(true);
    try {
      await onAgreeStart();
    } finally {
      setBusy(false);
    }
  }, [allRequiredChecked, busy, onAgreeStart]);

  const detailTitle = useMemo(() => (detailKey ? TERM_LABELS[detailKey].title : ''), [detailKey]);
  const detailText = useMemo(() => (detailKey ? termBody(detailKey) : ''), [detailKey]);

  return (
    <>
      <Modal
        visible={visible}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (detailKey) {
            setDetailKey(null);
            return;
          }
          onClose();
        }}>
        <View style={styles.dim}>
          <Pressable
            style={StyleSheet.absoluteFillObject}
            onPress={() => {
              if (detailKey) {
                setDetailKey(null);
                return;
              }
              onClose();
            }}
            accessibilityRole="button"
            accessibilityLabel="약관 닫기"
          />
          <SafeAreaView style={styles.sheet} edges={['bottom']}>
            <View style={styles.header}>
              <Text style={styles.title}>{title}</Text>
              <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="닫기">
                <Ionicons name="close" size={22} color={GinitTheme.colors.text} />
              </Pressable>
            </View>

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
                      <Text style={styles.viewBtnText}>보기</Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>

            <Pressable
              onPress={() => void onAgree()}
              disabled={!allRequiredChecked || busy}
              style={({ pressed }) => [
                styles.agreeBtn,
                (!allRequiredChecked || busy) && styles.agreeBtnDisabled,
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="동의하고 시작하기">
              <Text style={styles.agreeBtnText}>{busy ? '처리 중…' : '동의하고 시작하기'}</Text>
            </Pressable>
          </SafeAreaView>
        </View>
      </Modal>

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
    </>
  );
}

const styles = StyleSheet.create({
  dim: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
    gap: 12,
  },
  pressed: { opacity: 0.8 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  title: { flex: 1, fontSize: 16, fontWeight: '900', color: '#0f172a' },
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
  viewBtnText: { fontSize: 13, fontWeight: '900', color: GinitTheme.colors.primary },
  agreeBtn: {
    marginTop: 2,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: GinitTheme.colors.primary,
    alignItems: 'center',
  },
  agreeBtnDisabled: { opacity: 0.45 },
  agreeBtnText: { fontSize: 15, fontWeight: '900', color: '#fff' },
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

