import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { RectButton, Swipeable } from 'react-native-gesture-handler';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { GinitButton, GinitCard } from '@/components/ginit';
import { InAppAlarmsBellButton } from '@/components/in-app-alarms/InAppAlarmsBellButton';
import { ScreenShell } from '@/components/ui';
import { GinitTheme } from '@/constants/ginit-theme';
import { useUserSession } from '@/src/context/UserSessionContext';
import type { Category } from '@/src/lib/categories';
import { subscribeCategories } from '@/src/lib/categories';
import {
  categoryEmojiForMeeting,
  compareFriendsByPresenceDistanceTrust,
  computeFriendSortSignals,
  formatDistanceCompact,
  meetingPhaseForFriend,
  mutualJoinedMeetingsCount,
  pickPrimaryMeetingForPeer,
  resolveFriendActivity,
  splitGDnaChips,
} from '@/src/lib/friend-presence-activity';
import { isUserJoinedMeeting } from '@/src/lib/joined-meetings';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import type { FriendAcceptedRow, FriendInboxRow } from '@/src/lib/friends';
import {
  acceptGinitRequest,
  cancelOutgoingGinitRequest,
  declineGinitRequest,
  fetchFriendsAcceptedList,
  fetchFriendsPendingInbox,
  fetchFriendsPendingOutbox,
  removeAcceptedFriend,
} from '@/src/lib/friends';
import { pushProfileOpenRegisterInfo } from '@/src/lib/profile-register-info';
import type { Meeting } from '@/src/lib/meetings';
import { subscribeMeetingsHybrid } from '@/src/lib/meetings-hybrid';
import { subscribeFriendsTableChanges } from '@/src/lib/supabase-friends-realtime';
import { getUserProfile, getUserProfilesForIds, isUserPhoneVerified } from '@/src/lib/user-profile';
import { socialDmRoomId } from '@/src/lib/social-chat-rooms';
import type { UserProfile } from '@/src/lib/user-profile';

const ACCENT_ORANGE = '#FF8A00';
const NEON_A = '#22d3ee';
const NEON_B = '#a855f7';
const HIDDEN_KEY = (me: string) => `ginit.friends.hidden.v1:${me}`;

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
  const [menuOpen, setMenuOpen] = useState(false);
  const nick = profile?.nickname?.trim() || '회원';
  const photo = profile?.photoUrl?.trim();
  const initials = nick.slice(0, 1) || '?';

  return (
    <View style={s.pendingCard}>
      {menuOpen ? (
        <Pressable
          style={s.pendingMenuBackdrop}
          onPress={() => setMenuOpen(false)}
          accessibilityRole="button"
          accessibilityLabel="메뉴 닫기"
        />
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${nick}, 지닛 요청. 눌러서 수락·거절`}
        accessibilityState={{ expanded: menuOpen }}
        onPress={() => setMenuOpen((v) => !v)}
        style={s.pendingAvatarTap}>
        <View style={s.pendingAvatarRing}>
          {photo ? (
            <Image source={{ uri: photo }} style={s.pendingAvatarImg} contentFit="cover" />
          ) : (
            <View style={s.pendingAvatarFallback}>
              <Text style={s.pendingAvatarLetter}>{initials}</Text>
            </View>
          )}
        </View>
      </Pressable>
      {menuOpen ? (
        <View style={s.pendingMenuSheet} pointerEvents="box-none">
          <View style={s.pendingMenuRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="지닛 수락"
              onPress={() => {
                setMenuOpen(false);
                onAccept(row);
              }}
              style={({ pressed }) => [s.pendingIconBtn, s.pendingAcceptBtn, pressed && { opacity: 0.9 }]}>
              <Ionicons name="checkmark" size={20} color="#FFFFFF" />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="지닛 거절"
              onPress={() => {
                setMenuOpen(false);
                onDecline(row);
              }}
              style={({ pressed }) => [s.pendingIconBtn, s.pendingDeclineBtn, pressed && { opacity: 0.88 }]}>
              <Ionicons name="close" size={20} color="#64748B" />
            </Pressable>
          </View>
        </View>
      ) : null}
      <View style={s.pendingTextBlock} pointerEvents={menuOpen ? 'none' : 'auto'}>
        <Text style={s.pendingNick} numberOfLines={1}>
          {nick}
        </Text>
        <Text style={s.pendingHint} numberOfLines={1}>
          지닛 요청
        </Text>
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
  profile: UserProfile | undefined;
  status: string;
  onCancel: (row: FriendInboxRow) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const nick = profile?.nickname?.trim() || '회원';
  const photo = profile?.photoUrl?.trim();
  const initials = nick.slice(0, 1) || '?';
  const hint = status === 'accepted' ? '상대와 연결됨' : '상대 응답 대기';
  const canCancel = status === 'pending';

  return (
    <View style={s.pendingCard} accessibilityRole="summary" accessibilityLabel={`지닛 요청을 받은 사람, ${nick}, ${hint}`}>
      {menuOpen ? (
        <Pressable
          style={s.pendingMenuBackdrop}
          onPress={() => setMenuOpen(false)}
          accessibilityRole="button"
          accessibilityLabel="메뉴 닫기"
        />
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${nick}, ${hint}. 눌러서 ${canCancel ? '요청 취소' : '상태 확인'}`}
        accessibilityState={{ expanded: menuOpen }}
        onPress={() => setMenuOpen((v) => !v)}
        style={s.pendingAvatarTap}>
        <View style={s.pendingAvatarRing}>
          {photo ? (
            <Image source={{ uri: photo }} style={s.pendingAvatarImg} contentFit="cover" />
          ) : (
            <View style={s.pendingAvatarFallback}>
              <Text style={s.pendingAvatarLetter}>{initials}</Text>
            </View>
          )}
        </View>
      </Pressable>
      {menuOpen ? (
        <View style={s.pendingMenuSheet} pointerEvents="box-none">
          {canCancel ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="지닛 요청 취소"
              onPress={() => {
                setMenuOpen(false);
                onCancel(row);
              }}
              style={({ pressed }) => [s.outgoingCancelBtnOverlay, pressed && { opacity: 0.88 }]}>
              <Text style={s.outgoingCancelBtnText}>요청 취소</Text>
            </Pressable>
          ) : (
            <View style={s.outgoingStatusOnly}>
              <Text style={s.outgoingStatusOnlyText}>{hint}</Text>
            </View>
          )}
        </View>
      ) : null}
      <View style={s.pendingTextBlock} pointerEvents={menuOpen ? 'none' : 'auto'}>
        <Text style={s.pendingNick} numberOfLines={1}>
          {nick}
        </Text>
        <Text style={s.pendingHint} numberOfLines={1}>
          {hint}
        </Text>
      </View>
    </View>
  );
}

type EnrichedFriend = {
  row: FriendAcceptedRow;
  profile: UserProfile;
  meeting: Meeting | null;
  sort: ReturnType<typeof computeFriendSortSignals>;
};

function PresenceAvatar({
  profile,
  meeting,
  categories,
  onPress,
}: {
  profile: UserProfile;
  meeting: Meeting | null;
  categories: Category[];
  onPress: () => void;
}) {
  const uri = profile.photoUrl?.trim();
  const initials = profile.nickname?.trim()?.slice(0, 1) || '?';
  const phase = meetingPhaseForFriend(meeting);
  const emoji = meeting ? categoryEmojiForMeeting(meeting, categories) : '·';
  const subtitle = meeting ? resolveFriendActivity(meeting, profile, categories).presenceSubtitle : '대기 중';

  const inner = (
    <View style={s.presenceAvatarInner}>
      {uri ? <Image source={{ uri }} style={s.presenceAvatarImg} contentFit="cover" /> : (
        <View style={s.presenceAvatarFallback}>
          <Text style={s.presenceAvatarLetter}>{initials}</Text>
        </View>
      )}
    </View>
  );

  return (
    <Pressable style={s.presenceItem} onPress={onPress} accessibilityRole="button">
      <View style={s.presenceRingWrap}>
        {phase !== 'idle' ? (
          <LinearGradient colors={[NEON_A, NEON_B]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.presenceNeonRing}>
            {inner}
          </LinearGradient>
        ) : (
          <View style={s.presenceIdleRing}>{inner}</View>
        )}
        <View style={s.presenceCatBadge}>
          <Text style={s.presenceCatBadgeTxt}>{emoji}</Text>
        </View>
      </View>
      <Text style={s.presenceNick} numberOfLines={1}>
        {profile.nickname}
      </Text>
      <Text style={s.presenceSub} numberOfLines={1}>
        {subtitle}
      </Text>
    </Pressable>
  );
}

function AiAffinityCard({
  profile,
  commonLine,
  onGather,
}: {
  profile: UserProfile;
  commonLine: string;
  onGather: () => void;
}) {
  const uri = profile.photoUrl?.trim();
  const initials = profile.nickname?.trim()?.slice(0, 1) || '?';
  return (
    <View style={s.aiCard}>
      <View style={s.aiCardLeft}>
        {uri ? <Image source={{ uri }} style={s.aiCardPhoto} contentFit="cover" /> : (
          <View style={s.aiCardPhotoFallback}>
            <Text style={s.aiCardPhotoLetter}>{initials}</Text>
          </View>
        )}
      </View>
      <View style={s.aiCardMid}>
        <Text style={s.aiCardNick} numberOfLines={1}>
          {profile.nickname}
        </Text>
        <Text style={s.aiCardCommon} numberOfLines={2}>
          {commonLine}
        </Text>
      </View>
      <Pressable onPress={onGather} style={({ pressed }) => [s.aiCardCta, pressed && { opacity: 0.9 }]}>
        <Text style={s.aiCardCtaText}>모임 만들기</Text>
      </Pressable>
    </View>
  );
}

function FriendConnectionRow({
  item,
  categories,
  onOpenChat,
  onOpenProfile,
  onLongPress,
  onDirectGather,
  onEvaluateTrust,
  onHide,
}: {
  item: EnrichedFriend;
  categories: Category[];
  onOpenChat: () => void;
  onOpenProfile: () => void;
  onLongPress: () => void;
  onDirectGather: () => void;
  onEvaluateTrust: () => void;
  onHide: () => void;
}) {
  const { profile, meeting } = item;
  const uri = profile.photoUrl?.trim();
  const initials = profile.nickname?.trim()?.slice(0, 1) || '?';
  const gLv = typeof profile.gLevel === 'number' && Number.isFinite(profile.gLevel) ? Math.max(1, Math.trunc(profile.gLevel)) : 1;
  const trust = typeof profile.gTrust === 'number' ? profile.gTrust : null;
  const activity = resolveFriendActivity(meeting, profile, categories);
  const chips = splitGDnaChips(profile.gDna, 4);
  const distLabel = formatDistanceCompact(item.sort.distanceM);

  const renderLeftActions = useCallback(
    (_p: unknown, _d: unknown, swipeable: { close: () => void }) => (
      <View style={s.swipeLeftRail}>
        <RectButton
          style={s.swipeGatherBtn}
          onPress={() => {
            swipeable.close();
            onDirectGather();
          }}>
          <Ionicons name="people" size={22} color="#fff" />
          <Text style={s.swipeGatherTxt}>모임{'\n'}만들기</Text>
        </RectButton>
      </View>
    ),
    [onDirectGather],
  );

  const renderRightActions = useCallback(
    (_p: unknown, _d: unknown, swipeable: { close: () => void }) => (
      <View style={s.swipeRightRail}>
        <RectButton
          style={s.swipeTrustBtn}
          onPress={() => {
            swipeable.close();
            onEvaluateTrust();
          }}>
          <Ionicons name="shield-checkmark-outline" size={20} color="#0f172a" />
          <Text style={s.swipeTrustTxt}>gTrust</Text>
        </RectButton>
        <RectButton
          style={s.swipeHideBtn}
          onPress={() => {
            swipeable.close();
            onHide();
          }}>
          <Ionicons name="eye-off-outline" size={20} color="#fff" />
          <Text style={s.swipeHideTxt}>숨기기</Text>
        </RectButton>
      </View>
    ),
    [onEvaluateTrust, onHide],
  );

  return (
    <Swipeable
      renderLeftActions={renderLeftActions}
      renderRightActions={renderRightActions}
      overshootLeft={false}
      overshootRight={false}
      friction={2}
      containerStyle={s.swipeContainer}
      childrenContainerStyle={{ flex: 1 }}>
      <Pressable
        onLongPress={onLongPress}
        delayLongPress={380}
        style={({ pressed }) => [s.connRow, pressed && { opacity: 0.92 }]}>
        <View style={s.connLeft}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="친구 프로필"
            hitSlop={6}
            onPress={(ev) => {
              ev.stopPropagation?.();
              onOpenProfile();
            }}
            style={s.connAvatarPress}>
            <View style={s.connAvatarWrap}>
              {uri ? <Image source={{ uri }} style={s.connAvatarImg} contentFit="cover" /> : (
                <View style={s.connAvatarFallback}>
                  <Text style={s.connAvatarLetter}>{initials}</Text>
                </View>
              )}
              <View style={s.gLevelBadge}>
                <Text style={s.gLevelBadgeTxt}>{gLv}</Text>
              </View>
            </View>
          </Pressable>
        </View>
        <View style={s.connCenter}>
          <View style={s.connLine1}>
            <Text style={s.connNick} numberOfLines={1}>
              {profile.nickname}
            </Text>
            {distLabel ? (
              <Text style={s.connDist} numberOfLines={1}>
                · {distLabel}
              </Text>
            ) : null}
          </View>
          <Text style={[s.connActivity, activity.kind === 'idle' && s.connActivityMuted]} numberOfLines={2}>
            {activity.secondaryLine}
          </Text>
          {chips.length ? (
            <View style={s.connChips}>
              {chips.map((c) => (
                <Text key={c} style={s.connChip} numberOfLines={1}>
                  {c}
                </Text>
              ))}
            </View>
          ) : null}
        </View>
        <View style={s.connRight}>
          {trust != null ? <Text style={s.connTrust}>gTrust {trust}</Text> : <Text style={s.connTrustMuted}>—</Text>}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="1대1 채팅"
            hitSlop={10}
            onPress={(e) => {
              e.stopPropagation?.();
              onOpenChat();
            }}
            style={({ pressed }) => [s.connMsgBtn, pressed && { opacity: 0.85 }]}>
            <Ionicons name="chatbubble-ellipses-outline" size={22} color={GinitTheme.colors.primary} />
          </Pressable>
        </View>
      </Pressable>
    </Swipeable>
  );
}

/**
 * [친구] 탭 — 스냅형 프리즌스 스트립 + 디스코드 밀도 리스트.
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
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [meProfile, setMeProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [hiddenPeerIds, setHiddenPeerIds] = useState<Set<string>>(new Set());
  const [sheetFriend, setSheetFriend] = useState<EnrichedFriend | null>(null);

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

  useEffect(() => {
    return subscribeMeetingsHybrid(
      (list) => setMeetings(list),
      () => {},
    );
  }, []);

  useEffect(() => {
    return subscribeCategories((list) => setCategories(list), () => {});
  }, []);

  useEffect(() => {
    if (!me.trim()) {
      setMeProfile(null);
      return;
    }
    let alive = true;
    void getUserProfile(me).then((p) => {
      if (!alive) return;
      setMeProfile(p);
    });
    return () => {
      alive = false;
    };
  }, [me]);

  useEffect(() => {
    if (!me) return;
    let alive = true;
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(HIDDEN_KEY(me));
        if (!alive || !raw) return;
        const arr = JSON.parse(raw) as unknown;
        if (!Array.isArray(arr)) return;
        setHiddenPeerIds(new Set(arr.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => friendAppUserKey(x))));
      } catch {
        /* ignore */
      }
    })();
    return () => {
      alive = false;
    };
  }, [me]);

  const persistHidden = useCallback(
    async (next: Set<string>) => {
      if (!me) return;
      try {
        await AsyncStorage.setItem(HIDDEN_KEY(me), JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
    },
    [me],
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void reload();
  }, [reload]);

  const enrichedFriends = useMemo((): EnrichedFriend[] => {
    const out: EnrichedFriend[] = [];
    for (const row of accepted) {
      const p = profileFromMap(profiles, row.peer_app_user_id);
      if (!p) continue;
      const pk = friendAppUserKey(row.peer_app_user_id);
      const meeting = pickPrimaryMeetingForPeer(pk, meetings);
      const sort = computeFriendSortSignals(p, meeting, meProfile);
      out.push({ row, profile: p, meeting, sort });
    }
    out.sort((a, b) => compareFriendsByPresenceDistanceTrust(a.sort, b.sort));
    return out;
  }, [accepted, profiles, meetings, meProfile]);

  const visibleFriends = useMemo(() => {
    const q = search.trim().toLowerCase();
    return enrichedFriends.filter((e) => {
      const pk = friendAppUserKey(e.row.peer_app_user_id);
      if (hiddenPeerIds.has(pk)) return false;
      if (!q) return true;
      const nick = e.profile.nickname?.toLowerCase() ?? '';
      const dna = (e.profile.gDna ?? '').toLowerCase();
      return nick.includes(q) || dna.includes(q) || pk.toLowerCase().includes(q);
    });
  }, [enrichedFriends, hiddenPeerIds, search]);

  const presenceStripFriends = useMemo(() => {
    const active = enrichedFriends.filter((e) => e.meeting != null).slice(0, 24);
    if (active.length) return active;
    return enrichedFriends.slice(0, 12);
  }, [enrichedFriends]);

  const aiRecommendations = useMemo(() => {
    const myDna = (meProfile?.gDna ?? '').trim().toLowerCase();
    const myInterests = new Set((meProfile?.interests ?? []).map((x) => String(x).toLowerCase()));
    const scored = enrichedFriends.map((e) => {
      const peerDna = (e.profile.gDna ?? '').trim().toLowerCase();
      const mutual = mutualJoinedMeetingsCount(me, e.row.peer_app_user_id, meetings);
      let bonus = mutual * 6;
      if (myDna && peerDna && (myDna === peerDna || myDna.includes(peerDna) || peerDna.includes(myDna))) bonus += 10;
      for (const it of e.profile.interests ?? []) {
        if (myInterests.has(String(it).toLowerCase())) bonus += 2;
      }
      return { e, mutual, bonus };
    });
    scored.sort((a, b) => b.bonus - a.bonus);
    return scored.filter((x) => x.bonus > 0).slice(0, 2).map((x) => x.e);
  }, [enrichedFriends, me, meetings, meProfile]);

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

  const goMap = useCallback(() => router.push('/(tabs)/map'), [router]);
  const goAddFriend = useCallback(() => router.push('/social/discovery'), [router]);
  const goSettings = useCallback(() => router.push('/(tabs)/profile'), [router]);
  const goCreateGathering = useCallback(() => {
    void (async () => {
      const pk = userId?.trim();
      if (pk) {
        try {
          const p = await getUserProfile(pk);
          if (!isUserPhoneVerified(p)) {
            Alert.alert('인증 정보 등록', '모임을 이용하시려면 인증 정보 등록을 완료하셔야 합니다.', [
              { text: '확인', onPress: () => pushProfileOpenRegisterInfo(router) },
            ]);
            return;
          }
        } catch {
          /* 등록 시 addMeeting에서 재검증 */
        }
      }
      router.push('/create/details');
    })();
  }, [router, userId]);

  const onRemoveAcceptedFriend = useCallback(() => {
    if (!sheetFriend || !me) return;
    const row = sheetFriend;
    const nick = row.profile.nickname?.trim() || '친구';
    const fid = row.row.id;
    const peerPk = friendAppUserKey(row.row.peer_app_user_id);
    Alert.alert(
      '친구 삭제',
      `${nick}님과의 지닛 친구 관계를 삭제할까요?\n채팅 기록은 그대로이며, 이후 다시 지닛을 보낼 수 있어요.`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await removeAcceptedFriend(me, fid);
                setHiddenPeerIds((prev) => {
                  if (!prev.has(peerPk)) return prev;
                  const next = new Set(prev);
                  next.delete(peerPk);
                  void persistHidden(next);
                  return next;
                });
                setSheetFriend(null);
                await reload();
              } catch (e) {
                setErr(e instanceof Error ? e.message : String(e));
              }
            })();
          },
        },
      ],
    );
  }, [me, sheetFriend, reload, persistHidden]);

  const hideFriend = useCallback(
    (peerId: string) => {
      const pk = friendAppUserKey(peerId);
      Alert.alert('친구 숨기기', '목록에서 숨길까요? (설정에서 다시 표시 기능은 준비 중이에요)', [
        { text: '취소', style: 'cancel' },
        {
          text: '숨기기',
          style: 'destructive',
          onPress: () => {
            setHiddenPeerIds((prev) => {
              const next = new Set(prev);
              next.add(pk);
              void persistHidden(next);
              return next;
            });
          },
        },
      ]);
    },
    [persistHidden],
  );

  const onEvaluateTrust = useCallback(() => {
    Alert.alert('gTrust 평가', '모임이 끝난 뒤 상대의 신뢰 점수를 반영할 수 있어요. (평가 UI는 곧 연결됩니다)');
  }, []);

  const sheetMutualMeetings = useMemo(() => {
    if (!sheetFriend) return [];
    const peer = friendAppUserKey(sheetFriend.row.peer_app_user_id);
    return meetings.filter((m) => isUserJoinedMeeting(m, me) && isUserJoinedMeeting(m, peer));
  }, [sheetFriend, meetings, me]);

  const listHeader = useMemo(
    () => (
      <View>
        {(pending.length > 0 || pendingOut.length > 0) && (
          <GinitCard appearance="light" style={s.sectionCard}>
            {pending.length > 0 ? (
              <>
                <Text style={s.sectionTitle}>나에게 온 지닛</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.pendingStrip}>
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
              </>
            ) : null}
            {pendingOut.length > 0 ? (
              <>
                <Text style={[s.sectionTitle, { marginTop: pending.length ? 14 : 0 }]}>내가 보낸 지닛</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.pendingStrip}>
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
              </>
            ) : null}
          </GinitCard>
        )}

        <View style={s.presenceSection}>
          <Text style={s.sectionTitle}>활성 지닛</Text>
          <Text style={s.sectionHint}>지금 모임에 참여 중인 친구가 네온 링으로 강조돼요.</Text>
          {presenceStripFriends.length === 0 ? (
            <View style={s.inlineHintBox}>
              <Ionicons name="planet-outline" size={20} color="#94a3b8" />
              <Text style={s.inlineHintText}>친구를 맺으면 활동 스트립이 채워져요.</Text>
            </View>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.presenceStrip}>
              {presenceStripFriends.map((e) => (
                <PresenceAvatar
                  key={e.row.id}
                  profile={e.profile}
                  meeting={e.meeting}
                  categories={categories}
                  onPress={() => openDm(e.row.peer_app_user_id, e.profile.nickname)}
                />
              ))}
            </ScrollView>
          )}
        </View>

        {aiRecommendations.length > 0 ? (
          <View style={s.aiBlock}>
            <Text style={s.sectionTitle}>맞춤 추천</Text>
            <Text style={s.sectionHint}>함께한 모임·gDna·관심사를 기준으로 골랐어요.</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.aiStrip}>
              {aiRecommendations.map((e) => {
                const mutual = mutualJoinedMeetingsCount(me, e.row.peer_app_user_id, meetings);
                const commonLine =
                  mutual > 0
                    ? `함께한 지닛 ${mutual}개 · ${(e.profile.gDna ?? 'gDna').trim().slice(0, 42)}`
                    : `비슷한 성향 · ${(e.profile.gDna ?? 'gDna').trim().slice(0, 48)}`;
                return (
                  <AiAffinityCard
                    key={`ai-${e.row.id}`}
                    profile={e.profile}
                    commonLine={commonLine}
                    onGather={() => goCreateGathering()}
                  />
                );
              })}
            </ScrollView>
          </View>
        ) : null}

        <Text style={[s.sectionTitle, s.sectionTitleLoose]}>내 지닛</Text>
        <Text style={s.sectionHint}>참여 중 · 거리 · gTrust 순으로 정렬돼요.</Text>
      </View>
    ),
    [
      aiRecommendations,
      categories,
      goCreateGathering,
      meetings,
      me,
      onAcceptPending,
      onCancelOutgoing,
      onDeclinePending,
      openDm,
      pending,
      pendingOut,
      presenceStripFriends,
      profiles,
    ],
  );

  const emptyAll = useMemo(
    () => (
      <GinitCard appearance="light" style={s.emptyCard}>
        <View style={s.emptyIconWrap}>
          <Ionicons name="people-outline" size={28} color={GinitTheme.colors.primary} />
        </View>
        <Text style={s.emptyTitle}>아직 연결된 지닛이 없어요</Text>
        <Text style={s.emptyBody}>새로운 모임에서 친구를 찾아보세요.</Text>
        <GinitButton title="모임 찾기" onPress={() => router.push('/(tabs)/map')} style={s.emptyCta} />
      </GinitCard>
    ),
    [router],
  );

  const emptySearch = useMemo(
    () => (
      <GinitCard appearance="light" style={s.emptyCard}>
        <Text style={s.emptyTitle}>검색 결과가 없어요</Text>
        <Text style={s.emptyBody}>이름·gDna·아이디 일부로 다시 검색해 보세요.</Text>
      </GinitCard>
    ),
    [],
  );

  const emptyHiddenAll = useMemo(
    () => (
      <GinitCard appearance="light" style={s.emptyCard}>
        <Text style={s.emptyTitle}>표시할 친구가 없어요</Text>
        <Text style={s.emptyBody}>숨긴 친구만 있을 때 목록이 비어 보일 수 있어요.</Text>
      </GinitCard>
    ),
    [],
  );

  const allFriendsHidden = useMemo(
    () =>
      enrichedFriends.length > 0 &&
      enrichedFriends.every((e) => hiddenPeerIds.has(friendAppUserKey(e.row.peer_app_user_id))),
    [enrichedFriends, hiddenPeerIds],
  );

  const listEmptyComponent = useMemo(() => {
    if (visibleFriends.length > 0) return null;
    if (search.trim()) return emptySearch;
    if (accepted.length === 0 && pending.length === 0 && pendingOut.length === 0) return emptyAll;
    if (accepted.length === 0) return null;
    if (allFriendsHidden) return emptyHiddenAll;
    return emptySearch;
  }, [
    visibleFriends.length,
    search,
    accepted.length,
    pending.length,
    pendingOut.length,
    allFriendsHidden,
    emptyAll,
    emptySearch,
    emptyHiddenAll,
  ]);

  const showListHeader = pending.length > 0 || pendingOut.length > 0 || accepted.length > 0 || search.trim().length > 0;

  if (!me) {
    return (
      <ScreenShell padded={false} style={s.root}>
        <SafeAreaView style={s.safe} edges={['top']}>
          <View style={s.loginBlock}>
            <Text style={s.loginHint}>로그인 후 친구 목록을 볼 수 있어요.</Text>
          </View>
        </SafeAreaView>
      </ScreenShell>
    );
  }

  return (
    <ScreenShell padded={false} style={s.root}>
      <SafeAreaView style={s.safe} edges={['top']}>
        {loading && accepted.length === 0 && pending.length === 0 && pendingOut.length === 0 ? (
          <View style={s.loadingOverlay}>
            <ActivityIndicator size="large" color={GinitTheme.colors.primary} />
          </View>
        ) : null}

        {err ? (
          <View style={s.errBanner}>
            <Text style={s.errText}>{err}</Text>
          </View>
        ) : null}

        <View style={[s.fixedHeader, { paddingHorizontal: 20 }]}>
          <View style={s.headerTop}>
            <Text style={s.headerTitle} accessibilityRole="header">
              지닛 친구
            </Text>
            <View style={s.headerIcons}>
              <Pressable accessibilityLabel="지도 보기" hitSlop={8} onPress={goMap} style={s.iconBtn}>
                <Ionicons name="map-outline" size={22} color="#0f172a" />
              </Pressable>
              <Pressable accessibilityLabel="친구 추가" hitSlop={8} onPress={goAddFriend} style={s.iconBtn}>
                <Ionicons name="person-add-outline" size={22} color="#0f172a" />
              </Pressable>
              <InAppAlarmsBellButton />
              <Pressable accessibilityLabel="설정" hitSlop={8} onPress={goSettings} style={s.iconBtn}>
                <Ionicons name="settings-outline" size={22} color="#0f172a" />
              </Pressable>
            </View>
          </View>
          <View style={s.searchWrap}>
            <Ionicons name="search-outline" size={18} color="#64748b" style={s.searchIcon} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="친구 이름이나 gDna 검색"
              placeholderTextColor="#94a3b8"
              style={s.searchInput}
              autoCorrect={false}
              autoCapitalize="none"
            />
            {search.length > 0 ? (
              <Pressable onPress={() => setSearch('')} hitSlop={8} accessibilityLabel="검색 지우기">
                <Ionicons name="close-circle" size={20} color="#94a3b8" />
              </Pressable>
            ) : null}
          </View>
        </View>

        <FlatList
          data={visibleFriends}
          keyExtractor={(item) => item.row.id}
          ListHeaderComponent={showListHeader ? listHeader : null}
          ListEmptyComponent={listEmptyComponent}
          contentContainerStyle={[s.listPad, { paddingBottom: insets.bottom + 88 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GinitTheme.colors.primary} />
          }
          renderItem={({ item }) => (
            <FriendConnectionRow
              item={item}
              categories={categories}
              onOpenChat={() => openDm(item.row.peer_app_user_id, item.profile.nickname)}
              onOpenProfile={() => setSheetFriend(item)}
              onLongPress={() => setSheetFriend(item)}
              onDirectGather={goCreateGathering}
              onEvaluateTrust={onEvaluateTrust}
              onHide={() => hideFriend(item.row.peer_app_user_id)}
            />
          )}
        />

        <Modal visible={sheetFriend != null} transparent animationType="slide" onRequestClose={() => setSheetFriend(null)}>
          <View style={s.sheetDim}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setSheetFriend(null)} />
            <View style={[s.sheetPanel, { paddingBottom: insets.bottom + 16 }]}>
              <View style={s.sheetGrab} />
              {sheetFriend ? (
                <>
                  <View style={s.sheetAvatarBlock}>
                    {sheetFriend.profile.photoUrl?.trim() ? (
                      <Image
                        source={{ uri: sheetFriend.profile.photoUrl.trim() }}
                        style={s.sheetAvatarImg}
                        contentFit="cover"
                      />
                    ) : (
                      <View style={s.sheetAvatarFallback}>
                        <Text style={s.sheetAvatarLetter}>
                          {sheetFriend.profile.nickname?.trim()?.slice(0, 1) || '?'}
                        </Text>
                      </View>
                    )}
                  </View>
                  <GinitButton
                    title="1:1 채팅"
                    style={s.sheetDmBtn}
                    onPress={() => {
                      const peer = sheetFriend.row.peer_app_user_id;
                      const nick = sheetFriend.profile.nickname?.trim() || '친구';
                      setSheetFriend(null);
                      openDm(peer, nick);
                    }}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="친구 삭제"
                    onPress={onRemoveAcceptedFriend}
                    style={({ pressed }) => [s.sheetDeleteBtn, pressed && { opacity: 0.88 }]}>
                    <Text style={s.sheetDeleteTxt}>친구 삭제</Text>
                  </Pressable>
                  <Text style={s.sheetTitle}>{sheetFriend.profile.nickname}님</Text>
                  <Text style={s.sheetSub}>gDna</Text>
                  <Text style={s.sheetBody}>{sheetFriend.profile.gDna?.trim() || '등록된 gDna가 없어요.'}</Text>
                  <Text style={[s.sheetSub, { marginTop: 14 }]}>모임 참여 이력</Text>
                  <Text style={s.sheetMeta}>누적 참여 {sheetFriend.profile.meetingCount ?? '—'}회 (프로필)</Text>
                  <ScrollView style={s.sheetScroll} nestedScrollEnabled showsVerticalScrollIndicator={false}>
                    {sheetMutualMeetings.length === 0 ? (
                      <Text style={s.sheetMuted}>함께한 공개·참여 모임이 아직 없어요.</Text>
                    ) : (
                      sheetMutualMeetings.map((m) => (
                        <Pressable
                          key={m.id}
                          onPress={() => {
                            setSheetFriend(null);
                            router.push(`/meeting/${encodeURIComponent(m.id)}`);
                          }}
                          style={({ pressed }) => [s.sheetMeetingRow, pressed && { opacity: 0.88 }]}>
                          <Text style={s.sheetMeetingTitle} numberOfLines={2}>
                            {m.title}
                          </Text>
                          <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
                        </Pressable>
                      ))
                    )}
                  </ScrollView>
                  <Pressable style={s.sheetClose} onPress={() => setSheetFriend(null)}>
                    <Text style={s.sheetCloseTxt}>닫기</Text>
                  </Pressable>
                </>
              ) : null}
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </ScreenShell>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: GinitTheme.colors.bg },
  safe: { flex: 1 },
  fixedHeader: {
    paddingTop: 4,
    paddingBottom: 10,
    backgroundColor: GinitTheme.colors.bg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(15, 23, 42, 0.08)',
    zIndex: 3,
  },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  headerTitle: { fontSize: 20, fontWeight: '900', color: GinitTheme.trustBlue, flex: 1 },
  headerIcons: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  iconBtn: { padding: 6, borderRadius: 10 },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.1)',
    backgroundColor: 'rgba(255,255,255,0.85)',
    paddingHorizontal: 12,
    minHeight: 44,
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 15, fontWeight: '600', color: '#0f172a', paddingVertical: 10 },
  listPad: { paddingHorizontal: 20, paddingTop: 8 },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 4,
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
  loginBlock: { paddingHorizontal: 20, paddingTop: 24 },
  loginHint: { fontSize: 15, fontWeight: '800', color: '#0f172a', lineHeight: 22 },
  sectionCard: { marginBottom: 10, borderColor: 'rgba(255, 255, 255, 0.55)' },
  sectionTitle: { fontSize: 16, fontWeight: '900', color: '#0f172a', marginBottom: 6 },
  sectionTitleLoose: { marginTop: 6 },
  sectionHint: { fontSize: 12, fontWeight: '700', color: '#64748b', marginBottom: 10, lineHeight: 17 },
  presenceSection: { marginBottom: 14 },
  presenceStrip: { flexDirection: 'row', gap: 14, paddingBottom: 4, paddingRight: 6 },
  presenceItem: { width: 76, alignItems: 'center' },
  presenceRingWrap: { width: 68, height: 68, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  presenceNeonRing: {
    width: 64,
    height: 64,
    borderRadius: 32,
    padding: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  presenceIdleRing: {
    width: 64,
    height: 64,
    borderRadius: 32,
    padding: 2,
    borderWidth: 2,
    borderColor: 'rgba(148, 163, 184, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  presenceAvatarInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: 'rgba(15,23,42,0.06)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15,23,42,0.08)',
  },
  presenceAvatarImg: { width: '100%', height: '100%' },
  presenceAvatarFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,82,204,0.08)' },
  presenceAvatarLetter: { fontSize: 20, fontWeight: '900', color: GinitTheme.colors.primary },
  presenceCatBadge: {
    position: 'absolute',
    bottom: 2,
    right: 4,
    minWidth: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  presenceCatBadgeTxt: { fontSize: 13 },
  presenceNick: { fontSize: 12, fontWeight: '900', color: '#0f172a', textAlign: 'center', width: '100%' },
  presenceSub: { fontSize: 10, fontWeight: '700', color: '#64748b', textAlign: 'center', width: '100%' },
  aiBlock: { marginBottom: 8 },
  aiStrip: { flexDirection: 'row', gap: 10, paddingBottom: 4 },
  aiCard: {
    width: 300,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.55)',
    backgroundColor: 'rgba(255,255,255,0.78)',
    gap: 10,
  },
  aiCardLeft: {},
  aiCardPhoto: { width: 48, height: 48, borderRadius: 14, backgroundColor: '#e2e8f0' },
  aiCardPhotoFallback: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: 'rgba(0,82,204,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiCardPhotoLetter: { fontSize: 18, fontWeight: '900', color: GinitTheme.colors.primary },
  aiCardMid: { flex: 1, minWidth: 0 },
  aiCardNick: { fontSize: 14, fontWeight: '900', color: '#0f172a', marginBottom: 4 },
  aiCardCommon: { fontSize: 12, fontWeight: '600', color: '#475569', lineHeight: 17 },
  aiCardCta: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: GinitTheme.colors.primary,
  },
  aiCardCtaText: { fontSize: 12, fontWeight: '900', color: '#fff' },
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
  inlineHintText: { flex: 1, fontSize: 14, fontWeight: '700', color: '#64748b' },
  pendingStrip: { flexDirection: 'row', gap: 10, paddingBottom: 2, paddingRight: 2 },
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
    position: 'relative',
    overflow: 'visible',
  },
  pendingMenuBackdrop: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 16,
    backgroundColor: 'rgba(248, 250, 252, 0.92)',
    zIndex: 1,
  },
  pendingAvatarTap: {
    zIndex: 2,
    alignSelf: 'center',
  },
  /** 프로필 아래에 뜨는 액션 오버레이 (닉네임 플로우와 겹칠 수 있어 zIndex로 위에 표시) */
  pendingMenuSheet: {
    position: 'absolute',
    left: 6,
    right: 6,
    top: 62,
    zIndex: 10,
    alignItems: 'center',
  },
  pendingTextBlock: {
    width: '100%',
    alignItems: 'center',
    zIndex: 0,
  },
  pendingMenuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.1)',
    ...GinitTheme.shadow.card,
  },
  pendingAvatarRing: {
    width: 48,
    height: 48,
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.12)',
    backgroundColor: 'rgba(15, 23, 42, 0.06)',
  },
  pendingAvatarImg: { width: '100%', height: '100%', borderRadius: 24 },
  pendingAvatarFallback: {
    flex: 1,
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 82, 204, 0.08)',
    borderRadius: 24,
  },
  pendingAvatarLetter: { fontSize: 18, fontWeight: '900', color: GinitTheme.colors.primary },
  pendingNick: { fontSize: 13, fontWeight: '900', color: '#0f172a', textAlign: 'center', width: '100%' },
  pendingHint: { fontSize: 11, fontWeight: '700', color: '#94a3b8' },
  pendingIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  pendingAcceptBtn: { backgroundColor: GinitTheme.colors.primary, borderColor: 'rgba(15, 23, 42, 0.12)' },
  pendingDeclineBtn: { backgroundColor: 'rgba(255, 255, 255, 0.95)', borderColor: 'rgba(15, 23, 42, 0.12)' },
  outgoingCancelBtnOverlay: {
    alignSelf: 'stretch',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.98)',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  outgoingStatusOnly: {
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.1)',
  },
  outgoingStatusOnlyText: { fontSize: 12, fontWeight: '800', color: '#64748b', textAlign: 'center' },
  outgoingCancelBtnText: { fontSize: 11, fontWeight: '800', color: '#64748b' },
  swipeContainer: { marginTop: 10 },
  swipeLeftRail: {
    width: 100,
    height: '100%',
    justifyContent: 'center',
    paddingRight: 8,
  },
  swipeGatherBtn: {
    flex: 1,
    backgroundColor: '#059669',
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    maxHeight: 96,
    paddingHorizontal: 6,
    gap: 4,
  },
  swipeGatherTxt: { color: '#fff', fontSize: 12, fontWeight: '900', textAlign: 'center' },
  swipeRightRail: {
    width: 112,
    height: '100%',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'stretch',
    paddingLeft: 8,
    gap: 6,
  },
  swipeTrustBtn: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    maxHeight: 96,
    gap: 2,
  },
  swipeTrustTxt: { fontSize: 10, fontWeight: '900', color: '#0f172a' },
  swipeHideBtn: {
    flex: 1,
    backgroundColor: '#64748b',
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    maxHeight: 96,
    gap: 2,
  },
  swipeHideTxt: { fontSize: 10, fontWeight: '900', color: '#fff' },
  connRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.55)',
    backgroundColor: 'rgba(255, 255, 255, 0.78)',
  },
  connLeft: { justifyContent: 'center', marginRight: 10 },
  connAvatarPress: { alignSelf: 'center' },
  connAvatarWrap: { width: 52, height: 52, position: 'relative' },
  connAvatarImg: { width: 52, height: 52, borderRadius: 18, backgroundColor: 'rgba(15,23,42,0.06)' },
  connAvatarFallback: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,82,204,0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15,23,42,0.1)',
  },
  connAvatarLetter: { fontSize: 18, fontWeight: '900', color: GinitTheme.colors.primary },
  gLevelBadge: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    minWidth: 22,
    height: 22,
    borderRadius: 8,
    paddingHorizontal: 5,
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.95)',
  },
  gLevelBadgeTxt: { fontSize: 10, fontWeight: '900', color: '#fff' },
  connCenter: { flex: 1, minWidth: 0, justifyContent: 'center', gap: 4 },
  connLine1: { flexDirection: 'row', alignItems: 'center', flexWrap: 'nowrap' },
  connNick: { fontSize: 15, fontWeight: '900', color: '#0f172a', flexShrink: 1 },
  connDist: { fontSize: 12, fontWeight: '700', color: '#64748b', flexShrink: 0 },
  connActivity: { fontSize: 13, fontWeight: '700', color: '#334155', lineHeight: 18 },
  connActivityMuted: { color: '#94a3b8', fontWeight: '600' },
  connChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  connChip: {
    fontSize: 9,
    fontWeight: '800',
    color: ACCENT_ORANGE,
    backgroundColor: 'rgba(255,138,0,0.12)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
  connRight: { alignItems: 'flex-end', justifyContent: 'space-between', paddingLeft: 6, minWidth: 72 },
  connTrust: { fontSize: 11, fontWeight: '800', color: '#64748b' },
  connTrustMuted: { fontSize: 11, fontWeight: '700', color: '#cbd5e1' },
  connMsgBtn: { padding: 6, borderRadius: 12, backgroundColor: 'rgba(0,82,204,0.08)' },
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
  emptyTitle: { fontSize: 16, fontWeight: '900', color: '#0f172a', textAlign: 'center', marginBottom: 6 },
  emptyBody: { fontSize: 14, fontWeight: '600', color: '#64748b', textAlign: 'center', lineHeight: 21, marginBottom: 18 },
  emptyCta: { alignSelf: 'stretch', width: '100%' },
  sheetDim: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  sheetPanel: {
    backgroundColor: '#f8fafc',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 10,
    maxHeight: '52%',
  },
  sheetGrab: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#cbd5e1',
    marginBottom: 12,
  },
  sheetAvatarBlock: { alignItems: 'center', marginBottom: 12 },
  sheetAvatarImg: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(15,23,42,0.06)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15,23,42,0.1)',
  },
  sheetAvatarFallback: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 82, 204, 0.1)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15,23,42,0.1)',
  },
  sheetAvatarLetter: { fontSize: 28, fontWeight: '900', color: GinitTheme.colors.primary },
  sheetDmBtn: { alignSelf: 'stretch', marginBottom: 10 },
  sheetDeleteBtn: { alignSelf: 'stretch', paddingVertical: 12, marginBottom: 14 },
  sheetDeleteTxt: { fontSize: 15, fontWeight: '800', color: '#b91c1c', textAlign: 'center' },
  sheetTitle: { fontSize: 18, fontWeight: '900', color: '#0f172a', marginBottom: 10 },
  sheetSub: { fontSize: 12, fontWeight: '800', color: '#64748b', marginBottom: 4 },
  sheetBody: { fontSize: 14, fontWeight: '600', color: '#334155', lineHeight: 21 },
  sheetMeta: { fontSize: 13, fontWeight: '600', color: '#475569', marginBottom: 8 },
  sheetScroll: { maxHeight: 160, marginBottom: 12 },
  sheetMuted: { fontSize: 13, fontWeight: '600', color: '#94a3b8' },
  sheetMeetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(15,23,42,0.08)',
    gap: 8,
  },
  sheetMeetingTitle: { flex: 1, fontSize: 14, fontWeight: '700', color: '#0f172a' },
  sheetClose: {
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(15,23,42,0.06)',
  },
  sheetCloseTxt: { fontSize: 15, fontWeight: '900', color: '#0f172a' },
});
