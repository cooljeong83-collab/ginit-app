import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { JoinedMeetingDashboardCard } from '@/components/joined-meetings/JoinedMeetingDashboardCard';
import { ScreenShell } from '@/components/ui';
import { HomeGlassStyles } from '@/constants/home-glass-styles';
import { GinitTheme } from '@/constants/ginit-theme';
import { useUserSession } from '@/src/context/UserSessionContext';
import { filterJoinedMeetings } from '@/src/lib/joined-meetings';
import type { Meeting } from '@/src/lib/meetings';
import { subscribeMeetings } from '@/src/lib/meetings';

export default function ProfileMeetingHistoryScreen() {
  const router = useRouter();
  const { userId } = useUserSession();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    const unsub = subscribeMeetings(
      (list) => {
        setMeetings(list);
        setError(null);
        setLoading(false);
      },
      (msg) => {
        setError(msg);
        setLoading(false);
      },
    );
    return unsub;
  }, []);

  const joinedMeetings = useMemo(
    () => filterJoinedMeetings(meetings, userId),
    [meetings, userId],
  );

  return (
    <ScreenShell padded={false} style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.topBar}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="뒤로"
            style={styles.backBtn}>
            <Ionicons name="chevron-back" size={28} color={GinitTheme.colors.text} />
          </Pressable>
          <Text style={styles.topTitle} numberOfLines={1}>
            참가 모임 히스토리
          </Text>
          <View style={styles.topBarSpacer} />
        </View>

        <ScrollView
          contentContainerStyle={[HomeGlassStyles.scrollPad, styles.scroll]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <Text style={styles.desc}>프로필에서 참가했던 모임과 동일하게, 지금 참여 중인 모임을 모아 보여줘요.</Text>

          {loading ? (
            <View style={styles.centerRow}>
              <ActivityIndicator color={GinitTheme.colors.primary} />
              <Text style={styles.muted}>불러오는 중…</Text>
            </View>
          ) : error ? (
            <Text style={styles.errorText}>{error}</Text>
          ) : joinedMeetings.length === 0 ? (
            <Text style={styles.empty}>
              아직 참여 중인 모임이 없어요. 홈에서 모임에 참여하면 여기에 표시돼요.
            </Text>
          ) : (
            joinedMeetings.map((m) => <JoinedMeetingDashboardCard key={m.id} meeting={m} />)
          )}
        </ScrollView>
      </SafeAreaView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: GinitTheme.colors.bg },
  safe: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 4,
  },
  backBtn: {
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  topTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '800',
    color: GinitTheme.colors.text,
    textAlign: 'center',
  },
  topBarSpacer: {
    width: 36,
  },
  scroll: {
    paddingTop: 4,
    paddingBottom: 28,
  },
  desc: {
    fontSize: 14,
    lineHeight: 20,
    color: '#64748b',
    marginBottom: 16,
  },
  centerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  muted: {
    fontSize: 14,
    color: '#64748b',
  },
  errorText: {
    fontSize: 14,
    color: '#b91c1c',
    marginBottom: 14,
  },
  empty: {
    fontSize: 14,
    lineHeight: 20,
    color: '#64748b',
  },
});
