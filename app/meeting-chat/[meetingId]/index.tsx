import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useIsFocused, useNavigation } from '@react-navigation/native';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { Timestamp } from 'firebase/firestore';
import { type ComponentProps, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
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
import { GestureHandlerRootView, PanGestureHandler, type PanGestureHandlerGestureEvent, State } from 'react-native-gesture-handler';
import { KeyboardAwareFlatList } from 'react-native-keyboard-aware-scroll-view';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { MeetingChatImageViewerZoomArea } from '@/components/chat/MeetingChatImageViewerZoomArea';
import { InAppAlarmsBellButton } from '@/components/in-app-alarms/InAppAlarmsBellButton';
import { MeetingPeerProfileModal } from '@/components/meeting/MeetingPeerProfileModal';
import { GinitTheme } from '@/constants/ginit-theme';
import { useInAppAlarms } from '@/src/context/InAppAlarmsContext';
import { useUserSession } from '@/src/context/UserSessionContext';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { saveRemoteImageUrlToLibrary, shareRemoteImageUrl } from '@/src/lib/chat-image-actions';
import { setCurrentChatRoomId } from '@/src/lib/current-chat-room';
import { resolveFeedLocationContext } from '@/src/lib/feed-display-location';
import { loadFeedLocationCache } from '@/src/lib/feed-location-cache';
import type { LatLng } from '@/src/lib/geo-distance';
import { isUserJoinedMeeting } from '@/src/lib/joined-meetings';
import type { MeetingChatFetchedMessagesPage, MeetingChatMessage } from '@/src/lib/meeting-chat';
import { getMeetingChatImageUploadQuality } from '@/src/lib/meeting-chat-image-quality-preference';
import {
  deleteMeetingChatImageMessageBestEffort,
  fetchOlderMeetingChatPagesUntilTargetMessageId,
  meetingChatMessageSearchHaystack,
  searchMeetingChatMessages,
  sendMeetingChatImageMessage,
  sendMeetingChatTextMessage,
  writeMeetingChatReadReceipt,
} from '@/src/lib/meeting-chat';
import {
  flattenMeetingChatInfinitePages,
  meetingChatMessagesQueryKey,
  mergeMeetingChatInfiniteAppendPages,
  useMeetingChatMessagesInfiniteQuery,
} from '@/src/hooks/use-meeting-chat-messages-infinite-query';
import type { Meeting } from '@/src/lib/meetings';
import { meetingParticipantCount, subscribeMeetingById } from '@/src/lib/meetings';
import type { UserProfile } from '@/src/lib/user-profile';
import { WITHDRAWN_NICKNAME, getUserProfilesForIds, isUserProfileWithdrawn } from '@/src/lib/user-profile';

function profileForSender(map: Map<string, UserProfile>, senderId: string): UserProfile | undefined {
  const n = normalizeParticipantId(senderId);
  const hit = map.get(senderId) ?? map.get(n);
  if (hit) return hit;
  for (const [k, v] of map) {
    if (normalizeParticipantId(k) === n) return v;
  }
  return undefined;
}

function formatChatTime(ts: Timestamp | null | undefined): string {
  if (!ts || typeof ts.toDate !== 'function') return '';
  try {
    return ts.toDate().toLocaleString('ko-KR', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return '';
  }
}

/** 사진 크게 보기 상단 — 보낸 시각(날짜·시간) */
function formatImageViewerSentAt(ts: Timestamp | null | undefined): string {
  if (!ts || typeof ts.toDate !== 'function') return '';
  try {
    return ts.toDate().toLocaleString('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return '';
  }
}

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

function meetingImageViewerMeta(
  item: MeetingChatMessage,
  profiles: Map<string, UserProfile>,
): { senderLabel: string; sentAtLabel: string } {
  const sid = item.senderId?.trim() ? normalizeParticipantId(item.senderId.trim()) : '';
  const prof = sid ? profileForSender(profiles, sid) : undefined;
  const withdrawn = isUserProfileWithdrawn(prof);
  const senderLabel = withdrawn ? WITHDRAWN_NICKNAME : (prof?.nickname ?? '회원');
  const sentAtLabel = formatImageViewerSentAt(item.createdAt);
  return { senderLabel, sentAtLabel };
}

function replyTargetLabel(replyTo: MeetingChatMessage['replyTo'], profiles: Map<string, UserProfile>): string {
  const sid = replyTo?.senderId?.trim() ? normalizeParticipantId(replyTo.senderId.trim()) : '';
  const prof = sid ? profileForSender(profiles, sid) : undefined;
  const withdrawn = isUserProfileWithdrawn(prof);
  const nick = withdrawn ? WITHDRAWN_NICKNAME : (prof?.nickname ?? '회원');
  return nick;
}

function replyPreviewText(replyTo: MeetingChatMessage['replyTo']): string {
  if (!replyTo?.messageId) return '';
  return replyTo.kind === 'image' || Boolean(replyTo.imageUrl?.trim()) ? '사진' : (replyTo.text || '메시지');
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

/** 탭바「모임 생성」FAB·마법사 primary CTA와 동일 높이 느낌(bottomPill min 50) */
const PLUS_QUICK_ROW_H = 50;
const PLUS_QUICK_ICON = 22;
/** 펼침 시 좌·우 패딩(마법사 primary 버튼과 유사) */
const PLUS_QUICK_PAD_X = 14;
/** 아이콘과 라벨 사이 — `plusFanLabelMorph.marginLeft` 과 맞출 것 */
const PLUS_QUICK_ICON_LABEL_GAP = 8;
/** 퀵 버튼 캡슐 라운딩(높이의 절반 — 좌우 완전 둥근 알약 형태) */
const PLUS_QUICK_BORDER_RADIUS = PLUS_QUICK_ROW_H / 2;
/** 측정 폭보다 살짝 넓혀 글자가 답답하지 않게 */
const PLUS_QUICK_PILL_EXTRA_W = 12;
/** `GinitTheme.colors.primary` (#1F2A44)와 동일 RGB — 캡슐만 반투명 */
const PLUS_QUICK_PILL_BG = 'rgba(31, 42, 68, 0.8)';

function estimateQuickLabelPx(label: string): number {
  if (!label) return 24;
  return [...label].reduce((acc, ch) => acc + ((ch.codePointAt(0) ?? 0) > 0x007f ? 15 : 9), 0);
}

type MeetingChatQuickActionDef = {
  key: string;
  label: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
};

function MeetingChatQuickActionRow({
  action,
  progress,
  pillMaxW,
}: {
  action: MeetingChatQuickActionDef;
  progress: Animated.Value;
  pillMaxW: number;
}) {
  const p = progress;
  const basePillContentW = (textPx: number) =>
    PLUS_QUICK_PAD_X + PLUS_QUICK_ICON + PLUS_QUICK_ICON_LABEL_GAP + textPx + PLUS_QUICK_PAD_X + PLUS_QUICK_PILL_EXTRA_W;

  const [pillTargetW, setPillTargetW] = useState(() =>
    Math.min(pillMaxW, Math.max(PLUS_QUICK_ROW_H, basePillContentW(estimateQuickLabelPx(action.label)))),
  );

  useEffect(() => {
    setPillTargetW(
      Math.min(pillMaxW, Math.max(PLUS_QUICK_ROW_H, basePillContentW(estimateQuickLabelPx(action.label)))),
    );
  }, [action.label, pillMaxW]);

  const onMeasureLabelTextLayout = useCallback(
    (e: { nativeEvent: { lines: { width: number }[] } }) => {
      const tw = e.nativeEvent.lines[0]?.width;
      if (tw == null || !Number.isFinite(tw)) return;
      const total = Math.ceil(basePillContentW(tw));
      setPillTargetW((prev) => {
        const next = Math.min(pillMaxW, Math.max(PLUS_QUICK_ROW_H, total));
        return prev === next ? prev : next;
      });
    },
    [pillMaxW],
  );

  /** 전체 진행에 맞춰 천천히 떠오르고 페이드 — 애니메이션 이징은 부모 timing에서 처리 */
  const rowLift = p.interpolate({
    inputRange: [0, 1],
    outputRange: [20, 0],
    extrapolate: 'clamp',
  });
  const rowOp = p.interpolate({
    inputRange: [0, 0.14, 0.62],
    outputRange: [0, 1, 1],
    extrapolate: 'clamp',
  });
  const rowScale = p.interpolate({
    inputRange: [0, 1],
    outputRange: [0.93, 1],
    extrapolate: 'clamp',
  });

  return (
    <Animated.View
      style={{
        marginBottom: 10,
        alignSelf: 'flex-start',
        opacity: rowOp,
        transform: [{ translateY: rowLift }, { scale: rowScale }],
      }}>
      <View
        style={[styles.plusQuickMeasureHost, { width: pillMaxW }]}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants">
        <Text style={styles.plusFanLabelMorph} onTextLayout={onMeasureLabelTextLayout} numberOfLines={1}>
          {action.label}
        </Text>
      </View>
      <Pressable
        onPress={action.onPress}
        accessibilityRole="button"
        accessibilityLabel={action.label}
        hitSlop={{ top: 4, bottom: 4, left: 2, right: 2 }}>
        <View
          style={{
            width: pillTargetW,
            minWidth: PLUS_QUICK_ROW_H,
            height: PLUS_QUICK_ROW_H,
            borderRadius: PLUS_QUICK_BORDER_RADIUS,
            backgroundColor: 'transparent',
            ...GinitTheme.shadow.float,
          }}>
          <View
            style={{
              width: '100%',
              height: '100%',
              borderRadius: PLUS_QUICK_BORDER_RADIUS,
              overflow: 'hidden',
              borderWidth: 0,
              backgroundColor: PLUS_QUICK_PILL_BG,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: PLUS_QUICK_PAD_X,
            }}>
            <View style={styles.plusQuickIconLabelRow}>
              <Ionicons name={action.icon} size={PLUS_QUICK_ICON} color="#FFFFFF" />
              <Text style={styles.plusFanLabelMorph} numberOfLines={1}>
                {action.label}
              </Text>
            </View>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
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
      <View style={styles.chatListFooterSpinner} accessibilityLabel="이전 메시지 로딩">
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
      const uploadQuality = await getMeetingChatImageUploadQuality(meetingId);
      await sendMeetingChatImageMessage(meetingId, userId, asset.uri, {
        caption: caption || undefined,
        naturalWidth: typeof asset.width === 'number' && asset.width > 0 ? asset.width : undefined,
        uploadQuality,
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
      styles.listContent,
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

  const renderItem = useCallback(
    ({ item, index }: { item: MeetingChatMessage; index: number }) => {
      const prev = index > 0 ? messages[index - 1] : null; // 배열상 더 최신(시각적으로는 아래)
      const next = index + 1 < messages.length ? messages[index + 1] : null; // 배열상 더 과거(시각적으로는 위)
      const currDate = item.createdAt?.toDate?.() ?? null;
      const nextDate = next?.createdAt?.toDate?.() ?? null;
      const dateLabel =
        currDate &&
        (!nextDate ||
          currDate.getFullYear() !== nextDate.getFullYear() ||
          currDate.getMonth() !== nextDate.getMonth() ||
          currDate.getDate() !== nextDate.getDate())
          ? currDate.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })
          : '';

      if (item.kind === 'system') {
        return (
          <View>
            {dateLabel ? (
              <View style={styles.dateChipRow}>
                <View style={styles.dateChip}>
                  <Text style={styles.dateChipText}>{dateLabel}</Text>
                </View>
              </View>
            ) : null}
            <View style={styles.systemRow}>
              <Text style={styles.systemText}>{item.text}</Text>
            </View>
          </View>
        );
      }
      const sid = item.senderId?.trim() ? normalizeParticipantId(item.senderId.trim()) : '';
      const isMine = Boolean(myId && sid && sid === myId);
      const prevSid =
        prev && prev.kind !== 'system' ? normalizeParticipantId(String(prev.senderId ?? '').trim()) : '';
      const sameSenderAsPrev = Boolean(sid && prevSid && prevSid === sid);
      const showAvatar = !isMine && sid && (index === 0 || !prev || prev.kind === 'system' || !sameSenderAsPrev);

      const prof = sid ? profileForSender(profiles, sid) : undefined;
      const withdrawn = isUserProfileWithdrawn(prof);
      const nick = withdrawn ? WITHDRAWN_NICKNAME : (prof?.nickname ?? '회원');
      const isHost = Boolean(hostNorm && sid && sid === hostNorm);
      const canOpenPeerProfile = Boolean(sid && !withdrawn && sid !== 'ginit_ai');

      const isImage = item.kind === 'image';
      const caption = item.text?.trim();

      if (isMine) {
        const unread = unreadCountForMessage(item, index);
        const bubble = (
          <View style={styles.rowMine}>
            <View style={styles.timeMineCol}>
              {unread > 0 ? (
                <Text style={styles.unreadBubbleCount} accessibilityLabel={`안 읽은 사람 ${unread}명`}>
                  {unread}
                </Text>
              ) : null}
              <Text style={styles.timeMine}>{formatChatTime(item.createdAt)}</Text>
            </View>
            <View style={[styles.bubbleMineWrap, isImage && styles.bubbleMineMedia]}>
              <BlurView tint="light" intensity={60} style={styles.bubbleMine}>
                {item.replyTo?.messageId ? (
                  <View style={styles.replyQuoteMine}>
                    <Pressable
                      onPress={() => void jumpToRepliedMessage(item.replyTo?.messageId ?? '')}
                      style={({ pressed }) => [styles.replyQuotePressable, pressed && styles.pressed]}
                      accessibilityRole="button"
                      accessibilityLabel="원글로 이동">
                      <View style={styles.replyQuoteTopRow}>
                        <View style={styles.replyQuoteTextCol}>
                          <Text style={styles.replyQuoteLabelMine}>
                            {replyTargetLabel(item.replyTo, profiles)}에게 답장
                          </Text>
                          <Text style={styles.replyQuoteTextMine} numberOfLines={2}>
                            {replyPreviewText(item.replyTo)}
                          </Text>
                        </View>
                        {item.replyTo.kind === 'image' && item.replyTo.imageUrl?.trim() ? (
                          <Image
                            source={{ uri: item.replyTo.imageUrl.trim() }}
                            style={styles.replyQuoteThumb}
                            contentFit="cover"
                          />
                        ) : null}
                      </View>
                    </Pressable>
                  </View>
                ) : null}
                {item.replyTo?.messageId ? <View style={styles.replyDivider} /> : null}
                {isImage ? (
                  item.imageUrl ? (
                    <Pressable
                      onPress={() => openMeetingChatImageViewer(item)}
                      style={({ pressed }) => [pressed && styles.pressed]}
                      accessibilityRole="button"
                      accessibilityLabel="사진 크게 보기">
                      <Image source={{ uri: item.imageUrl }} style={styles.chatImage} contentFit="cover" />
                    </Pressable>
                  ) : (
                    <Text style={styles.bubbleMineText}>이미지를 불러올 수 없어요.</Text>
                  )
                ) : (
                  <Text style={styles.bubbleMineText}>{item.text}</Text>
                )}
                {isImage && caption ? <Text style={styles.imageCaptionMine}>{caption}</Text> : null}
              </BlurView>
            </View>
          </View>
        );
        return (
          <View>
            {dateLabel ? (
              <View style={styles.dateChipRow}>
                <View style={styles.dateChip}>
                  <Text style={styles.dateChipText}>{dateLabel}</Text>
                </View>
              </View>
            ) : null}
            <SwipeToReply
              simultaneousHandlers={listRef}
              onTriggerReply={() =>
                setReplyTo({
                  messageId: item.id,
                  senderId: item.senderId ?? null,
                  kind: item.kind,
                  imageUrl: item.imageUrl ?? null,
                  text: item.text,
                })
              }
            >
              {bubble}
            </SwipeToReply>
          </View>
        );
      }

      const otherBubble = (
        <View style={styles.rowOther}>
          <Pressable
            style={styles.avatarCol}
            disabled={!canOpenPeerProfile}
            onPress={() => canOpenPeerProfile && setPeerProfileUserId(sid)}
            accessibilityRole={canOpenPeerProfile ? 'button' : undefined}
            accessibilityLabel={canOpenPeerProfile ? '프로필 보기' : undefined}>
            {showAvatar ? (
              withdrawn ? (
                <View style={styles.avatarWithdrawn}>
                  <Ionicons name="person" size={18} color="#94a3b8" />
                </View>
              ) : prof?.photoUrl ? (
                <Image source={{ uri: prof.photoUrl }} style={styles.avatar} contentFit="cover" />
              ) : (
                <View style={styles.avatarFallback}>
                  <Text style={styles.avatarFallbackText}>{nick.slice(0, 1)}</Text>
                </View>
              )
            ) : (
              <View style={styles.avatarSpacer} />
            )}
          </Pressable>
          <View style={styles.otherBlock} pointerEvents="box-none">
            {showAvatar ? (
              <Pressable
                disabled={!canOpenPeerProfile}
                onPress={() => canOpenPeerProfile && setPeerProfileUserId(sid)}
                style={({ pressed }) => [styles.nameRow, canOpenPeerProfile && pressed && styles.pressed]}
                accessibilityRole={canOpenPeerProfile ? 'button' : undefined}
                accessibilityLabel={canOpenPeerProfile ? '프로필 보기' : undefined}>
                <Text style={styles.nickname} numberOfLines={1}>
                  {nick}
                </Text>
                {isHost ? <Ionicons name="star" size={14} color="#CA8A04" style={styles.crown} /> : null}
              </Pressable>
            ) : null}
            <View style={styles.bubbleOtherWrap}>
              <View style={[styles.bubbleOtherOuter, isImage && styles.bubbleOtherMedia]}>
                <BlurView tint="light" intensity={60} style={styles.bubbleOther}>
                  {item.replyTo?.messageId ? (
                    <View style={styles.replyQuoteOther}>
                      <Pressable
                        onPress={() => void jumpToRepliedMessage(item.replyTo?.messageId ?? '')}
                        style={({ pressed }) => [styles.replyQuotePressable, pressed && styles.pressed]}
                        accessibilityRole="button"
                        accessibilityLabel="원글로 이동">
                        <View style={styles.replyQuoteTopRow}>
                          <View style={styles.replyQuoteTextCol}>
                            <Text style={styles.replyQuoteLabelOther}>
                              {replyTargetLabel(item.replyTo, profiles)}에게 답장
                            </Text>
                            <Text style={styles.replyQuoteTextOther} numberOfLines={2}>
                              {replyPreviewText(item.replyTo)}
                            </Text>
                          </View>
                          {item.replyTo.kind === 'image' && item.replyTo.imageUrl?.trim() ? (
                            <Image
                              source={{ uri: item.replyTo.imageUrl.trim() }}
                              style={styles.replyQuoteThumb}
                              contentFit="cover"
                            />
                          ) : null}
                        </View>
                      </Pressable>
                    </View>
                  ) : null}
                  {item.replyTo?.messageId ? <View style={styles.replyDivider} /> : null}
                  {isImage ? (
                    item.imageUrl ? (
                      <Pressable
                        onPress={() => openMeetingChatImageViewer(item)}
                        style={({ pressed }) => [pressed && styles.pressed]}
                        accessibilityRole="button"
                        accessibilityLabel="사진 크게 보기">
                        <Image source={{ uri: item.imageUrl }} style={styles.chatImage} contentFit="cover" />
                      </Pressable>
                    ) : (
                      <Text style={styles.bubbleOtherText}>이미지를 불러올 수 없어요.</Text>
                    )
                  ) : (
                    <Text style={styles.bubbleOtherText}>{item.text}</Text>
                  )}
                  {isImage && caption ? <Text style={styles.imageCaptionOther}>{caption}</Text> : null}
                </BlurView>
                {sid === 'ginit_ai' ? <View style={styles.aiNeonOutline} pointerEvents="none" /> : null}
              </View>
              <Text style={styles.timeOther}>{formatChatTime(item.createdAt)}</Text>
            </View>
          </View>
        </View>
      );
      return (
        <View>
          {dateLabel ? (
            <View style={styles.dateChipRow}>
              <View style={styles.dateChip}>
                <Text style={styles.dateChipText}>{dateLabel}</Text>
              </View>
            </View>
          ) : null}
          <SwipeToReply
            simultaneousHandlers={listRef}
            onTriggerReply={() =>
              setReplyTo({
                messageId: item.id,
                senderId: item.senderId ?? null,
                kind: item.kind,
                imageUrl: item.imageUrl ?? null,
                text: item.text,
              })
            }
          >
            {otherBubble}
          </SwipeToReply>
        </View>
      );
    },
    [myId, messages, profiles, hostNorm, unreadCountForMessage, openMeetingChatImageViewer],
  );

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
            <Ionicons name="chevron-back" size={28} color={GinitTheme.colors.text} />
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
                <Ionicons name="search-outline" size={24} color="#0f172a" />
              </Pressable>
              <InAppAlarmsBellButton />
              <Pressable
                onPress={() => router.push(`/meeting-chat/${meetingId}/settings`)}
                accessibilityRole="button"
                accessibilityLabel="채팅방 설정"
                hitSlop={10}
                style={styles.settingsIconWrap}>
                <Ionicons name="settings-outline" size={24} color="#0f172a" />
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
              <Ionicons name="megaphone-outline" size={16} color="#0052CC" />
              <Text style={styles.announcementText} numberOfLines={1}>
                {announcementText}
              </Text>
              <Ionicons name="chevron-forward" size={16} color="#64748b" />
            </BlurView>
          </Pressable>
        ) : null}

        <View style={styles.chatMainColumn}>
          <View style={styles.listWrap}>
            {chatError ? (
              <View style={styles.chatErrorBanner}>
                <Text style={styles.chatErrorText}>{chatError}</Text>
              </View>
            ) : null}
            {searchNavigateLoading ? (
              <View
                style={styles.searchJumpLoadingOverlay}
                pointerEvents="auto"
                accessibilityLabel="이전 대화를 불러오는 중">
                <ActivityIndicator color={GinitTheme.colors.primary} size="large" />
                <Text style={styles.searchJumpLoadingText}>이전 대화를 불러오는 중…</Text>
              </View>
            ) : null}
            <View style={{ flex: 1 }}>
              <KeyboardAwareFlatList
              // KeyboardAwareFlatList는 일반 ref가 실제 FlatList 메서드로 연결되지 않는 케이스가 있어
              // innerRef로 스크롤 제어(ref.scrollToIndex/Offset)가 확실히 동작하도록 합니다.
              ref={setListRef}
              innerRef={setInnerFlatListRef}
              data={messages}
              keyExtractor={(item) => item.id}
              renderItem={renderItem}
              contentContainerStyle={chatListContentStyle}
                inverted
              onScroll={onChatScroll}
              scrollEventThrottle={16}
              keyboardShouldPersistTaps="handled"
              enableOnAndroid
              extraScrollHeight={12}
              onScrollToIndexFailed={(info) => {
                const target = info.index;
                // h*index 오프셋은 inverted·가변 높이에서 과대 추정 시 최상단으로 클램프될 수 있음
                setTimeout(() => {
                  scrollToIndexSafe(target, 0.35, false);
                }, 100);
                setTimeout(() => {
                  scrollToIndexSafe(target, 0.35, false);
                }, 350);
              }}
              ListEmptyComponent={
                <Text style={styles.emptyChat}>첫 메시지를 남겨 보세요.</Text>
              }
              ListFooterComponent={isFetchingNextPage ? listFooterLoading : null}
              onEndReached={hasNextPage ? onPrefetchOlderMessages : undefined}
              onEndReachedThreshold={0.55}
              initialNumToRender={14}
              maxToRenderPerBatch={10}
              windowSize={11}
              updateCellsBatchingPeriod={50}
              /**
               * inverted + 과거 페이지 prepend 시 `maintainVisibleContentPosition`은
               * Android/iOS에서 네이티브 SIGABRT/강제 종료가 보고되는 경우가 많아 사용하지 않습니다.
               * 과거 로드 직후 스크롤이 약간 움직일 수 있으나 크래시를 막는 쪽을 택합니다.
               */
              removeClippedSubviews={false}
              />
            </View>
            {showJumpToBottomFab && !plusMenuOpen ? (
              <Pressable
                style={[styles.jumpFab, { bottom: 12 + composerDockBlockHeight }]}
                onPress={jumpToLatest}
                accessibilityRole="button"
                accessibilityLabel="최신 메시지로">
                <Ionicons name="chevron-down" size={22} color="#334155" />
              </Pressable>
            ) : null}
          </View>
          {plusMenuOpen ? (
            <Pressable
              style={[styles.plusListDismissLayer, { bottom: composerDockBlockHeight }]}
              onPress={() => closePlusMenuThen()}
              accessibilityRole="button"
              accessibilityLabel="퀵 메뉴 닫기"
            />
          ) : null}
          {plusMenuOpen ? (
            <View
              style={[styles.plusFanFloating, { bottom: composerDockBlockHeight }]}
              pointerEvents="box-none">
              <View style={styles.plusFanInner} pointerEvents="box-none">
                {plusQuickActions.map((action, i) => (
                  <MeetingChatQuickActionRow
                    key={action.key}
                    action={action}
                    progress={plusRowAnims[i]}
                    pillMaxW={plusPillMaxWidth}
                  />
                ))}
              </View>
            </View>
          ) : null}
          <View
            style={[styles.composerDock, { paddingBottom: composerBottomPad }]}
            onLayout={onComposerDockLayout}>
          {replyTo?.messageId ? (
            <View style={styles.replyPreviewRow}>
              <BlurView tint="light" intensity={55} style={styles.replyPreviewCard}>
                <View style={styles.replyPreviewIconWrap} accessibilityElementsHidden pointerEvents="none">
                  <Ionicons name="return-up-back-outline" size={20} color="#0f172a" />
                </View>
                <View style={styles.replyPreviewTextCol} pointerEvents="none">
                  <Text style={styles.replyPreviewTitle} numberOfLines={1}>
                    {replyTargetLabel(replyTo, profiles)}에게 답장
                  </Text>
                  <Text style={styles.replyPreviewBody} numberOfLines={1}>
                    {replyPreviewText(replyTo)}
                  </Text>
                </View>
                {replyTo.kind === 'image' && replyTo.imageUrl?.trim() ? (
                  <View style={styles.replyPreviewThumbOuter} pointerEvents="none" accessibilityElementsHidden>
                    <Image source={{ uri: replyTo.imageUrl.trim() }} style={styles.replyPreviewThumb} contentFit="cover" />
                  </View>
                ) : null}
                <Pressable
                  onPress={() => setReplyTo(null)}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="답장 취소">
                  <Ionicons name="close" size={18} color="#475569" />
                </Pressable>
              </BlurView>
            </View>
          ) : null}
          <View
            style={styles.composerCluster}
            onLayout={(e) => {
              const h = e.nativeEvent.layout.height;
              if (h > 0) setComposerInputBarHeight(h);
            }}>
            <View style={styles.composer}>
              <Pressable
                style={styles.plusBtn}
                onPress={openPlusMenu}
                disabled={uploadingImage}
                accessibilityRole="button"
                accessibilityLabel={plusMenuOpen ? '퀵 액션 닫기' : '퀵 액션 열기'}
                accessibilityState={{ expanded: plusMenuOpen }}>
                {uploadingImage ? (
                  <ActivityIndicator size="small" color="#475569" />
                ) : (
                  <View style={styles.plusBtnIconSlot} pointerEvents="none">
                    <Animated.View
                      style={[
                        styles.plusBtnIconLayer,
                        {
                          opacity: plusIconMorph.interpolate({
                            inputRange: [0, 0.42],
                            outputRange: [1, 0],
                            extrapolate: 'clamp',
                          }),
                          transform: [
                            {
                              scale: plusIconMorph.interpolate({
                                inputRange: [0, 1],
                                outputRange: [1, 0.45],
                              }),
                            },
                            {
                              rotate: plusIconMorph.interpolate({
                                inputRange: [0, 1],
                                outputRange: ['0deg', '45deg'],
                              }),
                            },
                          ],
                        },
                      ]}>
                      <Ionicons name="add-sharp" size={26} color="#475569" />
                    </Animated.View>
                    <Animated.View
                      style={[
                        styles.plusBtnIconLayer,
                        {
                          opacity: plusIconMorph.interpolate({
                            inputRange: [0.38, 1],
                            outputRange: [0, 1],
                            extrapolate: 'clamp',
                          }),
                          transform: [
                            {
                              scale: plusIconMorph.interpolate({
                                inputRange: [0, 1],
                                outputRange: [0.45, 1],
                              }),
                            },
                            {
                              rotate: plusIconMorph.interpolate({
                                inputRange: [0, 1],
                                outputRange: ['-45deg', '0deg'],
                              }),
                            },
                          ],
                        },
                      ]}>
                      <Ionicons name="close-sharp" size={26} color="#475569" />
                    </Animated.View>
                  </View>
                )}
              </Pressable>
              <View style={styles.inputShell}>
                <TextInput
                  ref={messageInputRef}
                  style={styles.input}
                  placeholder="메시지 보내기"
                  placeholderTextColor="#94a3b8"
                  value={draft}
                  onChangeText={setDraft}
                  multiline
                  maxLength={4000}
                  editable={!uploadingImage}
                />
              </View>
              <Pressable
                onPress={() => void onSend()}
                style={[styles.sendBtn, (sending || uploadingImage) && styles.sendBtnDisabled]}
                disabled={sending || uploadingImage || !draft.trim()}
                accessibilityRole="button"
                accessibilityLabel="보내기">
                {sending || uploadingImage ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="send" size={20} color="#fff" />
                )}
              </Pressable>
            </View>
          </View>
        </View>
        </View>

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
                <Ionicons name="chevron-back" size={26} color={GinitTheme.colors.text} />
              </Pressable>
              <Text style={styles.chatSearchTitle}>대화 검색</Text>
              <View style={styles.chatSearchHeaderSpacer} />
            </View>
            <View style={styles.chatSearchFieldWrap}>
              <Ionicons name="search-outline" size={20} color="#94a3b8" style={styles.chatSearchFieldIcon} />
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
          <GestureHandlerRootView style={styles.viewerRoot}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => !imageViewerBusy && setImageViewer(null)}
              pointerEvents="none"
              accessibilityRole="button"
              accessibilityLabel="닫기"
            />
            <View style={styles.viewerSheet} pointerEvents="box-none">
              <View style={[styles.viewerTopRow, { paddingTop: insets.top + 8 }]}>
                <Pressable
                  onPress={() => setImageViewer(null)}
                  hitSlop={10}
                  disabled={imageViewerBusy}
                  accessibilityRole="button"
                  accessibilityLabel="닫기">
                  <Ionicons name="close" size={26} color="#fff" />
                </Pressable>
                <View style={styles.viewerMetaCol} pointerEvents="none">
                  <Text style={styles.viewerMetaName} numberOfLines={1}>
                    {imageViewer?.senderLabel ?? ''}
                  </Text>
                  {imageViewer?.sentAtLabel ? (
                    <Text style={styles.viewerMetaTime} numberOfLines={1}>
                      {imageViewer.sentAtLabel}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.viewerActions}>
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
                    <Ionicons name="share-outline" size={24} color="#fff" />
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
                    <Ionicons name="download-outline" size={24} color="#fff" />
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
                      <Ionicons name="trash-outline" size={24} color="#fff" />
                    </Pressable>
                  ) : null}
                </View>
              </View>
              {imageViewer?.url ? (
                <View style={styles.viewerImageWrap}>
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

function SwipeToReply({
  children,
  onTriggerReply,
  simultaneousHandlers,
}: {
  children: ReactNode;
  onTriggerReply: () => void;
  simultaneousHandlers?: any;
}) {
  /**
   * 카카오톡처럼: 말풍선을 "왼쪽으로 당기면" 따라오고, 손을 놓으면 항상 원위치로 복귀.
   * 임계치만 넘으면 답장 타겟만 설정하고(=quote preview), UI는 즉시 복귀합니다.
   */
  const dragX = useRef(new Animated.Value(0)).current;
  const didTriggerRef = useRef(false);
  const triggerRef = useRef(onTriggerReply);
  triggerRef.current = onTriggerReply;

  const onGestureEvent = useMemo(
    () =>
      Animated.event<PanGestureHandlerGestureEvent>(
        [{ nativeEvent: { translationX: dragX } }],
        {
          useNativeDriver: true,
          listener: (e) => {
            const tx = (e as PanGestureHandlerGestureEvent).nativeEvent.translationX;
            // 왼쪽(음수)로 당길 때만 reply 트리거. 드래그 중에 실시간으로 체크.
            if (typeof tx === 'number' && tx < -56 && !didTriggerRef.current) {
              didTriggerRef.current = true;
              triggerRef.current();
            }
          },
        },
      ),
    [dragX],
  );

  const reset = useCallback(() => {
    dragX.stopAnimation();
    Animated.spring(dragX, {
      toValue: 0,
      useNativeDriver: true,
      tension: 180,
      friction: 18,
    }).start();
  }, [dragX]);

  const onHandlerStateChange = useCallback(
    (e: PanGestureHandlerGestureEvent) => {
      const s = e.nativeEvent.state;

      if (s === State.BEGAN) {
        didTriggerRef.current = false;
      }

      if (s === State.END || s === State.CANCELLED || s === State.FAILED) {
        reset();
      }
    },
    [reset],
  );

  const translateX = useMemo(
    () =>
      dragX.interpolate({
        inputRange: [-140, 0, 140],
        outputRange: [-72, 0, 0],
        extrapolate: 'clamp',
      }),
    [dragX],
  );

  return (
    <PanGestureHandler
      /**
       * 스크롤과 충돌 방지:
       * - 왼쪽(음수) 드래그에서만 활성화(오른쪽/미세 흔들림으로 스크롤이 막히지 않게)
       * - 세로 이동이 조금이라도 있으면 빠르게 실패시켜 FlatList 스크롤을 우선
       * - FlatList와 simultaneous로 동작하게 연결
       */
      activeOffsetX={[-18, 9999]}
      failOffsetY={[-6, 6]}
      simultaneousHandlers={simultaneousHandlers}
      onGestureEvent={onGestureEvent}
      onHandlerStateChange={onHandlerStateChange}
    >
      <Animated.View style={{ transform: [{ translateX }] }}>{children}</Animated.View>
    </PanGestureHandler>
  );
}

const styles = StyleSheet.create({
  ghRoot: { flex: 1 },
  safe: { flex: 1, backgroundColor: '#ECEFF1' },
  flexColumn: { flex: 1, flexDirection: 'column' },
  /** 리스트 + 퀵 메뉴(입력창 위) + composerDock — 퀵 메뉴 bottom을 입력 블록 높이에 맞춤 */
  chatMainColumn: {
    flex: 1,
    minHeight: 0,
    position: 'relative',
  },
  composerDock: {
    width: '100%',
    flexShrink: 0,
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(15, 23, 42, 0.08)',
  },
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
    paddingVertical: 8,
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
    fontWeight: '900',
    color: '#0f172a',
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  titleMain: {
    fontSize: 16,
    fontWeight: '800',
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
  /** 모임 탭(`app/(tabs)/index.tsx`) feedHeader — 검색·벨·설정과 동일 */
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
  timeMineCol: {
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
  },
  unreadBubbleCount: {
    fontSize: 11,
    fontWeight: '900',
    color: '#000000',
    marginBottom: 2,
  },
  // meetingInfoOuter: 상단 모임 스냅샷(요약 카드) 섹션 제거됨
  listWrap: {
    flex: 1,
    position: 'relative',
    backgroundColor: '#ECEFF1',
  },
  searchJumpLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.55)',
    zIndex: 12,
    gap: 10,
  },
  searchJumpLoadingText: {
    fontSize: 14,
    fontWeight: '700',
    color: GinitTheme.colors.textSub,
  },
  /** 퀵 메뉴 열릴 때 바깥 탭 — bottom은 입력 블록 높이로 JS에서 지정 */
  plusListDismissLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 4,
    backgroundColor: 'transparent',
  },
  /** 입력창 블록 바로 위에 붙는 퀵 메뉴 — bottom은 composerDock 높이로 지정 */
  plusFanFloating: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 7,
  },
  dateChipRow: {
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 2,
  },
  dateChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  dateChipText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#475569',
  },
  chatErrorBanner: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(220, 38, 38, 0.12)',
  },
  chatErrorText: { fontSize: 12, color: '#991b1b' },
  chatListFooterSpinner: {
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 16,
    flexGrow: 1,
  },
  emptyChat: {
    textAlign: 'center',
    marginTop: 40,
    fontSize: 14,
    color: '#94a3b8',
  },
  jumpFab: {
    position: 'absolute',
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.1)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 3,
    zIndex: 8,
  },
  systemRow: {
    alignItems: 'center',
    marginVertical: 8,
  },
  systemText: {
    fontSize: 12,
    color: '#94a3b8',
  },
  rowMine: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    gap: 6,
    marginBottom: 10,
  },
  bubbleMineWrap: {
    maxWidth: '78%',
  },
  bubbleMine: {
    backgroundColor: 'rgba(0, 82, 204, 0.22)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 16,
    borderTopRightRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0, 82, 204, 0.30)',
    overflow: 'hidden',
  },
  bubbleMineMedia: {
    paddingHorizontal: 6,
    paddingVertical: 6,
    /** 고정 78%는 220px 이미지+패딩보다 좁아 모서리가 잘리므로, 사진 말풍선만 가로 폭 전부 사용 */
    maxWidth: '100%',
  },
  bubbleMineText: {
    fontSize: 15,
    color: '#0f172a',
    lineHeight: 20,
  },
  chatImage: {
    width: 220,
    maxWidth: '100%',
    aspectRatio: 1,
    borderRadius: 12,
    backgroundColor: '#e2e8f0',
    alignSelf: 'flex-start',
  },
  imageCaptionMine: {
    marginTop: 6,
    paddingHorizontal: 6,
    fontSize: 14,
    color: '#0f172a',
    lineHeight: 19,
  },
  timeMine: {
    fontSize: 11,
    color: '#94a3b8',
    marginBottom: 2,
  },
  rowOther: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 10,
  },
  avatarCol: {
    width: 40,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#e2e8f0',
  },
  avatarWithdrawn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarFallback: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0, 82, 204, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarFallbackText: {
    fontSize: 15,
    fontWeight: '800',
    color: GinitTheme.colors.primary,
  },
  avatarSpacer: {
    width: 36,
    height: 36,
  },
  otherBlock: {
    flex: 1,
    minWidth: 0,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
  },
  nickname: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0f172a',
    maxWidth: '85%',
  },
  crown: { marginTop: -1 },
  bubbleOtherWrap: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
  },
  bubbleOtherOuter: {
    maxWidth: '78%',
    position: 'relative',
  },
  bubbleOther: {
    backgroundColor: 'rgba(255,255,255,0.58)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 16,
    borderTopLeftRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.08)',
    overflow: 'hidden',
  },
  aiNeonOutline: {
    position: 'absolute',
    top: -1,
    left: -1,
    right: -1,
    bottom: -1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 138, 0, 0.85)',
    shadowColor: '#FF8A00',
    shadowOpacity: 0.55,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  bubbleOtherMedia: {
    paddingHorizontal: 6,
    paddingVertical: 6,
    maxWidth: '100%',
  },
  bubbleOtherText: {
    fontSize: 15,
    color: '#0f172a',
    lineHeight: 20,
  },
  imageCaptionOther: {
    marginTop: 6,
    paddingHorizontal: 6,
    fontSize: 14,
    color: '#0f172a',
    lineHeight: 19,
  },
  timeOther: {
    fontSize: 11,
    color: '#94a3b8',
    marginBottom: 2,
  },
  replyQuoteMine: {
    marginBottom: 8,
    paddingLeft: 0,
    borderLeftWidth: 0,
    borderLeftColor: 'transparent',
  },
  replyQuoteOther: {
    marginBottom: 8,
    paddingLeft: 0,
    borderLeftWidth: 0,
    borderLeftColor: 'transparent',
  },
  replyQuoteLabelMine: { fontSize: 11, fontWeight: '900', color: '#0f172a' },
  replyQuoteLabelOther: { fontSize: 11, fontWeight: '900', color: '#0f172a' },
  /** 답장 말풍선 상단 원글(인용) 텍스트 — 카카오톡처럼 검정색 */
  replyQuoteTextMine: { marginTop: 2, fontSize: 12, color: '#0f172a' },
  replyQuoteTextOther: { marginTop: 2, fontSize: 12, color: '#0f172a' },
  replyQuoteTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    /**
     * 답장 인용 영역이 말풍선 폭을 "최대폭까지" 밀어버리는 케이스 방지:
     * row가 기본 stretch로 잡히지 않게 하고, 내용 기반으로만 폭이 결정되게 함.
     */
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  replyQuoteTextCol: { flexShrink: 1, minWidth: 0 },
  replyQuoteThumb: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: '#e2e8f0',
  },
  replyQuotePressable: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  /** 답장 인용과 본문을 분리하는 --- 라인 */
  replyDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(15, 23, 42, 0.16)',
    marginBottom: 8,
  },
  replyPreviewRow: {
    paddingHorizontal: 10,
    paddingTop: 10,
  },
  replyPreviewCard: {
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    overflow: 'hidden',
  },
  replyPreviewIconWrap: {
    /** composer의 + 버튼(44x44, marginBottom:2)과 동일 라인 정렬 */
    width: 44,
    height: 44,
    marginBottom: 2,
    /** replyPreviewCard의 paddingHorizontal(12)만큼 왼쪽으로 당겨 + 버튼과 X축 정렬 */
    marginLeft: -12,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderWidth: 0,
    borderColor: 'transparent',
  },
  replyPreviewTextCol: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'column',
    gap: 2,
  },
  replyPreviewTitle: { fontSize: 13, fontWeight: '900', color: '#0f172a' },
  replyPreviewBody: { fontSize: 12, fontWeight: '600', color: '#0f172a' },
  replyPreviewThumbOuter: {
    width: 28,
    height: 28,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#e2e8f0',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.12)',
  },
  replyPreviewThumb: { width: '100%', height: '100%' },
  /** + 퀵 메뉴 + 입력창 묶음 (퀵 메뉴는 배경 없이 아이콘·라벨만) */
  composerCluster: {
    width: '100%',
  },
  plusFanInner: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
  },
  /** 퀵 라벨 실제 너비 측정(화면 밖, 터치 불가) */
  plusQuickMeasureHost: {
    position: 'absolute',
    left: -8000,
    top: 0,
    opacity: 0,
  },
  /** 보내기 버튼과 동일 primary 배경 위 흰 라벨 (아이콘 간격은 `plusQuickIconLabelRow` gap) */
  plusFanLabelMorph: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.2,
    flexShrink: 1,
  },
  /** 버튼 안에서 아이콘·라벨을 한 덩어리로 가운데 정렬 */
  plusQuickIconLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pressed: {
    opacity: 0.85,
  },
  viewerRoot: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    alignItems: 'stretch',
  },
  viewerSheet: {
    flex: 1,
    paddingBottom: 12,
  },
  viewerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingBottom: 10,
  },
  viewerMetaCol: {
    flex: 1,
    marginLeft: 6,
    marginRight: 8,
    justifyContent: 'center',
    minWidth: 0,
  },
  viewerMetaName: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  viewerMetaTime: {
    marginTop: 2,
    color: 'rgba(255,255,255,0.72)',
    fontSize: 12,
    fontWeight: '500',
  },
  viewerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  viewerImageWrap: {
    flex: 1,
    width: '100%',
    minHeight: 0,
    backgroundColor: 'transparent',
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
    fontWeight: '800',
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
    fontWeight: '900',
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
    fontWeight: '900',
    color: '#0f172a',
    backgroundColor: 'rgba(255, 235, 59, 0.35)',
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 8,
  },
  /** 보내기 버튼과 동일 44 고정 — +/× 전환 시 입력창 폭이 흔들리지 않게 */
  plusBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  plusBtnIconSlot: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusBtnIconLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputShell: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f1f5f9',
    borderRadius: 20,
    paddingHorizontal: 14,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.08)',
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: '#0f172a',
    paddingVertical: 10,
    maxHeight: 100,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: GinitTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  sendBtnDisabled: {
    opacity: 0.5,
  },
});
