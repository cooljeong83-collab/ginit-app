import { StyleSheet, Text, View } from 'react-native';

import { GinitPressable } from '@/components/ui/GinitPressable';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { GinitTheme } from '@/constants/ginit-theme';
import type { AdminUserReportListItem } from '@/src/features/admin-reports/admin-user-reports-api';
import {
  formatAdminReportApprovalActionLabel,
  formatAdminReportReasonLabel,
} from '@/src/features/admin-reports/admin-user-reports-api';

type AdminReportListRowProps = {
  item: AdminUserReportListItem;
  onPress: () => void;
};

function formatStatusLabel(status: string): string {
  switch (status) {
    case 'pending':
      return '대기';
    case 'reviewing':
      return '검토 중';
    case 'approved':
      return '승인';
    case 'dismissed':
      return '기각';
    default:
      return status;
  }
}

export function AdminReportListRow({ item, onPress }: AdminReportListRowProps) {
  const created = item.created_at ? new Date(item.created_at).toLocaleString('ko-KR') : '';
  const approvalLabel =
    item.status === 'approved' ? formatAdminReportApprovalActionLabel(item.approval_action) : null;
  const statusLine = [
    formatAdminReportReasonLabel(item.reason_code),
    formatStatusLabel(item.status),
    approvalLabel,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <GinitPressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.9 }]}
      accessibilityRole="button">
      <View style={styles.textCol}>
        <Text style={styles.title} numberOfLines={1}>
          {item.reported_nickname || item.reported_app_user_id}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {statusLine}
        </Text>
        {created ? <Text style={styles.time}>{created}</Text> : null}
      </View>
      <GinitSymbolicIcon name="chevron-forward" size={18} color={GinitTheme.colors.textMuted} />
    </GinitPressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(15, 23, 42, 0.08)',
  },
  textCol: { flex: 1, marginRight: 8 },
  title: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  sub: { marginTop: 4, fontSize: 13, color: GinitTheme.colors.textSub },
  time: { marginTop: 4, fontSize: 12, color: GinitTheme.colors.textMuted },
});
