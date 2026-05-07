
import { useFocusEffect } from '@react-navigation/native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';

import { GinitButton, GinitCard } from '@/components/ginit';
import { ScreenShell } from '@/components/ui';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { GinitTheme } from '@/constants/ginit-theme';
import { useUserSession } from '@/src/context/UserSessionContext';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import type { Category } from '@/src/lib/categories';
import { subscribeCategories } from '@/src/lib/categories';
import {
  compareFriendsByPresenceDistanceTrust,
  computeFriendSortSignals,
  formatDistanceCompact,
  pickPrimaryMeetingForPeer,
  resolveFriendActivity
} from '@/src/lib/friend-presence-activity';
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
import { friendDisplayName, loadFavoritePeerKeys, loadFriendDisplayAliases } from '@/src/lib/friend-device-meta';
import {
  loadBlockedPeerIds,
  loadHiddenPeerIds,
  saveBlockedPeerIds,
  saveHiddenPeerIds,
} from '@/src/lib/friends-privacy-local';
import { isUserJoinedMeeting } from '@/src/lib/joined-meetings';
import type { Meeting } from '@/src/lib/meetings';
import { subscribeMeetingsHybrid } from '@/src/lib/meetings-hybrid';
import { socialDmRoomId } from '@/src/lib/social-chat-rooms';
import { subscribeFriendsTableChanges } from '@/src/lib/supabase-friends-realtime';
import type { UserProfile } from '@/src/lib/user-profile';
import { getUserProfile, getUserProfilesForIds, readShareActivityStatusEnabled } from '@/src/lib/user-profile';

function friendAppUserKey(raw: string | null | undefined): string {
  const t = raw?.trim() ?? '';
  return t ? normalizeParticipantId(t) : '';
}

function profileFromMap(map: Map<string, UserProfile>, rawId: string | null | undefined): UserProfile | undefined {
  const k = friendAppUserKey(rawId);
  if (!k) return undefined;
  return map.get(k) ?? map.get(rawId?.trim() ?? '');
}

function PendingGinitRow({
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
    <View style={s.requestRow}>
      <View style={s.rowAvatarWrap}>
        {photo ? (
          <Image source={{ uri: photo }} style={s.rowAvatarImg} contentFit="cover" />
        ) : (
          <View style={s.rowAvatarFallback}>
            <Text style={s.rowAvatarLetter}>{initials}</Text>
          </View>
        )}
      </View>
      <View style={s.rowCenter}>
        <Text style={s.rowTitle} numberOfLines={1}>
          {nick}
        </Text>
        <Text style={s.rowSubtle} numberOfLines={1}>
          나에게 온 지닛
        </Text>
      </View>
      <View style={s.rowActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="수락"
          onPress={() => onAccept(row)}
          style={({ pressed }) => [s.rowActionBtnPrimary, pressed && { opacity: 0.88 }]}>
          <Text style={s.rowActionBtnPrimaryText}>수락</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="거절"
          onPress={() => onDecline(row)}
          style={({ pressed }) => [s.rowActionBtnGhost, pressed && { opacity: 0.88 }]}>
          <Text style={s.rowActionBtnGhostText}>거절</Text>
        </Pressable>
      </View>
    </View>
  );
}

function OutgoingGinitRow({
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
  const nick = profile?.nickname?.trim() || '회원';
  const photo = profile?.photoUrl?.trim();
  const initials = nick.slice(0, 1) || '?';
  const hint = status === 'accepted' ? '상대와 연결됨' : '상대 응답 대기';
  const canCancel = status === 'pending';

  return (
    <View style={s.requestRow} accessibilityRole="summary" accessibilityLabel={`내가 보낸 지닛, ${nick}, ${hint}`}>
      <View style={s.rowAvatarWrap}>
        {photo ? (
          <Image source={{ uri: photo }} style={s.rowAvatarImg} contentFit="cover" />
        ) : (
          <View style={s.rowAvatarFallback}>
            <Text style={s.rowAvatarLetter}>{initials}</Text>
          </View>
        )}
      </View>
      <View style={s.rowCenter}>
        <Text style={s.rowTitle} numberOfLines={1}>
          {nick}
        </Text>
        <Text style={s.rowSubtle} numberOfLines={1}>
          {hint}
        </Text>
      </View>
      <View style={s.rowActions}>
        {canCancel ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="요청 취소"
            onPress={() => onCancel(row)}
            style={({ pressed }) => [s.rowActionBtnGhost, pressed && { opacity: 0.88 }]}>
            <Text style={s.rowActionBtnGhostText}>취소</Text>
          </Pressable>
        ) : (
          <View style={s.rowStatusPill} accessibilityElementsHidden>
            <Text style={s.rowStatusPillText}>연결됨</Text>
          </View>
        )}
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

function FriendListRow({
  item,
  categories,
  rowTitleText,
  onPressAvatar,
  onPressOpenChat,
  onPressOpenMeeting,
  onLongPressFriendMenu,
}: {
  item: EnrichedFriend;
  categories: Category[];
  rowTitleText: string;
  onPressAvatar: () => void;
  onPressOpenChat: () => void;
  onPressOpenMeeting?: () => void;
  onLongPressFriendMenu: () => void;
}) {
  const { profile, meeting } = item;
  const uri = profile.photoUrl?.trim();
  const initials = profile.nickname?.trim()?.slice(0, 1) || '?';
  const shareOn = readShareActivityStatusEnabled(profile.metadata);
  const activity = resolveFriendActivity(shareOn ? meeting : null, profile, categories);
  const distLabel = formatDistanceCompact(item.sort.distanceM);
  const showOpenMeeting = shareOn && meeting != null && typeof meeting.id === 'string' && meeting.id.trim().length > 0;
  const subtitle = useMemo(() => {
    const base = shareOn ? (activity.secondaryLine?.trim() ?? '') : (profile.bio?.trim() ?? '');
    const parts = [base || null, distLabel ? `거리 ${distLabel}` : null].filter(Boolean);
    return parts.join(' · ');
  }, [activity.secondaryLine, distLabel, profile.bio, shareOn]);

  return (
    <View style={s.friendRow}>
      <Pressable
        onPress={onPressAvatar}
        accessibilityRole="button"
        accessibilityLabel={`${rowTitleText || profile.nickname || '친구'} 프로필`}
        style={({ pressed }) => [pressed && { opacity: 0.88 }]}>
        <View style={s.rowAvatarWrap}>
          {uri ? (
            <Image source={{ uri }} style={s.rowAvatarImg} contentFit="cover" />
          ) : (
            <View style={s.rowAvatarFallback}>
              <Text style={s.rowAvatarLetter}>{initials}</Text>
            </View>
          )}
        </View>
      </Pressable>
      <View style={s.friendRowMain}>
        <View style={s.rowCenter}>
          <Pressable
            onPress={onPressOpenChat}
            onLongPress={onLongPressFriendMenu}
            accessibilityRole="button"
            accessibilityLabel={`${rowTitleText || profile.nickname || '친구'}, 1대1 채팅`}
            accessibilityHint="길게 눌러 친구 메뉴"
            style={({ pressed }) => [pressed && { opacity: 0.88 }]}>
            <Text style={s.rowTitle} numberOfLines={1}>
              {rowTitleText}
            </Text>
            <View style={s.rowSubRow}>
              <Text style={[s.rowSub, activity.kind === 'idle' && s.rowSubMuted]} numberOfLines={1}>
                {subtitle || ' '}
              </Text>
              {showOpenMeeting && onPressOpenMeeting ? (
                <Pressable
                  onPress={onPressOpenMeeting}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel="친구 모임 보기"
                  style={({ pressed }) => [s.openMeetingBtn, pressed && { opacity: 0.88 }]}>
                  <Text style={s.openMeetingBtnText}>친구 모임 보기</Text>
                </Pressable>
              ) : null}
            </View>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/**
 * [친구] 탭 — 스냅형 프리즌스 스트립 + 디스코드 밀도 리스트.
 */
export function FriendsHomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { userId } = useUserSession();
  const searchInputRef = useRef<TextInput>(null);
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [hiddenPeerIds, setHiddenPeerIds] = useState<Set<string>>(new Set());
  const [blockedPeerIds, setBlockedPeerIds] = useState<Set<string>>(new Set());
  const [sheetFriend, setSheetFriend] = useState<EnrichedFriend | null>(null);
  const [peerAliases, setPeerAliases] = useState<Record<string, string>>({});
  const [favoritePeerKeys, setFavoritePeerKeys] = useState<Set<string>>(() => new Set());

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
        setHiddenPeerIds(new Set());
        setBlockedPeerIds(new Set());
        setFavoritePeerKeys(new Set());
        return;
      }
      void reload();
      void (async () => {
        try {
          const [h, b, al, fav] = await Promise.all([
            loadHiddenPeerIds(me),
            loadBlockedPeerIds(me),
            loadFriendDisplayAliases(me),
            loadFavoritePeerKeys(me),
          ]);
          setHiddenPeerIds(h);
          setBlockedPeerIds(b);
          setPeerAliases(al);
          setFavoritePeerKeys(fav);
        } catch {
          /* ignore */
        }
      })();
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

  const persistHidden = useCallback(
    async (next: Set<string>) => {
      if (!me) return;
      try {
        await saveHiddenPeerIds(me, next);
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
      const shareOn = readShareActivityStatusEnabled(p.metadata);
      const sort = computeFriendSortSignals(p, shareOn ? meeting : null, meProfile);
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
      if (blockedPeerIds.has(pk)) return false;
      if (!q) return true;
      const nick = e.profile.nickname?.toLowerCase() ?? '';
      const dna = (e.profile.gDna ?? '').toLowerCase();
      return nick.includes(q) || dna.includes(q) || pk.toLowerCase().includes(q);
    });
  }, [enrichedFriends, hiddenPeerIds, blockedPeerIds, search]);

  /** 즐겨찾기 친구는 상단 섹션 + 아래 친구 목록에 각각 표시(검색·숨김·차단 필터는 `visibleFriends`와 동일) */
  const visibleFavoriteFriends = useMemo(() => {
    const fav = visibleFriends.filter((e) => favoritePeerKeys.has(friendAppUserKey(e.row.peer_app_user_id)));
    return [...fav].sort((a, b) => compareFriendsByPresenceDistanceTrust(a.sort, b.sort));
  }, [visibleFriends, favoritePeerKeys]);

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

  const goAddFriend = useCallback(() => router.push('/social/discovery'), [router]);
  const goMyProfile = useCallback(() => {
    const t = me.trim();
    if (!t) return;
    router.push(`/profile/user/${encodeURIComponent(t)}`);
  }, [me, router]);
  const goFriendManage = useCallback(() => router.push('/social/friends-settings'), [router]);
  const openFriendPublicProfile = useCallback(
    (peerRaw: string) => {
      const t = friendAppUserKey(peerRaw) || peerRaw.trim();
      if (!t) return;
      router.push(`/profile/user/${encodeURIComponent(t)}`);
    },
    [router],
  );

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
                setBlockedPeerIds((prev) => {
                  if (!prev.has(peerPk)) return prev;
                  const next = new Set(prev);
                  next.delete(peerPk);
                  void saveBlockedPeerIds(me, next);
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

  const onHideFriendFromSheet = useCallback(() => {
    if (!sheetFriend || !me) return;
    const pk = friendAppUserKey(sheetFriend.row.peer_app_user_id);
    setHiddenPeerIds((prev) => {
      const next = new Set(prev);
      next.add(pk);
      void persistHidden(next);
      return next;
    });
    setSheetFriend(null);
  }, [sheetFriend, me, persistHidden]);

  const onBlockFriendFromSheet = useCallback(() => {
    if (!sheetFriend || !me) return;
    const row = sheetFriend;
    const nick = row.profile.nickname?.trim() || '상대';
    Alert.alert('차단', `${nick}님을 차단할까요?\n친구 목록에서 보이지 않으며, 이후 상호작용이 제한될 수 있어요.`, [
      { text: '취소', style: 'cancel' },
      {
        text: '차단',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            const pk = friendAppUserKey(row.row.peer_app_user_id);
            const blocked = await loadBlockedPeerIds(me);
            blocked.add(pk);
            await saveBlockedPeerIds(me, blocked);
            setBlockedPeerIds(blocked);
            const hidden = await loadHiddenPeerIds(me);
            hidden.delete(pk);
            await saveHiddenPeerIds(me, hidden);
            setHiddenPeerIds(hidden);
            setSheetFriend(null);
          })();
        },
      },
    ]);
  }, [sheetFriend, me]);

  const onToggleSearch = useCallback(() => {
    setSearchOpen((v) => {
      const next = !v;
      if (next) {
        setTimeout(() => searchInputRef.current?.focus(), 0);
      } else {
        setSearch('');
      }
      return next;
    });
  }, []);

  const sheetMutualMeetings = useMemo(() => {
    if (!sheetFriend) return [];
    const peer = friendAppUserKey(sheetFriend.row.peer_app_user_id);
    return meetings.filter((m) => isUserJoinedMeeting(m, me) && isUserJoinedMeeting(m, peer));
  }, [sheetFriend, meetings, me]);

  const myNick = (meProfile?.nickname ?? '').trim() || '나';
  const myPhoto = meProfile?.photoUrl?.trim() ?? '';
  const myInitial = myNick.slice(0, 1) || '나';

  const listHeader = useMemo(() => {
    const showRequests = pending.length > 0 || pendingOut.length > 0;
    return (
      <View>
        <Pressable
          onPress={goMyProfile}
          style={({ pressed }) => [s.myRow, pressed && { opacity: 0.88 }]}
          accessibilityRole="button"
          accessibilityLabel="내 프로필">
          <View style={s.rowAvatarWrap}>
            {myPhoto ? (
              <Image source={{ uri: myPhoto }} style={s.rowAvatarImg} contentFit="cover" />
            ) : (
              <View style={s.rowAvatarFallback}>
                <Text style={s.rowAvatarLetter}>{myInitial}</Text>
              </View>
            )}
          </View>
          <View style={s.rowCenter}>
            <Text style={s.rowTitle} numberOfLines={1}>
              {myNick}
            </Text>
            <Text style={s.rowSub} numberOfLines={1}>
              내 프로필
            </Text>
          </View>
          <GinitSymbolicIcon name="chevron-forward" size={18} color="rgba(100, 116, 139, 0.9)" />
        </Pressable>

        {showRequests ? (
          <>
            <View style={s.sectionSpacer} />
            <Text style={s.sectionHeader}>친구 요청</Text>
            <View style={s.sectionBody}>
              {pending.map((row) => (
                <View key={row.id}>
                  <PendingGinitRow
                    row={row}
                    profile={profileFromMap(profiles, row.requester_app_user_id)}
                    onAccept={onAcceptPending}
                    onDecline={onDeclinePending}
                  />
                  <View style={s.fullSeparator} />
                </View>
              ))}
              {pendingOut.map((row) => (
                <View key={row.id}>
                  <OutgoingGinitRow
                    row={row}
                    profile={profileFromMap(profiles, row.addressee_app_user_id)}
                    status={row.status}
                    onCancel={onCancelOutgoing}
                  />
                  <View style={s.fullSeparator} />
                </View>
              ))}
            </View>
          </>
        ) : null}

        {visibleFavoriteFriends.length > 0 ? (
          <>
            <View style={s.sectionSpacer} />
            <Text style={s.sectionHeader}>즐겨찾기 {visibleFavoriteFriends.length}</Text>
            <View>
              {visibleFavoriteFriends.map((item, index) => (
                <View key={`fav-${item.row.id}`}>
                  {index > 0 ? <View style={s.friendSeparator} /> : null}
                  <FriendListRow
                    item={item}
                    categories={categories}
                    rowTitleText={friendDisplayName(
                      peerAliases,
                      item.row.peer_app_user_id,
                      item.profile.nickname?.trim() ?? '',
                    )}
                    onPressAvatar={() => openFriendPublicProfile(item.row.peer_app_user_id)}
                    onPressOpenChat={() =>
                      openDm(
                        item.row.peer_app_user_id,
                        friendDisplayName(peerAliases, item.row.peer_app_user_id, item.profile.nickname?.trim() ?? ''),
                      )
                    }
                    onPressOpenMeeting={() => {
                      const mid = item.meeting?.id?.trim() ?? '';
                      if (!mid) return;
                      router.push(`/meeting/${encodeURIComponent(mid)}`);
                    }}
                    onLongPressFriendMenu={() => setSheetFriend(item)}
                  />
                </View>
              ))}
            </View>
          </>
        ) : null}

        <View style={s.sectionSpacer} />
        <Text style={s.sectionHeader}>친구 {visibleFriends.length}</Text>
      </View>
    );
  }, [
    categories,
    goMyProfile,
    myInitial,
    myNick,
    myPhoto,
    onAcceptPending,
    onCancelOutgoing,
    onDeclinePending,
    openDm,
    openFriendPublicProfile,
    peerAliases,
    pending,
    pendingOut,
    profiles,
    visibleFavoriteFriends,
    visibleFriends.length,
  ]);

  const emptyAll = useMemo(
    () => (
      <GinitCard appearance="light" style={s.emptyCard}>
        <View style={s.emptyIconWrap}>
          <GinitSymbolicIcon name="people-outline" size={28} color={GinitTheme.colors.primary} />
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
      <View style={s.emptySearchPlain} accessibilityRole="text">
        <Text style={s.emptyTitle}>검색 결과가 없어요</Text>
        <Text style={s.emptyBody}>이름·gDna·아이디 일부로 다시 검색해 보세요.</Text>
      </View>
    ),
    [],
  );

  const emptyHiddenAll = useMemo(
    () => (
      <View style={s.emptySearchPlain} accessibilityRole="text">
        <Text style={s.emptyTitle}>표시할 친구가 없어요</Text>
        <Text style={s.emptyBody}>숨긴 친구만 있을 때 목록이 비어 보일 수 있어요.</Text>
      </View>
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

  const showListHeader = true;

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
              친구
            </Text>
            <View style={s.headerIcons}>
              <Pressable accessibilityLabel="검색" hitSlop={8} onPress={onToggleSearch} style={s.iconBtn}>
                <GinitSymbolicIcon name="search-outline" size={22} color="#0f172a" />
              </Pressable>
              <Pressable accessibilityLabel="친구 추가" hitSlop={8} onPress={goAddFriend} style={s.iconBtn}>
                <GinitSymbolicIcon name="person-add-outline" size={22} color="#0f172a" />
              </Pressable>
              <Pressable accessibilityLabel="친구 관리" hitSlop={8} onPress={goFriendManage} style={s.iconBtn}>
                <GinitSymbolicIcon name="settings-outline" size={22} color="#0f172a" />
              </Pressable>
            </View>
          </View>
          {searchOpen ? (
            <View style={s.searchWrap}>
              <GinitSymbolicIcon name="search-outline" size={18} color="#64748b" style={s.searchIcon} />
              <TextInput
                ref={searchInputRef}
                value={search}
                onChangeText={setSearch}
                placeholder="검색"
                placeholderTextColor="#94a3b8"
                style={s.searchInput}
                autoCorrect={false}
                autoCapitalize="none"
              />
              {search.length > 0 ? (
                <Pressable onPress={() => setSearch('')} hitSlop={8} accessibilityLabel="검색 지우기">
                  <GinitSymbolicIcon name="close-circle" size={20} color="#94a3b8" />
                </Pressable>
              ) : (
                <Pressable onPress={onToggleSearch} hitSlop={8} accessibilityLabel="검색 닫기">
                  <GinitSymbolicIcon name="close" size={20} color="#94a3b8" />
                </Pressable>
              )}
            </View>
          ) : null}
        </View>

        <FlashList
          data={visibleFriends}
          keyExtractor={(item) => item.row.id}
          ListHeaderComponent={showListHeader ? listHeader : null}
          ListEmptyComponent={listEmptyComponent}
          contentContainerStyle={[s.listPad, { paddingBottom: insets.bottom + 88 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GinitTheme.colors.primary} />
          }
          ItemSeparatorComponent={() => <View style={s.friendSeparator} />}
          renderItem={({ item }) => (
            <FriendListRow
              item={item}
              categories={categories}
              rowTitleText={friendDisplayName(peerAliases, item.row.peer_app_user_id, item.profile.nickname?.trim() ?? '')}
              onPressAvatar={() => openFriendPublicProfile(item.row.peer_app_user_id)}
              onPressOpenChat={() =>
                openDm(
                  item.row.peer_app_user_id,
                  friendDisplayName(peerAliases, item.row.peer_app_user_id, item.profile.nickname?.trim() ?? ''),
                )
              }
              onPressOpenMeeting={() => {
                const mid = item.meeting?.id?.trim() ?? '';
                if (!mid) return;
                router.push(`/meeting/${encodeURIComponent(mid)}`);
              }}
              onLongPressFriendMenu={() => setSheetFriend(item)}
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
                    accessibilityLabel="목록에서 숨기기"
                    onPress={onHideFriendFromSheet}
                    style={({ pressed }) => [s.sheetSecondaryBtn, pressed && { opacity: 0.88 }]}>
                    <Text style={s.sheetSecondaryTxt}>목록에서 숨기기</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="차단"
                    onPress={onBlockFriendFromSheet}
                    style={({ pressed }) => [s.sheetBlockBtn, pressed && { opacity: 0.88 }]}>
                    <Text style={s.sheetBlockTxt}>차단</Text>
                  </Pressable>
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
                          <GinitSymbolicIcon name="chevron-forward" size={18} color="#94a3b8" />
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
    paddingTop: 12,
    paddingBottom: 10,
    backgroundColor: GinitTheme.colors.bg,
    zIndex: 3,
  },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  headerTitle: { fontSize: 20, fontWeight: '700', color: GinitTheme.colors.text, flex: 1 },
  headerIcons: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  iconBtn: { padding: 6, borderRadius: 10 },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.34)',
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
    backgroundColor: 'rgba(255, 255, 255, 0.65)',
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
  loginHint: { fontSize: 15, fontWeight: '600', color: '#0f172a', lineHeight: 22 },
  sectionSpacer: { height: 14 },
  sectionHeader: { fontSize: 12, fontWeight: '600', color: 'rgba(100, 116, 139, 0.95)', marginBottom: 6 },
  sectionBody: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: GinitTheme.colors.border,
  },
  fullSeparator: { height: StyleSheet.hairlineWidth, backgroundColor: GinitTheme.colors.border, marginLeft: 0 },
  myRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 10,
  },
  friendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 10,
  },
  friendRowMain: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  requestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 10,
  },
  rowAvatarWrap: {
    width: 44,
    height: 44,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: 'rgba(15, 23, 42, 0.06)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowAvatarImg: { width: '100%', height: '100%' },
  rowAvatarFallback: { flex: 1, width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  rowAvatarLetter: { fontSize: 18, fontWeight: '600', color: GinitTheme.colors.primary },
  rowCenter: { flex: 1, minWidth: 0, justifyContent: 'center', gap: 2 },
  rowTitle: { fontSize: 15, fontWeight: '600', color: '#0f172a' },
  /** 채팅 목록 마지막 메시지 미리보기(`previewLine` / `socialPreviewLine`)와 동일 */
  rowSub: {
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 17,
    letterSpacing: -0.1,
    color: GinitTheme.colors.textMuted,
  },
  rowSubMuted: { color: '#94a3b8', fontWeight: '400' },
  rowSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  openMeetingBtn: {
    flexShrink: 0,
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.12)',
    backgroundColor: 'rgba(255, 255, 255, 0.75)',
  },
  openMeetingBtnText: { fontSize: 11, fontWeight: '700', color: '#0f172a', letterSpacing: -0.1 },
  rowSubtle: { fontSize: 12, fontWeight: '700', color: '#94a3b8' },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowActionBtnPrimary: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: GinitTheme.colors.primary,
  },
  rowActionBtnPrimaryText: { fontSize: 12, fontWeight: '600', color: '#fff' },
  rowActionBtnGhost: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.12)',
    backgroundColor: 'rgba(255, 255, 255, 0.75)',
  },
  rowActionBtnGhostText: { fontSize: 12, fontWeight: '600', color: '#0f172a' },
  rowStatusPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(15, 23, 42, 0.06)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.10)',
  },
  rowStatusPillText: { fontSize: 12, fontWeight: '600', color: '#334155' },
  friendSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: GinitTheme.colors.border,
    marginLeft: 54,
  },
  emptyCard: {
    marginTop: 8,
    alignItems: 'center',
    paddingVertical: 22,
    paddingHorizontal: 16,
  },
  emptySearchPlain: {
    marginTop: 8,
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
    borderColor: 'rgba(15, 23, 42, 0.34)',
    marginBottom: 12,
  },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: '#0f172a', textAlign: 'center', marginBottom: 6 },
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
  sheetAvatarLetter: { fontSize: 28, fontWeight: '600', color: GinitTheme.colors.primary },
  sheetDmBtn: { alignSelf: 'stretch', marginBottom: 10 },
  sheetSecondaryBtn: { alignSelf: 'stretch', paddingVertical: 12, marginBottom: 6 },
  sheetSecondaryTxt: { fontSize: 15, fontWeight: '600', color: '#0f172a', textAlign: 'center' },
  sheetBlockBtn: { alignSelf: 'stretch', paddingVertical: 12, marginBottom: 10 },
  sheetBlockTxt: { fontSize: 15, fontWeight: '600', color: '#b91c1c', textAlign: 'center' },
  sheetDeleteBtn: { alignSelf: 'stretch', paddingVertical: 12, marginBottom: 14 },
  sheetDeleteTxt: { fontSize: 15, fontWeight: '600', color: '#b91c1c', textAlign: 'center' },
  sheetTitle: { fontSize: 18, fontWeight: '600', color: '#0f172a', marginBottom: 10 },
  sheetSub: { fontSize: 12, fontWeight: '600', color: '#64748b', marginBottom: 4 },
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
  sheetCloseTxt: { fontSize: 15, fontWeight: '600', color: '#0f172a' },
});
