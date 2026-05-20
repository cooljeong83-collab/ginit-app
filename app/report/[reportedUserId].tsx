import { useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { UserReportForm } from '@/components/user-report/UserReportForm';
import { GinitPressable } from '@/components/ui/GinitPressable';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { useAndroidOverlayHardwareBack } from '@/src/hooks/use-android-overlay-hardware-back';
import { safeRouterBack } from '@/src/lib/router-safe';
import { useTransitionRouter } from '@/src/lib/screen-transition-navigation';

export default function UserReportScreen() {
  const router = useTransitionRouter();
  const handleHardwareBack = useCallback(() => safeRouterBack(router), [router]);
  useAndroidOverlayHardwareBack(handleHardwareBack);

  const params = useLocalSearchParams<{ reportedUserId?: string | string[]; displayName?: string | string[] }>();
  const reportedUserId = useMemo(() => {
    const raw = params.reportedUserId;
    const v = Array.isArray(raw) ? (raw[0] ?? '') : typeof raw === 'string' ? raw : '';
    return decodeURIComponent(String(v)).trim();
  }, [params.reportedUserId]);
  const displayName = useMemo(() => {
    const raw = params.displayName;
    const v = Array.isArray(raw) ? (raw[0] ?? '') : typeof raw === 'string' ? raw : '';
    return decodeURIComponent(String(v)).trim();
  }, [params.displayName]);

  const onSubmitted = useCallback(() => {
    safeRouterBack(router);
  }, [router]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <GinitPressable
          onPress={handleHardwareBack}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="뒤로"
          style={styles.backBtn}>
          <GinitSymbolicIcon name="chevron-back" size={22} color="#0f172a" />
        </GinitPressable>
        <Text style={styles.topTitle}>신고</Text>
        <View style={styles.topBarSpacer} />
      </View>
      {reportedUserId ? (
        <UserReportForm
          reportedUserId={reportedUserId}
          reportedDisplayName={displayName || undefined}
          onSubmitted={onSubmitted}
        />
      ) : (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>신고 대상을 찾을 수 없어요.</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    height: 52,
  },
  backBtn: { padding: 4 },
  topTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: '#0f172a' },
  topBarSpacer: { width: 44, height: 1 },
  empty: { flex: 1, padding: 20, justifyContent: 'center' },
  emptyText: { fontSize: 14, fontWeight: '700', color: '#64748b', textAlign: 'center' },
});
