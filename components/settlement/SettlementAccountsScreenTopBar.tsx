import { StyleSheet, Text, View } from 'react-native';

import { GinitPressable } from '@/components/ui/GinitPressable';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';

/** 프로필 설정 상단 바와 동일 스타일 — 정산 계좌 스택 전용 화면용 */
export function SettlementAccountsScreenTopBar({
  title,
  onBack,
}: {
  title: string;
  onBack: () => void;
}) {
  return (
    <View style={styles.topBar}>
      <GinitPressable
        onPress={onBack}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="뒤로"
        style={styles.backBtn}>
        <GinitSymbolicIcon name="chevron-back" size={22} color="#0f172a" />
      </GinitPressable>
      <Text style={styles.topTitle} numberOfLines={1} ellipsizeMode="tail">
        {title}
      </Text>
      <View style={styles.topBarSpacer} />
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 48,
  },
  backBtn: { padding: 4 },
  topTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: '#0f172a' },
  topBarSpacer: { width: 30 },
});
