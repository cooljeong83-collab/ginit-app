
import { useFocusEffect, useIsFocused, useNavigation } from '@react-navigation/native';
import { type InfiniteData, useQueryClient } from '@tanstack/react-query';
import { BlurView } from 'expo-blur';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { Timestamp } from 'firebase/firestore';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Animated,
    Dimensions,
    Easing,
    FlatList,
    InteractionManager,
    Keyboard,
    type KeyboardEvent,
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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { MeetingChatImageViewerZoomArea } from '@/components/chat/MeetingChatImageViewerZoomArea';
import { MeetingChatMainColumn } from '@/components/chat/MeetingChatMainColumn';
import { meetingChatBodyStyles } from '@/components/chat/meeting-chat-body-styles';
import type { MeetingChatQuickActionDef } from '@/components/chat/meeting-chat-quick-action-row';
import { meetingImageViewerMeta, profileForSender } from '@/components/chat/meeting-chat-ui-helpers';
import { useMeetingChatRenderItem } from '@/components/chat/use-meeting-chat-render-item';
import { InAppAlarmsBellButton } from '@/components/in-app-alarms/InAppAlarmsBellButton';
import { MeetingPeerProfileModal } from '@/components/meeting/MeetingPeerProfileModal';
import { GinitTheme } from '@/constants/ginit-theme';
import { useInAppAlarms } from '@/src/context/InAppAlarmsContext';
import { useUserSession } from '@/src/context/UserSessionContext';
import {
    flattenMeetingChatInfinitePages,
    meetingChatMessagesQueryKey,
    mergeMeetingChatInfiniteAppendPages,
    useMeetingChatMessagesInfiniteQuery,
} from '@/src/hooks/use-meeting-chat-messages-infinite-query';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { saveRemoteImageUrlToLibrary, shareRemoteImageUrl } from '@/src/lib/chat-image-actions';
import { setCurrentChatRoomId } from '@/src/lib/current-chat-room';
import { resolveFeedLocationContext } from '@/src/lib/feed-display-location';
import { loadFeedLocationCache } from '@/src/lib/feed-location-cache';
import type { LatLng } from '@/src/lib/geo-distance';
import { isUserJoinedMeeting } from '@/src/lib/joined-meetings';
import type { MeetingChatFetchedMessagesPage, MeetingChatMessage } from '@/src/lib/meeting-chat';
import {
    deleteMeetingChatImageMessageBestEffort,
    fetchOlderMeetingChatPagesUntilTargetMessageId,
    meetingChatMessageSearchHaystack,
    searchMeetingChatMessages,
    sendMeetingChatImageMessage,
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
  const [peerProfileUserId, setPeerProfileUserId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [replyTo, setReplyTo] = useState<MeetingChatMessage['replyTo']>(null);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  /** + 퀵 메뉴 행별 진행 0→1 (아래에서 올라오며 페이드), 닫을 때 역재생 */
  const plusRowAnims = useRef([
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
  ]).current;
  /** 0 = +, 1 = × — 스프링으로 회전·스케일 교차 */
  const plusIconMorph = useRef(new Animated.Value(0)).current;
  /** 키보드 본체 + IME 상단(이모지/툴바 등)까지 포함해 입력창을 올리기 위한 하단 여백 */
  const [keyboardBottomInset, setKeyboardBottomInset] = useState(0);
  const [userCoords, setUserCoords] = useState<LatLng | null>(null);
  const [imageViewer, setImageViewer] = useState<{
    messageId: string;
    url: string;
    senderLabel: string;
    sentAtLabel: string;
    canDelete: boolean;
  } | null>(null);
  const [imageViewerBusy, setImageViewerBusy] = useState(false);
  /** 맨 아래에서 조금이라도 위로 올라왔을 때만「최신으로」FAB 표시 */
  const [showJumpToBottomFab, setShowJumpToBottomFab] = useState(false);
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [chatSearchResults, setChatSearchResults] = useState<MeetingChatMessage[]>([]);
  const [chatSearchBusy, setChatSearchBusy] = useState(false);
  /** 검색 결과 점프 시 과거 메시지를 한꺼번에 불러오는 동안 */
  const [searchNavigateLoading, setSearchNavigateLoading] = useState(false);
  /** 퀵 메뉴·닫기 레이어를 입력창(composerDock) 바로 위에 붙이기 위한 높이 */
  const [composerDockBlockHeight, setComposerDockBlockHeight] = useState(104);
  const [composerInputBarHeight, setComposerInputBarHeight] = useState(56);
  const chatSearchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatSearchInputRef = useRef<TextInput>(null);
  const listRef = useRef<any>(null);
  const innerFlatListRef = useRef<any>(null);
  const setListRef = useCallback((r: any) => {
    if (r) listRef.current = r;
  }, []);
  const setInnerFlatListRef = useCallback((r: any) => {
    if (r) innerFlatListRef.current = r;
  }, []);
  const messageInputRef = useRef<TextInput>(null);
  const messagesRef = useRef<MeetingChatMessage[]>([]);
  const lastMarkedReadRef = useRef<{ meetingId: string; messageId: string } | null>(null);
  const { markChatReadUpTo } = useInAppAlarms();
  const lastScrollOffsetRef = useRef(0);
  const pendingAutoScrollToLatestRef = useRef(false);
  const lastAutoScrolledMessageIdRef = useRef<string>('');

  const resolveListScroller = useCallback(() => {
    // KeyboardAwareFlatList는 outer ref로는 스크롤 메서드가 없는 경우가 있어 inner ref를 최우선합니다.
    const r = innerFlatListRef.current ?? listRef.current;
    if (!r) return null;
    // KeyboardAwareFlatList / FlatList / AnimatedFlatList 등 다양한 래퍼 케이스를 모두 커버
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

  const scrollToMessageIndexBestEffort = useCallback((idx: number) => {
    const index = Math.max(0, Math.floor(idx));
    // inverted + 가변 높이: index*고정px 오프셋 추정은 클램프 버그가 있어 scrollToIndex만 사용.
    // 답장/검색 이동은 애니메이션 없이 즉시 점프(animated: false).
    InteractionManager.runAfterInteractions(() => {
      setTimeout(() => {
        scrollToIndexSafe(index, 0.35, false);
        requestAnimationFrame(() => {
          scrollToIndexSafe(index, 0.35, false);
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

    const shouldAutoScroll = pendingAutoScrollToLatestRef.current || !showJumpToBottomFab;
    if (!shouldAutoScroll) return;

    // 내가 보낸 메시지나, 현재 최신 영역에 머무르고 있는 상태라면 최신을 유지
    lastAutoScrolledMessageIdRef.current = latest.id;
    pendingAutoScrollToLatestRef.current = false;
    requestAnimationFrame(() => {
      scrollToOffsetSafe(0, false);
    });
  }, [messages, showJumpToBottomFab, scrollToOffsetSafe]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await loadFeedLocationCache();
      if (cancelled) return;
      let coordsForDistance = null as LatLng | null;
      if (cached?.coords) {
        coordsForDistance = cached.coords;
        setUserCoords(coordsForDistance);
      }
      const ctx = await resolveFeedLocationContext();
      if (cancelled) return;
      coordsForDistance = ctx.coords ?? coordsForDistance;
      setUserCoords(coordsForDistance);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    /** 키보드 바로 위에 살짝만 띄우기: 기본은 `height` + 작은 slack, IME가 더 크게 잡힐 때만 `screenY` 반영 */
    const slack = Platform.select({ ios: 8, android: 10, default: 8 });
    const apply = (e: KeyboardEvent) => {
      const { height, screenY } = e.endCoordinates;
      const h = typeof height === 'number' ? height : 0;
      if (h < 32) return;
      const winH = Dimensions.get('window').height;
      const fromBottom = Number.isFinite(screenY) ? Math.max(0, winH - screenY) : 0;
      let pad = h + slack;
      if (fromBottom > h + 28) {
        pad = fromBottom + Math.min(slack + 4, 12);
      }
      setKeyboardBottomInset(Math.ceil(pad));
      requestAnimationFrame(() => {
        scrollToOffsetSafe(Math.max(0, composerInputBarHeight), false);
      });
    };
    const clear = () => {
      setKeyboardBottomInset(0);
    };

    const subs: { remove: () => void }[] = [];
    if (Platform.OS === 'ios') {
      subs.push(Keyboard.addListener('keyboardWillShow', apply));
      subs.push(Keyboard.addListener('keyboardWillChangeFrame', apply));
      subs.push(Keyboard.addListener('keyboardWillHide', clear));
    } else {
      subs.push(Keyboard.addListener('keyboardDidShow', apply));
      subs.push(Keyboard.addListener('keyboardDidHide', clear));
    }
    return () => subs.forEach((s) => s.remove());
  }, [scrollToOffsetSafe, composerInputBarHeight]);

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

  const closeChatSearch = useCallback(() => {
    setChatSearchOpen(false);
    setChatSearchQuery('');
    setChatSearchResults([]);
    setChatSearchBusy(false);
    if (chatSearchDebounceRef.current) {
      clearTimeout(chatSearchDebounceRef.current);
      chatSearchDebounceRef.current = null;
    }
  }, []);

  const runChatSearch = useCallback(
    async (q: string) => {
      const t = q.trim();
      if (!meetingId) {
        setChatSearchResults([]);
        return;
      }
      if (!t) {
        setChatSearchResults([]);
        setChatSearchBusy(false);
        return;
      }
      setChatSearchBusy(true);
      try {
        const rows = await searchMeetingChatMessages(meetingId, t, { maxDocsScanned: 3000 });
        setChatSearchResults(rows);
      } catch {
        setChatSearchResults([]);
        Alert.alert('검색 실패', '네트워크 상태를 확인한 뒤 다시 시도해 주세요.');
      } finally {
        setChatSearchBusy(false);
      }
    },
    [meetingId],
  );

  useEffect(() => {
    if (!chatSearchOpen) return;
    if (chatSearchDebounceRef.current) clearTimeout(chatSearchDebounceRef.current);
    chatSearchDebounceRef.current = setTimeout(() => {
      void runChatSearch(chatSearchQuery);
    }, 320);
    return () => {
      if (chatSearchDebounceRef.current) {
        clearTimeout(chatSearchDebounceRef.current);
        chatSearchDebounceRef.current = null;
      }
    };
  }, [chatSearchQuery, chatSearchOpen, runChatSearch]);

  useEffect(() => {
    if (!chatSearchOpen) return;
    const t = setTimeout(() => chatSearchInputRef.current?.focus(), 280);
    return () => clearTimeout(t);
  }, [chatSearchOpen]);

  const jumpToSearchResult = useCallback(
    async (msg: MeetingChatMessage) => {
      const mid = meetingId.trim();
      const tid = msg.id.trim();
      if (!mid || !tid) return;

      closeChatSearch();
      Keyboard.dismiss();

      const cacheKey = meetingChatMessagesQueryKey(mid);
      const indexFromRQ = (): number => {
        const data = queryClient.getQueryData<InfiniteData<MeetingChatFetchedMessagesPage>>(cacheKey);
        return flattenMeetingChatInfinitePages(data).findIndex((m) => m.id === tid);
      };

      let idx = messages.findIndex((m) => m.id === tid);
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
            const { newPages, found } = await fetchOlderMeetingChatPagesUntilTargetMessageId(mid, anchor, tid, {
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
        InteractionManager.runAfterInteractions(() => {
          requestAnimationFrame(() => {
            scrollToMessageIndexBestEffort(idx);
          });
        });
        return;
      }

      const d = msg.createdAt && typeof msg.createdAt.toDate === 'function' ? msg.createdAt.toDate() : null;
      const when = d
        ? d.toLocaleString('ko-KR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          })
        : '';
      Alert.alert(
        '대화 위치',
        when
          ? `이 메시지는 ${when}에 보내진 내용이에요.\n불러올 수 있는 범위 안에서 찾지 못했어요.`
          : '불러올 수 있는 범위 안에서 찾지 못했어요.',
      );
    },
    [meetingId, messages, queryClient, closeChatSearch, scrollToMessageIndexBestEffort, refetchChatMessages],
  );

  const openChatSearch = useCallback(() => {
    Keyboard.dismiss();
    setPlusMenuOpen(false);
    setChatSearchOpen(true);
    setChatSearchQuery('');
    setChatSearchResults([]);
  }, []);

  const renderChatSearchRow = useCallback(
    ({ item }: { item: MeetingChatMessage }) => {
      const sid = item.senderId?.trim() ? normalizeParticipantId(item.senderId.trim()) : '';
      const prof = sid ? profileForSender(profiles, sid) : undefined;
      const withdrawn = isUserProfileWithdrawn(prof);
      const nick =
        item.kind === 'system' ? '알림' : withdrawn ? WITHDRAWN_NICKNAME : (prof?.nickname ?? '회원');
      const hay = meetingChatMessageSearchHaystack(item);
      const parts = splitSearchSnippet(hay, chatSearchQuery);
      const when =
        item.createdAt && typeof item.createdAt.toDate === 'function'
          ? item.createdAt.toDate().toLocaleString('ko-KR', {
              month: 'numeric',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })
          : '';
      return (
        <Pressable
          style={({ pressed }) => [styles.chatSearchRow, pressed && styles.chatSearchRowPressed]}
          onPress={() => void jumpToSearchResult(item)}
          accessibilityRole="button"
          accessibilityLabel={`${nick}, ${when}`}>
          <View style={styles.chatSearchRowTop}>
            <Text style={styles.chatSearchNick} numberOfLines={1}>
              {nick}
            </Text>
            <Text style={styles.chatSearchWhen} numberOfLines={1}>
              {when}
            </Text>
          </View>
          <Text style={styles.chatSearchSnippet} numberOfLines={2}>
            {parts.head}
            {parts.mid ? <Text style={styles.chatSearchSnippetHit}>{parts.mid}</Text> : null}
            {parts.tail}
          </Text>
        </Pressable>
      );
    },
    [profiles, chatSearchQuery, jumpToSearchResult],
  );

  const onSend = useCallback(async () => {
    if (!meetingId || !userId?.trim()) {
      Alert.alert('안내', '로그인 후 메시지를 보낼 수 있어요.');
      return;
    }
    const body = draft.trim();
    if (!body || sending || uploadingImage) return;
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
  }, [meetingId, userId, draft, sending, uploadingImage, replyTo]);

  const onPickImage = useCallback(async () => {
    if (!meetingId || !userId?.trim()) {
      Alert.alert('안내', '로그인 후 메시지를 보낼 수 있어요.');
      return;
    }
    if (uploadingImage) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('권한 필요', '사진을내려면 사진 라이브러리 접근을 허용해 주세요.');
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: false,
      quality: 1,
    });
    if (picked.canceled) return;
    const asset = picked.assets[0];
    if (!asset?.uri) return;
    setUploadingImage(true);
    try {
      const caption = draft.trim();
      await sendMeetingChatImageMessage(meetingId, userId, asset.uri, {
        caption: caption || undefined,
        naturalWidth: typeof asset.width === 'number' && asset.width > 0 ? asset.width : undefined,
      });
      if (caption) setDraft('');
    } catch (e) {
      Alert.alert('전송 실패', e instanceof Error ? e.message : '다시 시도해 주세요.');
    } finally {
      setUploadingImage(false);
    }
  }, [meetingId, userId, draft, uploadingImage]);

  const plusPillMaxWidth = useMemo(
    () => Math.max(200, Math.floor(Dimensions.get('window').width - 40)),
    [],
  );
  const chatListContentStyle = useMemo(
    () => [
      meetingChatBodyStyles.listContent,
      {
        // inverted 리스트에서 paddingTop이 시각적 하단 여백 역할
        paddingTop: keyboardBottomInset > 0 ? composerInputBarHeight : 4,
      },
    ],
    [keyboardBottomInset, composerInputBarHeight],
  );
  const closePlusMenuThen = useCallback(
    (after?: () => void) => {
      if (!plusMenuOpen) {
        after?.();
        return;
      }
      plusRowAnims.forEach((v) => {
        v.stopAnimation();
      });
      const duration = 680;
      const timings = plusRowAnims.map((v) =>
        Animated.timing(v, {
          toValue: 0,
          duration,
          easing: Easing.bezier(0.4, 0, 0.58, 1),
          useNativeDriver: true,
        }),
      );
      Animated.stagger(44, [timings[0], timings[1], timings[2], timings[3]]).start(({ finished }) => {
        setPlusMenuOpen(false);
        if (finished) after?.();
      });
    },
    [plusMenuOpen, plusRowAnims],
  );

  const openPlusMenu = useCallback(() => {
    if (uploadingImage || sending) return;
    if (plusMenuOpen) {
      closePlusMenuThen();
    } else {
      setPlusMenuOpen(true);
    }
  }, [uploadingImage, sending, plusMenuOpen, closePlusMenuThen]);

  const onComposerDockLayout = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h > 0) setComposerDockBlockHeight(h);
  }, []);

  const plusQuickActions: MeetingChatQuickActionDef[] = useMemo(
    () => [
      {
        key: 'photo',
        label: '사진',
        icon: 'image-outline',
        onPress: () => closePlusMenuThen(() => void onPickImage()),
      },
      {
        key: 'place',
        label: '장소',
        icon: 'sparkles-outline',
        onPress: () =>
          closePlusMenuThen(() => {
            Alert.alert('AI 장소추천', '곧 채팅에서 바로 추천을 띄워드릴게요.');
          }),
      },
      {
        key: 'poll',
        label: '투표',
        icon: 'bar-chart-outline',
        onPress: () =>
          closePlusMenuThen(() => {
            Alert.alert('투표 생성', '곧 제공됩니다. (다음 단계: 채팅에서 투표 카드 생성)');
          }),
      },
      {
        key: 'settle',
        label: '정산',
        icon: 'card-outline',
        onPress: () =>
          closePlusMenuThen(() => {
            setDraft((v) => (v.trim() ? v : '정산 요청합니다. 각자 확인 부탁드려요!'));
          }),
      },
    ],
    [onPickImage, closePlusMenuThen],
  );

  useEffect(() => {
    if (!plusMenuOpen) {
      plusRowAnims.forEach((v) => v.setValue(0));
      return;
    }
    plusRowAnims.forEach((v) => {
      v.stopAnimation();
      v.setValue(0);
    });
    const duration = 900;
    const timings = plusRowAnims.map((v) =>
      Animated.timing(v, {
        toValue: 1,
        duration,
        easing: Easing.bezier(0.22, 0.99, 0.26, 0.99),
        useNativeDriver: true,
      }),
    );
    Animated.stagger(56, [timings[3], timings[2], timings[1], timings[0]]).start();
  }, [plusMenuOpen, plusRowAnims]);

  useEffect(() => {
    plusIconMorph.stopAnimation();
    Animated.spring(plusIconMorph, {
      toValue: plusMenuOpen ? 1 : 0,
      friction: 9,
      tension: 168,
      useNativeDriver: true,
    }).start();
  }, [plusMenuOpen, plusIconMorph]);

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
        InteractionManager.runAfterInteractions(() => {
          requestAnimationFrame(() => {
            scrollToMessageIndexBestEffort(idx);
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

  const openMeetingChatImageViewer = useCallback((item: MeetingChatMessage) => {
    const url = item.imageUrl?.trim();
    if (!url || item.kind !== 'image') return;
    const { senderLabel, sentAtLabel } = meetingImageViewerMeta(item, profiles);
    const sid = item.senderId?.trim() ? normalizeParticipantId(item.senderId.trim()) : '';
    const canDelete = Boolean(myId && sid && sid === myId);
    setImageViewer({ messageId: item.id, url, senderLabel, sentAtLabel, canDelete });
  }, [profiles, myId]);

  const renderItem = useMeetingChatRenderItem({
    messages,
    myId,
    hostNorm,
    profiles,
    unreadCountForMessage,
    jumpToRepliedMessage,
    setReplyTo,
    setPeerProfileUserId,
    openMeetingChatImageViewer,
    listRef,
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

  const composerBottomPad = keyboardBottomInset > 0 ? keyboardBottomInset : Math.max(insets.bottom, 8);

  return (
    <GestureHandlerRootView style={styles.ghRoot}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.flexColumn}>
        <View style={styles.topBar}>
          <Pressable
            onPress={exitChatRoom}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="뒤로">
            <GinitSymbolicIcon name="chevron-back" size={22} color="#0f172a" />
          </Pressable>
          <View style={styles.titleBlock}>
            <Text style={styles.titleMain} numberOfLines={1}>
              {title}
            </Text>
            <Pressable onPress={goMeetingDetail} hitSlop={6} accessibilityRole="link" accessibilityLabel="모임 상세">
              <Text style={styles.titleLink}>모임으로 가기</Text>
            </Pressable>
          </View>
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
              <InAppAlarmsBellButton />
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
        </View>

        {announcementText ? (
          <Pressable
            onPress={() => Alert.alert('확정된 정보', announcementText)}
            style={styles.announcementBar}
            accessibilityRole="button"
            accessibilityLabel="공지">
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
          setInnerFlatListRef={setInnerFlatListRef}
          messages={messages}
          renderItem={renderItem}
          chatListContentStyle={chatListContentStyle}
          onScrollToIndexFailed={(info) => {
            const target = info.index;
            setTimeout(() => {
              scrollToIndexSafe(target, 0.35, false);
            }, 100);
            setTimeout(() => {
              scrollToIndexSafe(target, 0.35, false);
            }, 350);
          }}
          onChatScroll={onChatScroll}
          listFooterLoading={listFooterLoading}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          onPrefetchOlderMessages={hasNextPage ? onPrefetchOlderMessages : undefined}
          showJumpToBottomFab={showJumpToBottomFab}
          plusMenuOpen={plusMenuOpen}
          composerDockBlockHeight={composerDockBlockHeight}
          jumpToLatest={jumpToLatest}
          closePlusMenuThen={closePlusMenuThen}
          plusQuickActions={plusQuickActions}
          plusRowAnims={plusRowAnims}
          plusPillMaxWidth={plusPillMaxWidth}
          composerBottomPad={composerBottomPad}
          onComposerDockLayout={onComposerDockLayout}
          replyTo={replyTo}
          setReplyTo={setReplyTo}
          profiles={profiles}
          setComposerInputBarHeight={setComposerInputBarHeight}
          messageInputRef={messageInputRef}
          draft={draft}
          setDraft={setDraft}
          uploadingImage={uploadingImage}
          sending={sending}
          onSend={onSend}
          openPlusMenu={openPlusMenu}
          plusIconMorph={plusIconMorph}
        />

        {/* 대화 검색 */}
        <Modal
          visible={chatSearchOpen}
          animationType="slide"
          presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined}
          onRequestClose={closeChatSearch}>
          <SafeAreaView style={styles.chatSearchSafe} edges={['top', 'bottom']}>
            <View style={styles.chatSearchHeader}>
              <Pressable
                onPress={closeChatSearch}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="닫기">
                <GinitSymbolicIcon name="chevron-back" size={22} color="#0f172a" />
              </Pressable>
              <Text style={styles.chatSearchTitle}>대화 검색</Text>
              <View style={styles.chatSearchHeaderSpacer} />
            </View>
            <View style={styles.chatSearchFieldWrap}>
              <GinitSymbolicIcon name="search-outline" size={20} color="#94a3b8" style={styles.chatSearchFieldIcon} />
              <TextInput
                ref={chatSearchInputRef}
                style={styles.chatSearchInput}
                placeholder="대화 내용을 입력하세요"
                placeholderTextColor="#94a3b8"
                value={chatSearchQuery}
                onChangeText={setChatSearchQuery}
                autoCorrect={false}
                autoCapitalize="none"
                clearButtonMode="while-editing"
                returnKeyType="search"
              />
            </View>
            {chatSearchBusy ? (
              <View style={styles.chatSearchBusyRow}>
                <ActivityIndicator color={GinitTheme.colors.primary} />
                <Text style={styles.chatSearchBusyText}>검색 중…</Text>
              </View>
            ) : null}
            <FlatList
              data={chatSearchResults}
              keyExtractor={(it) => it.id}
              renderItem={renderChatSearchRow}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.chatSearchListContent}
              ListEmptyComponent={
                !chatSearchBusy ? (
                  <Text style={styles.chatSearchEmpty}>
                    {chatSearchQuery.trim()
                      ? '검색 결과가 없어요.\n다른 단어로 검색해 보세요.'
                      : '검색할 단어를 입력하면\n과거 대화에서 찾아 드려요.'}
                  </Text>
                ) : null
              }
            />
          </SafeAreaView>
        </Modal>

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
                    {imageViewer?.senderLabel ?? ''}
                  </Text>
                  {imageViewer?.sentAtLabel ? (
                    <Text style={meetingChatBodyStyles.viewerMetaTime} numberOfLines={1}>
                      {imageViewer.sentAtLabel}
                    </Text>
                  ) : null}
                </View>
                <View style={meetingChatBodyStyles.viewerActions}>
                  <Pressable
                    onPress={() => {
                      const u = imageViewer?.url.trim() ?? '';
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
                      const u = imageViewer?.url.trim() ?? '';
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
                  {imageViewer?.canDelete ? (
                    <Pressable
                      onPress={() => {
                        const u = imageViewer?.url.trim() ?? '';
                        const mid = meetingId.trim();
                        const msgId = imageViewer?.messageId.trim() ?? '';
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
              {imageViewer?.url ? (
                <View style={meetingChatBodyStyles.viewerImageWrap}>
                  <MeetingChatImageViewerZoomArea uri={imageViewer.url} />
                </View>
              ) : null}
            </View>
          </GestureHandlerRootView>
        </Modal>
        </View>
      </SafeAreaView>
      <MeetingPeerProfileModal
        visible={peerProfileUserId != null}
        peerAppUserId={peerProfileUserId}
        onClose={() => setPeerProfileUserId(null)}
      />
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
  participantCount: {
    fontSize: 14,
    fontWeight: '700',
    color: '#94a3b8',
    minWidth: 22,
    textAlign: 'right',
  },
  chatSearchSafe: {
    flex: 1,
    backgroundColor: '#fff',
  },
  chatSearchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(15, 23, 42, 0.08)',
  },
  chatSearchTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '600',
    color: '#0f172a',
  },
  chatSearchHeaderSpacer: {
    width: 34,
  },
  chatSearchFieldWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 14,
    marginTop: 12,
    marginBottom: 8,
    paddingHorizontal: 12,
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: '#f1f5f9',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.08)',
  },
  chatSearchFieldIcon: {
    marginRight: 8,
  },
  chatSearchInput: {
    flex: 1,
    fontSize: 16,
    color: '#0f172a',
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
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
