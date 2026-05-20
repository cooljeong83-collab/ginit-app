import { StyleSheet, Text, View } from 'react-native';

import { GinitPressable } from '@/components/ui/GinitPressable';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { GinitTheme } from '@/constants/ginit-theme';

type AdminSettingsSectionProps = {
  onOpenReports: () => void;
};

function sectionTitle(label: string) {
  return (
    <View style={styles.sectionHead}>
      <Text style={styles.sectionHeadText}>{label}</Text>
    </View>
  );
}

/**
 * 프로필 설정 전용 어드민 블록 — 일반 설정 행·상태와 공유하지 않습니다.
 */
export function AdminSettingsSection({ onOpenReports }: AdminSettingsSectionProps) {
  return (
    <>
      {sectionTitle('어드민')}
      <GinitPressable
        onPress={onOpenReports}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        accessibilityRole="button"
        accessibilityLabel="사용자 신고 목록">
        <View style={styles.rowIconSlot}>
          <GinitSymbolicIcon name="warning-outline" size={22} color="#475569" />
        </View>
        <View style={styles.rowText}>
          <Text style={styles.rowLabel}>사용자 신고 목록</Text>
          <Text style={styles.rowSub}>접수된 신고를 검토·처리해요.</Text>
        </View>
        <GinitSymbolicIcon name="chevron-forward" size={18} color={GinitTheme.colors.textMuted} />
      </GinitPressable>
    </>
  );
}

const styles = StyleSheet.create({
  sectionHead: {
    paddingHorizontal: 20,
    paddingBottom: 8,
    paddingTop: 4,
  },
  sectionHeadText: {
    fontSize: 13,
    fontWeight: '700',
    color: GinitTheme.colors.textMuted,
    letterSpacing: -0.1,
  },
  rowIconSlot: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(15, 23, 42, 0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    gap: 12,
  },
  rowPressed: { opacity: 0.82 },
  rowText: { flex: 1, minWidth: 0 },
  rowLabel: { fontSize: 16, fontWeight: '400', color: GinitTheme.colors.text, letterSpacing: -0.2 },
  rowSub: { marginTop: 4, fontSize: 12, fontWeight: '400', color: GinitTheme.colors.textMuted, lineHeight: 16 },
});
