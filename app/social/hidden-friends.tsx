import { useFocusEffect } from '@react-navigation/native';
import { Image } from 'expo-image';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GinitTheme } from '@/constants/ginit-theme';
import { useUserSession } from '@/src/context/UserSessionContext';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import type { FriendAcceptedRow } from '@/src/lib/friends';
import { fetchFriendsAcceptedList } from '@/src/lib/friends';
import { friendPeerStorageKey, loadHiddenPeerIds, saveHiddenPeerIds } from '@/src/lib/friends-privacy-local';
import type { UserProfile } from '@/src/lib/user-profile';
import { getUserProfilesForIds } from '@/src/lib/user-profile';

type Row = { row: FriendAcceptedRow; profile: UserProfile };

export default function HiddenFriendsScreen() {
  const { userId } = useUserSession();
  const me = userId?.trim() ? normalizeParticipantId(userId.trim()) : '';

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);

  const reload = useCallback(async () => {
    if (!me) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [hidden, accepted] = await Promise.all([loadHiddenPeerIds(me), fetchFriendsAcceptedList(me)]);
      const relevant = accepted.filter((a) => hidden.has(friendPeerStorageKey(a.peer_app_user_id)));
      const ids = relevant.map((a) => friendPeerStorageKey(a.peer_app_user_id)).filter(Boolean);
      const profiles = ids.length ? await getUserProfilesForIds(ids) : new Map<string, UserProfile>();
      const next: Row[] = [];
      for (const r of relevant) {
        const pk = friendPeerStorageKey(r.peer_app_user_id);
        const p = profiles.get(pk) ?? profiles.get(r.peer_app_user_id);
        if (p) next.push({ row: r, profile: p });
      }
      setRows(next);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [me]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const onUnhide = useCallback(
    async (peerId: string) => {
      if (!me) return;
      const pk = friendPeerStorageKey(peerId);
      const next = await loadHiddenPeerIds(me);
      next.delete(pk);
      await saveHiddenPeerIds(me, next);
      void reload();
    },
    [me, reload],
  );

  const listEmpty = useMemo(
    () => (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>숨긴 친구가 없어요</Text>
        <Text style={styles.emptyBody}>친구 목록에서 프로필을 열고 「목록에서 숨기기」로 숨길 수 있어요.</Text>
      </View>
    ),
    [],
  );

  if (!me) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>로그인이 필요해요</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.center} edges={['bottom']}>
        <ActivityIndicator color={GinitTheme.colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <FlatList
        data={rows}
        keyExtractor={(item) => item.row.id}
        ListEmptyComponent={listEmpty}
        contentContainerStyle={rows.length === 0 ? styles.listEmptyGrow : styles.listPad}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        renderItem={({ item }) => {
          const nick = item.profile.nickname?.trim() || '회원';
          const photo = item.profile.photoUrl?.trim();
          const letter = nick.slice(0, 1) || '?';
          return (
            <View style={styles.itemRow}>
              <View style={styles.avatar}>
                {photo ? (
                  <Image source={{ uri: photo }} style={styles.avatarImg} contentFit="cover" />
                ) : (
                  <Text style={styles.avatarLetter}>{letter}</Text>
                )}
              </View>
              <View style={styles.itemMid}>
                <Text style={styles.itemTitle} numberOfLines={1}>
                  {nick}
                </Text>
                <Text style={styles.itemSub} numberOfLines={1}>
                  친구 목록에 표시되지 않아요
                </Text>
              </View>
              <Pressable
                onPress={() => void onUnhide(item.row.peer_app_user_id)}
                style={({ pressed }) => [styles.unhideBtn, pressed && { opacity: 0.85 }]}
                accessibilityRole="button"
                accessibilityLabel={`${nick} 다시 표시`}>
                <Text style={styles.unhideBtnText}>숨김 해제</Text>
              </Pressable>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: GinitTheme.colors.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listPad: { paddingBottom: 24 },
  listEmptyGrow: { flexGrow: 1 },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: GinitTheme.colors.border, marginLeft: 68 },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    gap: 10,
    backgroundColor: GinitTheme.colors.bg,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: GinitTheme.colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarLetter: { fontSize: 18, fontWeight: '600', color: GinitTheme.colors.primary },
  itemMid: { flex: 1, minWidth: 0 },
  itemTitle: { fontSize: 15, fontWeight: '600', color: GinitTheme.colors.text },
  itemSub: { marginTop: 2, fontSize: 12, fontWeight: '600', color: GinitTheme.colors.textMuted },
  unhideBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: GinitTheme.colors.border },
  unhideBtnText: { fontSize: 12, fontWeight: '600', color: GinitTheme.colors.text },
  empty: { paddingHorizontal: 24, paddingTop: 48, alignItems: 'center' },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: GinitTheme.colors.text, marginBottom: 8, textAlign: 'center' },
  emptyBody: { fontSize: 14, fontWeight: '600', color: GinitTheme.colors.textMuted, textAlign: 'center', lineHeight: 21 },
});
