import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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
import { useInAppAlarms } from '@/src/context/InAppAlarmsContext';
import { useUserSession } from '@/src/context/UserSessionContext';
import { useChatRoomsInfiniteQuery } from '@/src/hooks/use-chat-rooms-infinite-query';
import { useMeetingsFeedInfiniteQuery } from '@/src/hooks/use-meetings-feed-infinite-query';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { resolveFeedLocationContext } from '@/src/lib/feed-display-location';
import { loadFeedLocationCache } from '@/src/lib/feed-location-cache';
import { listSortModeLabel, sortMeetingsForFeed, type MeetingListSortMode } from '@/src/lib/feed-meeting-utils';
import type { LatLng } from '@/src/lib/geo-distance';
import { filterJoinedMeetings } from '@/src/lib/joined-meetings';
import type { MeetingChatMessage } from '@/src/lib/meeting-chat';
import {
  fetchMeetingChatUnreadCount,
  searchMeetingChatMessages,
  subscribeMeetingChatLatestMessage,
} from '@/src/lib/meeting-chat';
import { effectiveMeetingChatReadId } from '@/src/lib/meeting-chat-read-pointer';
import { sweepStalePublicUnconfirmedMeetingsForHost } from '@/src/lib/meeting-expiry-sweep';
import type { Meeting } from '@/src/lib/meetings';
import { normalizePhoneUserId } from '@/src/lib/phone-user-id';
import {
  searchSocialChatMessages,
  socialDmRoomId,
  type SocialChatRoomSummary,
} from '@/src/lib/social-chat-rooms';
import type { UserProfile } from '@/src/lib/user-profile';
import { getUserProfilesForIds, isUserProfileWithdrawn } from '@/src/lib/user-profile';

/** 친구 채팅 행 좌측 액센트 — 홈 카드 톤과 어울리는 블루·민트 그라데이션 */
const SOCIAL_CHAT_LIST_ACCENT = ['rgba(0, 82, 204, 0.28)', 'rgba(134, 211, 183, 0.18)'] as const;

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

function meetingTextSearchHaystack(m: Meeting): string {
  return [m.title, m.description, m.categoryLabel, m.location, m.placeName, m.address ?? '']
    .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
    .join(' ')
    .toLowerCase();
}

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
  const [refreshing, setRefreshing] = useState(false);
  const [latestByMeetingId, setLatestByMeetingId] = useState<
    Record<string, MeetingChatMessage | null | undefined>
  >({});
  const [hostProfiles, setHostProfiles] = useState<Map<string, UserProfile>>(new Map());
  const [socialProfiles, setSocialProfiles] = useState<Map<string, UserProfile>>(new Map());
  const [unreadByMeetingId, setUnreadByMeetingId] = useState<Record<string, number>>({});

  const signedIn = Boolean(userId?.trim());

  const {
    meetings,
    listError: gatherListError,
    refetch: refetchMeetingsFeed,
    fetchNextPage: fetchNextMeetingsFeedPage,
    hasNextPage: hasMoreMeetingsFeed,
    isFetchingNextPage: isFetchingMoreMeetingsFeed,
    showFooterSpinner: showMeetingsFeedFooterSpinner,
    isInitialListLoading: meetingsFeedInitialLoading,
  } = useMeetingsFeedInfiniteQuery({
    enabled: signedIn && chatKind === 'gather',
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  const fetchNextMeetingsFeedPageGuarded = useCallback(async () => {
    if (!hasMoreMeetingsFeed || isFetchingMoreMeetingsFeed) return;
    await fetchNextMeetingsFeedPage();
  }, [hasMoreMeetingsFeed, isFetchingMoreMeetingsFeed, fetchNextMeetingsFeedPage]);

  useEffect(() => {
    const uid = userId?.trim();
    if (!uid || meetings.length === 0) return;
    void sweepStalePublicUnconfirmedMeetingsForHost(uid, meetings);
  }, [userId, meetings]);

  const joinedMeetings = useMemo(
    () => filterJoinedMeetings(meetings, userId),
    [meetings, userId],
  );

  const [userCoords, setUserCoords] = useState<LatLng | null>(null);
  const [chatSearchModalOpen, setChatSearchModalOpen] = useState(false);
  const [draftChatSearchQuery, setDraftChatSearchQuery] = useState('');
  const [appliedGatherTextQuery, setAppliedGatherTextQuery] = useState('');
  const [appliedSocialTextQuery, setAppliedSocialTextQuery] = useState('');
  const [gatherMessageMatchIds, setGatherMessageMatchIds] = useState<Set<string>>(() => new Set());
  const [gatherSearchBusy, setGatherSearchBusy] = useState(false);
  const [socialMessageMatchRoomIds, setSocialMessageMatchRoomIds] = useState<Set<string>>(() => new Set());
  const [socialSearchBusy, setSocialSearchBusy] = useState(false);
  const [chatListSettingsModalOpen, setChatListSettingsModalOpen] = useState(false);
  const [gatherListSortMode, setGatherListSortMode] = useState<MeetingListSortMode>('latest');
  const [socialSortByName, setSocialSortByName] = useState(false);

  useEffect(() => {
    setChatSearchModalOpen(false);
    setChatListSettingsModalOpen(false);
  }, [chatKind]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cached = await loadFeedLocationCache();
      if (cancelled) return;
      let coords: LatLng | null = cached?.coords ?? null;
      const ctx = await resolveFeedLocationContext();
      if (cancelled) return;
      coords = ctx.coords ?? coords;
      setUserCoords(coords);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const gatherMeetingsFiltered = useMemo(() => {
    const q = appliedGatherTextQuery.trim().toLowerCase();
    return joinedMeetings.filter((m) => {
      if (!q) return true;
      if (meetingTextSearchHaystack(m).includes(q)) return true;
      return gatherMessageMatchIds.has(m.id);
    });
  }, [joinedMeetings, appliedGatherTextQuery, gatherMessageMatchIds]);

  const displayedGatherMeetings = useMemo(
    () => sortMeetingsForFeed(gatherMeetingsFiltered, gatherListSortMode, userCoords),
    [gatherMeetingsFiltered, gatherListSortMode, userCoords],
  );

  const {
    rooms: socialRooms,
    listError: socialListError,
    refetch: refetchSocialRooms,
    fetchNextPage: fetchNextSocialRoomsPage,
    hasNextPage: hasMoreSocialRooms,
    isFetchingNextPage: isFetchingMoreSocialRooms,
    isInitialLoading: socialRoomsInitialLoading,
  } = useChatRoomsInfiniteQuery(userId, signedIn && chatKind === 'social');

  /** 친구 탭: `social_` 1:1 DM만 표시(그룹·기타 룸 제외) */
  const socialFriendDmRooms = useMemo(
    () => socialRooms.filter((r) => r.roomId.trim().startsWith('social_')),
    [socialRooms],
  );

  const joinedMeetingRowKey = useMemo(() => joinedMeetings.map((m) => m.id).join('\u0001'), [joinedMeetings]);

  const unreadRefreshSig = useMemo(() => {
    const pk = userId?.trim() ? normalizeParticipantId(userId.trim()) : '';
    const raw = userId?.trim() ?? '';
    return joinedMeetings
      .map((m) => {
        const lm = latestByMeetingId[m.id];
        const read = effectiveMeetingChatReadId(m, pk, raw, meetingChatReadMessageIdMap, lm?.id);
        return `${m.id}:${lm?.id ?? ''}:${read}`;
      })
      .join('|');
  }, [joinedMeetings, latestByMeetingId, meetingChatReadMessageIdMap, userId]);

  const socialRoomKey = useMemo(() => socialFriendDmRooms.map((r) => r.roomId).join('\u0001'), [socialFriendDmRooms]);

  const displayedSocialRooms = useMemo(() => {
    let rows = socialFriendDmRooms;
    const q = appliedSocialTextQuery.trim().toLowerCase();
    if (q) {
      rows = rows.filter((r) => {
        const nick = (socialProfiles.get(r.peerAppUserId)?.nickname ?? '').trim().toLowerCase();
        const id = r.peerAppUserId.trim().toLowerCase();
        if (nick.includes(q) || id.includes(q)) return true;
        return socialMessageMatchRoomIds.has(r.roomId);
      });
    }
    if (socialSortByName) {
      rows = [...rows].sort((a, b) => {
        const na = socialProfiles.get(a.peerAppUserId)?.nickname ?? a.peerAppUserId;
        const nb = socialProfiles.get(b.peerAppUserId)?.nickname ?? b.peerAppUserId;
        return na.localeCompare(nb, 'ko');
      });
    }
    return rows;
  }, [socialFriendDmRooms, appliedSocialTextQuery, socialSortByName, socialProfiles, socialMessageMatchRoomIds]);

  const chatSearchFiltersDot = useMemo(
    () =>
      chatKind === 'gather' ? appliedGatherTextQuery.trim() !== '' : appliedSocialTextQuery.trim() !== '',
    [chatKind, appliedGatherTextQuery, appliedSocialTextQuery],
  );

  const chatListSettingsDotActive = useMemo(() => {
    if (chatKind === 'gather') return gatherListSortMode !== 'latest';
    return socialSortByName;
  }, [chatKind, gatherListSortMode, socialSortByName]);

  const gatherSortComboLabel = useMemo(() => listSortModeLabel(gatherListSortMode), [gatherListSortMode]);

  useEffect(() => {
    const q = appliedGatherTextQuery.trim();
    if (!signedIn || chatKind !== 'gather') {
      setGatherMessageMatchIds(new Set());
      setGatherSearchBusy(false);
      return;
    }
    if (!q) {
      setGatherMessageMatchIds(new Set());
      setGatherSearchBusy(false);
      return;
    }
    let cancelled = false;
    setGatherSearchBusy(true);
    setGatherMessageMatchIds(new Set());
    const needle = q.toLowerCase();
    void (async () => {
      const messageHits = new Set<string>();
      const needScan = joinedMeetings.filter((m) => !meetingTextSearchHaystack(m).includes(needle));
      const concurrency = 4;
      for (let i = 0; i < needScan.length; i += concurrency) {
        if (cancelled) return;
        const chunk = needScan.slice(i, i + concurrency);
        await Promise.all(
          chunk.map(async (m) => {
            try {
              const rows = await searchMeetingChatMessages(m.id, q, { maxDocsScanned: 900 });
              if (!cancelled && rows.length > 0) messageHits.add(m.id);
            } catch {
              /* ignore */
            }
          }),
        );
      }
      if (!cancelled) {
        setGatherMessageMatchIds(messageHits);
        setGatherSearchBusy(false);
      }
    })();
    return () => {
      cancelled = true;
      setGatherSearchBusy(false);
    };
  }, [appliedGatherTextQuery, joinedMeetingRowKey, signedIn, chatKind, joinedMeetings]);

  useEffect(() => {
    const q = appliedSocialTextQuery.trim();
    if (!signedIn || chatKind !== 'social') {
      setSocialMessageMatchRoomIds(new Set());
      setSocialSearchBusy(false);
      return;
    }
    if (!q) {
      setSocialMessageMatchRoomIds(new Set());
      setSocialSearchBusy(false);
      return;
    }
    let cancelled = false;
    setSocialSearchBusy(true);
    setSocialMessageMatchRoomIds(new Set());
    const needle = q.toLowerCase();
    void (async () => {
      const messageHits = new Set<string>();
      const needScan = socialFriendDmRooms.filter((r) => {
        const nick = (socialProfiles.get(r.peerAppUserId)?.nickname ?? '').trim().toLowerCase();
        const id = r.peerAppUserId.trim().toLowerCase();
        return !nick.includes(needle) && !id.includes(needle);
      });
      const concurrency = 4;
      for (let i = 0; i < needScan.length; i += concurrency) {
        if (cancelled) return;
        const chunk = needScan.slice(i, i + concurrency);
        await Promise.all(
          chunk.map(async (r) => {
            try {
              const rows = await searchSocialChatMessages(r.roomId, q, { maxDocsScanned: 900 });
              if (!cancelled && rows.length > 0) messageHits.add(r.roomId);
            } catch {
              /* ignore */
            }
          }),
        );
      }
      if (!cancelled) {
        setSocialMessageMatchRoomIds(messageHits);
        setSocialSearchBusy(false);
      }
    })();
    return () => {
      cancelled = true;
      setSocialSearchBusy(false);
    };
  }, [appliedSocialTextQuery, socialRoomKey, signedIn, chatKind, socialFriendDmRooms, socialProfiles]);

  useEffect(() => {
    if (chatKind !== 'social' || socialFriendDmRooms.length === 0) {
      setSocialProfiles(new Map());
      return;
    }
    const peers = [...new Set(socialFriendDmRooms.map((r) => r.peerAppUserId))];
    let cancelled = false;
    void getUserProfilesForIds(peers).then((map) => {
      if (!cancelled) setSocialProfiles(map);
    });
    return () => {
      cancelled = true;
    };
  }, [chatKind, socialRoomKey]);

  useEffect(() => {
    if (!signedIn || joinedMeetings.length === 0) {
      return () => {};
    }
    const unsubs = joinedMeetings.map((m) =>
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
  }, [joinedMeetingRowKey, signedIn]);

  useEffect(() => {
    if (chatKind !== 'gather' || !signedIn || joinedMeetings.length === 0) {
      setUnreadByMeetingId({});
      return;
    }
    const pk = userId?.trim() ? normalizeParticipantId(userId.trim()) : '';
    const raw = userId?.trim() ?? '';
    let cancelled = false;
    void (async () => {
      const next: Record<string, number> = {};
      for (const m of joinedMeetings) {
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
        joinedMeetings
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
  }, [joinedMeetingRowKey]);

  const onPullRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (chatKind === 'social') {
        await refetchSocialRooms();
      } else {
        await refetchMeetingsFeed();
      }
    } finally {
      setRefreshing(false);
    }
  }, [chatKind, refetchSocialRooms, refetchMeetingsFeed]);

  const openChatSearch = useCallback(() => {
    setDraftChatSearchQuery(chatKind === 'gather' ? appliedGatherTextQuery : appliedSocialTextQuery);
    setChatSearchModalOpen(true);
  }, [chatKind, appliedGatherTextQuery, appliedSocialTextQuery]);

  const closeChatSearch = useCallback(() => setChatSearchModalOpen(false), []);
  const applyChatSearch = useCallback(() => {
    if (chatKind === 'gather') setAppliedGatherTextQuery(draftChatSearchQuery);
    else setAppliedSocialTextQuery(draftChatSearchQuery);
    setChatSearchModalOpen(false);
  }, [chatKind, draftChatSearchQuery]);

  const hasActiveChatSearchFilter = useMemo(
    () => (chatKind === 'gather' ? appliedGatherTextQuery.trim() !== '' : appliedSocialTextQuery.trim() !== ''),
    [chatKind, appliedGatherTextQuery, appliedSocialTextQuery],
  );

  const clearChatSearchFilters = useCallback(() => {
    setDraftChatSearchQuery('');
    if (chatKind === 'gather') setAppliedGatherTextQuery('');
    else setAppliedSocialTextQuery('');
    setChatSearchModalOpen(false);
  }, [chatKind]);

  const openChatListSettings = useCallback(() => setChatListSettingsModalOpen(true), []);
  const closeChatListSettings = useCallback(() => setChatListSettingsModalOpen(false), []);

  const gatherListFooter = useMemo(() => {
    if (chatKind !== 'gather') return null;
    if (!showMeetingsFeedFooterSpinner || refreshing) return null;
    return (
      <View style={styles.listFooterSpinner} accessibilityLabel="모임 목록 로딩">
        <ActivityIndicator color={GinitTheme.colors.primary} />
      </View>
    );
  }, [chatKind, showMeetingsFeedFooterSpinner, refreshing]);

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
          data={chatKind === 'gather' ? displayedGatherMeetings : displayedSocialRooms}
          extraData={{
            chatKind,
            gatherListSortMode,
            appliedGatherTextQuery,
            appliedSocialTextQuery,
            socialSortByName,
            gatherSearchBusy,
            socialSearchBusy,
            gatherMsgHits: gatherMessageMatchIds.size,
            socialMsgHits: socialMessageMatchRoomIds.size,
          }}
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
                  <Pressable
                    onPress={openChatSearch}
                    accessibilityRole="button"
                    accessibilityLabel="채팅 검색"
                    hitSlop={10}
                    style={styles.searchIconWrap}>
                    <Ionicons name="search-outline" size={24} color="#0f172a" />
                    {chatSearchFiltersDot ? <View style={styles.searchFilterDot} /> : null}
                  </Pressable>
                  <InAppAlarmsBellButton />
                  <Pressable
                    onPress={openChatListSettings}
                    accessibilityRole="button"
                    hitSlop={10}
                    accessibilityLabel="목록 정렬"
                    style={styles.settingsIconWrap}>
                    <Ionicons name="settings-outline" size={24} color="#0f172a" />
                    {chatListSettingsDotActive ? <View style={styles.settingsFilterDot} /> : null}
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

              {chatKind === 'gather' && meetingsFeedInitialLoading && meetings.length === 0 ? (
                <View style={styles.centerRow}>
                  <ActivityIndicator color={GinitTheme.colors.primary} />
                  <Text style={styles.muted}>불러오는 중…</Text>
                </View>
              ) : null}

              {chatKind === 'gather' && gatherListError ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorTitle}>목록을 불러오지 못했어요</Text>
                  <Text style={styles.errorBody}>{gatherListError}</Text>
                </View>
              ) : null}

              {chatKind === 'social' && socialListError ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorTitle}>Social 목록 오류</Text>
                  <Text style={styles.errorBody}>{socialListError}</Text>
                </View>
              ) : null}

              {signedIn && chatKind === 'gather' && appliedGatherTextQuery.trim() !== '' && gatherSearchBusy ? (
                <View style={styles.centerRow}>
                  <ActivityIndicator color={GinitTheme.colors.primary} />
                  <Text style={styles.muted}>대화에서 검색하는 중…</Text>
                </View>
              ) : null}

              {signedIn && chatKind === 'social' && appliedSocialTextQuery.trim() !== '' && socialSearchBusy ? (
                <View style={styles.centerRow}>
                  <ActivityIndicator color={GinitTheme.colors.primary} />
                  <Text style={styles.muted}>대화에서 검색하는 중…</Text>
                </View>
              ) : null}

              {!signedIn &&
              (chatKind === 'gather'
                ? !(meetingsFeedInitialLoading && meetings.length === 0) && !gatherListError
                : !(socialRoomsInitialLoading && socialRooms.length === 0) && !socialListError) ? (
                <Text style={styles.empty}>로그인하면 채팅 목록이 여기에 표시돼요.</Text>
              ) : null}

              {chatKind === 'gather' &&
              !(meetingsFeedInitialLoading && meetings.length === 0) &&
              !gatherListError &&
              signedIn &&
              joinedMeetings.length === 0 ? (
                <Text style={styles.empty}>참여 중인 모임이 없어요. 홈에서 모임에 참여해 보세요.</Text>
              ) : null}

              {chatKind === 'social' &&
              !(socialRoomsInitialLoading && socialRooms.length === 0) &&
              !socialListError &&
              signedIn &&
              socialFriendDmRooms.length === 0 ? (
                <Text style={styles.empty}>1:1 친구 채팅이 없어요.</Text>
              ) : null}

              {chatKind === 'gather' &&
              !(meetingsFeedInitialLoading && meetings.length === 0) &&
              !gatherListError &&
              signedIn &&
              !gatherSearchBusy &&
              joinedMeetings.length > 0 &&
              displayedGatherMeetings.length === 0 ? (
                <Text style={styles.empty}>
                  검색어에 맞는 모임 채팅이 없어요. 검색을 열어 다른 단어로 찾아 보세요.
                </Text>
              ) : null}

              {chatKind === 'social' &&
              !(socialRoomsInitialLoading && socialRooms.length === 0) &&
              !socialListError &&
              signedIn &&
              !socialSearchBusy &&
              socialFriendDmRooms.length > 0 &&
              displayedSocialRooms.length === 0 ? (
                <Text style={styles.empty}>
                  검색어에 맞는 친구 채팅이 없어요. 검색을 열어 다른 단어로 찾아 보세요.
                </Text>
              ) : null}
            </View>
          }
          ListFooterComponent={chatKind === 'social' ? socialListFooter : gatherListFooter}
          onEndReached={() => {
            if (chatKind === 'social' && hasMoreSocialRooms) void fetchNextSocialRoomsPage();
            else if (chatKind === 'gather' && hasMoreMeetingsFeed) void fetchNextMeetingsFeedPageGuarded();
          }}
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

        <Modal
          visible={chatSearchModalOpen}
          animationType="fade"
          transparent
          onRequestClose={closeChatSearch}>
          <View style={styles.modalRoot}>
            <Pressable
              style={StyleSheet.absoluteFillObject}
              onPress={closeChatSearch}
              accessibilityRole="button"
              accessibilityLabel="검색 닫기"
            />
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>채팅 검색</Text>
              <Text style={styles.modalHint}>
                {chatKind === 'gather'
                  ? '참여 중인 모임 채팅 중, 모임 이름·소개·장소 또는 대화에 "검색어"가 포함된 방만 목록에 표시해요.'
                  : '친구 이름 또는 대화 내용이 포함된 방만 목록에 표시해요.'}
              </Text>
              <TextInput
                value={draftChatSearchQuery}
                onChangeText={setDraftChatSearchQuery}
                placeholder={chatKind === 'gather' ? '모임 이름, 대화 내용…' : '친구 이름, 대화 내용…'}
                placeholderTextColor="#94a3b8"
                style={styles.socialSearchInput}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
              />
              <Pressable
                onPress={applyChatSearch}
                style={styles.socialSearchApplyBtn}
                accessibilityRole="button"
                accessibilityLabel="검색">
                <Text style={styles.socialSearchApplyLabel}>검색</Text>
              </Pressable>
              <Pressable
                onPress={clearChatSearchFilters}
                disabled={!hasActiveChatSearchFilter}
                style={({ pressed }) => [
                  styles.chatSearchClearBtn,
                  !hasActiveChatSearchFilter && styles.chatSearchClearBtnDisabled,
                  pressed && hasActiveChatSearchFilter && styles.chatSearchClearBtnPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="필터 해제"
                accessibilityState={{ disabled: !hasActiveChatSearchFilter }}>
                <Text
                  style={[
                    styles.chatSearchClearLabel,
                    !hasActiveChatSearchFilter && styles.chatSearchClearLabelDisabled,
                  ]}>
                  필터 해제
                </Text>
              </Pressable>
              <Pressable onPress={closeChatSearch} style={styles.modalCloseBtn} accessibilityRole="button">
                <Text style={styles.modalCloseLabel}>닫기</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        <Modal
          visible={chatListSettingsModalOpen}
          animationType="fade"
          transparent
          onRequestClose={closeChatListSettings}>
          <View style={styles.modalRoot}>
            <Pressable
              style={StyleSheet.absoluteFillObject}
              onPress={closeChatListSettings}
              accessibilityRole="button"
              accessibilityLabel="목록 정렬 닫기"
            />
            <View style={[styles.modalCard, styles.modalCardWide]}>
              <Text style={styles.modalTitle}>목록 정렬</Text>
              <Text style={styles.modalHint}>
                채팅 목록의 순서만 바꿀 수 있어요. 검색어는 상단 검색 아이콘을 눌러 주세요.
              </Text>
              {chatKind === 'gather' ? (
                <>
                  <Text style={styles.modalCurrentSummary} numberOfLines={2}>
                    현재: {gatherSortComboLabel}
                  </Text>
                  <ScrollView
                    style={styles.feedSettingsScroll}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}>
                    <Text style={styles.modalSectionTitle}>정렬</Text>
                    {(['distance', 'latest', 'soon'] as const).map((mode) => {
                      const selected = gatherListSortMode === mode;
                      const label = listSortModeLabel(mode);
                      return (
                        <Pressable
                          key={mode}
                          onPress={() => setGatherListSortMode(mode)}
                          style={({ pressed }) => [styles.modalRow, pressed && styles.modalRowPressed]}
                          accessibilityRole="button"
                          accessibilityState={{ selected }}>
                          <Text style={styles.modalRowLabel}>{label}</Text>
                          {selected ? (
                            <Ionicons name="checkmark-circle" size={22} color={GinitTheme.colors.primary} />
                          ) : (
                            <Ionicons name="ellipse-outline" size={22} color="#cbd5e1" />
                          )}
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </>
              ) : (
                <ScrollView
                  style={styles.feedSettingsScroll}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}>
                  <Text style={styles.modalSectionTitle}>정렬</Text>
                  <Pressable
                    onPress={() => setSocialSortByName(false)}
                    style={({ pressed }) => [styles.modalRow, pressed && styles.modalRowPressed]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: !socialSortByName }}>
                    <Text style={styles.modalRowLabel}>기본 순서</Text>
                    {!socialSortByName ? (
                      <Ionicons name="checkmark-circle" size={22} color={GinitTheme.colors.primary} />
                    ) : (
                      <Ionicons name="ellipse-outline" size={22} color="#cbd5e1" />
                    )}
                  </Pressable>
                  <Pressable
                    onPress={() => setSocialSortByName(true)}
                    style={({ pressed }) => [styles.modalRow, pressed && styles.modalRowPressed]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: socialSortByName }}>
                    <Text style={styles.modalRowLabel}>이름순 (가나다)</Text>
                    {socialSortByName ? (
                      <Ionicons name="checkmark-circle" size={22} color={GinitTheme.colors.primary} />
                    ) : (
                      <Ionicons name="ellipse-outline" size={22} color="#cbd5e1" />
                    )}
                  </Pressable>
                </ScrollView>
              )}
              <Pressable onPress={closeChatListSettings} style={styles.modalCloseBtn} accessibilityRole="button">
                <Text style={styles.modalCloseLabel}>닫기</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
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
  searchFilterDot: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#EF4444',
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  settingsFilterDot: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#EF4444',
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  modalRoot: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    borderRadius: 20,
    padding: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.6)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 8,
  },
  modalCardWide: {
    maxHeight: '92%',
  },
  feedSettingsScroll: {
    maxHeight: 400,
  },
  modalCurrentSummary: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
    lineHeight: 17,
    marginBottom: 8,
  },
  modalSectionTitle: {
    marginTop: 4,
    marginBottom: 2,
    fontSize: 13,
    fontWeight: '800',
    color: '#475569',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 6,
  },
  modalHint: {
    fontSize: 13,
    lineHeight: 18,
    color: '#64748b',
    marginBottom: 16,
  },
  modalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(15, 23, 42, 0.08)',
  },
  modalRowPressed: {
    backgroundColor: 'rgba(0, 82, 204, 0.06)',
  },
  modalRowLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0f172a',
  },
  modalCloseBtn: {
    marginTop: 16,
    alignSelf: 'center',
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  modalCloseLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: GinitTheme.trustBlue,
  },
  socialSearchInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.12)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#0f172a',
    marginBottom: 14,
  },
  socialSearchApplyBtn: {
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: GinitTheme.colors.primary,
    marginBottom: 4,
  },
  socialSearchApplyLabel: {
    fontSize: 15,
    fontWeight: '800',
    color: '#fff',
  },
  chatSearchClearBtn: {
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    borderWidth: 1.5,
    borderColor: GinitTheme.colors.primary,
    marginBottom: 4,
  },
  chatSearchClearBtnPressed: {
    backgroundColor: 'rgba(0, 82, 204, 0.08)',
  },
  chatSearchClearBtnDisabled: {
    borderColor: 'rgba(15, 23, 42, 0.15)',
    backgroundColor: 'rgba(248, 250, 252, 0.9)',
  },
  chatSearchClearLabel: {
    fontSize: 15,
    fontWeight: '800',
    color: GinitTheme.colors.primary,
  },
  chatSearchClearLabelDisabled: {
    color: '#94a3b8',
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
});
