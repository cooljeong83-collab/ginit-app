import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { SettlementBankLogo } from '@/components/settlement/SettlementBankLogo';
import { SettlementAccountsScreenTopBar } from '@/components/settlement/SettlementAccountsScreenTopBar';
import { ScreenShell } from '@/components/ui';
import { GinitPressable } from '@/components/ui/GinitPressable';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { GinitTheme } from '@/constants/ginit-theme';
import { useUserSession } from '@/src/context/UserSessionContext';
import { getSettlementBankById } from '@/src/lib/korean-banks-settlement';
import {
  deleteUserSettlementAccount,
  loadUserSettlementAccounts,
  resolveEffectiveDefaultId,
  setDefaultUserSettlementAccount,
  type UserSettlementAccountItem,
  type UserSettlementAccountsState,
} from '@/src/lib/user-settlement-accounts';
import { safeRouterBack } from '@/src/lib/router-safe';

export default function SettlementAccountsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { userId } = useUserSession();
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<UserSettlementAccountsState>({ defaultId: null, items: [] });

  const reload = useCallback(async () => {
    const uid = (userId ?? '').trim();
    if (!uid) {
      setState({ defaultId: null, items: [] });
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const s = await loadUserSettlementAccounts(uid);
      setState(s);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const effectiveDefaultId = resolveEffectiveDefaultId(state.items, state.defaultId);

  const onSetDefault = useCallback(
    async (id: string) => {
      const uid = (userId ?? '').trim();
      if (!uid) return;
      try {
        await setDefaultUserSettlementAccount(uid, id);
        await reload();
      } catch (e) {
        Alert.alert('오류', e instanceof Error ? e.message : String(e));
      }
    },
    [userId, reload],
  );

  const onDelete = useCallback(
    (item: UserSettlementAccountItem) => {
      Alert.alert('삭제', '이 정산 계좌를 삭제할까요?', [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제',
          style: 'destructive',
          onPress: async () => {
            const uid = (userId ?? '').trim();
            if (!uid) return;
            try {
              await deleteUserSettlementAccount(uid, item.id);
              await reload();
            } catch (e) {
              Alert.alert('오류', e instanceof Error ? e.message : String(e));
            }
          },
        },
      ]);
    },
    [userId, reload],
  );

  const renderItem = useCallback(
    ({ item }: { item: UserSettlementAccountItem }) => {
      const bank = getSettlementBankById(item.bankCode);
      const isDef = item.id === effectiveDefaultId;
      const acctDigits = item.accountNumber.replace(/\D/g, '');
      return (
        <View style={styles.row}>
          <GinitPressable
            onPress={() => void onSetDefault(item.id)}
            hitSlop={10}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: isDef }}
            accessibilityLabel="대표 계좌"
            style={({ pressed }) => [styles.checkSlot, pressed && { opacity: 0.85 }]}>
            <GinitSymbolicIcon
              name={isDef ? 'checkmark-circle' : 'ellipse-outline'}
              size={24}
              color={isDef ? GinitTheme.colors.primary : GinitTheme.colors.textMuted}
            />
          </GinitPressable>
          <GinitPressable
            onPress={() => router.push(`/settlement/account-edit?id=${encodeURIComponent(item.id)}`)}
            style={({ pressed }) => [styles.rowMain, pressed && { opacity: 0.85 }]}>
            {bank ? (
              <SettlementBankLogo
                faviconDomain={bank.faviconDomain}
                fallbackLetter={bank.label}
                brandColor={bank.brandColor}
                size={32}
              />
            ) : (
              <View style={styles.logoSpacer} />
            )}
            <View style={styles.rowMid}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {bank?.label ?? item.bankCode}
              </Text>
              <Text style={styles.rowSub} selectable>
                {acctDigits} · {item.holder.trim()}
              </Text>
            </View>
          </GinitPressable>
          <GinitPressable
            onPress={() => onDelete(item)}
            hitSlop={10}
            style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.86 }]}>
            <GinitSymbolicIcon name="trash-outline" size={22} color={GinitTheme.colors.textMuted} />
          </GinitPressable>
        </View>
      );
    },
    [effectiveDefaultId, onDelete, onSetDefault, router],
  );

  if (!(userId ?? '').trim()) {
    return (
      <ScreenShell padded={false} style={styles.rootShell}>
        <SafeAreaView style={styles.safe} edges={['top']}>
          <SettlementAccountsScreenTopBar title="정산 계좌" onBack={() => safeRouterBack(router)} />
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
          <SettlementAccountsScreenTopBar title="정산 계좌" onBack={() => safeRouterBack(router)} />
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
        <SettlementAccountsScreenTopBar title="정산 계좌" onBack={() => safeRouterBack(router)} />
        <View style={[styles.container, { paddingBottom: insets.bottom + 16 }]}>
          {state.items.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyHint}>등록된 정산 계좌가 없어요.</Text>
              <GinitPressable
                onPress={() => router.push('/settlement/account-edit')}
                style={({ pressed }) => [styles.addLarge, pressed && { opacity: 0.88 }]}>
                <GinitSymbolicIcon name="add" size={36} color={GinitTheme.colors.primary} />
                <Text style={styles.addLargeText}>추가</Text>
              </GinitPressable>
            </View>
          ) : (
            <>
              <FlatList
                data={state.items}
                keyExtractor={(it) => it.id}
                renderItem={renderItem}
                ItemSeparatorComponent={() => <View style={styles.sep} />}
                contentContainerStyle={styles.listContent}
                style={styles.listFlex}
              />
              <GinitPressable
                onPress={() => router.push('/settlement/account-edit')}
                style={({ pressed }) => [styles.footerAdd, pressed && { opacity: 0.86 }]}>
                <GinitSymbolicIcon name="add-circle-outline" size={22} color={GinitTheme.colors.primary} />
                <Text style={styles.footerAddText}>계좌 추가</Text>
              </GinitPressable>
            </>
          )}
        </View>
      </SafeAreaView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  rootShell: { flex: 1, backgroundColor: GinitTheme.colors.bg },
  safe: { flex: 1, backgroundColor: GinitTheme.colors.bg },
  bodyGrow: { flex: 1 },
  container: { flex: 1, backgroundColor: GinitTheme.colors.bg },
  listFlex: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: GinitTheme.colors.bg },
  muted: { fontSize: 14, color: GinitTheme.colors.textMuted },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 20 },
  emptyHint: { fontSize: 15, color: GinitTheme.colors.textMuted, textAlign: 'center' },
  addLarge: { alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16 },
  addLargeText: { fontSize: 16, fontWeight: '700', color: GinitTheme.colors.primary },
  listContent: { paddingTop: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  checkSlot: { paddingVertical: 4, paddingRight: 2, justifyContent: 'center' },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 },
  logoSpacer: { width: 32 },
  rowMid: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 15, fontWeight: '600', color: GinitTheme.colors.text },
  rowSub: { fontSize: 13, color: GinitTheme.colors.textMuted, flexWrap: 'wrap' },
  iconBtn: { padding: 4 },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: GinitTheme.colors.border },
  footerAdd: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    marginHorizontal: 16,
    marginTop: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
    borderRadius: 12,
  },
  footerAddText: { fontSize: 15, fontWeight: '600', color: GinitTheme.colors.text },
});
