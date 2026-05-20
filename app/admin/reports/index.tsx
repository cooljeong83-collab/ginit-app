import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AdminReportListRow } from '@/components/admin-reports/AdminReportListRow';
import { GinitPressable } from '@/components/ui/GinitPressable';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { GinitTheme } from '@/constants/ginit-theme';
import type { AdminUserReportListItem } from '@/src/features/admin-reports/admin-user-reports-api';
import {
  ADMIN_USER_REPORT_LIST_STATUS_OPEN,
  listAdminUserReports,
} from '@/src/features/admin-reports/admin-user-reports-api';
import { useAndroidOverlayHardwareBack } from '@/src/hooks/use-android-overlay-hardware-back';
import { presentAppDialogAlert } from '@/src/lib/app-dialog-present';
import { safeRouterBack } from '@/src/lib/router-safe';
import { useTransitionRouter } from '@/src/lib/screen-transition-navigation';

export default function AdminReportsListScreen() {
  const router = useTransitionRouter();
  const handleHardwareBack = useCallback(() => safeRouterBack(router), [router]);
  useAndroidOverlayHardwareBack(handleHardwareBack);

  const [items, setItems] = useState<AdminUserReportListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await listAdminUserReports({
        status: ADMIN_USER_REPORT_LIST_STATUS_OPEN,
        limit: 50,
      });
      setItems(res.items);
    } catch (e) {
      presentAppDialogAlert({
        title: '불러오기 실패',
        body: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load(false);
    }, [load]),
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <GinitPressable onPress={handleHardwareBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="뒤로">
          <GinitSymbolicIcon name="chevron-back" size={22} color="#0f172a" />
        </GinitPressable>
        <Text style={styles.topTitle}>사용자 신고</Text>
        <View style={styles.topBarSpacer} />
      </View>
      {loading && items.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={GinitTheme.colors.primary} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <AdminReportListRow
              item={item}
              onPress={() => router.push(`/admin/reports/${item.id}` as never)}
            />
          )}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.empty}>미처리 신고가 없어요.</Text>
            </View>
          }
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} />}
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  empty: { fontSize: 14, color: '#64748b', fontWeight: '600' },
});
