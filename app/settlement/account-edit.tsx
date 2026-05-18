import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { SettlementBankLogo } from '@/components/settlement/SettlementBankLogo';
import { SettlementBankPickerModal } from '@/components/settlement/SettlementBankPickerModal';
import { SettlementAccountsScreenTopBar } from '@/components/settlement/SettlementAccountsScreenTopBar';
import { ScreenShell } from '@/components/ui';
import { GinitPressable } from '@/components/ui/GinitPressable';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { GinitTheme } from '@/constants/ginit-theme';
import { useUserSession } from '@/src/context/UserSessionContext';
import { useAndroidOverlayHardwareBack } from '@/src/hooks/use-android-overlay-hardware-back';
import { getSettlementBankById } from '@/src/lib/korean-banks-settlement';
import { safeRouterBack } from '@/src/lib/router-safe';
import { useTransitionRouter } from '@/src/lib/screen-transition-navigation';
import {
  getUserSettlementAccountById,
  loadUserSettlementAccounts,
  saveUserSettlementAccount,
} from '@/src/lib/user-settlement-accounts';

export default function SettlementAccountEditScreen() {
  const router = useTransitionRouter();
  const handleHardwareBack = useCallback(() => safeRouterBack(router), [router]);
  useAndroidOverlayHardwareBack(handleHardwareBack);
  const insets = useSafeAreaInsets();
  const { userId } = useUserSession();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const editId = useMemo(() => {
    const raw = params.id;
    const s = Array.isArray(raw) ? raw[0] : raw;
    return typeof s === 'string' ? s.trim() : '';
  }, [params.id]);

  const [loading, setLoading] = useState(!!editId);
  const [saving, setSaving] = useState(false);
  const [bankPickerOpen, setBankPickerOpen] = useState(false);
  const [hostBankId, setHostBankId] = useState('');
  const [hostAccountNumber, setHostAccountNumber] = useState('');
  const [hostAccountHolder, setHostAccountHolder] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!editId || !(userId ?? '').trim()) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const st = await loadUserSettlementAccounts((userId ?? '').trim());
        if (!alive) return;
        const row = getUserSettlementAccountById(st, editId);
        if (row) {
          setHostBankId(row.bankCode);
          setHostAccountNumber(row.accountNumber.replace(/\D/g, ''));
          setHostAccountHolder(row.holder);
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [editId, userId]);

  const selectedBank = useMemo(() => getSettlementBankById(hostBankId), [hostBankId]);

  const onSave = useCallback(async () => {
    const uid = (userId ?? '').trim();
    if (!uid) {
      Alert.alert('오류', '로그인이 필요합니다.');
      return;
    }
    setSaving(true);
    try {
      await saveUserSettlementAccount(uid, {
        id: editId || undefined,
        bankCode: hostBankId,
        accountNumber: hostAccountNumber,
        holder: hostAccountHolder,
      });
      router.back();
    } catch (e) {
      Alert.alert('오류', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [userId, editId, hostBankId, hostAccountNumber, hostAccountHolder, router]);

  if (!(userId ?? '').trim()) {
    return (
      <ScreenShell padded={false} style={styles.rootShell}>
        <SafeAreaView style={styles.safe} edges={['top']}>
          <SettlementAccountsScreenTopBar title="정산 계좌 등록" onBack={handleHardwareBack} />
          <View style={[styles.center, styles.bodyGrow]}>
            <Text style={styles.muted}>로그인이 필요해요.</Text>
          </View>
        </SafeAreaView>
      </ScreenShell>
    );
  }

  if (loading) {
    return (
      <ScreenShell padded={false} style={styles.rootShell}>
        <SafeAreaView style={styles.safe} edges={['top']}>
          <SettlementAccountsScreenTopBar title="정산 계좌 등록" onBack={handleHardwareBack} />
          <View style={[styles.center, styles.bodyGrow]}>
            <ActivityIndicator color={GinitTheme.colors.primary} />
          </View>
        </SafeAreaView>
      </ScreenShell>
    );
  }

  return (
    <ScreenShell padded={false} style={styles.rootShell}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <SettlementAccountsScreenTopBar title="정산 계좌 등록" onBack={handleHardwareBack} />
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 24 }]}
          keyboardShouldPersistTaps="handled">
          <Text style={styles.sectionLabel}>입금 은행</Text>
          <GinitPressable
            onPress={() => setBankPickerOpen(true)}
            style={({ pressed }) => [styles.input, styles.bankRow, pressed && { opacity: 0.86 }]}>
            {selectedBank ? (
              <>
                <SettlementBankLogo
                  faviconDomain={selectedBank.faviconDomain}
                  fallbackLetter={selectedBank.label}
                  brandColor={selectedBank.brandColor}
                  size={28}
                />
                <Text style={styles.bankRowLabel} numberOfLines={1}>
                  {selectedBank.label}
                </Text>
              </>
            ) : (
              <Text style={styles.bankPlaceholder}>은행을 선택하세요</Text>
            )}
            <GinitSymbolicIcon name="chevron-down" size={20} color={GinitTheme.colors.textMuted} />
          </GinitPressable>

          <Text style={styles.sectionLabel}>계좌번호</Text>
          <TextInput
            value={hostAccountNumber}
            onChangeText={(x) => setHostAccountNumber(x.replace(/\D/g, ''))}
            keyboardType="number-pad"
            placeholder="숫자만 입력 (- 없이)"
            style={styles.input}
            placeholderTextColor={GinitTheme.colors.textMuted}
          />

          <Text style={styles.sectionLabel}>예금주</Text>
          <TextInput
            value={hostAccountHolder}
            onChangeText={setHostAccountHolder}
            placeholder="예금주 이름"
            style={styles.input}
            placeholderTextColor={GinitTheme.colors.textMuted}
          />
          <Text style={styles.holderHint}>
            정산 안내를 공유할 때 예금주 이름 가운데는 마스킹되어 전달돼요.
          </Text>

          <GinitPressable
            onPress={onSave}
            disabled={saving}
            style={({ pressed }) => [styles.primaryBtn, (pressed || saving) && { opacity: 0.88 }]}>
            <Text style={styles.primaryBtnText}>{saving ? '저장 중…' : '저장'}</Text>
          </GinitPressable>
        </ScrollView>
        <SettlementBankPickerModal
          visible={bankPickerOpen}
          onClose={() => setBankPickerOpen(false)}
          selectedBankId={hostBankId}
          onSelectBankId={setHostBankId}
        />
      </SafeAreaView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  rootShell: { flex: 1, backgroundColor: GinitTheme.colors.bg },
  safe: { flex: 1, backgroundColor: GinitTheme.colors.bg },
  bodyGrow: { flex: 1 },
  scroll: { flex: 1, backgroundColor: GinitTheme.colors.bg },
  scrollContent: { paddingHorizontal: 20, paddingTop: 12, gap: 10 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: GinitTheme.colors.bg },
  muted: { fontSize: 14, color: GinitTheme.colors.textMuted },
  sectionLabel: { marginTop: 8, fontSize: 13, fontWeight: '700', color: GinitTheme.colors.textSub },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: GinitTheme.colors.text,
    backgroundColor: GinitTheme.colors.bg,
  },
  bankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  bankRowLabel: { flex: 1, fontSize: 15, color: GinitTheme.colors.text, fontWeight: '600' },
  bankPlaceholder: { flex: 1, fontSize: 15, color: GinitTheme.colors.textMuted },
  holderHint: { ...GinitTheme.typography.caption, color: GinitTheme.colors.textMuted },
  primaryBtn: {
    backgroundColor: GinitTheme.colors.primary,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 16,
  },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
