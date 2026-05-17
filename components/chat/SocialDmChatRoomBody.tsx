import { GinitPressable } from '@/components/ui/GinitPressable';

import {forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, InteractionManager, type LayoutChangeEvent, Modal, Platform, StyleSheet, Text, TextInput, View} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useKeyboardState } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MeetingChatMediaPickerModal } from '@/components/chat/MeetingChatMediaPickerModal';
import { MeetingChatImageViewerGallery } from '@/components/chat/MeetingChatImageViewerGallery';
import { MeetingChatMainColumn } from '@/components/chat/MeetingChatMainColumn';
import { meetingChatBodyStyles } from '@/components/chat/meeting-chat-body-styles';
import { meetingImageViewerMeta } from '@/components/chat/meeting-chat-ui-helpers';
import { useMeetingChatRenderItem } from '@/components/chat/use-meeting-chat-render-item';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import {
  buildMeetingChatListRows,
  findMeetingChatListRowIndexByMessageId,
  meetingChatListExtraDataKey,
} from '@/src/lib/meeting-chat-list-rows';
import { saveRemoteImageUrlToLibrary, shareRemoteImageUrl } from '@/src/lib/chat-image-actions';
import { consumePendingDirectSharePayload, peekPendingDirectSharePayload } from '@/src/lib/direct-share-store';
import { ginitNotifyDbg } from '@/src/lib/ginit-notify-debug';
import { buildChatMessageIndexById } from '@/src/lib/chat-message-index-by-id';
import type { MeetingChatMessage } from '@/src/lib/meeting-chat';
import {
  deleteSocialChatImageMessageBestEffort,
  deleteSocialChatTextMessageBestEffort,
  sendSocialChatImageMessagesBatch,
  sendSocialChatTextMessage,
  socialMessagesToMeetingNewestFirst,
  type SocialChatMessage,
} from '@/src/lib/social-chat-rooms';
import type { UserProfile } from '@/src/lib/user-profile';
import { getUserProfilesForIds } from '@/src/lib/user-profile';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { GinitTheme } from '@/constants/ginit-theme';
import { useChatInvertedStickToLatest } from '@/src/hooks/use-chat-inverted-stick-to-latest';

export type SocialDmChatRoomBodyHandle = {
  /** 모임 채팅과 동일하게 `data`는 최신이 index 0(inverted 기준). */
  scrollToMessageId: (messageId: string, opts?: { animated?: boolean }) => boolean;
};

export type SocialDmChatRoomBodyProps = {
  roomId: string;
  peerId: string;
  myUserId: string;
  messages: SocialChatMessage[];
  chatError: string | null;
  chatReconnecting?: boolean;
  peerReadMessageId: string | null;
  peerReadAt: unknown | null;
  peerReadStateReady?: boolean;
  readMapsRevision?: number;
  initialPeerName?: string | null;
  initialPeerPhotoUrl?: string | null;
  searchNavigateLoading?: boolean;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  onPrefetchOlderMessages?: () => void;
  onPeerProfileOpen: (peerAppUserId: string) => void;

  /** 카카오식: 검색 결과 탐색 UI를 하단 컴포저 영역에 표시하기 위한 상태/핸들러 */
  searchMode?: boolean;
  searchQuery?: string;
  /** 엔터로 확정된 검색어 — ▲/▼은 이 값이 있을 때만 동작 */
  searchCommittedQuery?: string;
  /** 확정 검색어: 채팅 말풍선 본문 하이라이트 */
  messageSearchHighlightQuery?: string;
  searchBusy?: boolean;
  searchStatusLabel?: string;
  searchSession?: { matchIds: string[]; cursorIndex: number };
  /** ▲(위): 더 과거 결과로 */
  onSearchPrev?: () => void;
  /** ▼(아래): 더 최신 결과로 */
  onSearchNext?: () => void;

  /** 텍스트 전송을 상위 엔진(예: `useChatEngine`)으로 위임 — 설정 시 `sendSocialChatTextMessage` 미호출 */
  sendTextOverride?: (args: { body: string; replyTo: MeetingChatMessage['replyTo'] }) => Promise<void>;
};

export const SocialDmChatRoomBody = forwardRef<SocialDmChatRoomBodyHandle, SocialDmChatRoomBodyProps>(function SocialDmChatRoomBody(
  {
    roomId,
    peerId,
    myUserId,
    messages: rawMessages,
    chatError,
    chatReconnecting = false,
    peerReadMessageId: _peerReadMessageId,
    peerReadAt: _peerReadAt,
    peerReadStateReady = true,
    readMapsRevision = 0,
    initialPeerName = null,
    initialPeerPhotoUrl = null,
    searchNavigateLoading,
    hasNextPage,
    isFetchingNextPage,
    onPrefetchOlderMessages,
    onPeerProfileOpen,
    searchMode,
    searchQuery,
    searchCommittedQuery,
    messageSearchHighlightQuery,
    searchBusy,
    searchStatusLabel,
    searchSession,
    onSearchPrev,
    onSearchNext,
    sendTextOverride,
  },
  ref,
) {
  void _peerReadMessageId;
  void _peerReadAt;
  const insets = useSafeAreaInsets();
  const [profiles, setProfiles] = useState<Map<string, UserProfile>>(new Map());
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<MeetingChatMessage['replyTo']>(null);
  const [imageViewer, setImageViewer] = useState<{
    gallery: MeetingChatMessage[];
    index: number;
  } | null>(null);
  const [imageViewerBusy, setImageViewerBusy] = useState(false);
  const [composerDockBlockHeight, setComposerDockBlockHeight] = useState(104);
  const [composerInputBarHeight, setComposerInputBarHeight] = useState(56);
  const keyboardVisible = useKeyboardState((s) => s.isVisible);
  const listRef = useRef<unknown>(null);
  const innerFlashListRef = useRef<unknown>(null);
  const mountedRef = useRef(true);
  const setListRef = useCallback((r: unknown) => {
    listRef.current = r;
  }, []);
  const setInnerFlashListRef = useCallback((r: unknown) => {
    innerFlashListRef.current = r;
  }, []);
  const messageInputRef = useRef<TextInput>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      listRef.current = null;
      innerFlashListRef.current = null;
    };
  }, []);

  const myId = useMemo(() => (myUserId.trim() ? normalizeParticipantId(myUserId.trim()) : ''), [myUserId]);
  const hostNorm = '';

  const messages = useMemo(() => socialMessagesToMeetingNewestFirst(rawMessages), [rawMessages]);
  const chatListRows = useMemo(() => buildMeetingChatListRows(messages), [messages]);
  const chatListExtraData = useMemo(() => meetingChatListExtraDataKey(chatListRows), [chatListRows]);

  const chatImageGalleryChrono = useMemo(() => {
    const imgs = messages.filter((m) => m.kind === 'image' && m.imageUrl?.trim());
    return [...imgs].reverse();
  }, [messages]);

  const resolveListScroller = useCallback(() => {
    const r = innerFlashListRef.current ?? listRef.current;
    if (!r) return null;
    const node = (() => {
      try {
        return typeof (r as { getNode?: () => unknown }).getNode === 'function'
          ? (r as { getNode: () => unknown }).getNode()
          : null;
      } catch {
        return null;
      }
    })();
    const responder = (() => {
      try {
        return typeof (r as { getScrollResponder?: () => unknown }).getScrollResponder === 'function'
          ? (r as { getScrollResponder: () => unknown }).getScrollResponder()
          : null;
      } catch {
        return null;
      }
    })();
    const candidates = [
      r,
      node,
      responder,
      (r as { _flatListRef?: unknown })._flatListRef ?? null,
      (r as { _flatList?: unknown })._flatList ?? null,
    ].filter(Boolean);
    for (const c of candidates) {
      const x = c as { scrollToIndex?: unknown; scrollToOffset?: unknown };
      if (x && (typeof x.scrollToIndex === 'function' || typeof x.scrollToOffset === 'function')) return x;
    }
    return null;
  }, []);

  const scrollToIndexSafe = useCallback((index: number, viewPosition = 0.35, animated = false) => {
    if (!mountedRef.current) return false;
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
    if (!mountedRef.current) return false;
    const scroller = resolveListScroller();
    if (!scroller || typeof scroller.scrollToOffset !== 'function') return false;
    try {
      scroller.scrollToOffset({ offset, animated });
      return true;
    } catch {
      return false;
    }
  }, [resolveListScroller]);

  const latestMessageId = messages[0]?.id ?? '';

  const {
    showJumpToBottomFab,
    onChatScroll,
    onChatListContentSizeChange,
    jumpToLatest,
    markPendingStickToLatest,
    scheduleStickToLatest,
    stickWhenNearLatestOnLayoutChange,
  } = useChatInvertedStickToLatest({
    scrollToOffsetSafe,
    scrollToIndexSafe,
    latestMessageId,
    messagesEmpty: messages.length === 0,
  });

  const didHandleDirectShareRef = useRef(false);
  useEffect(() => {
    if (didHandleDirectShareRef.current) return;
    const rid = roomId.trim();
    const uid = myUserId.trim();
    if (!rid || !uid) return;
    const peek = peekPendingDirectSharePayload();
    if (!peek || peek.targetType !== 'dm' || peek.targetId.trim() !== rid) return;

    const payload = consumePendingDirectSharePayload();
    if (!payload || payload.targetType !== 'dm' || payload.targetId.trim() !== rid) return;
    didHandleDirectShareRef.current = true;

    ginitNotifyDbg('direct-share', 'dm_consume', {
      roomId: rid,
      kind: payload.kind,
      hasImageUri: payload.kind === 'image' ? Boolean(payload.imageUri?.trim()) : false,
      textLen: payload.kind === 'text' ? payload.text.length : (payload.text?.length ?? 0),
      imageUriPrefix: payload.kind === 'image' ? String(payload.imageUri ?? '').slice(0, 28) : '',
    });

    markPendingStickToLatest();
    setSending(true);
    void (async () => {
      try {
        if (payload.kind === 'image') {
          const uri = payload.imageUri.trim();
          if (uri) {
            await sendSocialChatImageMessagesBatch(rid, uid, [uri], { naturalWidths: [undefined] });
          }
        } else {
          const text = payload.text.trim();
          if (text) {
            if (sendTextOverride) {
              await sendTextOverride({ body: text, replyTo: null });
            } else {
              await sendSocialChatTextMessage(rid, uid, text, null);
            }
          }
        }
      } catch (e) {
        ginitNotifyDbg('direct-share', 'dm_send_failed', {
          roomId: rid,
          message: e instanceof Error ? e.message : String(e),
        });
        Alert.alert('공유 전송 실패', e instanceof Error ? e.message : String(e));
      } finally {
        setSending(false);
        markPendingStickToLatest();
        scheduleStickToLatest();
      }
    })();
  }, [roomId, myUserId, sendTextOverride, markPendingStickToLatest, scheduleStickToLatest]);

  const scrollToMessageIndexBestEffort = useCallback(
    (idx: number, animated = false) => {
      const index = Math.max(0, Math.floor(idx));
      InteractionManager.runAfterInteractions(() => {
        setTimeout(() => {
          if (!mountedRef.current) return;
          scrollToIndexSafe(index, 0.35, animated);
          requestAnimationFrame(() => {
            if (!mountedRef.current) return;
            scrollToIndexSafe(index, 0.35, animated);
          });
        }, 60);
      });
    },
    [scrollToIndexSafe],
  );

  useImperativeHandle(
    ref,
    () => ({
      scrollToMessageId: (messageId: string, opts?: { animated?: boolean }) => {
        const mid = String(messageId ?? '').trim();
        if (!mid) return false;
        const rowIdx = findMeetingChatListRowIndexByMessageId(chatListRows, mid);
        const idx = rowIdx >= 0 ? rowIdx : messages.findIndex((m) => m.id === mid);
        if (idx < 0) return false;
        scrollToMessageIndexBestEffort(idx, Boolean(opts?.animated));
        return true;
      },
    }),
    [messages, chatListRows, scrollToMessageIndexBestEffort],
  );

  useEffect(() => {
    const ids = [myUserId.trim(), peerId.trim()].filter(Boolean);
    if (ids.length < 2) return;
    setProfiles((prev) => {
      const next = new Map(prev);
      const peerKey = peerId.trim();
      if (peerKey && !next.has(peerKey) && (initialPeerName?.trim() || initialPeerPhotoUrl?.trim())) {
        next.set(peerKey, {
          id: peerKey,
          nickname: initialPeerName?.trim() || '친구',
          photoUrl: initialPeerPhotoUrl?.trim() || null,
        } as UserProfile);
      }
      return next;
    });
    void getUserProfilesForIds(ids).then(setProfiles);
  }, [initialPeerName, initialPeerPhotoUrl, myUserId, peerId]);

  /** 모임 채팅과 동일: IME 표시 중 일부 기기에서 하단 inset이 키보드 오프셋과 중복될 수 있어 최소 패딩만 사용 */
  const composerBottomPad = useMemo(
    () => (keyboardVisible ? 8 : Math.max(insets.bottom, 8)),
    [insets.bottom, keyboardVisible],
  );

  const messageIndexById = useMemo(() => buildChatMessageIndexById(messages as MeetingChatMessage[]), [messages]);

  const jumpToRepliedMessage = useCallback(
    async (replyMessageId: string) => {
      const rid = String(replyMessageId ?? '').trim();
      if (!rid) return;
      const rowIdx = findMeetingChatListRowIndexByMessageId(chatListRows, rid);
      const idx = rowIdx >= 0 ? rowIdx : messages.findIndex((m) => m.id === rid);
      if (idx >= 0) scrollToMessageIndexBestEffort(idx);
      else Alert.alert('원글 위치', '해당 메시지를 찾지 못했어요.');
    },
    [messages, chatListRows, scrollToMessageIndexBestEffort],
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

  const setPeerProfileUserIdBridge = useCallback(
    (id: string) => {
      const t = id.trim();
      if (t) onPeerProfileOpen(t);
    },
    [onPeerProfileOpen],
  );

  const renderItem = useMeetingChatRenderItem({
    listRows: chatListRows,
    messageIndexById,
    myId,
    hostNorm,
    profiles,
    jumpToRepliedMessage,
    setReplyTo,
    deleteMessageBestEffort: async (msg) => {
      const rid = roomId.trim();
      if (!rid || !msg?.id) return;
      if (msg.kind === 'image' && msg.imageUrl?.trim()) {
        await deleteSocialChatImageMessageBestEffort(rid, msg.id, msg.imageUrl.trim());
        return;
      }
      await deleteSocialChatTextMessageBestEffort(rid, msg.id);
    },
    onOpenUserProfile: setPeerProfileUserIdBridge,
    openMeetingChatImageViewer,
    listRef,
    messageSearchHighlightQuery,
    roomId: roomId.trim(),
    roomType: 'social_dm',
    chatRenderMode: 'social_dm',
    wmChatRoomIds: roomId.trim() ? [roomId.trim()] : [],
    participantIdsForUnread: peerId.trim() ? [normalizeParticipantId(peerId.trim()) ?? peerId.trim()] : [],
    peerId,
    peerReadStateReady,
    readMapsRevision,
  });

  const onPressAttach = useCallback(() => {
    if (Platform.OS === 'web') {
      Alert.alert('안내', '웹에서는 사진을 보낼 수 없어요.');
      return;
    }
    setMediaPickerOpen(true);
  }, []);

  const handleMediaPickerConfirmDm = useCallback(
    async ({ uris, widths }: { uris: string[]; widths: (number | undefined)[] }) => {
      const uid = myUserId.trim();
      if (!uid || !roomId || uris.length === 0 || sending) return;
      setSending(true);
      markPendingStickToLatest();
      try {
        await sendSocialChatImageMessagesBatch(roomId, uid, uris, {
          naturalWidths: widths,
        });
        setMediaPickerOpen(false);
      } catch (e) {
        Alert.alert('전송 실패', e instanceof Error ? e.message : String(e));
      } finally {
        setSending(false);
        markPendingStickToLatest();
        scheduleStickToLatest();
      }
    },
    [roomId, myUserId, sending, markPendingStickToLatest, scheduleStickToLatest],
  );

  const onSend = useCallback(async () => {
    const uid = myUserId.trim();
    const body = draft.trim();
    if (!uid || !roomId || !body || sending) return;
    setSending(true);
    markPendingStickToLatest();
    try {
      if (sendTextOverride) {
        await sendTextOverride({ body, replyTo: replyTo?.messageId ? replyTo : null });
      } else {
        await sendSocialChatTextMessage(roomId, uid, body, replyTo?.messageId ? replyTo : null);
      }
      setDraft('');
      setReplyTo(null);
    } catch (e) {
      Alert.alert('전송 실패', e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
      markPendingStickToLatest();
      scheduleStickToLatest();
    }
  }, [roomId, myUserId, draft, sending, replyTo, markPendingStickToLatest, scheduleStickToLatest, sendTextOverride]);

  const chatListContentStyle = useMemo(
    () => [
      meetingChatBodyStyles.listContent,
      {
        paddingTop: Math.max(
          4,
          Math.max(composerDockBlockHeight, composerInputBarHeight + composerBottomPad),
        ),
      },
    ],
    [composerDockBlockHeight, composerInputBarHeight, composerBottomPad],
  );

  const onComposerDockLayout = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h > 0) setComposerDockBlockHeight(h);
  }, []);

  useEffect(() => {
    stickWhenNearLatestOnLayoutChange();
  }, [stickWhenNearLatestOnLayoutChange, composerDockBlockHeight, composerInputBarHeight]);

  const listFooterLoading = useMemo(
    () => (
      <View style={meetingChatBodyStyles.chatListFooterSpinner} accessibilityLabel="이전 메시지 로딩">
        <ActivityIndicator color={GinitTheme.colors.primary} />
      </View>
    ),
    [],
  );

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

  const bottomSearchNavigator = useMemo(() => {
    if (!searchMode) return null;
    const raw = (searchQuery ?? '').trim();
    const committed = (searchCommittedQuery ?? '').trim();
    const navEnabled = Boolean(committed);
    const total = searchSession?.matchIds?.length ?? 0;
    const cursor = searchSession?.cursorIndex ?? -1;
    const atOldestMatch = total === 0 || (total > 0 && cursor >= 0 && cursor >= total - 1);
    const disablePrev = Boolean(searchBusy) || !navEnabled || atOldestMatch;
    const disableNext = Boolean(searchBusy) || !navEnabled || total === 0 || cursor <= 0;
    const showCenterHint = !raw || (raw && !committed);
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, position: 'relative' }}>
        {showCenterHint ? (
          <View
            style={{
              ...StyleSheet.absoluteFillObject,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 10,
            }}
            pointerEvents="none">
            <Text style={{ fontSize: 13, fontWeight: '700', color: '#475569', textAlign: 'center' }} numberOfLines={1}>
              {!raw ? '검색어가 없습니다' : '엔터로 검색하세요'}
            </Text>
          </View>
        ) : null}
        <Text
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 13,
            fontWeight: '700',
            color: '#475569',
            textAlign: navEnabled ? 'left' : 'left',
          }}
          numberOfLines={1}>
          {navEnabled ? (searchStatusLabel?.trim() ? searchStatusLabel : ' ') : ' '}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <GinitPressable
            onPress={onSearchPrev}
            disabled={disablePrev || !onSearchPrev}
            style={({ pressed }) => [
              {
                width: 34,
                height: 34,
                borderRadius: 10,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'rgba(255,255,255,0.9)',
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: 'rgba(15, 23, 42, 0.10)',
                opacity: disablePrev || !onSearchPrev ? 0.45 : pressed ? 0.86 : 1,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="더 과거 결과">
            <View style={{ transform: [{ rotate: '180deg' }] }}>
              <GinitSymbolicIcon name="chevron-down" size={20} color="#0f172a" />
            </View>
          </GinitPressable>
          <GinitPressable
            onPress={onSearchNext}
            disabled={disableNext || !onSearchNext}
            style={({ pressed }) => [
              {
                width: 34,
                height: 34,
                borderRadius: 10,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'rgba(255,255,255,0.9)',
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: 'rgba(15, 23, 42, 0.10)',
                opacity: disableNext || !onSearchNext ? 0.45 : pressed ? 0.86 : 1,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="더 최신 결과">
            <GinitSymbolicIcon name="chevron-down" size={20} color="#0f172a" />
          </GinitPressable>
        </View>
      </View>
    );
  }, [
    onSearchNext,
    onSearchPrev,
    searchBusy,
    searchCommittedQuery,
    searchMode,
    searchQuery,
    searchSession,
    searchStatusLabel,
  ]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>
        <MeetingChatMainColumn
          chatError={chatError}
          chatReconnecting={chatReconnecting}
          searchNavigateLoading={searchNavigateLoading === true}
          setListRef={setListRef}
          setInnerFlashListRef={setInnerFlashListRef}
          chatListRows={chatListRows}
          listExtraData={chatListExtraData}
          renderItem={renderItem}
          chatListContentStyle={chatListContentStyle}
          onChatScroll={onChatScroll}
          onChatListContentSizeChange={onChatListContentSizeChange}
          listFooterLoading={listFooterLoading}
          hasNextPage={Boolean(hasNextPage)}
          isFetchingNextPage={Boolean(isFetchingNextPage)}
          onPrefetchOlderMessages={hasNextPage ? onPrefetchOlderMessages : undefined}
          showJumpToBottomFab={showJumpToBottomFab}
          composerDockBlockHeight={composerDockBlockHeight}
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
          inputMultiline={false}
          bottomSearchNavigator={bottomSearchNavigator}
          hideComposer={Boolean(searchMode)}
        />

        <MeetingChatMediaPickerModal
          visible={mediaPickerOpen}
          onClose={() => setMediaPickerOpen(false)}
          sendBusy={sending}
          onConfirmSend={handleMediaPickerConfirmDm}
        />

        <Modal visible={imageViewer !== null} transparent animationType="fade" onRequestClose={() => setImageViewer(null)}>
          <GestureHandlerRootView style={meetingChatBodyStyles.viewerRoot}>
            <GinitPressable
              duplicatePressGuardDisabled
              style={StyleSheet.absoluteFill}
              onPress={() => !imageViewerBusy && setImageViewer(null)}
              pointerEvents="none"
              accessibilityRole="button"
              accessibilityLabel="닫기"
            />
            <View style={meetingChatBodyStyles.viewerSheet} pointerEvents="box-none">
              <View style={[meetingChatBodyStyles.viewerTopRow, { paddingTop: insets.top + 8 }]}>
                <GinitPressable
                  duplicatePressGuardDisabled
                  onPress={() => setImageViewer(null)}
                  hitSlop={10}
                  disabled={imageViewerBusy}
                  accessibilityRole="button"
                  accessibilityLabel="닫기">
                  <GinitSymbolicIcon name="close" size={26} color="#fff" />
                </GinitPressable>
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
                  <GinitPressable
                    duplicatePressGuardDisabled
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
                  </GinitPressable>
                  <GinitPressable
                    duplicatePressGuardDisabled
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
                  </GinitPressable>
                  {imageViewerCanDelete ? (
                    <GinitPressable
                      duplicatePressGuardDisabled
                      onPress={() => {
                        const u = imageViewerEntry?.imageUrl?.trim() ?? '';
                        const rid = roomId.trim();
                        const msgId = imageViewerEntry?.id.trim() ?? '';
                        if (!u || !rid || !msgId) return;
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
                                  await deleteSocialChatImageMessageBestEffort(rid, msgId, u);
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
                    </GinitPressable>
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
    </GestureHandlerRootView>
  );
});

SocialDmChatRoomBody.displayName = 'SocialDmChatRoomBody';
