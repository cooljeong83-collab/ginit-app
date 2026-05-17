import { GinitPressable } from '@/components/ui/GinitPressable';

import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { ActivityIndicator, Modal, RefreshControl, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useQueryClient } from '@tanstack/react-query';

import { Image } from 'expo-image';

import { ChatMeetingListRow } from '@/components/chat/ChatMeetingListRow';
import { ScreenShell, ScreenTransitionSkeleton } from '@/components/ui';
import { GinitSymbolicIcon, type SymbolicIconName } from '@/components/ui/GinitSymbolicIcon';
import { GinitTheme } from '@/constants/ginit-theme';
import { useMeetingCategories } from '@/src/context/MeetingCategoriesContext';
import { useUserSession } from '@/src/context/UserSessionContext';
import { useChatRoomListEngine } from '@/src/hooks/useChatRoomListEngine';
import { useChatRoomsInfiniteQuery } from '@/src/hooks/use-chat-rooms-infinite-query';
import { useMeetingsFeedInfiniteQuery } from '@/src/hooks/use-meetings-feed-infinite-query';
import { useMeetingsTableRealtimeDeferred } from '@/src/hooks/use-meetings-table-realtime-deferred';
import { useMyMeetingsFeedSync } from '@/src/hooks/use-my-meetings-feed-sync';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { formatDateWithKoWeekday } from '@/src/lib/date-display';
import { resolveFeedLocationContextWithoutPermissionPrompt } from '@/src/lib/feed-display-location';
import { meetingCreatedAtMs } from '@/src/lib/feed-meeting-utils';
import type { LatLng } from '@/src/lib/geo-distance';
import { filterJoinedMeetings, isUserJoinedMeeting } from '@/src/lib/joined-meetings';
import { runMeetingsUserActionDeltaSync } from '@/src/lib/meeting-sync-service';
import { useTransitionRouter } from '@/src/lib/screen-transition-navigation';
import type { MeetingChatMessage } from '@/src/lib/meeting-chat';
import {
  searchMeetingChatMessages,
} from '@/src/lib/meeting-chat';
import { sweepStalePublicUnconfirmedMeetingsForHost } from '@/src/lib/meeting-expiry-sweep';
import type { Meeting } from '@/src/lib/meetings';
import { normalizePhoneUserId } from '@/src/lib/phone-user-id';
import {
  searchSocialChatMessages,
  isValidSocialDmPeerForViewer,
  resolveSocialDmRoomIdForViewer,
  socialMessageTimeMs,
  type SocialChatMessage,
  type SocialChatRoomSummary,
} from '@/src/lib/social-chat-rooms';
import type { UserProfile } from '@/src/lib/user-profile';
import { getUserProfilesForIds, isUserProfileWithdrawn } from '@/src/lib/user-profile';
import {
  consumeIncomingDirectSharePayload,
  peekIncomingDirectSharePayload,
  setPendingDirectSharePayload,
} from '@/src/lib/direct-share-store';
import { ginitNotifyDbg } from '@/src/lib/ginit-notify-debug';
import {
  firestoreTimeToMs,
  meetingMessageFromLocalRoom,
  socialListLastMessageMs,
  socialListPreviewFromLocalRoom,
  socialMessageFromLocalRoom,
  upsertLocalChatRoomReadState,
  upsertLocalChatRoomSummary,
  type LocalChatRoomSummary,
} from '@/src/lib/offline-chat/offline-chat-rooms';

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

function coalesceUnreadCountByKeys(
  map: Record<string, number | null | undefined> | null | undefined,
  keys: (string | null | undefined)[],
): number {
  if (!map) return 0;
  for (const k of keys) {
    const key = String(k ?? '').trim();
    if (!key) continue;
    const v = map[key];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  }
  return 0;
}

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

function gatherMeetingHasConversation(
  meetingId: string,
  effectiveLatestById: Record<string, MeetingChatMessage | null | undefined>,
  rowById: Map<string, LocalChatRoomSummary>,
): boolean {
  const latest = effectiveLatestById[meetingId];
  if (latest != null && latestMeetingChatMessageMs(latest) > 0) return true;
  const loc = rowById.get(meetingId);
  return Boolean(loc?.lastMessageId?.trim() && loc.lastMessageAtMs && loc.lastMessageAtMs > 0);
}

/** 모임 채팅 목록 정렬: 실제 마지막 메시지 시각만 사용(미읽음·participant 갱신만으로는 위로 올리지 않음). */
function gatherMeetingConversationSortMs(
  meetingId: string,
  effectiveLatestById: Record<string, MeetingChatMessage | null | undefined>,
  rowById: Map<string, LocalChatRoomSummary>,
): number {
  const msgMs = latestMeetingChatMessageMs(effectiveLatestById[meetingId]);
  if (msgMs > 0) return msgMs;
  const loc = rowById.get(meetingId);
  const lm = typeof loc?.lastMessageAtMs === 'number' && Number.isFinite(loc.lastMessageAtMs) ? loc.lastMessageAtMs : 0;
  return lm > 0 ? lm : 0;
}

/** `chat_room_participants` Realtime만 오고 마지막 메시지 스텁이 없을 때도 목록 순서가 움직이게 함(웹훅 `unread_update` 없을 때 대비). */
function gatherMeetingListActivityMs(
  meetingId: string,
  effectiveLatestById: Record<string, MeetingChatMessage | null | undefined>,
  rowById: Map<string, LocalChatRoomSummary>,
): number {
  const conv = gatherMeetingConversationSortMs(meetingId, effectiveLatestById, rowById);
  if (conv > 0) return conv;
  const loc = rowById.get(meetingId);
  if (!loc) return 0;
  const ur = typeof loc.unreadLastAtMs === 'number' && Number.isFinite(loc.unreadLastAtMs) ? loc.unreadLastAtMs : 0;
  const ru = typeof loc.remoteUpdatedAtMs === 'number' && Number.isFinite(loc.remoteUpdatedAtMs) ? loc.remoteUpdatedAtMs : 0;
  return Math.max(ur, ru);
}

function latestSocialChatMessageMs(msg: SocialChatMessage | null | undefined): number {
  return socialMessageTimeMs(msg);
}

/** 친구 탭 목록: 실제 메시지가 있는 1:1 DM만 표시 */
function socialRoomHasConversation(
  roomId: string,
  effectiveLatestById: Record<string, SocialChatMessage | null | undefined>,
  rowById: Map<string, LocalChatRoomSummary>,
): boolean {
  const latest = effectiveLatestById[roomId];
  if (latest != null && latestSocialChatMessageMs(latest) > 0) return true;
  const loc = rowById.get(roomId);
  return Boolean(loc?.lastMessageId?.trim() && loc.lastMessageAtMs && loc.lastMessageAtMs > 0);
}

function socialRoomListActivityMs(
  roomId: string,
  effectiveLatestById: Record<string, SocialChatMessage | null | undefined>,
  rowById: Map<string, LocalChatRoomSummary>,
): number {
  const msgMs = latestSocialChatMessageMs(effectiveLatestById[roomId]);
  if (msgMs > 0) return msgMs;
  const loc = rowById.get(roomId);
  if (!loc) return 0;
  const ur = typeof loc.unreadLastAtMs === 'number' && Number.isFinite(loc.unreadLastAtMs) ? loc.unreadLastAtMs : 0;
  const ru = typeof loc.remoteUpdatedAtMs === 'number' && Number.isFinite(loc.remoteUpdatedAtMs) ? loc.remoteUpdatedAtMs : 0;
  const lm = typeof loc.lastMessageAtMs === 'number' && Number.isFinite(loc.lastMessageAtMs) ? loc.lastMessageAtMs : 0;
  return Math.max(ur, ru, lm);
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
  return formatDateWithKoWeekday(d);
}

function meetingTextSearchHaystack(m: Meeting): string {
  return [m.title, m.description, m.categoryLabel, m.location, m.placeName, m.address ?? '']
    .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
    .join(' ')
    .toLowerCase();
}

export default function ChatTab() {
  const router = useTransitionRouter();
  const queryClient = useQueryClient();
  const [directSharePickMode, setDirectSharePickMode] = useState(false);
  const { userId } = useUserSession();
  const { categories: meetingCategories } = useMeetingCategories();
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
  const gatherListRef = useRef<FlashListRef<Meeting> | null>(null);
  const socialListRef = useRef<FlashListRef<SocialChatRoomSummary> | null>(null);
  const didInitialFocusTopResetRef = useRef(false);
  const didGatherInitialTopResetRef = useRef(false);
  const didSocialInitialTopResetRef = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hostProfiles, setHostProfiles] = useState<Map<string, UserProfile>>(new Map());
  const [socialProfiles, setSocialProfiles] = useState<Map<string, UserProfile>>(new Map());

  const signedIn = Boolean(userId?.trim());
  const scrollGatherListToTop = useCallback(() => {
    requestAnimationFrame(() => {
      gatherListRef.current?.scrollToOffset({ offset: 0, animated: false, skipFirstItemOffset: true });
    });
  }, []);
  const scrollSocialListToTop = useCallback(() => {
    requestAnimationFrame(() => {
      socialListRef.current?.scrollToOffset({ offset: 0, animated: false, skipFirstItemOffset: true });
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (didInitialFocusTopResetRef.current) return;
      didInitialFocusTopResetRef.current = true;
      scrollGatherListToTop();
      scrollSocialListToTop();
    }, [scrollGatherListToTop, scrollSocialListToTop]),
  );

  useEffect(() => {
    // If we have an incoming share without a chosen room, guide user to pick.
    const incoming = peekIncomingDirectSharePayload();
    if (!incoming) return;
    if (!signedIn) return;
    ginitNotifyDbg('direct-share', 'pick_mode_on', {
      kind: incoming.kind,
      imageUriPrefix: incoming.kind === 'image' ? String(incoming.imageUri ?? '').slice(0, 28) : '',
      textLen: incoming.kind === 'text' ? incoming.text.length : (incoming.text?.length ?? 0),
    });
    setDirectSharePickMode(true);
  }, [signedIn]);

  const {
    meetings,
    listError: gatherListError,
    fetchNextPage: fetchNextMeetingsFeedPage,
    hasNextPage: hasMoreMeetingsFeed,
    isFetchingNextPage: isFetchingMoreMeetingsFeed,
    showFooterSpinner: showMeetingsFeedFooterSpinner,
    isInitialListLoading: meetingsFeedInitialLoading,
  } = useMeetingsFeedInfiniteQuery({
    enabled: signedIn,
    refetchOnWindowFocus: false,
  });

  /** Supabase: 공개 피드에 없는 비공개·내 모임을 홈 탭과 동일 RPC로 보강 */
  const {
    meetings: myMeetings,
    isInitialLoading: myMeetingsInitialLoading,
  } = useMyMeetingsFeedSync({
    enabled: signedIn,
    userId,
  });

  useMeetingsTableRealtimeDeferred({ enabled: signedIn, viewerUserId: userId });

  /** 공개 피드가 비어 있을 때는 내 모임 RPC까지 끝나야 빈 화면 판단(비공개만 참여 중인 경우) */
  const gatherListStillLoading = useMemo(
    () =>
      (meetingsFeedInitialLoading && meetings.length === 0) ||
      (myMeetingsInitialLoading && meetings.length === 0),
    [
      meetingsFeedInitialLoading,
      meetings.length,
      myMeetingsInitialLoading,
    ],
  );

  const mergedMeetingsForChat = useMemo(() => {
    if (myMeetings.length === 0) return meetings;
    const uid = userId?.trim() ?? '';
    const myMeetingsForChat = uid
      ? myMeetings.map((m) =>
          isUserJoinedMeeting(m, uid)
            ? m
            : {
                ...m,
                participantIds: [...(m.participantIds ?? []), uid],
              },
        )
      : myMeetings;
    const seen = new Set<string>();
    const out: Meeting[] = [];
    for (const m of meetings) {
      if (!m?.id) continue;
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      out.push(m);
    }
    for (const m of myMeetingsForChat) {
      if (!m?.id) continue;
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      out.push(m);
    }
    return out;
  }, [meetings, myMeetings, userId]);

  const fetchNextMeetingsFeedPageGuarded = useCallback(async () => {
    if (!hasMoreMeetingsFeed || isFetchingMoreMeetingsFeed) return;
    await fetchNextMeetingsFeedPage();
  }, [hasMoreMeetingsFeed, isFetchingMoreMeetingsFeed, fetchNextMeetingsFeedPage]);

  const goToChatKind = useCallback((k: ChatKind) => {
    setChatKind(k);
    requestAnimationFrame(() => {
      if (k === 'gather') scrollGatherListToTop();
      else scrollSocialListToTop();
    });
  }, [scrollGatherListToTop, scrollSocialListToTop]);

  useEffect(() => {
    const uid = userId?.trim();
    if (!uid || mergedMeetingsForChat.length === 0) return;
    void sweepStalePublicUnconfirmedMeetingsForHost(uid, mergedMeetingsForChat);
  }, [userId, mergedMeetingsForChat]);

  const joinedMeetings = useMemo(
    () => filterJoinedMeetings(mergedMeetingsForChat, userId),
    [mergedMeetingsForChat, userId],
  );
  const localMeetingRoomSummaries = useChatRoomListEngine({
    roomType: 'meeting',
    ownerUserId: userId,
    enabled: signedIn,
  });
  const localMeetingRoomById = useMemo(() => {
    const map = new Map<string, LocalChatRoomSummary>();
    for (const row of localMeetingRoomSummaries) {
      if (row.roomId.trim()) map.set(row.roomId, row);
    }
    return map;
  }, [localMeetingRoomSummaries]);

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
      const ctx = await resolveFeedLocationContextWithoutPermissionPrompt();
      if (cancelled) return;
      setUserCoords(ctx.coords);
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

  const effectiveLatestByMeetingId = useMemo(() => {
    const out: Record<string, MeetingChatMessage | null | undefined> = {};
    for (const row of localMeetingRoomSummaries) {
      const m = meetingMessageFromLocalRoom(row);
      if (m) out[row.roomId] = m;
    }
    return out;
  }, [localMeetingRoomSummaries]);

  /** 대화 있는 방 → 최근 메시지순 상단, 대화 없는 방 → 하단(모임 생성일순) */
  const displayedGatherMeetings = useMemo(() => {
    const list = [...gatherMeetingsFiltered];
    list.sort((a, b) => {
      const hasA = gatherMeetingHasConversation(a.id, effectiveLatestByMeetingId, localMeetingRoomById);
      const hasB = gatherMeetingHasConversation(b.id, effectiveLatestByMeetingId, localMeetingRoomById);
      if (hasA !== hasB) return hasA ? -1 : 1;

      if (hasA && hasB) {
        const tb = gatherMeetingConversationSortMs(b.id, effectiveLatestByMeetingId, localMeetingRoomById);
        const ta = gatherMeetingConversationSortMs(a.id, effectiveLatestByMeetingId, localMeetingRoomById);
        if (tb !== ta) return tb - ta;
        return a.title.localeCompare(b.title, 'ko');
      }

      const cb = meetingCreatedAtMs(b);
      const ca = meetingCreatedAtMs(a);
      if (cb !== ca) return cb - ca;
      return a.title.localeCompare(b.title, 'ko');
    });
    return list;
  }, [gatherMeetingsFiltered, effectiveLatestByMeetingId, localMeetingRoomById]);

  const {
    rooms: socialRooms,
    listError: socialListError,
    syncChangedRooms: syncChangedSocialRooms,
    listRenderRev: socialListRenderRev,
    isFetchingNextPage: isFetchingMoreSocialRooms,
    isInitialLoading: socialRoomsInitialLoading,
  } = useChatRoomsInfiniteQuery(userId, signedIn);

  const handleEndReachedForKind = useCallback(
    (kind: ChatKind) => {
      if (chatKind !== kind) return;
      if (kind === 'social') return;
      if (kind === 'gather' && hasMoreMeetingsFeed) void fetchNextMeetingsFeedPageGuarded();
    },
    [chatKind, hasMoreMeetingsFeed, fetchNextMeetingsFeedPageGuarded],
  );

  /** 친구 탭: `social_` 1:1 DM만 표시(그룹·기타 룸 제외) */
  const socialFriendDmRooms = useMemo(
    () => socialRooms.filter((r) => r.roomId.trim().startsWith('social_')),
    [socialRooms],
  );
  const localSocialRoomById = useMemo(() => {
    const map = new Map<string, LocalChatRoomSummary>();
    for (const row of socialRooms) {
      map.set(row.roomId, row as LocalChatRoomSummary);
    }
    return map;
  }, [socialRooms]);
  const effectiveLatestBySocialRoomId = useMemo(() => {
    const out: Record<string, SocialChatMessage | null | undefined> = {};
    for (const row of socialRooms) {
      const loc = row as LocalChatRoomSummary;
      const m = socialMessageFromLocalRoom(loc);
      out[row.roomId] = m ?? null;
    }
    return out;
  }, [socialRooms]);

  const joinedMeetingRowKey = useMemo(() => joinedMeetings.map((m) => m.id).join('\u0001'), [joinedMeetings]);

  const socialRoomKey = useMemo(() => socialFriendDmRooms.map((r) => r.roomId).join('\u0001'), [socialFriendDmRooms]);

  /** FlashList는 `data` 행 참조만으로는 셀 재사용 시 미읽음·순서 갱신을 놓칠 수 있어 시그니처를 넘깁니다. */
  const socialDmListFlashKey = useMemo(
    () =>
      socialFriendDmRooms
        .map(
          (r) =>
            `${r.roomId}:${r.unreadCount ?? 0}:${r.lastMessageAtMs ?? 0}:${r.remoteUpdatedAtMs ?? 0}:${
              (r as LocalChatRoomSummary).lastMessagePreview ?? ''
            }`,
        )
        .join('\u0001'),
    [socialFriendDmRooms],
  );

  /** gather: `data`는 Meeting(TanStack)이라 행 참조가 그대로일 때 FlashList가 미읽음·프리뷰 갱신을 건너뛰기 쉬움 */
  const gatherChatListFlashKey = useMemo(
    () =>
      joinedMeetings
        .map((m) => {
          const loc = localMeetingRoomById.get(m.id);
          return `${m.id}:${loc?.unreadCount ?? 0}:${loc?.lastMessageAtMs ?? 0}:${loc?.remoteUpdatedAtMs ?? 0}:${
            (loc?.lastMessagePreview ?? '').slice(0, 48)
          }`;
        })
        .join('\u0001'),
    [joinedMeetings, localMeetingRoomById],
  );

  const gatherTabUnreadTotal = useMemo(() => {
    return joinedMeetings.reduce((sum, m) => {
      const loc = localMeetingRoomById.get(m.id);
      return sum + (loc?.unreadCount ?? 0);
    }, 0);
  }, [joinedMeetings, localMeetingRoomById]);

  const socialTabUnreadTotal = useMemo(() => {
    return socialFriendDmRooms.reduce((sum, r) => {
      const loc = localSocialRoomById.get(r.roomId);
      return sum + (loc?.unreadCount ?? 0);
    }, 0);
  }, [socialFriendDmRooms, localSocialRoomById]);

  const displayedSocialRooms = useMemo(() => {
    const me = userId?.trim() ?? '';
    let rows = socialFriendDmRooms.filter(
      (r) =>
        (!me || isValidSocialDmPeerForViewer(me, r.peerAppUserId)) &&
        socialRoomHasConversation(r.roomId, effectiveLatestBySocialRoomId, localSocialRoomById),
    );
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
      const tb = socialRoomListActivityMs(b.roomId, effectiveLatestBySocialRoomId, localSocialRoomById);
      const ta = socialRoomListActivityMs(a.roomId, effectiveLatestBySocialRoomId, localSocialRoomById);
      if (tb !== ta) return tb - ta;
      const nb = (socialProfiles.get(b.peerAppUserId)?.nickname ?? b.peerAppUserId ?? '').trim();
      const na = (socialProfiles.get(a.peerAppUserId)?.nickname ?? a.peerAppUserId ?? '').trim();
      if (nb !== na) return na.localeCompare(nb, 'ko');
      return a.roomId.localeCompare(b.roomId);
    });
    return list;
  }, [
    socialFriendDmRooms,
    userId,
    appliedSocialTextQuery,
    socialProfiles,
    socialMessageMatchRoomIds,
    effectiveLatestBySocialRoomId,
    localSocialRoomById,
  ]);

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
        await syncChangedSocialRooms({ pullTail: true });
      } else {
        await runMeetingsUserActionDeltaSync(queryClient, userId?.trim() ?? null, 'pull_refresh');
      }
    } finally {
      setRefreshing(false);
    }
  }, [chatKind, syncChangedSocialRooms, queryClient, userId]);

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
    if (!isFetchingMoreSocialRooms) return null;
    return (
      <View style={styles.listFooterSpinner} accessibilityLabel="채팅방 목록 로딩">
        <ActivityIndicator color={GinitTheme.colors.primary} />
      </View>
    );
  }, [isFetchingMoreSocialRooms]);

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
  const showGatherInitialSkeleton = gatherListStillLoading && displayedGatherMeetings.length === 0;
  const showSocialInitialSkeleton = socialRoomsInitialLoading && socialRooms.length === 0;

  useEffect(() => {
    if (showGatherInitialSkeleton) {
      didGatherInitialTopResetRef.current = false;
      return;
    }
    if (displayedGatherMeetings.length === 0 || didGatherInitialTopResetRef.current) return;
    didGatherInitialTopResetRef.current = true;
    scrollGatherListToTop();
  }, [displayedGatherMeetings.length, scrollGatherListToTop, showGatherInitialSkeleton]);

  useEffect(() => {
    if (showSocialInitialSkeleton) {
      didSocialInitialTopResetRef.current = false;
      return;
    }
    if (displayedSocialRooms.length === 0 || didSocialInitialTopResetRef.current) return;
    didSocialInitialTopResetRef.current = true;
    scrollSocialListToTop();
  }, [displayedSocialRooms.length, scrollSocialListToTop, showSocialInitialSkeleton]);

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
          <GinitPressable
            onPress={openChatSearch}
            accessibilityRole="button"
            accessibilityLabel="채팅 검색"
            hitSlop={10}
            style={styles.searchIconWrap}>
            <GinitSymbolicIcon name="search-outline" size={22} color="#0f172a" />
            {chatSearchFiltersDot ? <View style={styles.searchFilterDot} /> : null}
          </GinitPressable>
        </View>
      </View>

      <View style={styles.tabCategoryBar} accessibilityRole="tablist">
        <View style={styles.tabPair}>
          <GinitPressable
            onPress={() => goToChatKind('gather')}
            style={({ pressed }) => [
              styles.chatTopChip,
              chatKind === 'gather' && styles.chatTopChipActive,
              pressed && styles.chatTopChipPressed,
              { maxWidth: tabChipMaxWidth },
            ]}
            accessibilityRole="tab"
            accessibilityState={{ selected: chatKind === 'gather' }}
            accessibilityLabel={
              gatherTabUnreadTotal > 0
                ? `모임, 읽지 않은 메시지 ${gatherTabUnreadTotal > 99 ? '99개 이상' : `${gatherTabUnreadTotal}개`}`
                : '모임'
            }>
            <View style={styles.chatTopChipInner} accessible={false}>
              <Text
                style={[styles.chatTopChipLabel, chatKind === 'gather' && styles.chatTopChipLabelActive]}
                numberOfLines={1}>
                모임
              </Text>
              {gatherTabUnreadTotal > 0 ? (
                <View style={styles.chatTopChipUnreadBadge}>
                  <Text style={styles.chatTopChipUnreadBadgeText}>
                    {gatherTabUnreadTotal > 99 ? '99+' : String(gatherTabUnreadTotal)}
                  </Text>
                </View>
              ) : null}
            </View>
          </GinitPressable>
          <GinitPressable
            onPress={() => goToChatKind('social')}
            style={({ pressed }) => [
              styles.chatTopChip,
              chatKind === 'social' && styles.chatTopChipActive,
              pressed && styles.chatTopChipPressed,
              { maxWidth: tabChipMaxWidth },
            ]}
            accessibilityRole="tab"
            accessibilityState={{ selected: chatKind === 'social' }}
            accessibilityLabel={
              socialTabUnreadTotal > 0
                ? `친구, 읽지 않은 메시지 ${socialTabUnreadTotal > 99 ? '99개 이상' : `${socialTabUnreadTotal}개`}`
                : '친구'
            }>
            <View style={styles.chatTopChipInner} accessible={false}>
              <Text
                style={[styles.chatTopChipLabel, chatKind === 'social' && styles.chatTopChipLabelActive]}
                numberOfLines={1}>
                친구
              </Text>
              {socialTabUnreadTotal > 0 ? (
                <View style={styles.chatTopChipUnreadBadge}>
                  <Text style={styles.chatTopChipUnreadBadgeText}>
                    {socialTabUnreadTotal > 99 ? '99+' : String(socialTabUnreadTotal)}
                  </Text>
                </View>
              ) : null}
            </View>
          </GinitPressable>
        </View>
        <View style={styles.categoryDropdownSpacer} pointerEvents="none" />
      </View>
    </View>
  );

  const chatTabListAlerts = (kind: ChatKind): ReactElement => (
    <>
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
        ? !gatherListStillLoading && !gatherListError
        : !(socialRoomsInitialLoading && socialRooms.length === 0) && !socialListError)
        ? chatListEmptyCentered(
            'chatbubbles-outline',
            '채팅 목록',
            '로그인하면 참여 중인 대화가 여기에 표시돼요.',
          )
        : null}

      {kind === 'gather' &&
      !gatherListStillLoading &&
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
      !gatherListStillLoading &&
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
      displayedSocialRooms.length === 0 &&
      appliedSocialTextQuery.trim() === ''
        ? chatListEmptyCentered(
            'chatbubbles-outline',
            '아직 대화한 친구가 없어요',
            '친구와 대화를 나누면 여기에 표시돼요.',
          )
        : null}

      {kind === 'social' &&
      !(socialRoomsInitialLoading && socialRooms.length === 0) &&
      !socialListError &&
      signedIn &&
      !socialSearchBusy &&
      socialFriendDmRooms.length > 0 &&
      displayedSocialRooms.length === 0 &&
      appliedSocialTextQuery.trim() !== ''
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
          <View style={styles.tabListMount}>
            {chatKind === 'gather' ? (
              showGatherInitialSkeleton ? (
                <ScreenTransitionSkeleton variant="chat" rows={6} />
              ) : (
                <FlashList<Meeting>
                  ref={gatherListRef}
                  data={displayedGatherMeetings}
                  extraData={{
                    chatKind,
                    appliedGatherTextQuery,
                    gatherSearchBusy,
                    gatherMsgHits: gatherMessageMatchIds.size,
                    latestByMeetingId: effectiveLatestByMeetingId,
                    hostProfiles,
                    meetingCategories,
                    gatherChatListFlashKey,
                  }}
                  keyExtractor={(m) => m.id}
                  style={styles.listFlex}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={styles.scroll}
                  maintainVisibleContentPosition={{ disabled: true }}
                  refreshControl={
                    <RefreshControl
                      refreshing={refreshing}
                      onRefresh={onPullRefresh}
                      tintColor={GinitTheme.colors.primary}
                      colors={[GinitTheme.colors.primary]}
                    />
                  }
                  ListHeaderComponent={chatTabListAlerts('gather')}
                  ListFooterComponent={gatherListFooter}
                  onEndReached={() => handleEndReachedForKind('gather')}
                  onEndReachedThreshold={0.6}
                  onLoad={scrollGatherListToTop}
                  renderItem={({ item: m }) => {
                    const host = profileForCreatedBy(hostProfiles, m.createdBy);
                    const unread = localMeetingRoomById.get(m.id)?.unreadCount ?? 0;
                    return (
                      <ChatMeetingListRow
                        meeting={m}
                        hostPhotoUrl={host?.photoUrl ?? null}
                        hostNickname={host?.nickname ?? '주관자'}
                        hostWithdrawn={isUserProfileWithdrawn(host)}
                        latestMessage={effectiveLatestByMeetingId[m.id] ?? null}
                        unreadCount={unread}
                        categories={meetingCategories}
                        onPress={() => {
                          if (directSharePickMode) {
                            const incoming = consumeIncomingDirectSharePayload();
                            if (incoming) {
                              if (incoming.kind === 'image') {
                                setPendingDirectSharePayload({
                                  kind: 'image',
                                  imageUri: incoming.imageUri,
                                  text: incoming.text,
                                  targetType: 'meeting',
                                  targetId: m.id,
                                });
                              } else {
                                setPendingDirectSharePayload({
                                  kind: 'text',
                                  text: incoming.text,
                                  targetType: 'meeting',
                                  targetId: m.id,
                                });
                              }
                            }
                            setDirectSharePickMode(false);
                          }
                          router.push(`/meeting-chat/${m.id}`);
                        }}
                      />
                    );
                  }}
                />
              )
            ) : showSocialInitialSkeleton ? (
              <ScreenTransitionSkeleton variant="chat" rows={6} />
            ) : (
              <FlashList<SocialChatRoomSummary>
                ref={socialListRef}
                data={displayedSocialRooms}
                extraData={{
                  chatKind,
                  appliedSocialTextQuery,
                  socialSearchBusy,
                  socialMsgHits: socialMessageMatchRoomIds.size,
                  socialProfiles,
                  latestBySocialRoomId: effectiveLatestBySocialRoomId,
                  socialDmListFlashKey,
                  socialListRenderRev,
                }}
                keyExtractor={(row) => row.roomId}
                style={styles.listFlex}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.scroll}
                maintainVisibleContentPosition={{ disabled: true }}
                refreshControl={
                  <RefreshControl
                    refreshing={refreshing}
                    onRefresh={onPullRefresh}
                    tintColor={GinitTheme.colors.primary}
                    colors={[GinitTheme.colors.primary]}
                  />
                }
                ListHeaderComponent={chatTabListAlerts('social')}
                ListFooterComponent={socialListFooter}
                onEndReached={() => handleEndReachedForKind('social')}
                onEndReachedThreshold={0.6}
                onLoad={scrollSocialListToTop}
                renderItem={({ item: row }) => {
                  const me = userId?.trim() ?? '';
                  const rid = me
                    ? resolveSocialDmRoomIdForViewer(me, row.peerAppUserId, row.roomId)
                    : row.roomId;
                  if (!rid) return null;
                  const prof = socialProfiles.get(row.peerAppUserId);
                  const uri = prof?.photoUrl?.trim();
                  const nick = prof?.nickname ?? '친구';
                  const friendBio =
                    prof && !isUserProfileWithdrawn(prof) ? (prof.bio?.trim() ?? '') : '';
                  const loc = localSocialRoomById.get(row.roomId) as LocalChatRoomSummary | undefined;
                  const latest = effectiveLatestBySocialRoomId[row.roomId];
                  const messageMs = socialListLastMessageMs(loc ?? { lastMessageAtMs: 0 }, latest);
                  const hasListableMessage = messageMs > 0;
                  const preview = socialListPreviewFromLocalRoom(loc ?? { lastMessagePreview: null }, latest);
                  const rightTime = hasListableMessage ? formatRelativeFromMs(messageMs) : '';
                  const unread = loc?.unreadCount ?? 0;
                  return (
                    <GinitPressable
                      onPress={() => {
                        if (directSharePickMode) {
                          const incoming = consumeIncomingDirectSharePayload();
                          if (incoming) {
                            if (incoming.kind === 'image') {
                              setPendingDirectSharePayload({
                                kind: 'image',
                                imageUri: incoming.imageUri,
                                text: incoming.text,
                                targetType: 'dm',
                                targetId: rid,
                              });
                            } else {
                              setPendingDirectSharePayload({
                                kind: 'text',
                                text: incoming.text,
                                targetType: 'dm',
                                targetId: rid,
                              });
                            }
                          }
                          setDirectSharePickMode(false);
                        }
                        router.push(
                          `/social-chat/${encodeURIComponent(rid)}?peerName=${encodeURIComponent(nick)}${
                            uri ? `&peerPhotoUrl=${encodeURIComponent(uri)}` : ''
                          }`,
                        );
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`${nick}와 채팅`}
                      style={({ pressed }) => [styles.chatPressableRow, pressed && styles.chatPressablePressed]}>
                      <View style={styles.socialZoneA}>
                        <View style={styles.socialSymbolCol}>
                          <View style={styles.socialAvatarBubble}>
                            <View style={styles.socialAvatarMedia}>
                              {uri ? (
                                <Image
                                  source={{ uri }}
                                  style={styles.socialAvatarImg}
                                  contentFit="cover"
                                  cachePolicy="disk"
                                  recyclingKey={`${row.peerAppUserId}:${uri}`}
                                />
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
                              {friendBio ? (
                                <Text style={styles.socialMetaMuted} numberOfLines={1}>
                                  {friendBio}
                                </Text>
                              ) : null}
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
                          {preview ? (
                            <Text style={styles.socialPreviewLine} numberOfLines={2}>
                              {preview}
                            </Text>
                          ) : null}
                        </View>
                      </View>
                    </GinitPressable>
                  );
                }}
              />
            )}
          </View>
        </View>

        <Modal
          visible={chatSearchModalOpen}
          animationType="fade"
          transparent
          onRequestClose={closeChatSearch}>
          <View style={styles.modalRoot}>
            <GinitPressable
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
              <GinitPressable
                onPress={applyChatSearch}
                style={styles.socialSearchApplyBtn}
                accessibilityRole="button"
                accessibilityLabel="검색">
                <Text style={styles.socialSearchApplyLabel}>검색</Text>
              </GinitPressable>
              <GinitPressable
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
              </GinitPressable>
              <GinitPressable onPress={closeChatSearch} style={styles.modalCloseBtn} accessibilityRole="button">
                <Text style={styles.modalCloseLabel}>닫기</Text>
              </GinitPressable>
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
  tabListMount: { flex: 1, minHeight: 0 },
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
  chatTopChipInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  chatTopChipUnreadBadge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EF4444',
  },
  chatTopChipUnreadBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: -0.2,
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
    fontWeight: '600',
    color: GinitTheme.colors.textMuted,
    letterSpacing: -0.12,
    marginTop: 1,
    textAlign: 'right',
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
