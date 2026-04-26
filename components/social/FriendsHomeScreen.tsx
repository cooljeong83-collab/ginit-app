import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { RectButton, Swipeable } from 'react-native-gesture-handler';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { GinitButton, GinitCard } from '@/components/ginit';
import { InAppAlarmsBellButton } from '@/components/in-app-alarms/InAppAlarmsBellButton';
import { ScreenShell } from '@/components/ui';
import { GinitTheme } from '@/constants/ginit-theme';
import { useUserSession } from '@/src/context/UserSessionContext';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import type { FriendAcceptedRow, FriendInboxRow } from '@/src/lib/friends';
import {
  acceptGinitRequest,
  cancelOutgoingGinitRequest,
  declineGinitRequest,
  fetchFriendsAcceptedList,
  fetchFriendsPendingInbox,
  fetchFriendsPendingOutbox,
} from '@/src/lib/friends';
import { subscribeFriendsTableChanges } from '@/src/lib/supabase-friends-realtime';
import { socialDmRoomId } from '@/src/lib/social-chat-rooms';
import type { UserProfile } from '@/src/lib/user-profile';
import { getUserProfilesForIds } from '@/src/lib/user-profile';

/** gDna 뱃지 포인트 — 프로필·피드와 동일한 오렌지 톤 */
const ACCENT_ORANGE = '#FF8A00';

/** `friends`·프로필 맵 조회용 app_user_id 정규화 */
function friendAppUserKey(raw: string | null | undefined): string {
  const t = raw?.trim() ?? '';
  return t ? normalizeParticipantId(t) : '';
}

function profileFromMap(map: Map<string, UserProfile>, rawId: string | null | undefined): UserProfile | undefined {
  const k = friendAppUserKey(rawId);
  if (!k) return undefined;
  return map.get(k) ?? map.get(rawId?.trim() ?? '');
}

function PendingGinitCard({
  row,
  profile,
  onAccept,
  onDecline,
}: {
  row: FriendInboxRow;
  profile: UserProfile | undefined;
  onAccept: (row: FriendInboxRow) => void;
  onDecline: (row: FriendInboxRow) => void;
}) {
  const nick = profile?.nickname?.trim() || '회원';
  const photo = profile?.photoUrl?.trim();
  const initials = nick.slice(0, 1) || '?';

  return (
    <View style={styles.pendingCard}>
      <View style={styles.pendingAvatarRing}>
        {photo ? (
          <Image source={{ uri: photo }} style={styles.pendingAvatarImg} contentFit="cover" />
        ) : (
          <View style={styles.pendingAvatarFallback}>
            <Text style={styles.pendingAvatarLetter}>{initials}</Text>
          </View>
        )}
      </View>
      <Text style={styles.pendingNick} numberOfLines={1}>
        {nick}
      </Text>
      <Text style={styles.pendingHint} numberOfLines={1}>
        지닛 요청
      </Text>
      <View style={styles.pendingActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="지닛 수락"
          onPress={() => onAccept(row)}
          style={({ pressed }) => [styles.pendingIconBtn, styles.pendingAcceptBtn, pressed && { opacity: 0.9 }]}>
          <Ionicons name="checkmark" size={20} color="#FFFFFF" />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="지닛 거절"
          onPress={() => onDecline(row)}
          style={({ pressed }) => [styles.pendingIconBtn, styles.pendingDeclineBtn, pressed && { opacity: 0.88 }]}>
          <Ionicons name="close" size={20} color="#64748B" />
        </Pressable>
      </View>
    </View>
  );
}

function OutgoingGinitCard({
  row,
  profile,
  status,
  onCancel,
}: {
  row: FriendInboxRow;
  /** 지닛 요청을 받은 사람(addressee) 프로필만 넘기세요. */
  profile: UserProfile | undefined;
  status: string;
  onCancel: (row: FriendInboxRow) => void;
}) {
  const nick = profile?.nickname?.trim() || '회원';
  const photo = profile?.photoUrl?.trim();
  const initials = nick.slice(0, 1) || '?';
  const hint = status === 'accepted' ? '상대와 연결됨' : '상대 응답 대기';
  const canCancel = status === 'pending';

  return (
    <View
      style={styles.pendingCard}
      accessibilityRole="summary"
      accessibilityLabel={`지닛 요청을 받은 사람, ${nick}, ${hint}`}>
      <View style={styles.pendingAvatarRing}>
        {photo ? (
          <Image source={{ uri: photo }} style={styles.pendingAvatarImg} contentFit="cover" />
        ) : (
          <View style={styles.pendingAvatarFallback}>
            <Text style={styles.pendingAvatarLetter}>{initials}</Text>
          </View>
        )}
      </View>
      <Text style={styles.pendingNick} numberOfLines={1}>
        {nick}
      </Text>
      <Text style={styles.pendingHint} numberOfLines={1}>
        {hint}
      </Text>
      {canCancel ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="지닛 요청 취소"
          onPress={() => onCancel(row)}
          style={({ pressed }) => [styles.outgoingCancelBtn, pressed && { opacity: 0.88 }]}>
          <Text style={styles.outgoingCancelBtnText}>요청 취소</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function FriendListRow({
  profile,
  onOpenChat,
}: {
  row: FriendAcceptedRow;
  profile: UserProfile;
  onOpenChat: () => void;
}) {
  const uri = profile.photoUrl?.trim();
  const initials = profile.nickname?.trim()?.slice(0, 1) || '?';
  const gLv = typeof profile.gLevel === 'number' && Number.isFinite(profile.gLevel) ? Math.max(1, Math.trunc(profile.gLevel)) : 1;
  const dna = profile.gDna?.trim() || '—';
  const trust = typeof profile.gTrust === 'number' ? profile.gTrust : null;

  const renderLeftActions = useCallback(
    (_progress: unknown, _drag: unknown, swipeable: { close: () => void }) => (
      <View style={styles.swipeLeftRail}>
        <RectButton
          style={styles.swipeChatBtn}
          onPress={() => {
            swipeable.close();
            onOpenChat();
          }}>
          <Text style={styles.swipeChatBtnText}>채팅하기</Text>
        </RectButton>
      </View>
    ),
    [onOpenChat],
  );

  return (
    <Swipeable
      renderLeftActions={renderLeftActions}
      overshootLeft={false}
      friction={2}
      containerStyle={styles.swipeContainer}
      childrenContainerStyle={{ flex: 1 }}>
      <View style={styles.friendMenuRow}>
        <View style={styles.friendMenuLeft}>
          <View style={styles.friendAvatarRing}>
            {uri ? (
              <Image source={{ uri }} style={styles.friendAvatarImg} contentFit="cover" />
            ) : (
              <View style={styles.friendAvatarFallback}>
                <Text style={styles.friendAvatarLetter}>{initials}</Text>
              </View>
            )}
          </View>
          <View style={styles.friendMenuTextCol}>
            <Text style={styles.friendMenuTitle} numberOfLines={1}>
              {profile.nickname}
            </Text>
            <View style={styles.gDnaBadge}>
              <Text style={styles.gDnaBadgeText} numberOfLines={1}>
                gDna · {dna}
              </Text>
            </View>
            {trust != null ? (
              <Text style={styles.friendMenuSub} numberOfLines={1}>
                gTrust {trust}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={styles.friendMenuRight}>
          <Text style={styles.gLevelLabel}>Lv.</Text>
          <Text style={styles.gLevelValue}>{gLv}</Text>
          <Text style={styles.friendSwipeHint}>밀어서 채팅</Text>
        </View>
      </View>
    </Swipeable>
  );
}

/**
 * [친구] 탭 — 프로필·모임 등록과 동일한 밝은 글래스 카드(`GinitCard`)·`menuRow`형 리스트.
 */
export function FriendsHomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { userId } = useUserSession();
  const me = useMemo(() => {
    const raw = userId?.trim() ?? '';
    return raw ? normalizeParticipantId(raw) : '';
  }, [userId]);

  const [pending, setPending] = useState<FriendInboxRow[]>([]);
  const [pendingOut, setPendingOut] = useState<FriendInboxRow[]>([]);
  const [accepted, setAccepted] = useState<FriendAcceptedRow[]>([]);
  const [profiles, setProfiles] = useState<Map<string, UserProfile>>(new Map());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!me) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    setErr(null);
    try {
      const [p, po, a] = await Promise.all([
        fetchFriendsPendingInbox(me),
        fetchFriendsPendingOutbox(me),
        fetchFriendsAcceptedList(me),
      ]);
      setPending(p);
      setPendingOut(po);
      setAccepted(a);
      const ids = [
        ...new Set([
          ...p.map((x) => friendAppUserKey(x.requester_app_user_id)),
          ...po.map((x) => friendAppUserKey(x.addressee_app_user_id)),
          ...a.map((x) => friendAppUserKey(x.peer_app_user_id)),
        ]),
      ].filter(Boolean);
      if (ids.length) {
        const map = await getUserProfilesForIds(ids);
        setProfiles(map);
      } else {
        setProfiles(new Map());
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [me]);

  useFocusEffect(
    useCallback(() => {
      if (!me) {
        setLoading(false);
        return;
      }
      void reload();
    }, [me, reload]),
  );

  useEffect(() => {
    if (!me) return;
    return subscribeFriendsTableChanges(() => {
      void reload();
    });
  }, [me, reload]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void reload();
  }, [reload]);

  const sortedFriends = useMemo(() => {
    const rows = accepted.slice();
    rows.sort((a, b) => {
      const pa = profileFromMap(profiles, a.peer_app_user_id);
      const pb = profileFromMap(profiles, b.peer_app_user_id);
      const ta = typeof pa?.gTrust === 'number' ? pa.gTrust : 0;
      const tb = typeof pb?.gTrust === 'number' ? pb.gTrust : 0;
      return tb - ta;
    });
    return rows;
  }, [accepted, profiles]);

  const openDm = useCallback(
    (peerAppUserId: string, peerDisplayName?: string) => {
      const uid = me;
      if (!uid) return;
      const rid = socialDmRoomId(uid, peerAppUserId);
      const nick = peerDisplayName ?? profileFromMap(profiles, peerAppUserId)?.nickname ?? '친구';
      router.push(`/social-chat/${encodeURIComponent(rid)}?peerName=${encodeURIComponent(nick)}`);
    },
    [me, profiles, router],
  );

  const onAcceptPending = useCallback(
    async (row: FriendInboxRow) => {
      try {
        await acceptGinitRequest(me, row.id);
        await reload();
        openDm(row.requester_app_user_id);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    },
    [me, openDm, reload],
  );

  const onDeclinePending = useCallback(
    async (row: FriendInboxRow) => {
      try {
        await declineGinitRequest(me, row.id);
        await reload();
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    },
    [me, reload],
  );

  const onCancelOutgoing = useCallback(
    (row: FriendInboxRow) => {
      if (row.status !== 'pending') return;
      const nick = profileFromMap(profiles, row.addressee_app_user_id)?.nickname?.trim() ?? '상대';
      Alert.alert('요청 취소', `${nick}님에게 보낸 지닛 요청을 취소할까요?`, [
        { text: '아니오', style: 'cancel' },
        {
          text: '취소하기',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await cancelOutgoingGinitRequest(me, row.id);
                await reload();
              } catch (e) {
                setErr(e instanceof Error ? e.message : String(e));
              }
            })();
          },
        },
      ]);
    },
    [me, profiles, reload],
  );

  const goFindMeetings = useCallback(() => {
    router.push('/(tabs)/map');
  }, [router]);

  const listHeader = useMemo(
    () => (
      <View>
        <View style={styles.feedHeader}>
          <View style={styles.feedHeaderTopRow}>
            <View style={styles.chatTitlePressable} accessibilityRole="header">
              <View style={styles.chatTitleCluster}>
                <Text style={styles.chatTitle} numberOfLines={1}>
                  친구
                </Text>
              </View>
            </View>
            <View style={styles.headerActions}>
              <View style={styles.searchIconWrap} pointerEvents="none">
                <Ionicons name="search-outline" size={24} color="transparent" />
              </View>
              <InAppAlarmsBellButton />
              <Pressable
                accessibilityRole="button"
                hitSlop={10}
                accessibilityLabel="설정"
                style={styles.settingsIconWrap}>
                <Ionicons name="settings-outline" size={24} color="#0f172a" />
              </Pressable>
            </View>
          </View>
        </View>

        <GinitCard appearance="light" style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>나에게 온 지닛</Text>
          {pending.length === 0 ? (
            <View style={styles.inlineHintBox}>
              <Ionicons name="mail-open-outline" size={20} color="#94a3b8" />
              <Text style={styles.inlineHintText}>대기 중인 지닛이 없어요.</Text>
            </View>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.pendingStrip}>
              {pending.map((row) => (
                <PendingGinitCard
                  key={row.id}
                  row={row}
                  profile={profileFromMap(profiles, row.requester_app_user_id)}
                  onAccept={onAcceptPending}
                  onDecline={onDeclinePending}
                />
              ))}
            </ScrollView>
          )}
        </GinitCard>

        <GinitCard appearance="light" style={styles.sectionCard}>
          <Text style={[styles.sectionTitle, styles.sectionTitleWithSub]}>내가 보낸 지닛</Text>
          <Text style={styles.sectionSubInline}>내가 요청을 보낸 상대(요청을 받은 분)이에요.</Text>
          {pendingOut.length === 0 ? (
            <View style={styles.inlineHintBox}>
              <Ionicons name="paper-plane-outline" size={20} color="#94a3b8" />
              <Text style={styles.inlineHintText}>보낸 요청이 없어요.</Text>
            </View>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.pendingStrip}>
              {pendingOut.map((row) => (
                <OutgoingGinitCard
                  key={row.id}
                  row={row}
                  profile={profileFromMap(profiles, row.addressee_app_user_id)}
                  status={row.status}
                  onCancel={onCancelOutgoing}
                />
              ))}
            </ScrollView>
          )}
        </GinitCard>

        <Text style={[styles.sectionTitle, styles.sectionTitleLoose]}>내 친구</Text>
        <Text style={styles.sectionSub}>gTrust 높은 순으로 정렬돼요.</Text>
      </View>
    ),
    [onAcceptPending, onCancelOutgoing, onDeclinePending, pending, pendingOut, profiles],
  );

  const emptyFriends = useMemo(
    () => (
      <GinitCard appearance="light" style={styles.emptyCard}>
        <View style={styles.emptyIconWrap}>
          <Ionicons name="people-outline" size={28} color={GinitTheme.colors.primary} />
        </View>
        <Text style={styles.emptyTitle}>아직 연결된 지닛이 없어요</Text>
        <Text style={styles.emptyBody}>새로운 모임에서 친구를 찾아보세요.</Text>
        <GinitButton title="모임 찾기" onPress={goFindMeetings} style={styles.emptyCta} />
      </GinitCard>
    ),
    [goFindMeetings],
  );

  if (!me) {
    return (
      <ScreenShell padded={false} style={styles.root}>
        <SafeAreaView style={styles.safe} edges={['top']}>
          <View style={styles.loginBlock}>
            <Text style={styles.loginHint}>로그인 후 친구 목록을 볼 수 있어요.</Text>
          </View>
        </SafeAreaView>
      </ScreenShell>
    );
  }

  return (
    <ScreenShell padded={false} style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        {loading && sortedFriends.length === 0 && pending.length === 0 && pendingOut.length === 0 ? (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color={GinitTheme.colors.primary} />
          </View>
        ) : null}

        {err ? (
          <View style={styles.errBanner}>
            <Text style={styles.errText}>{err}</Text>
          </View>
        ) : null}

        <FlatList
          data={sortedFriends}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={emptyFriends}
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 88 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GinitTheme.colors.primary} />
          }
          renderItem={({ item }) => {
            const p = profileFromMap(profiles, item.peer_app_user_id);
            if (!p) {
              return (
                <View style={[styles.friendMenuRow, styles.friendRowGhost]}>
                  <ActivityIndicator color={GinitTheme.colors.primary} />
                  <Text style={styles.mutedLine}>프로필 불러오는 중…</Text>
                </View>
              );
            }
            return (
              <FriendListRow
                row={item}
                profile={p}
                onOpenChat={() => openDm(item.peer_app_user_id, p.nickname)}
              />
            );
          }}
        />
      </SafeAreaView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: GinitTheme.colors.bg },
  safe: { flex: 1 },
  scroll: {
    paddingHorizontal: 20,
    paddingBottom: 28,
  },
  feedHeader: {
    marginBottom: 16,
    paddingTop: 4,
    gap: 12,
  },
  feedHeaderTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  chatTitle: {
    flexShrink: 1,
    fontSize: 20,
    fontWeight: '700',
    color: GinitTheme.trustBlue,
    minWidth: 0,
  },
  chatTitleCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
    gap: 4,
  },
  chatTitlePressable: {
    alignSelf: 'flex-start',
    maxWidth: 220,
    borderRadius: 10,
    paddingVertical: 2,
    paddingHorizontal: 2,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    flexShrink: 0,
  },
  searchIconWrap: {
    position: 'relative',
    padding: 2,
  },
  settingsIconWrap: {
    position: 'relative',
    padding: 2,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
    backgroundColor: 'rgba(246, 250, 255, 0.65)',
  },
  errBanner: {
    marginHorizontal: 20,
    marginBottom: 8,
    padding: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(220, 38, 38, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(220, 38, 38, 0.22)',
  },
  errText: { color: '#b91c1c', fontWeight: '700', fontSize: 13 },
  screenSub: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748b',
    marginBottom: 16,
    lineHeight: 19,
  },
  sectionCard: {
    marginBottom: 8,
    borderColor: 'rgba(255, 255, 255, 0.55)',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#0f172a',
    marginBottom: 10,
  },
  sectionTitleWithSub: {
    marginBottom: 4,
  },
  sectionSubInline: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
    marginBottom: 10,
    lineHeight: 17,
  },
  sectionTitleLoose: {
    marginTop: 18,
    marginBottom: 6,
  },
  sectionSub: {
    fontSize: 12,
    fontWeight: '800',
    color: '#64748b',
    marginBottom: 4,
  },
  inlineHintBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(15, 23, 42, 0.04)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.1)',
  },
  inlineHintText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: '#64748b',
  },
  mutedLine: { fontSize: 13, fontWeight: '600', color: '#64748b' },
  loginBlock: { paddingHorizontal: 20, paddingTop: 24 },
  loginHint: { fontSize: 15, fontWeight: '800', color: '#0f172a', lineHeight: 22 },
  pendingStrip: {
    flexDirection: 'row',
    gap: 10,
    paddingBottom: 2,
    paddingRight: 2,
  },
  pendingCard: {
    width: 136,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.55)',
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    alignItems: 'center',
    gap: 8,
  },
  pendingAvatarRing: {
    width: 48,
    height: 48,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.12)',
    backgroundColor: 'rgba(15, 23, 42, 0.06)',
  },
  pendingAvatarImg: { width: '100%', height: '100%' },
  pendingAvatarFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 82, 204, 0.08)',
  },
  pendingAvatarLetter: { fontSize: 18, fontWeight: '900', color: GinitTheme.colors.primary },
  pendingNick: {
    fontSize: 13,
    fontWeight: '900',
    color: '#0f172a',
    textAlign: 'center',
    width: '100%',
  },
  pendingHint: { fontSize: 11, fontWeight: '700', color: '#94a3b8' },
  outgoingCancelBtn: {
    marginTop: 2,
    alignSelf: 'stretch',
    paddingVertical: 7,
    paddingHorizontal: 6,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  outgoingCancelBtnText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748b',
  },
  pendingActions: { flexDirection: 'row', gap: 10, marginTop: 2 },
  pendingIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  pendingAcceptBtn: {
    backgroundColor: GinitTheme.colors.primary,
    borderColor: 'rgba(15, 23, 42, 0.12)',
  },
  pendingDeclineBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderColor: 'rgba(15, 23, 42, 0.12)',
  },
  swipeContainer: {
    marginTop: 12,
  },
  swipeLeftRail: {
    width: 112,
    height: '100%',
    justifyContent: 'center',
    paddingRight: 8,
  },
  swipeChatBtn: {
    flex: 1,
    backgroundColor: GinitTheme.colors.primary,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    maxHeight: 72,
    alignSelf: 'stretch',
  },
  swipeChatBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  friendMenuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.55)',
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
  },
  friendRowGhost: { justifyContent: 'center', gap: 10, minHeight: 72 },
  friendMenuLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 },
  friendAvatarRing: {
    width: 44,
    height: 44,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.12)',
    backgroundColor: 'rgba(15, 23, 42, 0.06)',
  },
  friendAvatarImg: { width: '100%', height: '100%' },
  friendAvatarFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 82, 204, 0.08)',
  },
  friendAvatarLetter: { fontSize: 16, fontWeight: '900', color: GinitTheme.colors.primary },
  friendMenuTextCol: { flex: 1, minWidth: 0, gap: 4 },
  friendMenuTitle: {
    fontSize: 15,
    fontWeight: '900',
    color: '#0f172a',
  },
  friendMenuSub: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748b',
  },
  gDnaBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 138, 0, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255, 138, 0, 0.32)',
  },
  gDnaBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: ACCENT_ORANGE,
  },
  friendMenuRight: { alignItems: 'flex-end', justifyContent: 'center', paddingLeft: 8 },
  gLevelLabel: { fontSize: 10, fontWeight: '800', color: '#64748b' },
  gLevelValue: { fontSize: 18, fontWeight: '900', color: '#0f172a', letterSpacing: -0.4 },
  friendSwipeHint: { fontSize: 10, fontWeight: '700', color: '#94a3b8', marginTop: 2 },
  emptyCard: {
    marginTop: 8,
    borderColor: 'rgba(255, 255, 255, 0.55)',
    alignItems: 'center',
    paddingVertical: 22,
    paddingHorizontal: 16,
  },
  emptyIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.06)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.1)',
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#0f172a',
    textAlign: 'center',
    marginBottom: 6,
  },
  emptyBody: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 18,
  },
  emptyCta: { alignSelf: 'stretch', width: '100%' },
});
