
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Dimensions,
  InteractionManager,
  type KeyboardEvent,
  type LayoutChangeEvent,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MeetingChatMediaPickerModal } from '@/components/chat/MeetingChatMediaPickerModal';
import { MeetingChatImageViewerGallery } from '@/components/chat/MeetingChatImageViewerGallery';
import { MeetingChatMainColumn } from '@/components/chat/MeetingChatMainColumn';
import { meetingChatBodyStyles } from '@/components/chat/meeting-chat-body-styles';
import { meetingImageViewerMeta } from '@/components/chat/meeting-chat-ui-helpers';
import { useMeetingChatRenderItem } from '@/components/chat/use-meeting-chat-render-item';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { buildMeetingChatListRows, findMeetingChatListRowIndexByMessageId } from '@/src/lib/meeting-chat-list-rows';
import { saveRemoteImageUrlToLibrary, shareRemoteImageUrl } from '@/src/lib/chat-image-actions';
import type { MeetingChatMessage } from '@/src/lib/meeting-chat';
import {
  deleteSocialChatImageMessageBestEffort,
  sendSocialChatImageMessagesBatch,
  sendSocialChatTextMessage,
  socialMessagesToMeetingNewestFirst,
  type SocialChatMessage,
} from '@/src/lib/social-chat-rooms';
import type { UserProfile } from '@/src/lib/user-profile';
import { getUserProfilesForIds } from '@/src/lib/user-profile';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';

export type SocialDmChatRoomBodyHandle = {
  /** 모임 채팅과 동일하게 `data`는 최신이 index 0(inverted 기준). */
  scrollToMessageId: (messageId: string) => boolean;
};

export type SocialDmChatRoomBodyProps = {
  roomId: string;
  peerId: string;
  myUserId: string;
  messages: SocialChatMessage[];
  chatError: string | null;
  peerReadMessageId: string | null;
  peerReadAt: unknown | null;
  onPeerProfileOpen: (peerAppUserId: string) => void;
};

export const SocialDmChatRoomBody = forwardRef<SocialDmChatRoomBodyHandle, SocialDmChatRoomBodyProps>(function SocialDmChatRoomBody(
  { roomId, peerId, myUserId, messages: rawMessages, chatError, peerReadMessageId, peerReadAt, onPeerProfileOpen },
  ref,
) {
  const insets = useSafeAreaInsets();
  const [profiles, setProfiles] = useState<Map<string, UserProfile>>(new Map());
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<MeetingChatMessage['replyTo']>(null);
  const [keyboardBottomInset, setKeyboardBottomInset] = useState(0);
  const [imageViewer, setImageViewer] = useState<{
    gallery: MeetingChatMessage[];
    index: number;
  } | null>(null);
  const [imageViewerBusy, setImageViewerBusy] = useState(false);
  const [showJumpToBottomFab, setShowJumpToBottomFab] = useState(false);
  const searchNavigateLoading = false;
  const [composerDockBlockHeight, setComposerDockBlockHeight] = useState(104);
  const [composerInputBarHeight, setComposerInputBarHeight] = useState(56);
  const listRef = useRef<unknown>(null);
  const innerFlashListRef = useRef<unknown>(null);
  const setListRef = useCallback((r: unknown) => {
    if (r) listRef.current = r;
  }, []);
  const setInnerFlashListRef = useCallback((r: unknown) => {
    if (r) innerFlashListRef.current = r;
  }, []);
  const messageInputRef = useRef<TextInput>(null);

  const myId = useMemo(() => (myUserId.trim() ? normalizeParticipantId(myUserId.trim()) : ''), [myUserId]);
  const hostNorm = '';

  const messages = useMemo(() => socialMessagesToMeetingNewestFirst(rawMessages), [rawMessages]);
  const chatListRows = useMemo(() => buildMeetingChatListRows(messages), [messages]);

  const chatImageGalleryChrono = useMemo(() => {
    const imgs = messages.filter((m) => m.kind === 'image' && m.imageUrl?.trim());
    return [...imgs].reverse();
  }, [messages]);

  const resolveListScroller = useCallback(() => {
    const r = innerFlashListRef.current ?? listRef.current;
    if (!r) return null;
    const candidates = [
      r,
      typeof (r as { getNode?: () => unknown }).getNode === 'function' ? (r as { getNode: () => unknown }).getNode() : null,
      typeof (r as { getScrollResponder?: () => unknown }).getScrollResponder === 'function'
        ? (r as { getScrollResponder: () => unknown }).getScrollResponder()
        : null,
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

  const scrollToMessageIndexBestEffort = useCallback(
    (idx: number) => {
      const index = Math.max(0, Math.floor(idx));
      InteractionManager.runAfterInteractions(() => {
        setTimeout(() => {
          scrollToIndexSafe(index, 0.35, false);
          requestAnimationFrame(() => {
            scrollToIndexSafe(index, 0.35, false);
          });
        }, 60);
      });
    },
    [scrollToIndexSafe],
  );

  useImperativeHandle(
    ref,
    () => ({
      scrollToMessageId: (messageId: string) => {
        const mid = String(messageId ?? '').trim();
        if (!mid) return false;
        const rowIdx = findMeetingChatListRowIndexByMessageId(chatListRows, mid);
        const idx = rowIdx >= 0 ? rowIdx : messages.findIndex((m) => m.id === mid);
        if (idx < 0) return false;
        scrollToMessageIndexBestEffort(idx);
        return true;
      },
    }),
    [messages, chatListRows, scrollToMessageIndexBestEffort],
  );

  useEffect(() => {
    const ids = [myUserId.trim(), peerId.trim()].filter(Boolean);
    if (ids.length < 2) return;
    void getUserProfilesForIds(ids).then(setProfiles);
  }, [myUserId, peerId]);

  useEffect(() => {
    const slack = Platform.select({ ios: 3, android: 3, default: 3 });
    const apply = (e: KeyboardEvent) => {
      const { height, screenY } = e.endCoordinates;
      const h = typeof height === 'number' ? height : 0;
      if (h < 32) return;
      const winH = Dimensions.get('window').height;
      const fromBottom = Number.isFinite(screenY) ? Math.max(0, winH - screenY) : 0;
      let pad = h + slack;
      if (fromBottom > pad + 8) pad = fromBottom;
      setKeyboardBottomInset(pad);
    };
    const subShow =
      Platform.OS === 'ios' ? Keyboard.addListener('keyboardWillShow', apply) : Keyboard.addListener('keyboardDidShow', apply);
    const subHide =
      Platform.OS === 'ios'
        ? Keyboard.addListener('keyboardWillHide', () => setKeyboardBottomInset(0))
        : Keyboard.addListener('keyboardDidHide', () => setKeyboardBottomInset(0));
    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, []);

  const composerBottomPad = useMemo(
    () =>
      keyboardBottomInset > 0 ? Math.ceil(keyboardBottomInset) : Math.max(insets.bottom, 8),
    [keyboardBottomInset, insets.bottom],
  );

  const onChatScroll = useCallback(
    (e: { nativeEvent: { contentOffset: { y: number }; layoutMeasurement: { height: number }; contentSize: { height: number } } }) => {
      const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
      const viewH = layoutMeasurement.height;
      const contentH = contentSize.height;
      if (viewH <= 0 || contentH <= 0) {
        setShowJumpToBottomFab(false);
        return;
      }
      if (contentH <= viewH + 4) {
        setShowJumpToBottomFab(false);
        return;
      }
      const threshold = 56;
      setShowJumpToBottomFab(contentOffset.y > threshold);
    },
    [],
  );

  useEffect(() => {
    if (messages.length === 0) setShowJumpToBottomFab(false);
  }, [messages.length]);

  const messageIndexById = useMemo(() => {
    const m = new Map<string, number>();
    messages.forEach((msg, i) => {
      if (msg.id) m.set(msg.id, i);
    });
    return m;
  }, [messages]);

  const peerReadAtMs = useMemo(() => {
    const v = peerReadAt as unknown;
    if (!v) return 0;
    if (typeof v === 'object') {
      const o = v as { toMillis?: () => number; seconds?: number; nanoseconds?: number };
      if (typeof o.toMillis === 'function') {
        try {
          return o.toMillis();
        } catch {
          return 0;
        }
      }
      if (typeof o.seconds === 'number') {
        const ns = typeof o.nanoseconds === 'number' ? o.nanoseconds : 0;
        return Math.max(0, Math.floor(o.seconds * 1000 + ns / 1e6));
      }
    }
    return 0;
  }, [peerReadAt]);

  const unreadCountForMessage = useCallback(
    (message: MeetingChatMessage, messageIndex: number): number => {
      // 1:1: 상대가 안 읽었으면 1, 읽었으면 0
      const msgMs = message.createdAt && typeof message.createdAt.toMillis === 'function' ? message.createdAt.toMillis() : 0;
      if (!msgMs) return 0;

      const lastId = (peerReadMessageId ?? '').trim();
      if (lastId) {
        const readIdx = messageIndexById.get(lastId);
        // inverted + 최신순 배열: 인덱스가 작을수록 더 최신.
        // 상대의 마지막 읽음이 이 메시지보다 최신(또는 동일)이면 읽음(0).
        if (readIdx != null && readIdx <= messageIndex) return 0;
      }

      const ms = peerReadAtMs;
      if (ms > 0 && ms >= msgMs) return 0;
      return 1;
    },
    [peerReadMessageId, peerReadAtMs, messageIndexById],
  );

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
    unreadCountForMessage,
    jumpToRepliedMessage,
    setReplyTo,
    onOpenUserProfile: setPeerProfileUserIdBridge,
    openMeetingChatImageViewer,
    listRef,
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
      try {
        await sendSocialChatImageMessagesBatch(roomId, uid, uris, {
          naturalWidths: widths,
        });
        setMediaPickerOpen(false);
      } catch (e) {
        Alert.alert('전송 실패', e instanceof Error ? e.message : String(e));
      } finally {
        setSending(false);
      }
    },
    [roomId, myUserId, sending],
  );

  const onSend = useCallback(async () => {
    const uid = myUserId.trim();
    const body = draft.trim();
    if (!uid || !roomId || !body || sending) return;
    setSending(true);
    try {
      await sendSocialChatTextMessage(roomId, uid, body, replyTo?.messageId ? replyTo : null);
      setDraft('');
      setReplyTo(null);
    } catch (e) {
      Alert.alert('전송 실패', e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }, [roomId, myUserId, draft, sending, replyTo]);

  const chatListContentStyle = useMemo(
    () => [
      meetingChatBodyStyles.listContent,
      {
        paddingTop:
          keyboardBottomInset > 0
            ? Math.max(4, composerDockBlockHeight - composerBottomPad)
            : 4,
      },
    ],
    [keyboardBottomInset, composerDockBlockHeight, composerBottomPad],
  );

  const onComposerDockLayout = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h > 0) setComposerDockBlockHeight(h);
  }, []);

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
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>
        <MeetingChatMainColumn
          chatError={chatError}
          searchNavigateLoading={searchNavigateLoading}
          setListRef={setListRef}
          setInnerFlashListRef={setInnerFlashListRef}
          chatListRows={chatListRows}
          renderItem={renderItem}
          chatListContentStyle={chatListContentStyle}
          onChatScroll={onChatScroll}
          listFooterLoading={null}
          hasNextPage={false}
          isFetchingNextPage={false}
          onPrefetchOlderMessages={undefined}
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
        />

        <MeetingChatMediaPickerModal
          visible={mediaPickerOpen}
          onClose={() => setMediaPickerOpen(false)}
          sendBusy={sending}
          onConfirmSend={handleMediaPickerConfirmDm}
        />

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
    </GestureHandlerRootView>
  );
});

SocialDmChatRoomBody.displayName = 'SocialDmChatRoomBody';
