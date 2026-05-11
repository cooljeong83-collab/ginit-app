import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SettlementAccountsScreenTopBar } from '@/components/settlement/SettlementAccountsScreenTopBar';
import { ScreenShell } from '@/components/ui';
import { GinitTheme } from '@/constants/ginit-theme';
import { safeRouterBack } from '@/src/lib/router-safe';

export default function ArrivalVerifyMeetingScreenWeb() {
  const router = useRouter();
  const params = useLocalSearchParams<{ meetingId: string | string[] }>();
  const meetingId = Array.isArray(params.meetingId)
    ? (params.meetingId[0] ?? '').trim()
    : typeof params.meetingId === 'string'
      ? params.meetingId.trim()
      : '';

  return (
    <ScreenShell padded={false} style={styles.rootShell}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <SettlementAccountsScreenTopBar title="장소 인증" onBack={() => safeRouterBack(router)} />
        <View style={styles.centered}>
          <Text style={styles.muted}>장소 인증은 iOS·Android 앱에서 진행해 주세요.</Text>
          {meetingId ? <Text style={styles.sub}>모임 ID: {meetingId}</Text> : null}
        </View>
      </SafeAreaView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  rootShell: { flex: 1, backgroundColor: GinitTheme.colors.bg },
  safe: { flex: 1, backgroundColor: GinitTheme.colors.bg },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    gap: 8,
  },
  muted: { fontSize: 15, fontWeight: '600', color: GinitTheme.colors.textSub, textAlign: 'center' },
  sub: { fontSize: 13, fontWeight: '500', color: GinitTheme.colors.textSub, textAlign: 'center' },
});
