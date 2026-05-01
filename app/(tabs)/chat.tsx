
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Image } from 'expo-image';

import { ChatMeetingListRow } from '@/components/chat/ChatMeetingListRow';
import { ScreenShell } from '@/components/ui';
import { GinitSymbolicIcon, type SymbolicIconName } from '@/components/ui/GinitSymbolicIcon';
import { GinitTheme } from '@/constants/ginit-theme';
import { useInAppAlarms } from '@/src/context/InAppAlarmsContext';
import { useUserSession } from '@/src/context/UserSessionContext';
import { useChatRoomsInfiniteQuery } from '@/src/hooks/use-chat-rooms-infinite-query';
import { useMeetingsFeedInfiniteQuery } from '@/src/hooks/use-meetings-feed-infinite-query';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { resolveFeedLocationContext } from '@/src/lib/feed-display-location';
import { loadFeedLocationCache } from '@/src/lib/feed-location-cache';
import { meetingCreatedAtMs } from '@/src/lib/feed-meeting-utils';
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
  fetchSocialChatUnreadCount,
  searchSocialChatMessages,
  socialDmPreviewLine,
  socialDmRoomId,
  socialMessageTimeMs,
  subscribeSocialChatLatestMessage,
  subscribeSocialChatRoom,
  type SocialChatMessage,
  type SocialChatRoomDoc,
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

function latestMeetingChatMessageMs(msg: MeetingChatMessage | null | undefined): number {
  const ts = msg?.createdAt;
  if (ts && typeof ts.toMillis === 'function') {
    try {
      return ts.toMillis();
    } catch {
      return 0;
    }
  }
  return 0;
}

function latestSocialChatMessageMs(msg: SocialChatMessage | null | undefined): number {
  return socialMessageTimeMs(msg);
}

function formatRelativeFromMs(ms: number): string {
  if (!ms || ms <= 0) return '';
  const diffMs = Date.now() - ms;
  if (diffMs < 0) return '';
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return '방금';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}일 전`;
  const week = Math.floor(day / 7);
  if (week < 6) return `${week}주 전`;
  const d = new Date(ms);
  return d.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
}

function formatRightTimeFromMs(ms: number): string {
  if (!ms || ms <= 0) return '';
  try {
    const d = new Date(ms);
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    if (sameDay) {
      return d.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit', hour12: true });
    }
    return formatRelativeFromMs(ms);
  } catch {
    return '';
  }
}

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
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const safeInsets = useSafeAreaInsets();
  /** 모임 피드와 동일: 빈 목록 안내를 리스트 영역 세로 중앙에 배치 */
  const chatEmptyMinHeight = useMemo(
    () => Math.max(300, windowHeight - safeInsets.top - safeInsets.bottom - 200),
    [windowHeight, safeInsets.top, safeInsets.bottom],
  );
  /** 홈 피드 상단 칩과 동일한 라벨 폭 상한 */
  const tabChipMaxWidth = useMemo(
    () => Math.min(200, Math.max(100, Math.floor(windowWidth * 0.38))),
    [windowWidth],
  );
  const [chatKind, setChatKind] = useState<ChatKind>('gather');
  const tabPagerRef = useRef<ScrollView | null>(null);
  const chatKindRef = useRef(chatKind);
  chatKindRef.current = chatKind;
  const [refreshing, setRefreshing] = useState(false);
  const [latestByMeetingId, setLatestByMeetingId] = useState<
    Record<string, MeetingChatMessage | null | undefined>
  >({});
  const [hostProfiles, setHostProfiles] = useState<Map<string, UserProfile>>(new Map());
  const [socialProfiles, setSocialProfiles] = useState<Map<string, UserProfile>>(new Map());
  const [unreadByMeetingId, setUnreadByMeetingId] = useState<Record<string, number>>({});
  const [latestBySocialRoomId, setLatestBySocialRoomId] = useState<Record<string, SocialChatMessage | null | undefined>>({});
  const [socialRoomDocById, setSocialRoomDocById] = useState<Record<string, SocialChatRoomDoc | null | undefined>>({});
  const [unreadBySocialRoomId, setUnreadBySocialRoomId] = useState<Record<string, number>>({});

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
    enabled: signedIn,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  const fetchNextMeetingsFeedPageGuarded = useCallback(async () => {
    if (!hasMoreMeetingsFeed || isFetchingMoreMeetingsFeed) return;
    await fetchNextMeetingsFeedPage();
  }, [hasMoreMeetingsFeed, isFetchingMoreMeetingsFeed, fetchNextMeetingsFeedPage]);

  const goToChatKind = useCallback(
    (k: ChatKind) => {
      setChatKind(k);
      const idx = k === 'gather' ? 0 : 1;
      requestAnimationFrame(() => {
        tabPagerRef.current?.scrollTo({ x: idx * windowWidth, animated: true });
      });
    },
    [windowWidth],
  );

  const onTabPagerMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const x = e.nativeEvent.contentOffset.x;
      const w = Math.max(1, windowWidth);
      const idx = Math.round(x / w);
      setChatKind(idx <= 0 ? 'gather' : 'social');
    },
    [windowWidth],
  );

  const handleEndReachedForKind = useCallback(
    (kind: ChatKind) => {
      if (chatKind !== kind) return;
      if (kind === 'social' && hasMoreSocialRooms) void fetchNextSocialRoomsPage();
      else if (kind === 'gather' && hasMoreMeetingsFeed) void fetchNextMeetingsFeedPageGuarded();
    },
    [chatKind, hasMoreSocialRooms, hasMoreMeetingsFeed, fetchNextSocialRoomsPage, fetchNextMeetingsFeedPageGuarded],
  );

  useEffect(() => {
    const k = chatKindRef.current;
    const idx = k === 'gather' ? 0 : 1;
    tabPagerRef.current?.scrollTo({ x: idx * windowWidth, animated: false });
  }, [windowWidth]);

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
  useEffect(() => {
    setChatSearchModalOpen(false);
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

  /** 최근 메시지 시각 기준(없으면 모임 생성일) — 최신 대화가 위로 */
  const displayedGatherMeetings = useMemo(() => {
    const list = [...gatherMeetingsFiltered];
    list.sort((a, b) => {
      const tb = latestMeetingChatMessageMs(latestByMeetingId[b.id]);
      const ta = latestMeetingChatMessageMs(latestByMeetingId[a.id]);
      if (tb !== ta) return tb - ta;
      const cb = meetingCreatedAtMs(b);
      const ca = meetingCreatedAtMs(a);
      if (cb !== ca) return cb - ca;
      return a.title.localeCompare(b.title, 'ko');
    });
    return list;
  }, [gatherMeetingsFiltered, latestByMeetingId]);

  const {
    rooms: socialRooms,
    listError: socialListError,
    refetch: refetchSocialRooms,
    fetchNextPage: fetchNextSocialRoomsPage,
    hasNextPage: hasMoreSocialRooms,
    isFetchingNextPage: isFetchingMoreSocialRooms,
    isInitialLoading: socialRoomsInitialLoading,
  } = useChatRoomsInfiniteQuery(userId, signedIn);

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
    const list = [...rows];
    list.sort((a, b) => {
      const tb = latestSocialChatMessageMs(latestBySocialRoomId[b.roomId]);
      const ta = latestSocialChatMessageMs(latestBySocialRoomId[a.roomId]);
      if (tb !== ta) return tb - ta;
      const nb = (socialProfiles.get(b.peerAppUserId)?.nickname ?? b.peerAppUserId ?? '').trim();
      const na = (socialProfiles.get(a.peerAppUserId)?.nickname ?? a.peerAppUserId ?? '').trim();
      if (nb !== na) return na.localeCompare(nb, 'ko');
      return a.roomId.localeCompare(b.roomId);
    });
    return list;
  }, [socialFriendDmRooms, appliedSocialTextQuery, socialProfiles, socialMessageMatchRoomIds, latestBySocialRoomId]);

  const chatSearchFiltersDot = useMemo(
    () =>
      chatKind === 'gather' ? appliedGatherTextQuery.trim() !== '' : appliedSocialTextQuery.trim() !== '',
    [chatKind, appliedGatherTextQuery, appliedSocialTextQuery],
  );

  useEffect(() => {
    const q = appliedGatherTextQuery.trim();
    if (!signedIn) {
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
  }, [appliedGatherTextQuery, joinedMeetingRowKey, signedIn, joinedMeetings]);

  useEffect(() => {
    const q = appliedSocialTextQuery.trim();
    if (!signedIn) {
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
  }, [appliedSocialTextQuery, socialRoomKey, signedIn, socialFriendDmRooms, socialProfiles]);

  useEffect(() => {
    if (socialFriendDmRooms.length === 0) {
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
  }, [socialRoomKey]);

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
    if (!signedIn || socialFriendDmRooms.length === 0) {
      setLatestBySocialRoomId({});
      return () => {};
    }
    const unsubs = socialFriendDmRooms.map((r) =>
      subscribeSocialChatLatestMessage(
        r.roomId,
        (msg) => setLatestBySocialRoomId((p) => ({ ...p, [r.roomId]: msg })),
        () => setLatestBySocialRoomId((p) => ({ ...p, [r.roomId]: null })),
      ),
    );
    return () => unsubs.forEach((u) => u());
  }, [signedIn, socialRoomKey]);

  useEffect(() => {
    if (!signedIn || socialFriendDmRooms.length === 0) {
      setSocialRoomDocById({});
      return () => {};
    }
    const unsubs = socialFriendDmRooms.map((r) =>
      subscribeSocialChatRoom(
        r.roomId,
        (doc) => setSocialRoomDocById((p) => ({ ...p, [r.roomId]: doc })),
        () => setSocialRoomDocById((p) => ({ ...p, [r.roomId]: null })),
      ),
    );
    return () => unsubs.forEach((u) => u());
  }, [signedIn, socialRoomKey]);

  const socialUnreadRefreshSig = useMemo(() => {
    const raw = userId?.trim() ?? '';
    const mePhone = normalizePhoneUserId(raw) ?? raw;
    const mePk = raw ? normalizeParticipantId(raw) : '';
    return socialFriendDmRooms
      .map((r) => {
        const lm = latestBySocialRoomId[r.roomId];
        const doc = socialRoomDocById[r.roomId];
        const map = doc?.readMessageIdBy ?? {};
        const read =
          map[raw] ??
          map[mePhone] ??
          (mePk ? map[mePk] : null) ??
          '';
        const ms = latestSocialChatMessageMs(lm);
        return `${r.roomId}:${(lm?.id ?? '').trim()}:${ms}:${String(read ?? '')}`;
      })
      .join('|');
  }, [socialFriendDmRooms, latestBySocialRoomId, socialRoomDocById, userId]);

  useEffect(() => {
    if (!signedIn || socialFriendDmRooms.length === 0) {
      setUnreadBySocialRoomId({});
      return;
    }
    const raw = userId?.trim() ?? '';
    const mePhone = normalizePhoneUserId(raw) ?? raw;
    const mePk = raw ? normalizeParticipantId(raw) : '';
    let cancelled = false;
    void (async () => {
      const next: Record<string, number> = {};
      for (const r of socialFriendDmRooms) {
        if (cancelled) return;
        const doc = socialRoomDocById[r.roomId];
        const readMap = doc?.readMessageIdBy ?? {};
        const atMap = doc?.readAtBy ?? {};
        const readId =
          readMap[raw] ??
          readMap[mePhone] ??
          (mePk ? readMap[mePk] : null) ??
          null;
        const readAt =
          atMap[raw] ??
          atMap[mePhone] ??
          (mePk ? atMap[mePk] : null) ??
          null;
        try {
          next[r.roomId] = await fetchSocialChatUnreadCount(r.roomId, raw, readId, readAt, { maxDocsScanned: 600 });
        } catch {
          next[r.roomId] = 0;
        }
      }
      if (!cancelled) setUnreadBySocialRoomId(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [signedIn, socialUnreadRefreshSig]);

  useEffect(() => {
    if (!signedIn || joinedMeetings.length === 0) {
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
        const readForCount =
          (readId || '').trim() || (latestByMeetingId[m.id]?.id ?? '').trim() || null;
        try {
          next[m.id] = await fetchMeetingChatUnreadCount(m.id, readForCount);
        } catch {
          next[m.id] = 0;
        }
      }
      if (!cancelled) setUnreadByMeetingId(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [signedIn, unreadRefreshSig]);

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

  const gatherListFooter = useMemo(() => {
    if (!showMeetingsFeedFooterSpinner || refreshing) return null;
    return (
      <View style={styles.listFooterSpinner} accessibilityLabel="모임 목록 로딩">
        <ActivityIndicator color={GinitTheme.colors.primary} />
      </View>
    );
  }, [showMeetingsFeedFooterSpinner, refreshing]);

  const socialListFooter = useMemo(() => {
    if (!isFetchingMoreSocialRooms && !(socialRoomsInitialLoading && socialRooms.length === 0)) return null;
    return (
      <View style={styles.listFooterSpinner} accessibilityLabel="채팅방 목록 로딩">
        <ActivityIndicator color={GinitTheme.colors.primary} />
      </View>
    );
  }, [isFetchingMoreSocialRooms, socialRoomsInitialLoading, socialRooms.length]);

  const chatListEmptyCentered = useCallback(
    (
      icon: SymbolicIconName,
      title: string,
      body: string,
    ): ReactElement => (
      <View style={[styles.chatListEmptyFill, { minHeight: chatEmptyMinHeight }]}>
        <View style={styles.chatListEmptyInner}>
          <View style={styles.chatListEmptyIconCircle}>
            <GinitSymbolicIcon name={icon} size={34} color={GinitTheme.colors.primary} />
          </View>
          <Text style={styles.chatListEmptyTitle}>{title}</Text>
          <Text style={styles.chatListEmptyBody}>{body}</Text>
        </View>
      </View>
    ),
    [chatEmptyMinHeight],
  );

  const fixedChatHeader = (
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
            <GinitSymbolicIcon name="search-outline" size={22} color="#0f172a" />
            {chatSearchFiltersDot ? <View style={styles.searchFilterDot} /> : null}
          </Pressable>
        </View>
      </View>

      <View style={styles.tabCategoryBar} accessibilityRole="tablist">
        <View style={styles.tabPair}>
          <Pressable
            onPress={() => goToChatKind('gather')}
            style={({ pressed }) => [
              styles.chatTopChip,
              chatKind === 'gather' && styles.chatTopChipActive,
              pressed && styles.chatTopChipPressed,
              { maxWidth: tabChipMaxWidth },
            ]}
            accessibilityRole="tab"
            accessibilityState={{ selected: chatKind === 'gather' }}
            accessibilityLabel="모임">
            <Text
              style={[styles.chatTopChipLabel, chatKind === 'gather' && styles.chatTopChipLabelActive]}
              numberOfLines={1}>
              모임
            </Text>
          </Pressable>
          <Pressable
            onPress={() => goToChatKind('social')}
            style={({ pressed }) => [
              styles.chatTopChip,
              chatKind === 'social' && styles.chatTopChipActive,
              pressed && styles.chatTopChipPressed,
              { maxWidth: tabChipMaxWidth },
            ]}
            accessibilityRole="tab"
            accessibilityState={{ selected: chatKind === 'social' }}
            accessibilityLabel="친구">
            <Text
              style={[styles.chatTopChipLabel, chatKind === 'social' && styles.chatTopChipLabelActive]}
              numberOfLines={1}>
              친구
            </Text>
          </Pressable>
        </View>
        <View style={styles.categoryDropdownSpacer} pointerEvents="none" />
      </View>
    </View>
  );

  const chatTabListAlerts = (kind: ChatKind): ReactElement => (
    <>
      {kind === 'gather' && meetingsFeedInitialLoading && meetings.length === 0 ? (
        <View style={styles.centerRow}>
          <ActivityIndicator color={GinitTheme.colors.primary} />
          <Text style={styles.muted}>불러오는 중…</Text>
        </View>
      ) : null}

      {kind === 'gather' && gatherListError ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorTitle}>목록을 불러오지 못했어요</Text>
          <Text style={styles.errorBody}>{gatherListError}</Text>
        </View>
      ) : null}

      {kind === 'social' && socialListError ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorTitle}>Social 목록 오류</Text>
          <Text style={styles.errorBody}>{socialListError}</Text>
        </View>
      ) : null}

      {signedIn && kind === 'gather' && appliedGatherTextQuery.trim() !== '' && gatherSearchBusy ? (
        <View style={styles.centerRow}>
          <ActivityIndicator color={GinitTheme.colors.primary} />
          <Text style={styles.muted}>대화에서 검색하는 중…</Text>
        </View>
      ) : null}

      {signedIn && kind === 'social' && appliedSocialTextQuery.trim() !== '' && socialSearchBusy ? (
        <View style={styles.centerRow}>
          <ActivityIndicator color={GinitTheme.colors.primary} />
          <Text style={styles.muted}>대화에서 검색하는 중…</Text>
        </View>
      ) : null}

      {!signedIn &&
      (kind === 'gather'
        ? !(meetingsFeedInitialLoading && meetings.length === 0) && !gatherListError
        : !(socialRoomsInitialLoading && socialRooms.length === 0) && !socialListError)
        ? chatListEmptyCentered(
            'chatbubbles-outline',
            '채팅 목록',
            '로그인하면 참여 중인 대화가 여기에 표시돼요.',
          )
        : null}

      {kind === 'gather' &&
      !(meetingsFeedInitialLoading && meetings.length === 0) &&
      !gatherListError &&
      signedIn &&
      joinedMeetings.length === 0
        ? chatListEmptyCentered(
            'people-outline',
            '참여 중인 모임이 없어요',
            '홈에서 모임에 참여하면 모임 채팅이 여기에 모여요.',
          )
        : null}

      {kind === 'social' &&
      !(socialRoomsInitialLoading && socialRooms.length === 0) &&
      !socialListError &&
      signedIn &&
      socialFriendDmRooms.length === 0
        ? chatListEmptyCentered(
            'person-outline',
            '1:1 친구 채팅이 없어요',
            '친구를 맺고 나면 대화방이 여기에 표시돼요.',
          )
        : null}

      {kind === 'gather' &&
      !(meetingsFeedInitialLoading && meetings.length === 0) &&
      !gatherListError &&
      signedIn &&
      !gatherSearchBusy &&
      joinedMeetings.length > 0 &&
      displayedGatherMeetings.length === 0
        ? chatListEmptyCentered(
            'search-outline',
            '검색 결과가 없어요',
            '다른 단어로 찾아 보시거나, 상단 검색을 열어 조건을 바꿔 보세요.',
          )
        : null}

      {kind === 'social' &&
      !(socialRoomsInitialLoading && socialRooms.length === 0) &&
      !socialListError &&
      signedIn &&
      !socialSearchBusy &&
      socialFriendDmRooms.length > 0 &&
      displayedSocialRooms.length === 0
        ? chatListEmptyCentered(
            'search-outline',
            '검색 결과가 없어요',
            '다른 단어로 찾아 보시거나, 상단 검색을 열어 조건을 바꿔 보세요.',
          )
        : null}
    </>
  );

  return (
    <ScreenShell padded={false} style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.feedColumn}>
          {fixedChatHeader}
          <ScrollView
            ref={tabPagerRef}
            horizontal
            pagingEnabled
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={onTabPagerMomentumEnd}
            style={styles.tabPager}>
            <View style={[styles.tabPage, { width: windowWidth }]}>
              <FlatList<Meeting>
                data={displayedGatherMeetings}
                extraData={{
                  chatKind,
                  appliedGatherTextQuery,
                  gatherSearchBusy,
                  gatherMsgHits: gatherMessageMatchIds.size,
                  latestByMeetingId,
                  unreadByMeetingId,
                  hostProfiles,
                }}
                keyExtractor={(m) => m.id}
                style={styles.listFlex}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.scroll}
                nestedScrollEnabled
                refreshControl={
                  <RefreshControl
                    refreshing={refreshing}
                    onRefresh={onPullRefresh}
                    tintColor={GinitTheme.colors.primary}
                    colors={[GinitTheme.colors.primary]}
                  />
                }
                ListHeaderComponent={chatTabListAlerts('gather')}
                ListFooterComponent={chatKind === 'gather' ? gatherListFooter : null}
                onEndReached={() => handleEndReachedForKind('gather')}
                onEndReachedThreshold={0.6}
                renderItem={({ item: m }) => {
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
                }}
              />
            </View>
            <View style={[styles.tabPage, { width: windowWidth }]}>
              <FlatList<SocialChatRoomSummary>
                data={displayedSocialRooms}
                extraData={{
                  chatKind,
                  appliedSocialTextQuery,
                  socialSearchBusy,
                  socialMsgHits: socialMessageMatchRoomIds.size,
                  socialProfiles,
                }}
                keyExtractor={(row) => row.roomId}
                style={styles.listFlex}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.scroll}
                nestedScrollEnabled
                refreshControl={
                  <RefreshControl
                    refreshing={refreshing}
                    onRefresh={onPullRefresh}
                    tintColor={GinitTheme.colors.primary}
                    colors={[GinitTheme.colors.primary]}
                  />
                }
                ListHeaderComponent={chatTabListAlerts('social')}
                ListFooterComponent={chatKind === 'social' ? socialListFooter : null}
                onEndReached={() => handleEndReachedForKind('social')}
                onEndReachedThreshold={0.6}
                renderItem={({ item: row }) => {
                  const prof = socialProfiles.get(row.peerAppUserId);
                  const uri = prof?.photoUrl?.trim();
                  const nick = prof?.nickname ?? '친구';
                  const rid = userId?.trim() ? socialDmRoomId(userId.trim(), row.peerAppUserId) : row.roomId;
                  const latest = latestBySocialRoomId[row.roomId];
                  const hasMessage = latest != null;
                  const loadingPreview = latest === undefined;
                  const preview = hasMessage ? socialDmPreviewLine(latest) : '대화를 시작해 보세요.';
                  const rightTime = hasMessage ? formatRightTimeFromMs(latestSocialChatMessageMs(latest)) : '';
                  const unread = unreadBySocialRoomId[row.roomId] ?? 0;
                  return (
                    <Pressable
                      onPress={() =>
                        router.push(`/social-chat/${encodeURIComponent(rid)}?peerName=${encodeURIComponent(nick)}`)
                      }
                      accessibilityRole="button"
                      accessibilityLabel={`${nick}와 채팅`}
                      style={({ pressed }) => [styles.chatPressableRow, pressed && styles.chatPressablePressed]}>
                      <View style={styles.socialZoneA}>
                        <View style={styles.socialSymbolCol}>
                          <View style={styles.socialAvatarBubble}>
                            <View style={styles.socialAvatarMedia}>
                              {uri ? (
                                <Image source={{ uri }} style={styles.socialAvatarImg} contentFit="cover" />
                              ) : (
                                <View style={styles.socialAvatarFallback}>
                                  <Text style={styles.socialAvatarLetter}>{nick.slice(0, 1)}</Text>
                                </View>
                              )}
                            </View>
                          </View>
                        </View>
                        <View style={styles.socialZoneMain}>
                          <View style={styles.socialTitleRow}>
                            <View style={styles.socialTitleBlock}>
                              <Text style={styles.socialHeroTitle} numberOfLines={1}>
                                {nick}
                              </Text>
                              <Text style={styles.socialMetaMuted} numberOfLines={1}>
                                친구 채팅
                              </Text>
                            </View>
                            {rightTime || unread > 0 ? (
                              <View style={styles.socialTimeColumn}>
                                {rightTime ? (
                                  <Text style={styles.socialTimeRight} numberOfLines={1}>
                                    {rightTime}
                                  </Text>
                                ) : null}
                                {unread > 0 ? (
                                  <View
                                    style={[styles.socialUnreadBadge, !rightTime && styles.socialUnreadBadgeSolo]}
                                    accessibilityLabel={`읽지 않은 메시지 ${unread > 99 ? '99개 이상' : `${unread}개`}`}>
                                    <Text style={styles.socialUnreadBadgeText}>{unread > 99 ? '99+' : String(unread)}</Text>
                                  </View>
                                ) : null}
                              </View>
                            ) : null}
                          </View>
                          <Text style={styles.socialPreviewLine} numberOfLines={2}>
                            {loadingPreview ? '불러오는 중…' : preview}
                          </Text>
                        </View>
                      </View>
                    </Pressable>
                  );
                }}
              />
            </View>
          </ScrollView>
        </View>

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
      </SafeAreaView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: GinitTheme.colors.bg },
  safe: { flex: 1 },
  feedColumn: { flex: 1 },
  tabPager: { flex: 1 },
  tabPage: { flex: 1 },
  listFlex: { flex: 1 },
  scroll: {
    paddingHorizontal: 20,
    paddingBottom: 28,
    flexGrow: 1,
  },
  chatPressableRow: {
    paddingVertical: 10,
  },
  chatPressablePressed: {
    opacity: 0.86,
  },
  feedHeader: {
    marginBottom: 16,
    paddingTop: 12,
    paddingHorizontal: 20,
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
    color: GinitTheme.colors.text,
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
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#0f172a',
    marginBottom: 6,
  },
  modalHint: {
    fontSize: 13,
    lineHeight: 18,
    color: '#64748b',
    marginBottom: 16,
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
    color: GinitTheme.themeMainColor,
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
    fontWeight: '600',
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
    fontWeight: '600',
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
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
    opacity: 0,
  },
  chatTopChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.75)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.34)',
    flexShrink: 1,
  },
  chatTopChipActive: {
    backgroundColor: GinitTheme.themeMainColor,
    borderColor: GinitTheme.themeMainColor,
  },
  chatTopChipPressed: {
    opacity: 0.88,
  },
  chatTopChipLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#475569',
  },
  chatTopChipLabelActive: {
    color: '#fff',
  },
  socialZoneA: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  socialSymbolCol: {
    flexShrink: 0,
    alignItems: 'center',
    paddingTop: 1,
  },
  socialAvatarBubble: {
    width: 52,
    height: 52,
    borderRadius: 19,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
    backgroundColor: GinitTheme.colors.surfaceStrong,
  },
  socialAvatarMedia: {
    ...StyleSheet.absoluteFillObject,
  },
  socialAvatarImg: {
    width: '100%',
    height: '100%',
  },
  socialAvatarFallback: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 82, 204, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  socialAvatarLetter: { fontSize: 21, fontWeight: '600', color: GinitTheme.themeMainColor },
  socialZoneMain: {
    flex: 1,
    minWidth: 0,
    gap: 2,
    paddingTop: 1,
  },
  socialHeroTitle: {
    fontSize: 15,
    fontWeight: '600',
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
  socialTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  socialTitleBlock: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  socialTimeColumn: {
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
    gap: 6,
    paddingTop: 1,
  },
  socialTimeRight: {
    fontSize: 11,
    fontWeight: '700',
    color: GinitTheme.colors.textMuted,
    letterSpacing: -0.12,
  },
  socialUnreadBadge: {
    marginTop: 2,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-end',
    backgroundColor: '#EF4444',
  },
  socialUnreadBadgeSolo: {
    marginTop: 1,
  },
  socialUnreadBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  socialPreviewLine: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '400',
    letterSpacing: -0.1,
    color: GinitTheme.colors.textMuted,
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
    fontWeight: '600',
    color: '#B91C1C',
    marginBottom: 6,
  },
  errorBody: {
    fontSize: 14,
    color: '#7F1D1D',
    lineHeight: 20,
  },
  chatListEmptyFill: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: GinitTheme.spacing.xl,
    paddingVertical: GinitTheme.spacing.lg,
  },
  chatListEmptyInner: {
    alignItems: 'center',
    maxWidth: 300,
  },
  chatListEmptyIconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: GinitTheme.colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: GinitTheme.spacing.lg,
  },
  chatListEmptyTitle: {
    ...GinitTheme.typography.title,
    color: GinitTheme.colors.text,
    textAlign: 'center',
    marginBottom: GinitTheme.spacing.sm,
  },
  chatListEmptyBody: {
    ...GinitTheme.typography.body,
    lineHeight: 22,
    color: GinitTheme.colors.textSub,
    textAlign: 'center',
  },
  listFooterSpinner: {
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
