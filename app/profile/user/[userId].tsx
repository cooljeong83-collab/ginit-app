import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { UserProfilePublicBody } from '@/components/profile/UserProfilePublicBody';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { safeRouterBack } from '@/src/lib/router-safe';

export default function UserProfileStackScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ userId?: string | string[] }>();
  const targetUserId = useMemo(() => {
    const raw = params.userId;
    const v = Array.isArray(raw) ? (raw[0] ?? '') : typeof raw === 'string' ? raw : '';
    return decodeURIComponent(String(v)).trim();
  }, [params.userId]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => safeRouterBack(router)}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="뒤로"
          style={styles.backBtn}>
          <GinitSymbolicIcon name="chevron-back" size={22} color="#0f172a" />
        </Pressable>
        <Text style={styles.topTitle} numberOfLines={1}>
          프로필
        </Text>
        <View style={styles.topBarSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {targetUserId ? (
          <UserProfilePublicBody targetUserId={targetUserId} layout="stack" />
        ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>프로필을 찾을 수 없어요.</Text>
          </View>
        )}
      </ScrollView>
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

  scroll: { paddingBottom: 24 },
  empty: { padding: 20 },
  emptyText: { fontSize: 14, fontWeight: '700', color: '#64748b' },
});

