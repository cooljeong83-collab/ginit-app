
import { useFocusEffect, useIsFocused, useNavigation } from '@react-navigation/native';
import { type InfiniteData, useQueryClient } from '@tanstack/react-query';
import { BlurView } from 'expo-blur';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { Timestamp } from 'firebase/firestore';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlashList } from '@shopify/flash-list';
import {
    ActivityIndicator,
    Alert,
    InteractionManager,
    Keyboard,
    type LayoutChangeEvent,
    Modal,
    type NativeScrollEvent,
    type NativeSyntheticEvent,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { useGenericKeyboardHandler } from 'react-native-keyboard-controller';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { MeetingChatMediaPickerModal } from '@/components/chat/MeetingChatMediaPickerModal';
import { MeetingChatImageViewerGallery } from '@/components/chat/MeetingChatImageViewerGallery';
import { MeetingChatMainColumn } from '@/components/chat/MeetingChatMainColumn';
import { meetingChatBodyStyles } from '@/components/chat/meeting-chat-body-styles';
import { meetingImageViewerMeta, profileForSender } from '@/components/chat/meeting-chat-ui-helpers';
import { useMeetingChatRenderItem } from '@/components/chat/use-meeting-chat-render-item';
import { GinitTheme } from '@/constants/ginit-theme';
import { useInAppAlarms } from '@/src/context/InAppAlarmsContext';
import { useUserSession } from '@/src/context/UserSessionContext';
import { useOfflineChatRoomSync } from '@/src/hooks/useOfflineChatRoomSync';
import {
    flattenMeetingChatInfinitePages,
    meetingChatMessagesQueryKey,
    mergeMeetingChatInfiniteAppendPages,
    useMeetingChatMessagesInfiniteQuery,
} from '@/src/hooks/use-meeting-chat-messages-infinite-query';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { createChatSearchSession, type ChatSearchSession } from '@/src/lib/chat-search-navigator';
import { buildMeetingChatListRows, findMeetingChatListRowIndexByMessageId } from '@/src/lib/meeting-chat-list-rows';
import { saveRemoteImageUrlToLibrary, shareRemoteImageUrl } from '@/src/lib/chat-image-actions';
import { setCurrentChatRoomId } from '@/src/lib/current-chat-room';
import { listLocalSearchMessageIdsNewestFirst } from '@/src/lib/offline-chat/offline-chat-search';
import { recordRecentSearch } from '@/src/lib/offline-chat/recent-searches';
import { resolveFeedLocationContextWithoutPermissionPrompt } from '@/src/lib/feed-display-location';
import type { LatLng } from '@/src/lib/geo-distance';
import { isUserJoinedMeeting } from '@/src/lib/joined-meetings';
import type { MeetingChatFetchedMessagesPage, MeetingChatMessage } from '@/src/lib/meeting-chat';
import {
    deleteMeetingChatImageMessageBestEffort,
    fetchOlderMeetingChatPagesUntilTargetMessageId,
    searchMeetingChatMessages,
    sendMeetingChatImageMessagesBatch,
    sendMeetingChatTextMessage,
    writeMeetingChatReadReceipt,
} from '@/src/lib/meeting-chat';
import type { Meeting } from '@/src/lib/meetings';
import { meetingParticipantCount, subscribeMeetingById } from '@/src/lib/meetings';
import type { UserProfile } from '@/src/lib/user-profile';
import { WITHDRAWN_NICKNAME, getUserProfilesForIds, isUserProfileWithdrawn } from '@/src/lib/user-profile';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';

/** Firestore Timestamp · `{ seconds }` · Ledger ISO 문자열 → ms */
function coalesceFirestoreTimeMs(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'string' && v.trim()) {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : 0;
  }
  if (typeof (v as Timestamp).toMillis === 'function') {
    try {
      return (v as Timestamp).toMillis();
    } catch {
      return 0;
    }
  }
  if (typeof v === 'object' && v !== null && 'seconds' in v) {
    const s = Number((v as { seconds: unknown }).seconds);
    if (!Number.isFinite(s)) return 0;
    const n = Number((v as { nanoseconds?: unknown }).nanoseconds);
    return s * 1000 + (Number.isFinite(n) ? Math.floor(n / 1e6) : 0);
  }
  return 0;
}

/** `chatReadMessageIdBy` 키가 이메일/전화 등 여러 형태여도 정규화된 pid로 마지막 읽은 메시지 id */
function lastReadMessageIdForParticipant(readBy: Meeting['chatReadMessageIdBy'], pid: string): string {
  if (!readBy || typeof readBy !== 'object') return '';
  const pick = (val: unknown) => (typeof val === 'string' ? val.trim() : String(val ?? '').trim());
  const direct = pick((readBy as Record<string, unknown>)[pid]);
  if (direct) return direct;
  for (const [k, v] of Object.entries(readBy)) {
    const id = pick(v);
    if (!id) continue;
    const nk = normalizeParticipantId(k) ?? k.trim();
    if (nk === pid) return id;
  }
  return '';
}

/** 검색 결과 한 줄 미리보기 — 검색어 주변만 잘라 표시 */
function splitSearchSnippet(full: string, needle: string): { head: string; mid: string; tail: string } {
  const f = full;
  const n = needle.trim();
  if (!f) return { head: '', mid: '', tail: '' };
  if (!n) return { head: f.length > 120 ? `${f.slice(0, 120)}…` : f, mid: '', tail: '' };
  const lower = f.toLowerCase();
  const idx = lower.indexOf(n.toLowerCase());
  if (idx < 0) return { head: f.length > 120 ? `${f.slice(0, 120)}…` : f, mid: '', tail: '' };
  const pad = 28;
  const start = Math.max(0, idx - pad);
  const end = Math.min(f.length, idx + n.length + pad);
  const slice = f.slice(start, end);
  const local = slice.toLowerCase().indexOf(n.toLowerCase());
  if (local < 0) return { head: (start > 0 ? '…' : '') + slice, mid: '', tail: end < f.length ? '…' : '' };
  const headRaw = slice.slice(0, local);
  const midRaw = slice.slice(local, local + n.length);
  const tailRaw = slice.slice(local + n.length);
  return {
    head: (start > 0 ? '…' : '') + headRaw,
    mid: midRaw,
    tail: tailRaw + (end < f.length ? '…' : ''),
  };
}

export default function MeetingChatRoomScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ meetingId: string | string[] }>();
  const meetingId = Array.isArray(params.meetingId)
    ? (params.meetingId[0] ?? '').trim()
    : typeof params.meetingId === 'string'
      ? params.meetingId.trim()
      : '';
  const { userId } = useUserSession();
  const queryClient = useQueryClient();

  const [meeting, setMeeting] = useState<Meeting | null | undefined>(undefined);
  const [meetingError, setMeetingError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Map<string, UserProfile>>(new Map());
  const openUserProfile = useCallback(
    (id: string) => {
      const t = id.trim();
      if (!t) return;
      router.push(`/profile/user/${encodeURIComponent(t)}`);
    },
    [router],
  );
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<MeetingChatMessage['replyTo']>(null);
  const [userCoords, setUserCoords] = useState<LatLng | null>(null);
  const [imageViewer, setImageViewer] = useState<{
    gallery: MeetingChatMessage[];
    index: number;
  } | null>(null);
  const [imageViewerBusy, setImageViewerBusy] = useState(false);
  /** 맨 아래에서 조금이라도 위로 올라왔을 때만「최신으로」FAB 표시 */
  const [showJumpToBottomFab, setShowJumpToBottomFab] = useState(false);
  const [chatSearchMode, setChatSearchMode] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  /** 엔터로 확정된 검색어(로컬 DB·▲/▼ 탐색 기준) */
  const [chatSearchCommittedQuery, setChatSearchCommittedQuery] = useState('');
  const [chatSearchSession, setChatSearchSession] = useState<ChatSearchSession>(() => createChatSearchSession(''));
  const [chatSearchBusy, setChatSearchBusy] = useState(false);
  /** 검색 결과 점프 시 과거 메시지를 한꺼번에 불러오는 동안 */
  const [searchNavigateLoading, setSearchNavigateLoading] = useState(false);
  /** 퀵 메뉴·닫기 레이어를 입력창(composerDock) 바로 위에 붙이기 위한 높이 */
  const [composerDockBlockHeight, setComposerDockBlockHeight] = useState(104);
  const [composerInputBarHeight, setComposerInputBarHeight] = useState(56);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const chatSearchInputRef = useRef<TextInput>(null);
  const listRef = useRef<any>(null);
  const innerFlashListRef = useRef<any>(null);
  const setListRef = useCallback((r: any) => {
    if (r) listRef.current = r;
  }, []);
  const setInnerFlashListRef = useCallback((r: any) => {
    if (r) innerFlashListRef.current = r;
  }, []);
  const messageInputRef = useRef<TextInput>(null);
  const messagesRef = useRef<MeetingChatMessage[]>([]);
  const lastMarkedReadRef = useRef<{ meetingId: string; messageId: string } | null>(null);
  const { markChatReadUpTo } = useInAppAlarms();
  const lastScrollOffsetRef = useRef(0);
  const pendingAutoScrollToLatestRef = useRef(false);
  const lastAutoScrolledMessageIdRef = useRef<string>('');

  const resolveListScroller = useCallback(() => {
    const r = innerFlashListRef.current ?? listRef.current;
    if (!r) return null;
    // FlashList / 레거시 래퍼 케이스
    const candidates = [
      r,
      typeof (r as any).getNode === 'function' ? (r as any).getNode() : null,
      typeof (r as any).getScrollResponder === 'function' ? (r as any).getScrollResponder() : null,
      (r as any)._flatListRef ?? null,
      (r as any)._flatList ?? null,
    ].filter(Boolean);
    for (const c of candidates) {
      if (c && (typeof c.scrollToIndex === 'function' || typeof c.scrollToOffset === 'function')) return c;
    }
    return null;
  }, []);

  const scrollToIndexSafe = useCallback((index: number, viewPosition = 0.35, animated = false) => {
    const scroller = resolveListScroller();
    if (!scroller || typeof scroller.scrollToIndex !== 'function') return false;
    try {
      scroller.scrollToIndex({ index, viewPosition, animated });
      return true;
    } catch {
      return false;
    }
  }, [resolveListScroller]);

  const scrollToOffsetSafe = useCallback((offset: number, animated = false) => {
    const scroller = resolveListScroller();
    if (!scroller || typeof scroller.scrollToOffset !== 'function') return false;
    try {
      scroller.scrollToOffset({ offset, animated });
      return true;
    } catch {
      return false;
    }
  }, [resolveListScroller]);

  const jumpToLatest = useCallback(() => {
    setShowJumpToBottomFab(false);
    requestAnimationFrame(() => {
      scrollToOffsetSafe(0, false);
    });
  }, [scrollToOffsetSafe]);

  const myId = useMemo(() => (userId?.trim() ? normalizeParticipantId(userId.trim()) : ''), [userId]);

  const scrollToMessageIndexBestEffort = useCallback((idx: number, animated = false) => {
    const index = Math.max(0, Math.floor(idx));
    // inverted + 가변 높이: index*고정px 오프셋 추정은 클램프 버그가 있어 scrollToIndex만 사용.
    // 검색 이동은 animated=true로 "스크롤되는 느낌"을 줍니다.
    InteractionManager.runAfterInteractions(() => {
      setTimeout(() => {
        scrollToIndexSafe(index, 0.35, animated);
        requestAnimationFrame(() => {
          scrollToIndexSafe(index, 0.35, animated);
        });
      }, 60);
    });
  }, [scrollToIndexSafe]);

  useFocusEffect(
    useCallback(() => {
      setCurrentChatRoomId(meetingId);
      return () => setCurrentChatRoomId(null);
    }, [meetingId]),
  );

  useEffect(() => {
    if (!meetingId) {
      setMeeting(null);
      return;
    }
    const unsub = subscribeMeetingById(
      meetingId,
      (m) => {
        setMeeting(m);
        setMeetingError(null);
      },
      (msg) => setMeetingError(msg),
    );
    return unsub;
  }, [meetingId]);

  const allowed = useMemo(() => {
    if (meeting === undefined) return null;
    if (!meeting) return false;
    return isUserJoinedMeeting(meeting, userId);
  }, [meeting, userId]);

  useOfflineChatRoomSync({ roomType: 'meeting', roomId: meetingId }, allowed === true);

  const {
    messages,
    listError: chatError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch: refetchChatMessages,
  } = useMeetingChatMessagesInfiniteQuery({
    meetingId,
    enabled: allowed === true,
  });

  messagesRef.current = messages;

  const chatListRows = useMemo(() => buildMeetingChatListRows(messages), [messages]);

  /** 채팅방 이미지 뷰어: 시간순(오래된 것 → 최신)으로 슬라이드 */
  const chatImageGalleryChrono = useMemo(() => {
    const imgs = messages.filter((m) => m.kind === 'image' && m.imageUrl?.trim());
    return [...imgs].reverse();
  }, [messages]);

  useEffect(() => {
    lastMarkedReadRef.current = null;
  }, [meetingId]);

  useFocusEffect(
    useCallback(() => {
      if (allowed !== true) {
        return () => {};
      }
      return () => {
        if (!meetingId) return;
        const list = messagesRef.current;
        const latest = list[0];
        if (!latest?.id) return;
        markChatReadUpTo(meetingId, latest.id);
      };
    }, [allowed, meetingId, markChatReadUpTo]),
  );

  useEffect(() => {
    if (allowed !== true || !meetingId || !isFocused) return;
    const latest = messages[0];
    if (!latest?.id) return;
    const prev = lastMarkedReadRef.current;
    if (prev && prev.meetingId === meetingId && prev.messageId === latest.id) return;
    lastMarkedReadRef.current = { meetingId, messageId: latest.id };
    markChatReadUpTo(meetingId, latest.id);
    if (myId) {
      void writeMeetingChatReadReceipt(meetingId, myId, latest.id).catch(() => {
        /* best-effort */
      });
    }
  }, [allowed, meetingId, messages, markChatReadUpTo, myId, isFocused]);

  /** inverted 리스트에서 상단(과거) 근접 시 훅 내부에서 중복 요청 방지 + 미리 불러오기 */
  const onPrefetchOlderMessages = useCallback(() => {
    void fetchNextPage();
  }, [fetchNextPage]);

  const listFooterLoading = useMemo(
    () => (
      <View style={meetingChatBodyStyles.chatListFooterSpinner} accessibilityLabel="이전 메시지 로딩">
        <ActivityIndicator color={GinitTheme.colors.primary} />
      </View>
    ),
    [],
  );

  useEffect(() => {
    if (!meeting || allowed !== true) return;
    const ids = [...(meeting.participantIds ?? [])];
    if (meeting.createdBy?.trim()) ids.push(meeting.createdBy);
    void getUserProfilesForIds(ids).then(setProfiles);
  }, [meeting, allowed]);

  // inverted 리스트: offset=0 이 "최신(하단)" 이므로 별도 scrollToEnd 로직이 필요 없습니다.

  const onChatScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
    lastScrollOffsetRef.current = contentOffset.y;
    const viewH = layoutMeasurement.height;
    const contentH = contentSize.height;
    if (viewH <= 0 || contentH <= 0) {
      setShowJumpToBottomFab(false);
      return;
    }
    /** 스크롤이 생기지 않으면(내용이 짧으면) FAB 숨김 */
    if (contentH <= viewH + 4) {
      setShowJumpToBottomFab(false);
      return;
    }
    const threshold = 56;
    // inverted: 최신 위치(하단)는 offset=0, 위로 갈수록 offset이 증가
    setShowJumpToBottomFab(contentOffset.y > threshold);
  }, []);

  useEffect(() => {
    if (messages.length === 0) {
      setShowJumpToBottomFab(false);
    }
  }, [messages.length]);

  useEffect(() => {
    const latest = messages[0];
    if (!latest?.id) return;
    if (lastAutoScrolledMessageIdRef.current === latest.id) return;

    const shouldAutoScroll = keyboardHeight > 0 || pendingAutoScrollToLatestRef.current || !showJumpToBottomFab;
    if (!shouldAutoScroll) return;

    // 내가 보낸 메시지나, 현재 최신 영역에 머무르고 있는 상태라면 최신을 유지
    lastAutoScrolledMessageIdRef.current = latest.id;
    pendingAutoScrollToLatestRef.current = false;
    // 레이아웃(콘텐츠 높이/입력 독 패딩) 반영 타이밍에 따라 1프레임만으로는 가려질 수 있어 2~3회 재시도합니다.
    requestAnimationFrame(() => {
      scrollToOffsetSafe(0, false);
      requestAnimationFrame(() => {
        scrollToOffsetSafe(0, false);
      });
      setTimeout(() => {
        scrollToOffsetSafe(0, false);
      }, 60);
    });
  }, [messages, showJumpToBottomFab, keyboardHeight, scrollToOffsetSafe]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ctx = await resolveFeedLocationContextWithoutPermissionPrompt();
      if (cancelled) return;
      setUserCoords(ctx.coords);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** 입력 독 하단: 세이프만(`KeyboardStickyView`가 키보드 동기화). */
  const composerBottomPad = useMemo(() => Math.max(insets.bottom, 8), [insets.bottom]);

  const goMeetingDetail = useCallback(() => {
    if (!meetingId) return;
    router.push(`/meeting/${meetingId}`);
  }, [router, meetingId]);

  const exitChatRoom = useCallback(() => {
    if (navigation.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/chat');
    }
  }, [navigation, router]);

  useEffect(() => {
    if (!chatSearchMode) return;
    const t = setTimeout(() => chatSearchInputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [chatSearchMode]);

  const openChatSearch = useCallback(() => {
    Keyboard.dismiss();
    setChatSearchMode(true);
    setChatSearchQuery('');
    setChatSearchCommittedQuery('');
    setChatSearchSession(createChatSearchSession(''));
  }, []);

  const closeChatSearch = useCallback(() => {
    setChatSearchMode(false);
    setChatSearchQuery('');
    setChatSearchCommittedQuery('');
    setChatSearchSession(createChatSearchSession(''));
    setChatSearchBusy(false);
  }, []);

  const searchStatusLabel = useMemo(() => {
    const total = chatSearchSession.matchIds.length;
    if (!chatSearchSession.query.trim()) return '';
    if (total === 0) return chatSearchBusy ? '찾는 중…' : '결과 없음';
    const cur = Math.min(total, Math.max(1, chatSearchSession.cursorIndex + 1));
    return `${cur}/${total}`;
  }, [chatSearchBusy, chatSearchSession]);

  const scrollMeetingToMessageIdBestEffort = useCallback(
    async (messageId: string) => {
      const mid = String(messageId ?? '').trim();
      if (!mid) return;
      const tryScroll = (): boolean => {
        const idx = messagesRef.current.findIndex((m) => m.id === mid);
        if (idx < 0) return false;
        scrollToMessageIndexBestEffort(idx, true);
        return true;
      };
      if (tryScroll()) return;
      for (let i = 0; i < 3; i += 1) {
        if (!hasNextPage) break;
        await fetchNextPage();
        if (tryScroll()) return;
      }
      Alert.alert('대화 위치', '로컬에는 있지만 아직 이 화면에 불러와지지 않은 메시지예요.\n위로 스크롤해 조금 더 불러온 뒤 다시 시도해 주세요.');
    },
    [fetchNextPage, hasNextPage, scrollToMessageIndexBestEffort],
  );

  const runMeetingLocalSearch = useCallback(async () => {
    const q = chatSearchQuery.trim();
    if (!q || !meetingId) return;
    setChatSearchCommittedQuery(q);
    setChatSearchBusy(true);
    try {
      const matchIds = await listLocalSearchMessageIdsNewestFirst({
        key: { roomType: 'meeting', roomId: meetingId },
        query: q,
        limit: 200,
      });
      setChatSearchSession({
        query: q,
        matchIds,
        cursorIndex: matchIds.length > 0 ? 0 : -1,
        scanCursor: 0,
      });
      await recordRecentSearch({ scope: 'room', roomId: meetingId, query: q });
      const first = matchIds[0]?.trim();
      if (first) await scrollMeetingToMessageIdBestEffort(first);
    } finally {
      setChatSearchBusy(false);
    }
  }, [chatSearchQuery, meetingId, scrollMeetingToMessageIdBestEffort]);

  const goNewerMatch = useCallback(() => {
    const total = chatSearchSession.matchIds.length;
    const cur = chatSearchSession.cursorIndex;
    if (total <= 0) return;
    if (cur < 0) {
      const id0 = chatSearchSession.matchIds[0]?.trim() ?? '';
      if (!id0) return;
      setChatSearchSession((prev) => ({ ...prev, cursorIndex: 0 }));
      const idx0 = messagesRef.current.findIndex((m) => m.id === id0);
      if (idx0 >= 0) scrollToMessageIndexBestEffort(idx0, true);
      else void scrollMeetingToMessageIdBestEffort(id0);
      return;
    }
    if (cur <= 0) return;
    const id = chatSearchSession.matchIds[cur - 1]?.trim() ?? '';
    if (!id) return;
    setChatSearchSession((prev) => ({ ...prev, cursorIndex: Math.max(0, cur - 1) }));
    const idx = messagesRef.current.findIndex((m) => m.id === id);
    if (idx >= 0) scrollToMessageIndexBestEffort(idx, true);
    else void scrollMeetingToMessageIdBestEffort(id);
  }, [
    chatSearchSession.cursorIndex,
    chatSearchSession.matchIds,
    scrollMeetingToMessageIdBestEffort,
    scrollToMessageIndexBestEffort,
  ]);

  const goOlderMatchOrScan = useCallback(async () => {
    const total = chatSearchSession.matchIds.length;
    const cur = chatSearchSession.cursorIndex;
    if (total > 0 && cur >= 0 && cur + 1 < total) {
      const id = chatSearchSession.matchIds[cur + 1]?.trim() ?? '';
      if (!id) return;
      setChatSearchSession((prev) => ({ ...prev, cursorIndex: Math.min(prev.matchIds.length - 1, cur + 1) }));
      const idx = messagesRef.current.findIndex((m) => m.id === id);
      if (idx >= 0) scrollToMessageIndexBestEffort(idx, true);
      else await scrollMeetingToMessageIdBestEffort(id);
      return;
    }
  }, [chatSearchSession.cursorIndex, chatSearchSession.matchIds, scrollMeetingToMessageIdBestEffort, scrollToMessageIndexBestEffort]);

  const bottomSearchNavigator = useMemo(() => {
    if (!chatSearchMode) return null;
    const raw = chatSearchQuery.trim();
    const committed = chatSearchCommittedQuery.trim();
    const navEnabled = Boolean(committed);
    const showCenterHint = !raw || (raw && !committed);
    const total = chatSearchSession.matchIds.length;
    const cur = chatSearchSession.cursorIndex;
    const atOldestMatch = total === 0 || (total > 0 && cur >= 0 && cur >= total - 1);
    return (
      <View
        style={[styles.bottomSearchNavRow, showCenterHint && styles.bottomSearchNavRowCenter]}
        accessibilityLabel="검색 결과 탐색">
        {showCenterHint ? (
          <View style={styles.bottomSearchNavCenterOverlay} pointerEvents="none">
            <Text style={styles.bottomSearchNavCenterText} numberOfLines={1}>
              {!raw ? '검색어가 없습니다' : '엔터로 검색하세요'}
            </Text>
          </View>
        ) : null}
        <Text
          style={[styles.bottomSearchNavStatus, showCenterHint && styles.bottomSearchNavStatusCenter]}
          numberOfLines={1}>
          {navEnabled ? searchStatusLabel || ' ' : ' '}
        </Text>
        <View style={styles.bottomSearchNavBtns}>
          <Pressable
            onPress={() => void goOlderMatchOrScan()}
            disabled={chatSearchBusy || !navEnabled || atOldestMatch}
            style={({ pressed }) => [
              styles.bottomSearchNavBtn,
              (chatSearchBusy || !navEnabled || atOldestMatch) && styles.bottomSearchNavBtnDisabled,
              pressed && !(chatSearchBusy || !navEnabled || atOldestMatch) && styles.bottomSearchNavBtnPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="더 과거 결과">
            <View style={{ transform: [{ rotate: '180deg' }] }}>
              <GinitSymbolicIcon name="chevron-down" size={20} color="#0f172a" />
            </View>
          </Pressable>
          <Pressable
            onPress={goNewerMatch}
            disabled={
              chatSearchBusy ||
              !navEnabled ||
              chatSearchSession.cursorIndex <= 0 ||
              chatSearchSession.matchIds.length === 0
            }
            style={({ pressed }) => [
              styles.bottomSearchNavBtn,
              (chatSearchBusy ||
                !navEnabled ||
                chatSearchSession.cursorIndex <= 0 ||
                chatSearchSession.matchIds.length === 0) &&
                styles.bottomSearchNavBtnDisabled,
              pressed &&
                !(
                  chatSearchBusy ||
                  !navEnabled ||
                  chatSearchSession.cursorIndex <= 0 ||
                  chatSearchSession.matchIds.length === 0
                ) &&
                styles.bottomSearchNavBtnPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="더 최신 결과">
            <GinitSymbolicIcon name="chevron-down" size={20} color="#0f172a" />
          </Pressable>
        </View>
      </View>
    );
  }, [
    chatSearchMode,
    chatSearchQuery,
    chatSearchCommittedQuery,
    chatSearchBusy,
    chatSearchSession,
    searchStatusLabel,
    goOlderMatchOrScan,
    goNewerMatch,
  ]);

  const onPressAttach = useCallback(() => {
    if (Platform.OS === 'web') {
      Alert.alert('안내', '웹에서는 사진을 보낼 수 없어요.');
      return;
    }
    setMediaPickerOpen(true);
  }, []);

  const handleMediaPickerConfirmMeeting = useCallback(
    async ({ uris, widths }: { uris: string[]; widths: (number | undefined)[] }) => {
      if (!meetingId || !userId?.trim()) {
        Alert.alert('안내', '로그인 후 메시지를 보낼 수 있어요.');
        return;
      }
      if (uris.length === 0 || sending) return;
      setSending(true);
      pendingAutoScrollToLatestRef.current = true;
      try {
        await sendMeetingChatImageMessagesBatch(meetingId, userId, uris, {
          naturalWidths: widths,
        });
        setMediaPickerOpen(false);
      } catch (e) {
        Alert.alert('전송 실패', e instanceof Error ? e.message : '다시 시도해 주세요.');
      } finally {
        setSending(false);
      }
    },
    [meetingId, userId, sending],
  );

  const onSend = useCallback(async () => {
    if (!meetingId || !userId?.trim()) {
      Alert.alert('안내', '로그인 후 메시지를 보낼 수 있어요.');
      return;
    }
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    pendingAutoScrollToLatestRef.current = true;
    try {
      await sendMeetingChatTextMessage(meetingId, userId, body, replyTo?.messageId ? replyTo : null);
      setDraft('');
      setReplyTo(null);
    } catch (e) {
      Alert.alert('전송 실패', e instanceof Error ? e.message : '다시 시도해 주세요.');
    } finally {
      setSending(false);
    }
  }, [meetingId, userId, draft, sending, replyTo]);

  const chatListContentStyle = useMemo(
    () => [
      meetingChatBodyStyles.listContent,
      {
        // inverted: 입력 독이 absolute+sticky이므로 리스트 시각 하단에 독 높이만큼 여백
        paddingTop: Math.max(
          4,
          Math.max(composerDockBlockHeight, composerInputBarHeight + composerBottomPad) + Math.max(0, keyboardHeight),
        ),
      },
    ],
    [composerDockBlockHeight, composerInputBarHeight, composerBottomPad, keyboardHeight],
  );

  useGenericKeyboardHandler(
    {
      onMove: (e) => {
        'worklet';
        runOnJS(setKeyboardHeight)(Math.max(0, e.height));
      },
      onEnd: (e) => {
        'worklet';
        runOnJS(setKeyboardHeight)(Math.max(0, e.height));
      },
    },
    [],
  );

  const onComposerDockLayout = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h > 0) setComposerDockBlockHeight(h);
  }, []);

  // 입력 독/키보드 높이 변화로 리스트 패딩이 바뀌는 순간,
  // 최신 영역에 머무는 중이면(offset=0) 한 번 더 최신으로 붙여 가려짐을 방지합니다.
  useEffect(() => {
    if (showJumpToBottomFab) return;
    requestAnimationFrame(() => {
      scrollToOffsetSafe(0, false);
    });
  }, [showJumpToBottomFab, composerDockBlockHeight, composerInputBarHeight, composerBottomPad, keyboardHeight, scrollToOffsetSafe]);

  const hostNorm = meeting?.createdBy?.trim() ? normalizeParticipantId(meeting.createdBy.trim()) : '';

  const announcementText = useMemo(() => {
    if (!meeting) return '';
    if (meeting.scheduleConfirmed !== true) return '';
    const place = meeting.placeName?.trim() || meeting.location?.trim();
    const d = meeting.scheduleDate?.trim();
    const t = meeting.scheduleTime?.trim();
    const parts = [place, d && t ? `${d} ${t}` : d || t].filter(Boolean);
    return parts.length ? `확정: ${parts.join(' · ')}` : '';
  }, [meeting]);

  const participantIdsForReadCount = useMemo(() => {
    if (!meeting) return [] as string[];
    const ids = [...(meeting.participantIds ?? [])];
    if (meeting.createdBy?.trim()) ids.push(meeting.createdBy);
    return [...new Set(ids.map((x) => normalizeParticipantId(String(x)) ?? String(x).trim()).filter(Boolean))];
  }, [meeting]);

  const readAtMsByUser = useMemo(() => {
    const map: Record<string, number> = {};
    const raw = meeting?.chatReadAtBy ?? null;
    if (!raw) return map;
    for (const [k, v] of Object.entries(raw)) {
      const uid = normalizeParticipantId(k) ?? k.trim();
      if (!uid) continue;
      const ms = coalesceFirestoreTimeMs(v);
      if (ms > 0) map[uid] = Math.max(map[uid] ?? 0, ms);
    }
    return map;
  }, [meeting?.chatReadAtBy]);

  const messageIndexById = useMemo(() => {
    const m = new Map<string, number>();
    messages.forEach((msg, i) => {
      if (msg.id) m.set(msg.id, i);
    });
    return m;
  }, [messages]);

  const jumpToRepliedMessage = useCallback(
    async (replyMessageId: string) => {
      const mid = meetingId.trim();
      const rid = String(replyMessageId ?? '').trim();
      if (!mid || !rid) return;

      const cacheKey = meetingChatMessagesQueryKey(mid);
      const indexFromRQ = (): number => {
        const data = queryClient.getQueryData<InfiniteData<MeetingChatFetchedMessagesPage>>(cacheKey);
        return flattenMeetingChatInfinitePages(data).findIndex((m) => m.id === rid);
      };

      let idx = messageIndexById.get(rid) ?? -1;
      if (idx < 0) idx = indexFromRQ();

      if (idx < 0) {
        setSearchNavigateLoading(true);
        try {
          let data = queryClient.getQueryData<InfiniteData<MeetingChatFetchedMessagesPage>>(cacheKey);
          if (!data?.pages?.length) {
            await refetchChatMessages();
            data = queryClient.getQueryData<InfiniteData<MeetingChatFetchedMessagesPage>>(cacheKey);
          }
          const anchor = data?.pages?.[data.pages.length - 1]?.oldestMessageId?.trim() ?? '';
          if (anchor) {
            const { newPages, found } = await fetchOlderMeetingChatPagesUntilTargetMessageId(mid, anchor, rid, {
              pageSize: 100,
              maxPages: 200,
            });
            if (found && newPages.length) {
              queryClient.setQueryData(
                cacheKey,
                (prev: InfiniteData<MeetingChatFetchedMessagesPage> | undefined) =>
                  mergeMeetingChatInfiniteAppendPages(prev, newPages),
              );
            }
          }
          idx = indexFromRQ();
          if (idx < 0) {
            await refetchChatMessages();
            idx = indexFromRQ();
          }
        } finally {
          setSearchNavigateLoading(false);
        }
      }

      if (idx >= 0) {
        const rowIdx = findMeetingChatListRowIndexByMessageId(chatListRows, rid);
        const toScroll = rowIdx >= 0 ? rowIdx : idx;
        InteractionManager.runAfterInteractions(() => {
          requestAnimationFrame(() => {
            scrollToMessageIndexBestEffort(toScroll);
          });
        });
        return;
      }

      Alert.alert('원글 위치', '불러올 수 있는 범위 안에서 원글을 찾지 못했어요.');
    },
    [
      meetingId,
      queryClient,
      messageIndexById,
      chatListRows,
      refetchChatMessages,
      scrollToMessageIndexBestEffort,
      fetchOlderMeetingChatPagesUntilTargetMessageId,
      flattenMeetingChatInfinitePages,
      mergeMeetingChatInfiniteAppendPages,
    ],
  );

  const unreadCountForMessage = useCallback(
    (message: MeetingChatMessage, messageIndex: number): number => {
      if (allowed !== true) return 0;
      if (!meeting) return 0;
      const messageMs =
        message.createdAt && typeof message.createdAt.toMillis === 'function' ? message.createdAt.toMillis() : 0;
      if (!messageMs) return 0;
      const readMsgBy = meeting.chatReadMessageIdBy;
      let unread = 0;
      const idxMsg = messageIndex;
      for (const pid of participantIdsForReadCount) {
        if (myId && pid === myId) continue;
        const lastId = lastReadMessageIdForParticipant(readMsgBy, pid);
        if (lastId) {
          const readIdx = messageIndexById.get(lastId);
          // inverted + 최신순 배열: 인덱스가 작을수록 더 최신.
          // 참여자의 마지막 읽음이 이 메시지보다 최신(또는 동일)이면 이미 읽음 처리.
          if (readIdx != null && readIdx <= idxMsg) continue;
        }
        const ms = readAtMsByUser[pid] ?? 0;
        if (!ms || ms < messageMs) unread += 1;
      }
      return unread;
    },
    [allowed, meeting, participantIdsForReadCount, readAtMsByUser, myId, messageIndexById],
  );

  const openMeetingChatImageViewer = useCallback(
    (item: MeetingChatMessage) => {
      const url = item.imageUrl?.trim();
      if (!url || item.kind !== 'image') return;
      const ix = chatImageGalleryChrono.findIndex((m) => m.id === item.id);
      setImageViewer({
        gallery: chatImageGalleryChrono,
        index: ix >= 0 ? ix : 0,
      });
    },
    [chatImageGalleryChrono],
  );

  const onChatImageGalleryIndexChange = useCallback((i: number) => {
    setImageViewer((prev) => (prev && prev.gallery.length > 0 ? { ...prev, index: i } : prev));
  }, []);

  const renderItem = useMeetingChatRenderItem({
    listRows: chatListRows,
    messageIndexById,
    myId,
    hostNorm,
    profiles,
    unreadCountForMessage,
    jumpToRepliedMessage,
    setReplyTo,
    onOpenUserProfile: openUserProfile,
    openMeetingChatImageViewer,
    listRef,
    messageSearchHighlightQuery:
      chatSearchMode && chatSearchCommittedQuery.trim() ? chatSearchCommittedQuery : '',
  });

  if (!meetingId) {
    return (
      <SafeAreaView style={styles.centerFill} edges={['top']}>
        <Text style={styles.muted}>잘못된 주소예요.</Text>
        <Pressable onPress={exitChatRoom} style={styles.backLink}>
          <Text style={styles.backLinkText}>돌아가기</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  if (meeting === undefined) {
    return (
      <SafeAreaView style={styles.centerFill} edges={['top']}>
        <ActivityIndicator color={GinitTheme.colors.primary} />
        <Text style={styles.muted}>모임 불러오는 중…</Text>
      </SafeAreaView>
    );
  }

  if (!meeting || meetingError) {
    return (
      <SafeAreaView style={styles.centerFill} edges={['top']}>
        <Text style={styles.errorText}>{meetingError ?? '모임을 찾을 수 없어요.'}</Text>
        <Pressable onPress={exitChatRoom} style={styles.backLink}>
          <Text style={styles.backLinkText}>돌아가기</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  if (allowed === false) {
    return (
      <SafeAreaView style={styles.centerFill} edges={['top']}>
        <Text style={styles.errorText}>참여 중인 모임의 채팅방만 들어갈 수 있어요.</Text>
        <Pressable onPress={exitChatRoom} style={styles.backLink}>
          <Text style={styles.backLinkText}>돌아가기</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const title = meeting.title?.trim() || '모임 채팅';
  const pCount = meetingParticipantCount(meeting);

  const imageViewerEntry =
    imageViewer && imageViewer.gallery.length > 0
      ? imageViewer.gallery[Math.min(imageViewer.gallery.length - 1, Math.max(0, imageViewer.index))]
      : null;
  const imageViewerMetaResolved = imageViewerEntry ? meetingImageViewerMeta(imageViewerEntry, profiles) : { senderLabel: '', sentAtLabel: '' };
  const imageViewerCanDelete = Boolean(
    imageViewerEntry &&
      myId &&
      imageViewerEntry.senderId?.trim() &&
      normalizeParticipantId(imageViewerEntry.senderId.trim()) === myId,
  );

  return (
    <GestureHandlerRootView style={styles.ghRoot}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.flexColumn}>
        <View style={styles.topBar}>
          <Pressable
            onPress={chatSearchMode ? closeChatSearch : exitChatRoom}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={chatSearchMode ? '검색 닫기' : '뒤로'}>
            <GinitSymbolicIcon name="chevron-back" size={22} color="#0f172a" />
          </Pressable>
          {chatSearchMode ? (
            <View style={styles.searchTitleBlock}>
              <TextInput
                ref={chatSearchInputRef}
                style={styles.searchTitleInput}
                placeholder="검색어 입력"
                placeholderTextColor="#94a3b8"
                value={chatSearchQuery}
                onChangeText={(t) => {
                  setChatSearchQuery(t);
                  setChatSearchCommittedQuery('');
                  setChatSearchSession(createChatSearchSession(''));
                }}
                autoCorrect={false}
                autoCapitalize="none"
                clearButtonMode="while-editing"
                returnKeyType="search"
                onSubmitEditing={() => {
                  void runMeetingLocalSearch();
                }}
              />
            </View>
          ) : (
            <View style={styles.titleBlock}>
              <Text style={styles.titleMain} numberOfLines={1}>
                {title}
              </Text>
              <Pressable onPress={goMeetingDetail} hitSlop={6} accessibilityRole="link" accessibilityLabel="모임 상세">
                <Text style={styles.titleLink}>모임으로 가기</Text>
              </Pressable>
            </View>
          )}
          {!chatSearchMode ? (
            <View style={styles.topBarRight}>
              <Text style={styles.participantCount}>{pCount}</Text>
              <View style={styles.headerActions}>
                <Pressable
                  onPress={openChatSearch}
                  accessibilityRole="button"
                  accessibilityLabel="대화 검색"
                  hitSlop={10}
                  style={styles.searchIconWrap}>
                  <GinitSymbolicIcon name="search-outline" size={22} color="#0f172a" />
                </Pressable>
                <Pressable
                  onPress={() => router.push(`/meeting-chat/${meetingId}/settings`)}
                  accessibilityRole="button"
                  accessibilityLabel="채팅방 설정"
                  hitSlop={10}
                  style={styles.settingsIconWrap}>
                  <GinitSymbolicIcon name="settings-outline" size={22} color="#0f172a" />
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>

        {announcementText ? (
          <Pressable
            onPress={goMeetingDetail}
            style={styles.announcementBar}
            accessibilityRole="link"
            accessibilityLabel="모임 상세">
            <BlurView tint="light" intensity={60} style={styles.announcementInner}>
              <GinitSymbolicIcon name="megaphone-outline" size={16} color="#0052CC" />
              <Text style={styles.announcementText} numberOfLines={1}>
                {announcementText}
              </Text>
              <GinitSymbolicIcon name="chevron-forward" size={16} color="#64748b" />
            </BlurView>
          </Pressable>
        ) : null}

        <MeetingChatMainColumn
          chatError={chatError}
          searchNavigateLoading={searchNavigateLoading}
          setListRef={setListRef}
          setInnerFlashListRef={setInnerFlashListRef}
          chatListRows={chatListRows}
          renderItem={renderItem}
          chatListContentStyle={chatListContentStyle}
          onChatScroll={onChatScroll}
          listFooterLoading={listFooterLoading}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          onPrefetchOlderMessages={hasNextPage ? onPrefetchOlderMessages : undefined}
          showJumpToBottomFab={showJumpToBottomFab}
          composerDockBlockHeight={composerDockBlockHeight}
          keyboardHeight={keyboardHeight}
          jumpToLatest={jumpToLatest}
          composerBottomPad={composerBottomPad}
          onComposerDockLayout={onComposerDockLayout}
          replyTo={replyTo}
          setReplyTo={setReplyTo}
          profiles={profiles}
          setComposerInputBarHeight={setComposerInputBarHeight}
          messageInputRef={messageInputRef}
          draft={draft}
          setDraft={setDraft}
          sending={sending}
          onSend={onSend}
          onPressAttach={onPressAttach}
          bottomSearchNavigator={bottomSearchNavigator}
          hideComposer={chatSearchMode}
        />

        <MeetingChatMediaPickerModal
          visible={mediaPickerOpen}
          onClose={() => setMediaPickerOpen(false)}
          sendBusy={sending}
          onConfirmSend={handleMediaPickerConfirmMeeting}
        />

        {/* 사진 크게 보기 */}
        <Modal visible={imageViewer !== null} transparent animationType="fade" onRequestClose={() => setImageViewer(null)}>
          <GestureHandlerRootView style={meetingChatBodyStyles.viewerRoot}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => !imageViewerBusy && setImageViewer(null)}
              pointerEvents="none"
              accessibilityRole="button"
              accessibilityLabel="닫기"
            />
            <View style={meetingChatBodyStyles.viewerSheet} pointerEvents="box-none">
              <View style={[meetingChatBodyStyles.viewerTopRow, { paddingTop: insets.top + 8 }]}>
                <Pressable
                  onPress={() => setImageViewer(null)}
                  hitSlop={10}
                  disabled={imageViewerBusy}
                  accessibilityRole="button"
                  accessibilityLabel="닫기">
                  <GinitSymbolicIcon name="close" size={26} color="#fff" />
                </Pressable>
                <View style={meetingChatBodyStyles.viewerMetaCol} pointerEvents="none">
                  <Text style={meetingChatBodyStyles.viewerMetaName} numberOfLines={1}>
                    {imageViewerMetaResolved.senderLabel}
                  </Text>
                  {imageViewerMetaResolved.sentAtLabel ? (
                    <Text style={meetingChatBodyStyles.viewerMetaTime} numberOfLines={1}>
                      {imageViewerMetaResolved.sentAtLabel}
                    </Text>
                  ) : null}
                </View>
                <View style={meetingChatBodyStyles.viewerActions}>
                  <Pressable
                    onPress={() => {
                      const u = imageViewerEntry?.imageUrl?.trim() ?? '';
                      if (!u) return;
                      void (async () => {
                        setImageViewerBusy(true);
                        try {
                          await shareRemoteImageUrl(u);
                        } catch (e) {
                          Alert.alert('공유 실패', e instanceof Error ? e.message : '다시 시도해 주세요.');
                        } finally {
                          setImageViewerBusy(false);
                        }
                      })();
                    }}
                    hitSlop={10}
                    disabled={imageViewerBusy}
                    accessibilityRole="button"
                    accessibilityLabel="공유">
                    <GinitSymbolicIcon name="share-outline" size={24} color="#fff" />
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      const u = imageViewerEntry?.imageUrl?.trim() ?? '';
                      if (!u) return;
                      void (async () => {
                        setImageViewerBusy(true);
                        try {
                          await saveRemoteImageUrlToLibrary(u);
                        } catch (e) {
                          Alert.alert('저장 실패', e instanceof Error ? e.message : '다시 시도해 주세요.');
                        } finally {
                          setImageViewerBusy(false);
                        }
                      })();
                    }}
                    hitSlop={10}
                    disabled={imageViewerBusy}
                    accessibilityRole="button"
                    accessibilityLabel="저장">
                    <GinitSymbolicIcon name="download-outline" size={24} color="#fff" />
                  </Pressable>
                  {imageViewerCanDelete ? (
                    <Pressable
                      onPress={() => {
                        const u = imageViewerEntry?.imageUrl?.trim() ?? '';
                        const mid = meetingId.trim();
                        const msgId = imageViewerEntry?.id.trim() ?? '';
                        if (!u || !mid || !msgId) return;
                        if (imageViewerBusy) return;
                        Alert.alert('사진 삭제', '이 사진을 채팅방에서 삭제할까요?', [
                          { text: '취소', style: 'cancel' },
                          {
                            text: '삭제',
                            style: 'destructive',
                            onPress: () => {
                              void (async () => {
                                setImageViewerBusy(true);
                                try {
                                  await deleteMeetingChatImageMessageBestEffort(mid, msgId, u);
                                  setImageViewer(null);
                                } catch (e) {
                                  Alert.alert('삭제 실패', e instanceof Error ? e.message : '다시 시도해 주세요.');
                                } finally {
                                  setImageViewerBusy(false);
                                }
                              })();
                            },
                          },
                        ]);
                      }}
                      hitSlop={10}
                      disabled={imageViewerBusy}
                      accessibilityRole="button"
                      accessibilityLabel="삭제">
                      <GinitSymbolicIcon name="trash-outline" size={24} color="#fff" />
                    </Pressable>
                  ) : null}
                </View>
              </View>
              {imageViewer && imageViewer.gallery.length > 0 ? (
                <View style={meetingChatBodyStyles.viewerImageWrap}>
                  <MeetingChatImageViewerGallery
                    gallery={imageViewer.gallery}
                    initialIndex={imageViewer.index}
                    onIndexChange={onChatImageGalleryIndexChange}
                  />
                </View>
              ) : null}
            </View>
          </GestureHandlerRootView>
        </Modal>
        </View>
      </SafeAreaView>
      {/* 프로필 팝업 대신 전체 화면 프로필로 이동합니다. */}
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  ghRoot: { flex: 1 },
  safe: { flex: 1, backgroundColor: '#ECEFF1' },
  flexColumn: { flex: 1, flexDirection: 'column' },
  centerFill: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 12,
    backgroundColor: '#ECEFF1',
  },
  muted: { fontSize: 14, color: '#64748b' },
  errorText: { fontSize: 15, color: '#b91c1c', textAlign: 'center' },
  backLink: { marginTop: 8, padding: 10 },
  backLinkText: { fontSize: 15, fontWeight: '700', color: GinitTheme.colors.primary },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 6,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(15, 23, 42, 0.08)',
  },
  announcementBar: {
    paddingHorizontal: 8,
    paddingTop: 6,
    backgroundColor: '#ECEFF1',
  },
  announcementInner: {
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    overflow: 'hidden',
  },
  announcementText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#0f172a',
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  searchTitleBlock: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchTitleInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 34,
    borderRadius: 10,
    marginRight: 10,
    paddingHorizontal: 10,
    paddingRight: 14,
    backgroundColor: '#f1f5f9',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.10)',
    fontSize: 15,
    color: '#0f172a',
    paddingVertical: Platform.OS === 'ios' ? 8 : 6,
  },
  bottomSearchNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  bottomSearchNavRowCenter: {
    position: 'relative',
  },
  bottomSearchNavCenterOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  bottomSearchNavCenterText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
    textAlign: 'center',
  },
  bottomSearchNavStatus: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
  },
  bottomSearchNavStatusCenter: {
    textAlign: 'center',
  },
  bottomSearchNavBtns: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  bottomSearchNavBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.10)',
  },
  bottomSearchNavBtnPressed: { opacity: 0.86 },
  bottomSearchNavBtnDisabled: { opacity: 0.45 },
  titleMain: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0f172a',
  },
  titleLink: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
  },
  topBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexShrink: 0,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
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
  participantCount: {
    fontSize: 14,
    fontWeight: '700',
    color: '#94a3b8',
    minWidth: 22,
    textAlign: 'right',
  },
  // (모달 검색 UI 제거로 미사용)
  // (헤더 인라인 검색으로 이동: 모달 내 네비 버튼 스타일은 미사용)
  chatSearchStatusText: {
    textAlign: 'right',
    paddingHorizontal: 16,
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
    marginBottom: 2,
  },
  chatSearchBusyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  chatSearchBusyText: {
    fontSize: 14,
    color: '#64748b',
    fontWeight: '600',
  },
  chatSearchListContent: {
    paddingHorizontal: 14,
    paddingBottom: 24,
    flexGrow: 1,
  },
  chatSearchEmpty: {
    marginTop: 48,
    textAlign: 'center',
    fontSize: 15,
    color: '#94a3b8',
    lineHeight: 22,
    fontWeight: '600',
  },
  chatSearchRow: {
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(15, 23, 42, 0.06)',
  },
  chatSearchRowPressed: {
    backgroundColor: 'rgba(15, 23, 42, 0.04)',
  },
  chatSearchRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 6,
  },
  chatSearchNick: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
  },
  chatSearchWhen: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94a3b8',
  },
  chatSearchSnippet: {
    fontSize: 14,
    lineHeight: 20,
    color: '#475569',
    fontWeight: '500',
  },
  chatSearchSnippetHit: {
    fontWeight: '600',
    color: '#0f172a',
    backgroundColor: 'rgba(255, 235, 59, 0.35)',
  },
});
