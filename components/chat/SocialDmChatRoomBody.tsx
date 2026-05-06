
import * as ImagePicker from 'expo-image-picker';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Dimensions,
  Easing,
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

import { MeetingChatImageViewerZoomArea } from '@/components/chat/MeetingChatImageViewerZoomArea';
import { MeetingChatMainColumn } from '@/components/chat/MeetingChatMainColumn';
import { meetingChatBodyStyles } from '@/components/chat/meeting-chat-body-styles';
import type { MeetingChatQuickActionDef } from '@/components/chat/meeting-chat-quick-action-row';
import { meetingImageViewerMeta } from '@/components/chat/meeting-chat-ui-helpers';
import { useMeetingChatRenderItem } from '@/components/chat/use-meeting-chat-render-item';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { saveRemoteImageUrlToLibrary, shareRemoteImageUrl } from '@/src/lib/chat-image-actions';
import type { MeetingChatMessage } from '@/src/lib/meeting-chat';
import {
  deleteSocialChatImageMessageBestEffort,
  sendSocialChatImageMessage,
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
  const [uploadingImage, setUploadingImage] = useState(false);
  const [replyTo, setReplyTo] = useState<MeetingChatMessage['replyTo']>(null);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const plusRowAnims = useRef([
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
  ]).current;
  const plusIconMorph = useRef(new Animated.Value(0)).current;
  const [keyboardBottomInset, setKeyboardBottomInset] = useState(0);
  const [imageViewer, setImageViewer] = useState<{
    messageId: string;
    url: string;
    senderLabel: string;
    sentAtLabel: string;
    canDelete: boolean;
  } | null>(null);
  const [imageViewerBusy, setImageViewerBusy] = useState(false);
  const [showJumpToBottomFab, setShowJumpToBottomFab] = useState(false);
  const searchNavigateLoading = false;
  const [composerDockBlockHeight, setComposerDockBlockHeight] = useState(104);
  const [composerInputBarHeight, setComposerInputBarHeight] = useState(56);
  const listRef = useRef<unknown>(null);
  const innerFlatListRef = useRef<unknown>(null);
  const setListRef = useCallback((r: unknown) => {
    if (r) listRef.current = r;
  }, []);
  const setInnerFlatListRef = useCallback((r: unknown) => {
    if (r) innerFlatListRef.current = r;
  }, []);
  const messageInputRef = useRef<TextInput>(null);

  const myId = useMemo(() => (myUserId.trim() ? normalizeParticipantId(myUserId.trim()) : ''), [myUserId]);
  const hostNorm = '';

  const messages = useMemo(() => socialMessagesToMeetingNewestFirst(rawMessages), [rawMessages]);

  const resolveListScroller = useCallback(() => {
    const r = innerFlatListRef.current ?? listRef.current;
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
        const idx = messages.findIndex((m) => m.id === mid);
        if (idx < 0) return false;
        scrollToMessageIndexBestEffort(idx);
        return true;
      },
    }),
    [messages, scrollToMessageIndexBestEffort],
  );

  useEffect(() => {
    const ids = [myUserId.trim(), peerId.trim()].filter(Boolean);
    if (ids.length < 2) return;
    void getUserProfilesForIds(ids).then(setProfiles);
  }, [myUserId, peerId]);

  useEffect(() => {
    const slack = Platform.select({ ios: 8, android: 10, default: 8 });
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
      const idx = messages.findIndex((m) => m.id === rid);
      if (idx >= 0) scrollToMessageIndexBestEffort(idx);
      else Alert.alert('원글 위치', '해당 메시지를 찾지 못했어요.');
    },
    [messages, scrollToMessageIndexBestEffort],
  );

  const openMeetingChatImageViewer = useCallback(
    (item: MeetingChatMessage) => {
      const url = item.imageUrl?.trim();
      if (!url || item.kind !== 'image') return;
      const { senderLabel, sentAtLabel } = meetingImageViewerMeta(item, profiles);
      const sid = item.senderId?.trim() ? normalizeParticipantId(item.senderId.trim()) : '';
      const canDelete = Boolean(myId && sid && sid === myId);
      setImageViewer({ messageId: item.id, url, senderLabel, sentAtLabel, canDelete });
    },
    [profiles, myId],
  );

  const setPeerProfileUserIdBridge = useCallback(
    (id: string) => {
      const t = id.trim();
      if (t) onPeerProfileOpen(t);
    },
    [onPeerProfileOpen],
  );

  const renderItem = useMeetingChatRenderItem({
    messages,
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

  const onSend = useCallback(async () => {
    const uid = myUserId.trim();
    const body = draft.trim();
    if (!uid || !roomId || !body || sending || uploadingImage) return;
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
  }, [roomId, myUserId, draft, sending, uploadingImage, replyTo]);

  const onPickImage = useCallback(async () => {
    const uid = myUserId.trim();
    if (!uid || !roomId) return;
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
      await sendSocialChatImageMessage(roomId, uid, asset.uri, {
        caption: caption || undefined,
        naturalWidth: typeof asset.width === 'number' && asset.width > 0 ? asset.width : undefined,
      });
      if (caption) setDraft('');
    } catch (e) {
      Alert.alert('전송 실패', e instanceof Error ? e.message : '다시 시도해 주세요.');
    } finally {
      setUploadingImage(false);
    }
  }, [roomId, myUserId, draft, uploadingImage]);

  const plusPillMaxWidth = useMemo(
    () => Math.max(200, Math.floor(Dimensions.get('window').width - 40)),
    [],
  );
  const chatListContentStyle = useMemo(
    () => [
      meetingChatBodyStyles.listContent,
      {
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
      Animated.stagger(44, [timings[0]!, timings[1]!, timings[2]!, timings[3]!]).start(({ finished }) => {
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
    Animated.stagger(56, [timings[3]!, timings[2]!, timings[1]!, timings[0]!]).start();
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

  const composerBottomPad = keyboardBottomInset > 0 ? keyboardBottomInset : Math.max(insets.bottom, 8);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>
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
          listFooterLoading={null}
          hasNextPage={false}
          isFetchingNextPage={false}
          onPrefetchOlderMessages={undefined}
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
                        const rid = roomId.trim();
                        const msgId = imageViewer?.messageId.trim() ?? '';
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
              {imageViewer?.url ? (
                <View style={meetingChatBodyStyles.viewerImageWrap}>
                  <MeetingChatImageViewerZoomArea uri={imageViewer.url} />
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
