import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { GinitTheme } from '@/constants/ginit-theme';
import {
    acceptFollowRequest,
    fetchFollowersList,
    fetchFollowingList,
    fetchFollowPendingInbox,
    fetchFollowPendingOutbox,
    rejectFollowRequest,
    unfollow,
    type FollowListRow,
    type FollowPendingInboxRow,
    type FollowPendingOutboxRow,
} from '@/src/lib/follow';
import type { UserProfile } from '@/src/lib/user-profile';
import { getUserProfilesForIds } from '@/src/lib/user-profile';

type Tab = 'following' | 'followers' | 'requests';

type Props = {
  userId: string;
};

function Avatar({ profile, fallback }: { profile: UserProfile | null | undefined; fallback: string }) {
  const uri = profile?.photoUrl?.trim();
  const initial = (profile?.nickname?.trim() || fallback).slice(0, 1) || '?';
  return uri ? (
    <Image source={{ uri }} style={styles.avatarImg} contentFit="cover" />
  ) : (
    <View style={styles.avatarFallback}>
      <Text style={styles.avatarLetter}>{initial}</Text>
    </View>
  );
}

function ProfileRow({
  title,
  subtitle,
  profile,
  right,
}: {
  title: string;
  subtitle?: string;
  profile: UserProfile | null | undefined;
  right?: React.ReactNode;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowLeft}>
        <View style={styles.avatarWrap}>
          <Avatar profile={profile} fallback={title} />
        </View>
        <View style={styles.rowTextCol}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.rowSub} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>
      {right ? <View style={styles.rowRight}>{right}</View> : null}
    </View>
  );
}

export function FollowManager({ userId }: Props) {
  const me = userId.trim();
  const [tab, setTab] = useState<Tab>('following');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [following, setFollowing] = useState<FollowListRow[]>([]);
  const [followers, setFollowers] = useState<FollowListRow[]>([]);
  const [pendingInbox, setPendingInbox] = useState<FollowPendingInboxRow[]>([]);
  const [pendingOutbox, setPendingOutbox] = useState<FollowPendingOutboxRow[]>([]);
  const [profiles, setProfiles] = useState<Map<string, UserProfile>>(new Map());

  const reload = useCallback(async () => {
    if (!me) return;
    setLoading(true);
    setErr(null);
    try {
      const [fg, fr, inbox, outbox] = await Promise.all([
        fetchFollowingList(me),
        fetchFollowersList(me),
        fetchFollowPendingInbox(me),
        fetchFollowPendingOutbox(me),
      ]);
      setFollowing(fg);
      setFollowers(fr);
      setPendingInbox(inbox);
      setPendingOutbox(outbox);

      const ids = [
        ...fg.map((x) => x.peer_app_user_id),
        ...fr.map((x) => x.peer_app_user_id),
        ...inbox.map((x) => x.requester_app_user_id),
        ...outbox.map((x) => x.addressee_app_user_id),
      ]
        .map((x) => String(x ?? '').trim())
        .filter(Boolean);
      const uniq = [...new Set(ids)];
      if (uniq.length) {
        const map = await getUserProfilesForIds(uniq);
        setProfiles(map);
      } else {
        setProfiles(new Map());
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [me]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const followingSet = useMemo(() => new Set(following.map((x) => x.peer_app_user_id)), [following]);
  const followersSet = useMemo(() => new Set(followers.map((x) => x.peer_app_user_id)), [followers]);

  const rowsForTab = useMemo(() => {
    if (tab === 'following') return following.map((x) => ({ kind: 'following' as const, row: x }));
    if (tab === 'followers') return followers.map((x) => ({ kind: 'followers' as const, row: x }));
    return [
      ...pendingInbox.map((x) => ({ kind: 'inbox' as const, row: x })),
      ...pendingOutbox.map((x) => ({ kind: 'outbox' as const, row: x })),
    ];
  }, [followers, following, pendingInbox, pendingOutbox, tab]);

  const onAccept = useCallback(
    async (id: string) => {
      try {
        await acceptFollowRequest(me, id);
        await reload();
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    },
    [me, reload],
  );

  const onReject = useCallback(
    async (id: string) => {
      try {
        await rejectFollowRequest(me, id);
        await reload();
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    },
    [me, reload],
  );

  const onUnfollow = useCallback(
    async (peer: string) => {
      try {
        await unfollow(me, peer);
        await reload();
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    },
    [me, reload],
  );

  if (!me) {
    return (
      <View style={styles.pad}>
        <Text style={styles.muted}>로그인 후 팔로우 목록을 볼 수 있어요.</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.tabs}>
        {([
          { id: 'following', label: `팔로잉 ${following.length}` },
          { id: 'followers', label: `팔로워 ${followers.length}` },
          { id: 'requests', label: `요청 ${pendingInbox.length}` },
        ] as const).map((t) => {
          const active = tab === t.id;
          return (
            <Pressable
              key={t.id}
              onPress={() => setTab(t.id)}
              style={[styles.tabBtn, active && styles.tabBtnActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}>
              <Text style={[styles.tabText, active && styles.tabTextActive]} numberOfLines={1}>
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={GinitTheme.colors.primary} />
        </View>
      ) : null}
      {err ? (
        <View style={styles.errBox}>
          <Text style={styles.errText}>{err}</Text>
        </View>
      ) : null}

      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {rowsForTab.length === 0 && !loading ? (
          <Text style={styles.muted}>
            {tab === 'requests' ? '대기 중인 요청이 없어요.' : '표시할 항목이 없어요.'}
          </Text>
        ) : null}

        {rowsForTab.map((x) => {
          if (x.kind === 'following') {
            const peer = x.row.peer_app_user_id;
            const p = profiles.get(peer);
            const mutual = followersSet.has(peer);
            return (
              <ProfileRow
                key={`following-${x.row.id}`}
                title={p?.nickname ?? '회원'}
                subtitle={mutual ? '맞팔로우' : '팔로잉'}
                profile={p}
                right={
                  <Pressable
                    onPress={() => void onUnfollow(peer)}
                    style={({ pressed }) => [styles.smallBtn, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel="언팔로우">
                    <Text style={styles.smallBtnText}>언팔</Text>
                  </Pressable>
                }
              />
            );
          }
          if (x.kind === 'followers') {
            const peer = x.row.peer_app_user_id;
            const p = profiles.get(peer);
            const mutual = followingSet.has(peer);
            return (
              <ProfileRow
                key={`followers-${x.row.id}`}
                title={p?.nickname ?? '회원'}
                subtitle={mutual ? '맞팔로우' : '팔로워'}
                profile={p}
              />
            );
          }
          if (x.kind === 'inbox') {
            const peer = x.row.requester_app_user_id;
            const p = profiles.get(peer);
            return (
              <ProfileRow
                key={`inbox-${x.row.id}`}
                title={p?.nickname ?? '회원'}
                subtitle="팔로우 요청"
                profile={p}
                right={
                  <View style={styles.actionRow}>
                    <Pressable
                      onPress={() => void onReject(x.row.id)}
                      style={({ pressed }) => [styles.smallBtnGhost, pressed && styles.pressed]}
                      accessibilityRole="button"
                      accessibilityLabel="거절">
                      <Text style={styles.smallBtnGhostText}>거절</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => void onAccept(x.row.id)}
                      style={({ pressed }) => [styles.smallBtnPrimary, pressed && styles.pressed]}
                      accessibilityRole="button"
                      accessibilityLabel="승인">
                      <Text style={styles.smallBtnPrimaryText}>승인</Text>
                    </Pressable>
                  </View>
                }
              />
            );
          }
          // outbox
          const peer = x.row.addressee_app_user_id;
          const p = profiles.get(peer);
          return (
            <ProfileRow
              key={`outbox-${x.row.id}`}
              title={p?.nickname ?? '회원'}
              subtitle="요청중"
              profile={p}
              right={
                <Pressable
                  onPress={() => void onUnfollow(peer)}
                  style={({ pressed }) => [styles.smallBtnGhost, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel="요청 취소">
                  <Text style={styles.smallBtnGhostText}>취소</Text>
                </Pressable>
              }
            />
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  pad: { padding: 16 },
  muted: { fontSize: 14, color: GinitTheme.colors.textMuted },
  pressed: { opacity: 0.88 },
  center: { paddingVertical: 12, alignItems: 'center' },
  errBox: {
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(220, 38, 38, 0.08)',
  },
  errText: { fontSize: 13, fontWeight: '700', color: '#b91c1c' },
  tabs: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  tabBtn: {
    flex: 1,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
  },
  tabBtnActive: {
    backgroundColor: GinitTheme.colors.primary,
    borderColor: GinitTheme.colors.primary,
  },
  tabText: { fontSize: 12, fontWeight: '600', color: GinitTheme.colors.textSub },
  tabTextActive: { color: '#fff' },
  list: { paddingHorizontal: 16, paddingBottom: 24, gap: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
  },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 },
  rowTextCol: { flex: 1, minWidth: 0, gap: 2 },
  rowRight: { flexShrink: 0, alignItems: 'flex-end' },
  rowTitle: { fontSize: 15, fontWeight: '600', color: GinitTheme.colors.text },
  rowSub: { fontSize: 12, fontWeight: '700', color: GinitTheme.colors.textMuted },
  avatarWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: 'rgba(226, 232, 240, 0.85)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  avatarLetter: { fontSize: 18, fontWeight: '600', color: GinitTheme.colors.primary },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  smallBtn: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.06)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.08)',
  },
  smallBtnText: { fontSize: 12, fontWeight: '600', color: GinitTheme.colors.textSub },
  smallBtnGhost: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.12)',
  },
  smallBtnGhostText: { fontSize: 12, fontWeight: '600', color: GinitTheme.colors.textSub },
  smallBtnPrimary: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GinitTheme.colors.primary,
  },
  smallBtnPrimaryText: { fontSize: 12, fontWeight: '600', color: '#fff' },
});

