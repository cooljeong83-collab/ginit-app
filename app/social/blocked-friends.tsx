import { useFocusEffect } from '@react-navigation/native';
import { Image } from 'expo-image';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GinitTheme } from '@/constants/ginit-theme';
import { useUserSession } from '@/src/context/UserSessionContext';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { friendPeerStorageKey, loadBlockedPeerIds, saveBlockedPeerIds } from '@/src/lib/friends-privacy-local';
import type { UserProfile } from '@/src/lib/user-profile';
import { getUserProfilesForIds } from '@/src/lib/user-profile';

type Row = { peerId: string; profile: UserProfile | null };

export default function BlockedFriendsScreen() {
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
      const blocked = await loadBlockedPeerIds(me);
      const ids = [...blocked];
      const profiles = ids.length ? await getUserProfilesForIds(ids) : new Map<string, UserProfile>();
      const next: Row[] = ids.map((id) => ({
        peerId: id,
        profile: profiles.get(id) ?? profiles.get(id.trim()) ?? null,
      }));
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

  const onUnblock = useCallback(
    (peerId: string, label: string) => {
      if (!me) return;
      Alert.alert('차단 해제', `${label}님 차단을 해제할까요?`, [
        { text: '취소', style: 'cancel' },
        {
          text: '해제',
          onPress: () => {
            void (async () => {
              const pk = friendPeerStorageKey(peerId);
              const next = await loadBlockedPeerIds(me);
              next.delete(pk);
              await saveBlockedPeerIds(me, next);
              void reload();
            })();
          },
        },
      ]);
    },
    [me, reload],
  );

  const listEmpty = useMemo(
    () => (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>차단한 친구가 없어요</Text>
        <Text style={styles.emptyBody}>친구 프로필에서 「차단」으로 관리할 수 있어요.</Text>
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
        keyExtractor={(item) => item.peerId}
        ListEmptyComponent={listEmpty}
        contentContainerStyle={rows.length === 0 ? styles.listEmptyGrow : styles.listPad}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        renderItem={({ item }) => {
          const p = item.profile;
          const nick = p?.nickname?.trim() || '알 수 없음';
          const photo = p?.photoUrl?.trim();
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
                  메시지·친구 추천에서 제외돼요
                </Text>
              </View>
              <Pressable
                onPress={() => onUnblock(item.peerId, nick)}
                style={({ pressed }) => [styles.unblockBtn, pressed && { opacity: 0.85 }]}
                accessibilityRole="button"
                accessibilityLabel={`${nick} 차단 해제`}>
                <Text style={styles.unblockBtnText}>차단 해제</Text>
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
  avatarLetter: { fontSize: 18, fontWeight: '900', color: GinitTheme.colors.primary },
  itemMid: { flex: 1, minWidth: 0 },
  itemTitle: { fontSize: 15, fontWeight: '900', color: GinitTheme.colors.text },
  itemSub: { marginTop: 2, fontSize: 12, fontWeight: '600', color: GinitTheme.colors.textMuted },
  unblockBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: GinitTheme.colors.border },
  unblockBtnText: { fontSize: 12, fontWeight: '600', color: GinitTheme.colors.text },
  empty: { paddingHorizontal: 24, paddingTop: 48, alignItems: 'center' },
  emptyTitle: { fontSize: 16, fontWeight: '900', color: GinitTheme.colors.text, marginBottom: 8, textAlign: 'center' },
  emptyBody: { fontSize: 14, fontWeight: '600', color: GinitTheme.colors.textMuted, textAlign: 'center', lineHeight: 21 },
});
