import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { fetchAdminSessionGate } from '@/src/features/admin-reports/admin-session-gate';
import { presentAppDialogAlert } from '@/src/lib/app-dialog-present';
import { safeRouterBack } from '@/src/lib/router-safe';

export default function AdminLayout() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const gate = await fetchAdminSessionGate();
      if (cancelled) return;
      if (!gate.ok || !gate.admin) {
        const hint =
          gate.hint ??
          (gate.reason === 'not_admin'
            ? '운영자 계정만 접근할 수 있어요.'
            : '로그인 후 다시 시도해 주세요.');
        presentAppDialogAlert({ title: '접근 불가', body: hint });
        safeRouterBack(router);
        setReady(true);
        setAllowed(false);
        return;
      }
      setAllowed(true);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!allowed) {
    return (
      <View style={styles.center}>
        <Text style={styles.denied}>접근할 수 없어요.</Text>
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
      }}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  denied: { fontSize: 14, fontWeight: '600', color: '#64748b' },
});
