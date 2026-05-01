import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GinitTheme } from '@/constants/ginit-theme';
import { useUserSession } from '@/src/context/UserSessionContext';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import {
    friendsAllowRecommendationsStorageKey,
    friendsAutoAddContactsStorageKey,
    loadBlockedPeerIds,
    loadFriendBoolPref,
    loadHiddenPeerIds,
    saveFriendBoolPref,
} from '@/src/lib/friends-privacy-local';

function RowSep() {
  return <View style={styles.sep} />;
}

/** 하단 탭「모임 생성」FAB과 동일 톤 (`GinitTabBar` fabInner / trustBlue) */
const meetingCreateSwitchTrack = { false: '#cbd5e1', true: GinitTheme.trustBlue } as const;

export default function FriendsSettingsScreen() {
  const router = useRouter();
  const { userId } = useUserSession();
  const me = userId?.trim() ? normalizeParticipantId(userId.trim()) : '';

  const [autoAdd, setAutoAdd] = useState(false);
  const [recOn, setRecOn] = useState(true);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [blockedCount, setBlockedCount] = useState(0);

  const refreshCounts = useCallback(async () => {
    if (!me) return;
    const [h, b] = await Promise.all([loadHiddenPeerIds(me), loadBlockedPeerIds(me)]);
    setHiddenCount(h.size);
    setBlockedCount(b.size);
  }, [me]);

  const loadPrefs = useCallback(async () => {
    if (!me) {
      setPrefsLoaded(true);
      return;
    }
    const [a, r] = await Promise.all([
      loadFriendBoolPref(me, friendsAutoAddContactsStorageKey, false),
      loadFriendBoolPref(me, friendsAllowRecommendationsStorageKey, true),
    ]);
    setAutoAdd(a);
    setRecOn(r);
    await refreshCounts();
    setPrefsLoaded(true);
  }, [me, refreshCounts]);

  useFocusEffect(
    useCallback(() => {
      void loadPrefs();
    }, [loadPrefs]),
  );

  const onToggleAutoAdd = useCallback(
    async (next: boolean) => {
      setAutoAdd(next);
      if (!me) return;
      try {
        await saveFriendBoolPref(me, friendsAutoAddContactsStorageKey, next);
      } catch {
        setAutoAdd((v) => !v);
      }
    },
    [me],
  );

  const onToggleRec = useCallback(
    async (next: boolean) => {
      setRecOn(next);
      if (!me) return;
      try {
        await saveFriendBoolPref(me, friendsAllowRecommendationsStorageKey, next);
      } catch {
        setRecOn((v) => !v);
      }
    },
    [me],
  );

  if (!me) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>로그인 후 이용할 수 있어요.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']} accessibilityLabel="친구 관리">
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.block}>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>자동 친구 추가</Text>
              <Text style={styles.rowSub}>연락처에 저장된 번호로 가입한 지닛을 자동으로 친구에 추가해요.</Text>
            </View>
            {prefsLoaded ? (
              <Switch
                value={autoAdd}
                onValueChange={(v) => void onToggleAutoAdd(v)}
                trackColor={meetingCreateSwitchTrack}
                thumbColor={autoAdd ? '#FFFFFF' : '#f1f5f9'}
                ios_backgroundColor="#cbd5e1"
                accessibilityLabel="자동 친구 추가"
              />
            ) : null}
          </View>
          <RowSep />
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>친구 추천 허용</Text>
              <Text style={styles.rowSub}>모임·활동을 바탕으로 한 친구 추천을 받을지 설정해요.</Text>
            </View>
            {prefsLoaded ? (
              <Switch
                value={recOn}
                onValueChange={(v) => void onToggleRec(v)}
                trackColor={meetingCreateSwitchTrack}
                thumbColor={recOn ? '#FFFFFF' : '#f1f5f9'}
                ios_backgroundColor="#cbd5e1"
                accessibilityLabel="친구 추천 허용"
              />
            ) : null}
          </View>
        </View>

        <View style={[styles.block, styles.blockGap]}>
          <Pressable
            onPress={() => router.push('/social/hidden-friends')}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            accessibilityRole="button"
            accessibilityLabel="숨긴 친구 관리">
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>숨긴 친구 관리</Text>
              <Text style={styles.rowSub}>
                {hiddenCount > 0 ? `숨긴 친구 ${hiddenCount}명` : '숨긴 친구가 없어요'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={GinitTheme.colors.textMuted} />
          </Pressable>
          <RowSep />
          <Pressable
            onPress={() => router.push('/social/blocked-friends')}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            accessibilityRole="button"
            accessibilityLabel="차단 친구 관리">
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>차단 친구 관리</Text>
              <Text style={styles.rowSub}>
                {blockedCount > 0 ? `차단 ${blockedCount}명` : '차단한 친구가 없어요'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={GinitTheme.colors.textMuted} />
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: GinitTheme.colors.bg },
  scroll: { paddingTop: 8, paddingBottom: 32 },
  block: {
    backgroundColor: 'transparent',
  },
  blockGap: { marginTop: 20 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    gap: 12,
  },
  rowPressed: { opacity: 0.82 },
  rowText: { flex: 1, minWidth: 0 },
  rowLabel: { fontSize: 16, fontWeight: '600', color: GinitTheme.colors.text, letterSpacing: -0.2 },
  rowSub: { marginTop: 4, fontSize: 12, fontWeight: '600', color: GinitTheme.colors.textMuted, lineHeight: 16 },
  sep: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 20,
    backgroundColor: GinitTheme.colors.border,
  },
  emptyWrap: { flex: 1, padding: 24, justifyContent: 'center' },
  emptyText: { fontSize: 15, fontWeight: '700', color: GinitTheme.colors.textMuted, textAlign: 'center' },
});
