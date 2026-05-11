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

import { GinitPressable } from '@/components/ui/GinitPressable';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { GinitTheme } from '@/constants/ginit-theme';
import { SettlementBankLogo } from '@/components/settlement/SettlementBankLogo';
import type { SettlementBankChoice } from '@/src/lib/korean-banks-settlement';
import { SETTLEMENT_BANK_CHOICES } from '@/src/lib/korean-banks-settlement';

type Props = {
  visible: boolean;
  onClose: () => void;
  selectedBankId: string;
  onSelectBankId: (id: string) => void;
};

export function SettlementBankPickerModal({ visible, onClose, selectedBankId, onSelectBankId }: Props) {
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();

  const renderItem = useCallback(
    ({ item }: { item: SettlementBankChoice }) => {
      const on = item.id === selectedBankId;
      return (
        <GinitPressable
          onPress={() => {
            onSelectBankId(item.id);
            onClose();
          }}
          style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}>
          <SettlementBankLogo
            faviconDomain={item.faviconDomain}
            fallbackLetter={item.label}
            brandColor={item.brandColor}
            size={32}
          />
          <Text style={styles.rowLabel} numberOfLines={1}>
            {item.label}
          </Text>
          {on ? <GinitSymbolicIcon name="checkmark-circle" size={22} color={GinitTheme.colors.primary} /> : <View style={styles.checkSpacer} />}
        </GinitPressable>
      );
    },
    [onClose, onSelectBankId, selectedBankId],
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.sheet, { paddingTop: insets.top + 8, maxHeight: winH * 0.92 }]}>
        <View style={styles.header}>
          <Text style={styles.title}>은행 선택</Text>
          <GinitPressable onPress={onClose} hitSlop={12} style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.86 }]}>
            <GinitSymbolicIcon name="close" size={26} color={GinitTheme.colors.text} />
          </GinitPressable>
        </View>
        <Text style={styles.sub}>시중 5대 → 인터넷전문은행 → 기타 순입니다.</Text>
        <FlatList
          data={SETTLEMENT_BANK_CHOICES}
          keyExtractor={(it) => it.id}
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
          ItemSeparatorComponent={() => <View style={styles.sep} />}
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
  title: { ...GinitTheme.typography.h2, color: GinitTheme.colors.text, flex: 1 },
  closeBtn: { padding: 4 },
  sub: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    ...GinitTheme.typography.caption,
    color: GinitTheme.colors.textMuted,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  rowLabel: { flex: 1, fontSize: 15, color: GinitTheme.colors.text, fontWeight: '600' },
  checkSpacer: { width: 22 },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: GinitTheme.colors.border },
});
