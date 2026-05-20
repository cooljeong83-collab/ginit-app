import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AdminReportDetailBody } from '@/components/admin-reports/AdminReportDetailBody';
import { GinitPressable } from '@/components/ui/GinitPressable';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { GinitTheme } from '@/constants/ginit-theme';
import type { AdminUserReportRow } from '@/src/features/admin-reports/admin-user-reports-api';
import { getAdminUserReport } from '@/src/features/admin-reports/admin-user-reports-api';
import { useAndroidOverlayHardwareBack } from '@/src/hooks/use-android-overlay-hardware-back';
import { presentAppDialogAlert } from '@/src/lib/app-dialog-present';
import { safeRouterBack } from '@/src/lib/router-safe';
import { useTransitionRouter } from '@/src/lib/screen-transition-navigation';

export default function AdminReportDetailScreen() {
  const router = useTransitionRouter();
  const handleHardwareBack = useCallback(() => safeRouterBack(router), [router]);
  useAndroidOverlayHardwareBack(handleHardwareBack);

  const params = useLocalSearchParams<{ reportId?: string | string[] }>();
  const reportId = useMemo(() => {
    const raw = params.reportId;
    const v = Array.isArray(raw) ? (raw[0] ?? '') : typeof raw === 'string' ? raw : '';
    return String(v).trim();
  }, [params.reportId]);

  const [report, setReport] = useState<AdminUserReportRow | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!reportId) return;
    setLoading(true);
    try {
      const row = await getAdminUserReport(reportId);
      setReport(row);
    } catch (e) {
      presentAppDialogAlert({
        title: '불러오기 실패',
        body: e instanceof Error ? e.message : String(e),
      });
      safeRouterBack(router);
    } finally {
      setLoading(false);
    }
  }, [reportId, router]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <GinitPressable onPress={handleHardwareBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="뒤로">
          <GinitSymbolicIcon name="chevron-back" size={22} color="#0f172a" />
        </GinitPressable>
        <Text style={styles.topTitle}>신고 상세</Text>
        <View style={styles.topBarSpacer} />
      </View>
      {loading || !report ? (
        <View style={styles.center}>
          <ActivityIndicator color={GinitTheme.colors.primary} />
        </View>
      ) : (
        <AdminReportDetailBody
          report={report}
          onResolved={() => {
            // 기각 시 RPC가 행을 삭제하므로 재조회하면 not_found — 목록으로만 복귀
            safeRouterBack(router);
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    height: 52,
  },
  topTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: '#0f172a' },
  topBarSpacer: { width: 44 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
