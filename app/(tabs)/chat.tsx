import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Image } from 'expo-image';

import { ChatListCardShell } from '@/components/chat/ChatListCardShell';
import { ChatMeetingListRow } from '@/components/chat/ChatMeetingListRow';
import { GlassCategoryChip } from '@/components/feed/GlassCategoryChip';
import { InAppAlarmsBellButton } from '@/components/in-app-alarms/InAppAlarmsBellButton';
import { ScreenShell } from '@/components/ui';
import { GinitTheme } from '@/constants/ginit-theme';
import { filterJoinedMeetings } from '@/src/lib/joined-meetings';
import { useInAppAlarms } from '@/src/context/InAppAlarmsContext';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import type { MeetingChatMessage } from '@/src/lib/meeting-chat';
import { fetchMeetingChatUnreadCount, subscribeMeetingChatLatestMessage } from '@/src/lib/meeting-chat';
import type { Meeting } from '@/src/lib/meetings';
import { getMeetingRecruitmentPhase } from '@/src/lib/meetings';
import { sweepStalePublicUnconfirmedMeetingsForHost } from '@/src/lib/meeting-expiry-sweep';
import { fetchMeetingsOnceHybrid, subscribeMeetingsHybrid } from '@/src/lib/meetings-hybrid';
import { normalizePhoneUserId } from '@/src/lib/phone-user-id';
import { socialDmRoomId, type SocialChatRoomSummary } from '@/src/lib/social-chat-rooms';
import { useChatRoomsInfiniteQuery } from '@/src/hooks/use-chat-rooms-infinite-query';
import type { UserProfile } from '@/src/lib/user-profile';
import { getUserProfilesForIds, isUserProfileWithdrawn } from '@/src/lib/user-profile';
import { useUserSession } from '@/src/context/UserSessionContext';

/** 친구 채팅 행 좌측 액센트 — 홈 카드 톤과 어울리는 블루·민트 그라데이션 */
const SOCIAL_CHAT_LIST_ACCENT = ['rgba(0, 82, 204, 0.28)', 'rgba(134, 211, 183, 0.18)'] as const;

/** 모임 문서의 `chatReadMessageIdBy`에서 내 마지막 읽은 메시지 id (키 형식이 달라도 정규화로 매칭) */
function readMessageIdFromMeetingDoc(m: Meeting, userPk: string, rawUid: string): string {
  const by = m.chatReadMessageIdBy;
  if (!by || typeof by !== 'object') return '';
  const tryKey = (k: string) => (k ? String((by as Record<string, string>)[k] ?? '').trim() : '');
  let s = userPk ? tryKey(userPk) : '';
  if (s) return s;
  const raw = rawUid.trim();
  if (raw) {
    s = tryKey(raw);
    if (s) return s;
  }
  if (userPk) {
    for (const [k, v] of Object.entries(by)) {
      if (typeof v !== 'string' || !v.trim()) continue;
      if ((normalizeParticipantId(k) ?? k.trim()) === userPk) return v.trim();
    }
  }
  return '';
}

function effectiveMeetingChatReadId(
  m: Meeting,
  userPk: string,
  rawUid: string,
  localMap: Record<string, string>,
  latestMessageId?: string | null,
): string {
  const fromDoc = readMessageIdFromMeetingDoc(m, userPk, rawUid);
  const latest = (latestMessageId ?? '').trim();
  // 다른 기기/세션에서 이미 최신까지 읽음이 반영된 경우, 로컬 캐시보다 서버를 우선
  if (latest && fromDoc === latest) return fromDoc;
  const local = (localMap[m.id] ?? '').trim();
  if (local) return local;
  return fromDoc;
}

function profileForCreatedBy(
  map: Map<string, UserProfile>,
  createdBy: string | null | undefined,
): UserProfile | undefined {
  if (!createdBy?.trim()) return undefined;
  const n = normalizePhoneUserId(createdBy) ?? createdBy.trim();
  const hit = map.get(createdBy) ?? map.get(n);
  if (hit) return hit;
  for (const [k, v] of map) {
    if ((normalizePhoneUserId(k) ?? k.trim()) === n) return v;
  }
  return undefined;
}

type ChatKind = 'gather' | 'social';

export default function ChatTab() {
  const router = useRouter();
  const { userId } = useUserSession();
  const { meetingChatReadMessageIdMap } = useInAppAlarms();
  const { width: windowWidth } = useWindowDimensions();
  /** 홈 피드 상단 칩과 동일한 라벨 폭 상한 */
  const tabChipMaxWidth = useMemo(
    () => Math.min(200, Math.max(100, Math.floor(windowWidth * 0.38))),
    [windowWidth],
  );
  const [chatKind, setChatKind] = useState<ChatKind>('gather');
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [latestByMeetingId, setLatestByMeetingId] = useState<
    Record<string, MeetingChatMessage | null | undefined>
  >({});
  const [hostProfiles, setHostProfiles] = useState<Map<string, UserProfile>>(new Map());
  const [socialProfiles, setSocialProfiles] = useState<Map<string, UserProfile>>(new Map());
  const [unreadByMeetingId, setUnreadByMeetingId] = useState<Record<string, number>>({});

  useEffect(() => {
    setLoading(true);
    const unsub = subscribeMeetingsHybrid(
      (list) => {
        setMeetings(list);
        setListError(null);
        setLoading(false);
      },
      (msg) => {
        setListError(msg);
        setLoading(false);
      },
    );
    return unsub;
  }, []);

  useEffect(() => {
    const uid = userId?.trim();
    if (!uid || meetings.length === 0) return;
    void sweepStalePublicUnconfirmedMeetingsForHost(uid, meetings);
  }, [userId, meetings]);

  const joinedMeetings = useMemo(
    () => filterJoinedMeetings(meetings, userId),
    [meetings, userId],
  );

  const sortedMeetingChats = useMemo(() => {
    const list = joinedMeetings.slice();
    const msgTime = (m: Meeting): number => {
      const msg = latestByMeetingId[m.id];
      if (!msg || !msg.createdAt || typeof msg.createdAt.toDate !== 'function') return 0;
      try {
        return msg.createdAt.toDate().getTime();
      } catch {
        return 0;
      }
    };
    const ongoingRank = (m: Meeting): number => {
      const phase = getMeetingRecruitmentPhase(m);
      return phase === 'recruiting' || phase === 'confirmed' || phase === 'full' ? 1 : 0;
    };
    list.sort((a, b) => {
      const oa = ongoingRank(a);
      const ob = ongoingRank(b);
      if (oa !== ob) return ob - oa;
      const ta = msgTime(a);
      const tb = msgTime(b);
      if (ta !== tb) return tb - ta;
      return String(b.id).localeCompare(String(a.id));
    });
    return list;
  }, [joinedMeetings, latestByMeetingId]);

  const signedIn = Boolean(userId?.trim());

  const {
    rooms: socialRooms,
    listError: socialListError,
    refetch: refetchSocialRooms,
    fetchNextPage: fetchNextSocialRoomsPage,
    hasNextPage: hasMoreSocialRooms,
    isFetchingNextPage: isFetchingMoreSocialRooms,
    isInitialLoading: socialRoomsInitialLoading,
  } = useChatRoomsInfiniteQuery(userId, signedIn && chatKind === 'social');

  const chatRowMeetingKey = useMemo(() => sortedMeetingChats.map((m) => m.id).join('\u0001'), [sortedMeetingChats]);

  const unreadRefreshSig = useMemo(() => {
    const pk = userId?.trim() ? normalizeParticipantId(userId.trim()) : '';
    const raw = userId?.trim() ?? '';
    return sortedMeetingChats
      .map((m) => {
        const lm = latestByMeetingId[m.id];
        const read = effectiveMeetingChatReadId(m, pk, raw, meetingChatReadMessageIdMap, lm?.id);
        return `${m.id}:${lm?.id ?? ''}:${read}`;
      })
      .join('|');
  }, [sortedMeetingChats, latestByMeetingId, meetingChatReadMessageIdMap, userId]);

  const socialRoomKey = useMemo(() => socialRooms.map((r) => r.roomId).join('\u0001'), [socialRooms]);

  useEffect(() => {
    if (chatKind !== 'social' || socialRooms.length === 0) {
      setSocialProfiles(new Map());
      return;
    }
    const peers = [...new Set(socialRooms.map((r) => r.peerAppUserId))];
    let cancelled = false;
    void getUserProfilesForIds(peers).then((map) => {
      if (!cancelled) setSocialProfiles(map);
    });
    return () => {
      cancelled = true;
    };
  }, [chatKind, socialRoomKey]);

  useEffect(() => {
    if (!signedIn || sortedMeetingChats.length === 0) {
      return () => {};
    }
    const unsubs = sortedMeetingChats.map((m) =>
      subscribeMeetingChatLatestMessage(
        m.id,
        (msg) => {
          setLatestByMeetingId((p) => ({ ...p, [m.id]: msg }));
        },
        () => {
          setLatestByMeetingId((p) => ({ ...p, [m.id]: null }));
        },
      ),
    );
    return () => {
      unsubs.forEach((u) => u());
    };
  }, [chatRowMeetingKey, signedIn]);

  useEffect(() => {
    if (chatKind !== 'gather' || !signedIn || sortedMeetingChats.length === 0) {
      setUnreadByMeetingId({});
      return;
    }
    const pk = userId?.trim() ? normalizeParticipantId(userId.trim()) : '';
    const raw = userId?.trim() ?? '';
    let cancelled = false;
    void (async () => {
      const next: Record<string, number> = {};
      for (const m of sortedMeetingChats) {
        if (cancelled) return;
        const readId = effectiveMeetingChatReadId(m, pk, raw, meetingChatReadMessageIdMap, latestByMeetingId[m.id]?.id);
        try {
          next[m.id] = await fetchMeetingChatUnreadCount(m.id, readId || null);
        } catch {
          next[m.id] = 0;
        }
      }
      if (!cancelled) setUnreadByMeetingId(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [chatKind, signedIn, unreadRefreshSig]);

  useEffect(() => {
    const hosts = [
      ...new Set(
        sortedMeetingChats
          .map((me) => (me.createdBy?.trim() ? normalizePhoneUserId(me.createdBy) ?? me.createdBy.trim() : ''))
          .filter(Boolean),
      ),
    ] as string[];
    if (hosts.length === 0) {
      setHostProfiles(new Map());
      return;
    }
    let cancelled = false;
    void getUserProfilesForIds(hosts).then((map) => {
      if (!cancelled) setHostProfiles(map);
    });
    return () => {
      cancelled = true;
    };
  }, [chatRowMeetingKey]);

  const onPullRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (chatKind === 'social') {
        await refetchSocialRooms();
      } else {
        const result = await fetchMeetingsOnceHybrid();
        if (result.ok) {
          setMeetings(result.meetings);
          setListError(null);
        } else {
          setListError(result.message);
        }
      }
    } finally {
      setRefreshing(false);
    }
  }, [chatKind, refetchSocialRooms]);

  const socialListFooter = useMemo(() => {
    if (chatKind !== 'social') return null;
    if (!isFetchingMoreSocialRooms && !(socialRoomsInitialLoading && socialRooms.length === 0)) return null;
    return (
      <View style={styles.listFooterSpinner} accessibilityLabel="채팅방 목록 로딩">
        <ActivityIndicator color={GinitTheme.colors.primary} />
      </View>
    );
  }, [chatKind, isFetchingMoreSocialRooms, socialRoomsInitialLoading, socialRooms.length]);

  return (
    <ScreenShell padded={false} style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <FlatList<Meeting | SocialChatRoomSummary>
          data={chatKind === 'gather' ? sortedMeetingChats : socialRooms}
          keyExtractor={(item) => ('peerAppUserId' in item ? item.roomId : item.id)}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onPullRefresh}
              tintColor={GinitTheme.colors.primary}
              colors={[GinitTheme.colors.primary]}
            />
          }
          ListHeaderComponent={
            <View style={styles.feedHeader}>
              <View style={styles.feedHeaderTopRow}>
                <View style={styles.chatTitlePressable} accessibilityRole="header">
                  <View style={styles.chatTitleCluster}>
                    <Text style={styles.chatTitle} numberOfLines={1}>
                      채팅
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
                    accessibilityLabel="채팅 설정"
                    style={styles.settingsIconWrap}>
                    <Ionicons name="settings-outline" size={24} color="#0f172a" />
                  </Pressable>
                </View>
              </View>

              <View style={styles.tabCategoryBar} accessibilityRole="tablist">
                <View style={styles.tabPair}>
                  <GlassCategoryChip
                    label="모임"
                    active={chatKind === 'gather'}
                    onPress={() => setChatKind('gather')}
                    maxLabelWidth={tabChipMaxWidth}
                    accessibilityLabel="모임"
                  />
                  <GlassCategoryChip
                    label="친구"
                    active={chatKind === 'social'}
                    onPress={() => setChatKind('social')}
                    maxLabelWidth={tabChipMaxWidth}
                    accessibilityLabel="친구"
                  />
                </View>
                <View style={styles.categoryDropdownSpacer} pointerEvents="none" />
              </View>

              {signedIn && chatKind === 'social' ? (
                <View style={styles.socialShortcuts}>
                  <Pressable
                    style={styles.shortcutBtn}
                    onPress={() => router.push('/social/connections')}
                    accessibilityRole="button"
                    accessibilityLabel="친구 관리">
                    <Text style={styles.shortcutBtnText}>친구 관리</Text>
                  </Pressable>
                  <Pressable
                    style={styles.shortcutBtn}
                    onPress={() => router.push('/social/discovery')}
                    accessibilityRole="button"
                    accessibilityLabel="지닛 디스커버리">
                    <Text style={styles.shortcutBtnText}>디스커버리</Text>
                  </Pressable>
                </View>
              ) : null}

              {loading ? (
                <View style={styles.centerRow}>
                  <ActivityIndicator color={GinitTheme.colors.primary} />
                  <Text style={styles.muted}>불러오는 중…</Text>
                </View>
              ) : null}

              {listError ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorTitle}>목록을 불러오지 못했어요</Text>
                  <Text style={styles.errorBody}>{listError}</Text>
                </View>
              ) : null}

              {chatKind === 'social' && socialListError ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorTitle}>Social 목록 오류</Text>
                  <Text style={styles.errorBody}>{socialListError}</Text>
                </View>
              ) : null}

              {!loading && !listError && !signedIn ? (
                <Text style={styles.empty}>로그인하면 채팅 목록이 여기에 표시돼요.</Text>
              ) : null}

              {!loading && !listError && signedIn && chatKind === 'gather' && joinedMeetings.length === 0 ? (
                <Text style={styles.empty}>참여 중인 모임이 없어요. 홈에서 모임에 참여해 보세요.</Text>
              ) : null}

              {!loading && !listError && signedIn && chatKind === 'social' && socialRooms.length === 0 ? (
                <Text style={styles.empty}>Social 대화가 없어요. 디스커버리에서 지닛을 보내 보세요.</Text>
              ) : null}
            </View>
          }
          ListFooterComponent={socialListFooter}
          onEndReached={
            chatKind === 'social' && hasMoreSocialRooms
              ? () => {
                  void fetchNextSocialRoomsPage();
                }
              : undefined
          }
          onEndReachedThreshold={0.6}
          renderItem={({ item }) => {
            if (chatKind === 'gather') {
              const m = item as Meeting;
              const host = profileForCreatedBy(hostProfiles, m.createdBy);
              return (
                <ChatMeetingListRow
                  meeting={m}
                  hostPhotoUrl={host?.photoUrl ?? null}
                  hostNickname={host?.nickname ?? '주관자'}
                  hostWithdrawn={isUserProfileWithdrawn(host)}
                  latestMessage={latestByMeetingId[m.id]}
                  unreadCount={unreadByMeetingId[m.id] ?? 0}
                  onPress={() => router.push(`/meeting-chat/${m.id}`)}
                />
              );
            }
            const row = item as SocialChatRoomSummary;
            const prof = socialProfiles.get(row.peerAppUserId);
            const uri = prof?.photoUrl?.trim();
            const nick = prof?.nickname ?? '친구';
            const rid = userId?.trim() ? socialDmRoomId(userId.trim(), row.peerAppUserId) : row.roomId;
            return (
              <ChatListCardShell
                accentGradient={SOCIAL_CHAT_LIST_ACCENT}
                onPress={() =>
                  router.push(`/social-chat/${encodeURIComponent(rid)}?peerName=${encodeURIComponent(nick)}`)
                }
                accessibilityLabel={`${nick}와 채팅`}>
                <View style={styles.socialZoneA}>
                  <View style={styles.socialSymbolCol}>
                    {uri ? (
                      <View style={styles.socialAvatarBubble}>
                        <Image source={{ uri }} style={styles.socialAvatarImg} contentFit="cover" />
                      </View>
                    ) : (
                      <View style={styles.socialAvatarBubble}>
                        <View style={styles.socialAvatarFallback}>
                          <Text style={styles.socialAvatarLetter}>{nick.slice(0, 1)}</Text>
                        </View>
                      </View>
                    )}
                    <Text style={styles.socialKindUnder} numberOfLines={1}>
                      1:1
                    </Text>
                  </View>
                  <View style={styles.socialZoneMain}>
                    <Text style={styles.socialHeroTitle} numberOfLines={1}>
                      {nick}
                    </Text>
                    <Text style={styles.socialMetaMuted} numberOfLines={1}>
                      친구 채팅
                    </Text>
                  </View>
                </View>
              </ChatListCardShell>
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
  tabCategoryBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 2,
  },
  tabPair: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
    minWidth: 0,
  },
  /** 홈 카테고리 드롭다운과 동일 레이아웃 폭·패딩(채팅 탭은 우측 컨트롤 없음) */
  categoryDropdownSpacer: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    maxWidth: 150,
    minWidth: 96,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
    opacity: 0,
  },
  socialShortcuts: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 4,
  },
  shortcutBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(0, 82, 204, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0, 82, 204, 0.18)',
    alignItems: 'center',
  },
  shortcutBtnText: {
    fontSize: 13,
    fontWeight: '900',
    color: GinitTheme.colors.primary,
  },
  socialZoneA: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  socialSymbolCol: {
    flexShrink: 0,
    alignItems: 'center',
    gap: 6,
    paddingTop: 1,
  },
  socialAvatarBubble: {
    width: 32,
    height: 32,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
    backgroundColor: GinitTheme.colors.surfaceStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  socialAvatarImg: {
    width: '100%',
    height: '100%',
  },
  socialAvatarFallback: {
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(0, 82, 204, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  socialAvatarLetter: { fontSize: 13, fontWeight: '900', color: GinitTheme.trustBlue },
  socialKindUnder: {
    fontSize: 9,
    fontWeight: '800',
    color: GinitTheme.colors.textMuted,
    letterSpacing: -0.35,
    textAlign: 'center',
    maxWidth: 40,
  },
  socialZoneMain: {
    flex: 1,
    minWidth: 0,
    gap: 2,
    paddingTop: 1,
  },
  socialHeroTitle: {
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: -0.2,
    lineHeight: 18,
    color: GinitTheme.colors.text,
  },
  socialMetaMuted: {
    fontSize: 11,
    fontWeight: '600',
    color: GinitTheme.colors.textMuted,
    letterSpacing: -0.12,
  },
  centerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  muted: {
    fontSize: 14,
    color: '#64748b',
  },
  errorBox: {
    marginBottom: 14,
    padding: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(220, 38, 38, 0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(220, 38, 38, 0.25)',
  },
  errorTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#B91C1C',
    marginBottom: 6,
  },
  errorBody: {
    fontSize: 14,
    color: '#7F1D1D',
    lineHeight: 20,
  },
  empty: {
    fontSize: 14,
    color: '#64748b',
    lineHeight: 20,
    marginBottom: 12,
  },
  listFooterSpinner: {
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 정렬 모달/칩 UI 제거됨
});
