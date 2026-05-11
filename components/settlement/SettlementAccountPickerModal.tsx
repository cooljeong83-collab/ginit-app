import { useCallback } from 'react';
import {
  FlatList,
  Modal,
  Platform,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SettlementBankLogo } from '@/components/settlement/SettlementBankLogo';
import { GinitPressable } from '@/components/ui/GinitPressable';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { GinitTheme } from '@/constants/ginit-theme';
import { getSettlementBankById } from '@/src/lib/korean-banks-settlement';
import type { UserSettlementAccountItem } from '@/src/lib/user-settlement-accounts';

type Props = {
  visible: boolean;
  onClose: () => void;
  items: UserSettlementAccountItem[];
  selectedAccountId: string;
  defaultAccountId: string | null;
  onSelectAccountId: (id: string) => void;
};

export function SettlementAccountPickerModal({
  visible,
  onClose,
  items,
  selectedAccountId,
  defaultAccountId,
  onSelectAccountId,
}: Props) {
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();

  const renderItem = useCallback(
    ({ item }: { item: UserSettlementAccountItem }) => {
      const bank = getSettlementBankById(item.bankCode);
      const on = item.id === selectedAccountId;
      const isDefault = defaultAccountId != null && item.id === defaultAccountId;
      return (
        <GinitPressable
          onPress={() => {
            onSelectAccountId(item.id);
            onClose();
          }}
          style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}>
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
          <View style={styles.rowTextCol}>
            <Text style={styles.rowLabel} numberOfLines={1}>
              {bank?.label ?? item.bankCode}
            </Text>
            <Text style={styles.rowSub}>
              {item.accountNumber.trim()}
              {item.holder.trim() ? ` · ${item.holder.trim()}` : ''}
            </Text>
          </View>
          {isDefault ? (
            <Text style={styles.badge}>대표</Text>
          ) : (
            <View style={styles.badgeSpacer} />
          )}
          {on ? <GinitSymbolicIcon name="checkmark-circle" size={22} color={GinitTheme.colors.primary} /> : <View style={styles.checkSpacer} />}
        </GinitPressable>
      );
    },
    [defaultAccountId, onClose, onSelectAccountId, selectedAccountId],
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.sheet, { paddingTop: insets.top + 8, maxHeight: winH * 0.92 }]}>
        <View style={styles.header}>
          <Text style={styles.title}>정산 계좌 선택</Text>
          <GinitPressable onPress={onClose} hitSlop={12} style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.86 }]}>
            <GinitSymbolicIcon name="close" size={26} color={GinitTheme.colors.text} />
          </GinitPressable>
        </View>
        <FlatList
          data={items}
          keyExtractor={(it) => it.id}
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          ListEmptyComponent={<Text style={styles.empty}>등록된 계좌가 없어요.</Text>}
          contentContainerStyle={{ paddingBottom: insets.bottom + (Platform.OS === 'ios' ? 8 : 16) }}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: GinitTheme.colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
  /** 프로필 설정 `topTitle`과 동일(17 / 700 / 본문 텍스트 색) */
  title: { flex: 1, fontSize: 17, fontWeight: '700', color: GinitTheme.colors.text},
  closeBtn: { padding: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  logoSpacer: { width: 32 },
  rowTextCol: { flex: 1, minWidth: 0, gap: 2 },
  rowLabel: { fontSize: 15, color: GinitTheme.colors.text, fontWeight: '600' },
  rowSub: { fontSize: 13, color: GinitTheme.colors.textMuted },
  badge: {
    fontSize: 11,
    fontWeight: '700',
    color: GinitTheme.colors.primary,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeSpacer: { width: 28 },
  checkSpacer: { width: 22 },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: GinitTheme.colors.border },
  empty: { padding: 24, textAlign: 'center', color: GinitTheme.colors.textMuted, fontSize: 14 },
});
