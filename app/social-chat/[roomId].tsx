import { GinitPressable } from '@/components/ui/GinitPressable';

import { useIsFocused, useNavigation } from '@react-navigation/native';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ForwardRefExoticComponent, type RefAttributes } from 'react';
import { ActivityIndicator, Keyboard, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
    SocialDmChatRoomBody,
    type SocialDmChatRoomBodyHandle,
    type SocialDmChatRoomBodyProps,
} from '@/components/chat/SocialDmChatRoomBody';
import { GinitTheme } from '@/constants/ginit-theme';
import { useInAppAlarms } from '@/src/context/InAppAlarmsContext';
import { getAppQueryClient } from '@/src/context/QueryClientPersistProvider';
import { useUserSession } from '@/src/context/UserSessionContext';
import { useLocalChatRoomSummaries } from '@/src/hooks/use-local-chat-room-summaries';
import { useOfflineChatRoomSync } from '@/src/hooks/useOfflineChatRoomSync';
import { syncServerParticipantUnreadForRoom } from '@/src/lib/chat-local-unread-sync';
import { useAndroidOverlayHardwareBack } from '@/src/hooks/use-android-overlay-hardware-back';
import { useChatMarkReadOnFocus } from '@/src/hooks/use-chat-mark-read-on-focus';
import { useChatRealtimeConnectionBanner } from '@/src/hooks/use-chat-realtime-connection-banner';
import { useChatEngine } from '@/src/hooks/useChatEngine';
import { useFocusedDelayedSubscription } from '@/src/hooks/use-focused-delayed-subscription';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { chatEngineSnapshotsToSocialMessagesChrono } from '@/src/lib/chat-engine-snapshot-to-social';
import { setCurrentChatRoomId } from '@/src/lib/current-chat-room';
import { normalizePhoneUserId } from '@/src/lib/phone-user-id';
import { useTransitionRouter } from '@/src/lib/screen-transition-navigation';
import type { MeetingChatMessage } from '@/src/lib/meeting-chat';
import type { SocialChatMessage } from '@/src/lib/social-chat-rooms';
import {
  ensureSocialChatRoomDoc,
  parsePeerFromSocialRoomId,
  subscribeSocialChatRoom,
  type SocialChatRoomDoc,
} from '@/src/lib/social-chat-rooms';
import { subscribeSocialChatReadPointersRealtime } from '@/src/lib/social-chat-read-pointers';
import { createChatSearchSession, type ChatSearchSession } from '@/src/lib/chat-search-navigator';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { isPeerBlockedByMe } from '@/src/lib/user-blocks';
import { listLocalSearchMessageIdsNewestFirst } from '@/src/lib/offline-chat/offline-chat-search';
import { recordRecentSearch } from '@/src/lib/offline-chat/recent-searches';
import {
  firestoreTimeToMs,
  optimisticZeroUnreadLocalChatRoomOnMount,
  upsertLocalChatRoomReadState,
} from '@/src/lib/offline-chat/offline-chat-rooms';
import { backfillOlderRoomMessagesToLocal } from '@/src/lib/offline-chat/offline-chat-sync';
import { presentAppDialogAlert } from '@/src/lib/app-dialog-present';

export default function SocialChatRoomScreen() {
  const router = useTransitionRouter();
  const navigation = useNavigation();
  const isFocused = useIsFocused();
  const { userId } = useUserSession();
  const { markChatReadUpTo } = useInAppAlarms();
  const params = useLocalSearchParams<{ roomId: string | string[]; peerName?: string; peerPhotoUrl?: string }>();
  const rawRoom = Array.isArray(params.roomId) ? params.roomId[0] : params.roomId;
  const roomId = useMemo(() => decodeURIComponent(String(rawRoom ?? '').trim()), [rawRoom]);
  const peerName =
    typeof params.peerName === 'string' && params.peerName.trim()
      ? decodeURIComponent(params.peerName.trim())
      : '친구';
  const initialPeerPhotoUrl =
    typeof params.peerPhotoUrl === 'string' && params.peerPhotoUrl.trim()
      ? decodeURIComponent(params.peerPhotoUrl.trim())
      : null;

  const peerId = useMemo(() => {
    const me = userId?.trim() ?? '';
    if (!me || !roomId) return '';
    return parsePeerFromSocialRoomId(roomId, me) ?? '';
  }, [roomId, userId]);
  const chatMe = useMemo(() => {
    const raw = userId?.trim() ?? '';
    return (normalizeParticipantId(raw) || normalizePhoneUserId(raw) || raw).trim();
  }, [userId]);
  const canRenderChatShell = Boolean(roomId && userId?.trim() && peerId);

  const [chatError, setChatError] = useState<string | null>(null);
  const realtimeBanner = useChatRealtimeConnectionBanner(true, isFocused);
  const [ready, setReady] = useState(false);
  const [roomDoc, setRoomDoc] = useState<SocialChatRoomDoc | null | undefined>(undefined);
  const dmBodyRef = useRef<SocialDmChatRoomBodyHandle | null>(null);
  const [searchNavigateLoading, setSearchNavigateLoading] = useState(false);
  const [bubbleReadMapsRevision, setBubbleReadMapsRevision] = useState(0);

  const { messages: engineSnapshots, sendMessage } = useChatEngine({
    roomKind: 'social_dm',
    roomId,
    meAppUserId: userId?.trim() ?? '',
    enabled: ready && Boolean(userId?.trim()),
    observeLimit: 5000,
  });

  const messages = useMemo(
    () => chatEngineSnapshotsToSocialMessagesChrono(engineSnapshots),
    [engineSnapshots],
  );

  const markReadMessages = useMemo(
    () =>
      messages.map((m) => ({
        id: m.id,
        serverSeq: m.serverSeq,
        createdAtMs: m.createdAt?.toMillis?.() ?? 0,
      })),
    [messages],
  );

  const pickLatestSocialMessage = useCallback(
    (msgs: readonly { id: string; serverSeq?: number | null; createdAtMs?: number }[]) =>
      msgs.length > 0 ? (msgs[msgs.length - 1] ?? null) : null,
    [],
  );

  useChatMarkReadOnFocus({
    roomKind: 'social_dm',
    roomId,
    meAppUserId: chatMe,
    ownerUserId: userId?.trim() ?? null,
    peerUserId: peerId,
    isFocused,
    enabled: ready && Boolean(roomId && chatMe),
    pickLatest: pickLatestSocialMessage,
    messages: markReadMessages,
    markChatReadUpTo,
    markOnBlur: true,
  });

  useEffect(() => {
    if (!ready || !isFocused || !roomId.trim() || !chatMe.trim()) return;
    void syncServerParticipantUnreadForRoom(chatMe, 'social_dm', roomId, {
      queryClient: getAppQueryClient(),
    });
  }, [ready, isFocused, roomId, chatMe]);

  const [hasMoreOlder, setHasMoreOlder] = useState(true);
  const [olderPrefetchBusy, setOlderPrefetchBusy] = useState(false);

  useEffect(() => {
    setHasMoreOlder(true);
  }, [roomId]);

  useEffect(() => {
    if (!roomId || !userId?.trim()) return;
    const ownerNorm = normalizeParticipantId(userId.trim()) || userId.trim();
    const peer = peerId?.trim() || undefined;
    void optimisticZeroUnreadLocalChatRoomOnMount({
      roomType: 'social_dm',
      roomId,
      ownerUserId: ownerNorm,
      isGroup: false,
      peerUserId: peer,
    });
  }, [roomId, userId, peerId]);

  useOfflineChatRoomSync({ roomType: 'social_dm', roomId }, ready, userId);
  const localSocialRoomSummaries = useLocalChatRoomSummaries({
    roomType: 'social_dm',
    ownerUserId: userId,
    enabled: ready,
  });
  const localSocialRoom = useMemo(
    () => localSocialRoomSummaries.find((row) => row.roomId === roomId) ?? null,
    [localSocialRoomSummaries, roomId],
  );

  const chatReconnecting = realtimeBanner.bannerTone === 'reconnecting';
  const mergedChatError = realtimeBanner.bannerTone === 'error' ? realtimeBanner.bannerText : chatError;

  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchCommittedQuery, setSearchCommittedQuery] = useState('');
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchSession, setSearchSession] = useState<ChatSearchSession>(() => createChatSearchSession(''));
  const searchInputRef = useRef<TextInput>(null);
  const messagesNewestFirstRef = useRef<SocialChatMessage[]>([]);

  useEffect(() => {
    messagesNewestFirstRef.current = [...messages].reverse();
  }, [messages]);

  const SocialDmChatRoomBodyTyped = SocialDmChatRoomBody as unknown as ForwardRefExoticComponent<
    SocialDmChatRoomBodyProps & RefAttributes<SocialDmChatRoomBodyHandle>
  >;

  const pickPeerReadValue = useCallback(
    <T,>(map: Record<string, T> | undefined, rawPeerId: string): T | null => {
      if (!map) return null;
      const pid = rawPeerId.trim();
      if (!pid) return null;
      const direct = (map as Record<string, T | undefined>)[pid];
      if (direct !== undefined) return direct ?? null;
      const pidPk = normalizeParticipantId(pid) ?? '';
      const pidPhone = normalizePhoneUserId(pid) ?? '';
      for (const [k, v] of Object.entries(map)) {
        if (!k.trim()) continue;
        const kPk = normalizeParticipantId(k) ?? '';
        const kPhone = normalizePhoneUserId(k) ?? '';
        if ((pidPk && kPk && kPk === pidPk) || (pidPhone && kPhone && kPhone === pidPhone)) return v ?? null;
      }
      return null;
    },
    [],
  );

  const localPeerReadMessageId = useMemo(() => {
    const v = pickPeerReadValue<unknown>(localSocialRoom?.messageReadMessageIdBy, peerId);
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  }, [localSocialRoom?.messageReadMessageIdBy, peerId, pickPeerReadValue]);

  const localPeerReadAt = useMemo(
    () => pickPeerReadValue<number>(localSocialRoom?.messageReadAtMsBy, peerId),
    [localSocialRoom?.messageReadAtMsBy, peerId, pickPeerReadValue],
  );

  const serverPeerReadMessageId = useMemo(() => {
    const v = pickPeerReadValue<unknown>(
      roomDoc?.readMessageIdBy as unknown as Record<string, unknown> | undefined,
      peerId,
    );
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  }, [peerId, pickPeerReadValue, roomDoc?.readMessageIdBy]);

  const serverPeerReadAt = useMemo(() => pickPeerReadValue<unknown>(roomDoc?.readAtBy, peerId), [
    peerId,
    pickPeerReadValue,
    roomDoc?.readAtBy,
  ]);

  const effectivePeerReadState = useMemo(() => {
    const localAtMs = typeof localPeerReadAt === 'number' && Number.isFinite(localPeerReadAt) ? localPeerReadAt : 0;
    const serverAtMs = firestoreTimeToMs(serverPeerReadAt);
    if (serverPeerReadMessageId && (!localPeerReadMessageId || serverAtMs >= localAtMs)) {
      return { readMessageId: serverPeerReadMessageId, readAt: serverPeerReadAt ?? serverAtMs };
    }
    return { readMessageId: localPeerReadMessageId ?? serverPeerReadMessageId, readAt: localPeerReadAt ?? serverPeerReadAt };
  }, [localPeerReadAt, localPeerReadMessageId, serverPeerReadAt, serverPeerReadMessageId]);

  useEffect(() => {
    if (!roomId || !userId?.trim() || !peerId) {
      setReady(false);
      setRoomDoc(undefined);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const blockedByMe = await isPeerBlockedByMe(userId.trim(), peerId).catch(() => false);
        if (blockedByMe) {
          presentAppDialogAlert({ title: '차단된 사용자', body: '차단된 사용자와는 메시지를 주고받을 수 없어요.' });
          if (!cancelled) router.back();
          return;
        }
        await ensureSocialChatRoomDoc(roomId, userId.trim(), peerId);
        if (!cancelled) setReady(true);
      } catch (e) {
        if (!cancelled) setChatError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roomId, userId, peerId]);

  useEffect(() => {
    if (!roomId || !isFocused) return;
    setCurrentChatRoomId(roomId);
    return () => setCurrentChatRoomId(null);
  }, [roomId, isFocused]);

  useFocusedDelayedSubscription(
    isFocused && ready && Boolean(roomId),
    () => subscribeSocialChatRoom(roomId, (d) => setRoomDoc(d), realtimeBanner.handlers),
    [ready, roomId, isFocused, realtimeBanner.handlers],
  );

  useEffect(() => {
    if (!ready || !roomId || !roomDoc) return;
    const readAtBy = roomDoc.readAtBy ?? null;
    const readStateLastAtMs = Math.max(
      firestoreTimeToMs(roomDoc.updatedAt),
      ...Object.values(readAtBy ?? {}).map((v) => firestoreTimeToMs(v)),
    );
    void upsertLocalChatRoomReadState({
      roomType: 'social_dm',
      roomId,
      ownerUserId: userId?.trim() ?? null,
      peerUserId: peerId,
      readMessageIdBy: roomDoc.readMessageIdBy as Record<string, unknown> | null,
      readAtBy: readAtBy as Record<string, unknown> | null,
      readStateLastAtMs: readStateLastAtMs || undefined,
    });
  }, [ready, roomId, roomDoc, userId, peerId]);

  /** Supabase `chat_read_pointers` Realtime → 로컬 읽음 맵(말풍선 상대 읽음). 목록용 `chat_rooms` 엔진은 변경하지 않습니다. */
  useFocusedDelayedSubscription(
    isFocused && ready && Boolean(roomId) && Boolean(chatMe) && Boolean(peerId),
    () =>
      subscribeSocialChatReadPointersRealtime({
        roomId,
        myAppUserId: chatMe,
        ownerUserId: userId?.trim() ?? null,
        peerUserId: peerId,
        realtimeCallbacks: realtimeBanner.handlers,
        onReadPointersMerged: () => setBubbleReadMapsRevision((v) => v + 1),
      }),
    [ready, roomId, isFocused, chatMe, peerId, userId, realtimeBanner.handlers],
  );

  const closeSearch = useCallback(() => {
    setSearchMode(false);
    setSearchQuery('');
    setSearchCommittedQuery('');
    setSearchSession(createChatSearchSession(''));
    setSearchBusy(false);
  }, []);

  const openSearch = useCallback(() => {
    Keyboard.dismiss();
    setSearchMode(true);
    setSearchQuery('');
    setSearchCommittedQuery('');
    setSearchSession(createChatSearchSession(''));
  }, []);

  const openSettings = useCallback(() => {
    router.push(`/social-chat/${encodeURIComponent(roomId)}/settings?peerName=${encodeURIComponent(peerName)}`);
  }, [router, roomId, peerName]);

  const searchStatusLabel = useMemo(() => {
    const total = searchSession.matchIds.length;
    if (!searchSession.query.trim()) return '';
    if (total === 0) return searchBusy ? '찾는 중…' : '결과 없음';
    const cur = Math.min(total, Math.max(1, searchSession.cursorIndex + 1));
    return `${cur}/${total}`;
  }, [searchBusy, searchSession]);

  const onPrefetchOlderMessages = useCallback(() => {
    const uid = userId?.trim();
    if (!roomId.trim() || !uid || olderPrefetchBusy) return;
    setOlderPrefetchBusy(true);
    void (async () => {
      try {
        const r = await backfillOlderRoomMessagesToLocal({
          key: { roomType: 'social_dm', roomId: roomId.trim() },
          appUserId: uid,
          pageSize: 120,
          maxPages: 2,
          timeBudgetMs: 2200,
        });
        if (r.pulledDocs <= 0) setHasMoreOlder(false);
      } finally {
        setOlderPrefetchBusy(false);
      }
    })();
  }, [roomId, userId, olderPrefetchBusy]);

  const scrollSocialToMessageIdBestEffort = useCallback(
    async (messageId: string) => {
      const mid = String(messageId ?? '').trim();
      if (!mid) return;
      if (dmBodyRef.current?.scrollToMessageId(mid, { animated: true })) return;
      const uid = userId?.trim() ?? '';
      const rid = roomId.trim();
      if (!uid || !rid) return;
      for (let i = 0; i < 10; i += 1) {
        const r = await backfillOlderRoomMessagesToLocal({
          key: { roomType: 'social_dm', roomId: rid },
          appUserId: uid,
          pageSize: 150,
          maxPages: 3,
          timeBudgetMs: 2800,
        });
        if (dmBodyRef.current?.scrollToMessageId(mid, { animated: true })) return;
        if (r.pulledDocs <= 0) {
          setHasMoreOlder(false);
          break;
        }
      }
      presentAppDialogAlert({ title: '대화 위치', body: '로컬에는 있지만 아직 이 화면에 불러와지지 않은 메시지예요.\n위로 스크롤해 조금 더 불러온 뒤 다시 시도해 주세요.' });
    },
    [roomId, userId],
  );

  const runSocialLocalSearch = useCallback(async () => {
    const q = searchQuery.trim();
    if (!q || !roomId) return;
    setSearchCommittedQuery(q);
    setSearchBusy(true);
    try {
      const matchIds = await listLocalSearchMessageIdsNewestFirst({
        key: { roomType: 'social_dm', roomId },
        query: q,
        limit: 200,
      });
      setSearchSession({
        query: q,
        matchIds,
        cursorIndex: matchIds.length > 0 ? 0 : -1,
        scanCursor: 0,
      });
      await recordRecentSearch({ scope: 'room', roomId, query: q });
      const first = matchIds[0]?.trim();
      if (first) await scrollSocialToMessageIdBestEffort(first);
    } finally {
      setSearchBusy(false);
    }
  }, [roomId, scrollSocialToMessageIdBestEffort, searchQuery]);

  const goNewerMatch = useCallback(() => {
    const total = searchSession.matchIds.length;
    const cur = searchSession.cursorIndex;
    if (total <= 0) return;
    if (cur < 0) {
      const id0 = searchSession.matchIds[0]?.trim() ?? '';
      if (!id0) return;
      setSearchSession((prev) => ({ ...prev, cursorIndex: 0 }));
      if (!dmBodyRef.current?.scrollToMessageId(id0, { animated: true })) void scrollSocialToMessageIdBestEffort(id0);
      return;
    }
    if (cur <= 0) return;
    const id = searchSession.matchIds[cur - 1]?.trim() ?? '';
    if (!id) return;
    setSearchSession((prev) => ({ ...prev, cursorIndex: Math.max(0, cur - 1) }));
    if (!dmBodyRef.current?.scrollToMessageId(id, { animated: true })) void scrollSocialToMessageIdBestEffort(id);
  }, [scrollSocialToMessageIdBestEffort, searchSession.cursorIndex, searchSession.matchIds]);

  const goOlderMatchOrScan = useCallback(async () => {
    const total = searchSession.matchIds.length;
    const cur = searchSession.cursorIndex;
    if (total > 0 && cur >= 0 && cur + 1 < total) {
      const id = searchSession.matchIds[cur + 1]?.trim() ?? '';
      if (!id) return;
      setSearchSession((prev) => ({ ...prev, cursorIndex: Math.min(prev.matchIds.length - 1, cur + 1) }));
      if (!dmBodyRef.current?.scrollToMessageId(id, { animated: true })) await scrollSocialToMessageIdBestEffort(id);
      return;
    }
  }, [scrollSocialToMessageIdBestEffort, searchSession.cursorIndex, searchSession.matchIds]);

  useEffect(() => {
    if (!searchMode) return;
    const t = setTimeout(() => searchInputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [searchMode]);

  const jumpToResult = useCallback(
    async (msg: SocialChatMessage) => {
      closeSearch();
      setTimeout(() => {
        void (async () => {
          const rid = roomId.trim();
          const tid = msg.id.trim();
          if (!rid || !tid) return;

          const ok0 = dmBodyRef.current?.scrollToMessageId(tid) ?? false;
          if (ok0) return;

          setSearchNavigateLoading(true);
          try {
            const uid = userId?.trim() ?? '';
            if (!uid) return;
            for (let i = 0; i < 12; i += 1) {
              const r = await backfillOlderRoomMessagesToLocal({
                key: { roomType: 'social_dm', roomId: rid },
                appUserId: uid,
                pageSize: 150,
                maxPages: 4,
                timeBudgetMs: 3200,
              });
              const ok1 = dmBodyRef.current?.scrollToMessageId(tid) ?? false;
              if (ok1) return;
              if (r.pulledDocs <= 0) {
                setHasMoreOlder(false);
                break;
              }
            }
            setTimeout(() => {
              const ok2 = dmBodyRef.current?.scrollToMessageId(tid) ?? false;
              if (!ok2) presentAppDialogAlert({ title: '위치 이동', body: '해당 메시지를 목록에서 찾지 못했어요.' });
            }, 80);
          } finally {
            setSearchNavigateLoading(false);
          }
        })();
      }, 100);
    },
    [closeSearch, roomId, userId],
  );

  const sendTextOverride = useCallback(
    async ({ body, replyTo }: { body: string; replyTo: MeetingChatMessage['replyTo'] }) => {
      const uid = userId?.trim() ?? '';
      if (!uid) return;
      await sendMessage({
        kind: 'text',
        bodyText: body,
        senderId: uid,
        replyTo: replyTo?.messageId
          ? {
              messageId: replyTo.messageId,
              senderId: replyTo.senderId,
              kind: replyTo.kind,
              imageUrl: replyTo.imageUrl,
              text: replyTo.text,
            }
          : null,
      });
    },
    [sendMessage, userId],
  );

  const exitSocialChat = useCallback(() => {
    if (navigation.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/chat');
    }
  }, [navigation, router]);

  const handleSocialChatHardwareBack = useCallback(() => {
    if (searchMode) {
      closeSearch();
      return;
    }
    exitSocialChat();
  }, [searchMode, closeSearch, exitSocialChat]);

  useAndroidOverlayHardwareBack(handleSocialChatHardwareBack);

  if (!userId?.trim()) {
    return (
      <SafeAreaView style={s.center} edges={['top']}>
        <Text style={s.muted}>로그인이 필요합니다.</Text>
      </SafeAreaView>
    );
  }

  if (!roomId || !peerId.trim()) {
    return (
      <SafeAreaView style={s.center} edges={['top']}>
        <Text style={s.muted}>채팅방 정보가 올바르지 않아요.</Text>
        <GinitPressable onPress={exitSocialChat} style={s.backLink}>
          <Text style={s.backLinkText}>돌아가기</Text>
        </GinitPressable>
      </SafeAreaView>
    );
  }

  return (
    <View style={s.root}>
      <SafeAreaView edges={['top']} style={s.topSafe}>
        <View style={s.topBar}>
          <GinitPressable
            onPress={searchMode ? closeSearch : exitSocialChat}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={searchMode ? '검색 닫기' : '뒤로'}>
            <GinitSymbolicIcon name="chevron-back" size={22} color="#0f172a" />
          </GinitPressable>
          {searchMode ? (
            <View style={s.searchTitleBlock} accessibilityLabel="검색 입력">
              <TextInput
                ref={searchInputRef}
                style={s.searchTitleInput}
                placeholder="검색어 입력"
                placeholderTextColor="#94a3b8"
                value={searchQuery}
                onChangeText={(t) => {
                  setSearchQuery(t);
                  setSearchCommittedQuery('');
                  setSearchSession(createChatSearchSession(''));
                }}
                autoCorrect={false}
                autoCapitalize="none"
                clearButtonMode="while-editing"
                returnKeyType="search"
                onSubmitEditing={() => void runSocialLocalSearch()}
              />
            </View>
          ) : (
            <View style={s.titleBlock} accessibilityRole="header" accessibilityLabel="대화 상대">
              <Text style={s.topTitle} numberOfLines={1}>
                {peerName}
              </Text>
              <GinitPressable onPress={exitSocialChat} hitSlop={6} accessibilityRole="button" accessibilityLabel="뒤로가기">
                <Text style={s.titleLink}>뒤로가기</Text>
              </GinitPressable>
            </View>
          )}
          {!searchMode ? (
            <>
              <GinitPressable
                onPress={openSearch}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="대화 검색"
                style={s.searchBtn}
              >
                <GinitSymbolicIcon name="search-outline" size={22} color="#0f172a" />
              </GinitPressable>
              <GinitPressable
                onPress={openSettings}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="채팅방 설정"
                style={s.settingsBtn}
              >
                <GinitSymbolicIcon name="settings-outline" size={22} color="#0f172a" />
              </GinitPressable>
            </>
          ) : null}
        </View>
      </SafeAreaView>

      {!canRenderChatShell || !ready ? (
        <View style={s.loading}>
          <ActivityIndicator color={GinitTheme.colors.primary} />
        </View>
      ) : (
        <>
          <SocialDmChatRoomBodyTyped
            ref={dmBodyRef}
            roomId={roomId}
            peerId={peerId}
            myUserId={userId.trim()}
            messages={messages}
            chatError={mergedChatError}
            chatReconnecting={chatReconnecting}
            searchNavigateLoading={searchNavigateLoading}
            hasNextPage={hasMoreOlder}
            isFetchingNextPage={olderPrefetchBusy}
            onPrefetchOlderMessages={onPrefetchOlderMessages}
            sendTextOverride={sendTextOverride}
            searchMode={searchMode}
            searchQuery={searchQuery}
            searchCommittedQuery={searchCommittedQuery}
            messageSearchHighlightQuery={
              searchMode && searchCommittedQuery.trim() ? searchCommittedQuery : ''
            }
            searchBusy={searchBusy}
            searchStatusLabel={searchStatusLabel}
            searchSession={searchSession}
            onSearchPrev={goOlderMatchOrScan}
            onSearchNext={goNewerMatch}
            peerReadMessageId={effectivePeerReadState.readMessageId}
            peerReadAt={effectivePeerReadState.readAt}
            peerReadStateReady={(localSocialRoom?.messageReadStateLastAtMs ?? 0) > 0 || roomDoc !== undefined}
            readMapsRevision={bubbleReadMapsRevision}
            initialPeerName={peerName}
            initialPeerPhotoUrl={initialPeerPhotoUrl}
            onPeerProfileOpen={(id) => {
              const t = id.trim();
              if (!t) return;
              router.push(`/profile/user/${encodeURIComponent(t)}`);
            }}
          />
        </>
      )}

      {/* 헤더 인라인 검색으로 전환(모달 검색 제거) */}
      {/* 프로필 팝업 대신 전체 화면 프로필로 이동합니다. */}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#ECEFF1' },
  topSafe: { backgroundColor: '#fff' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(15, 23, 42, 0.08)',
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
    gap: 2,
    justifyContent: 'center',
    paddingVertical: 4,
    alignItems: 'flex-start',
  },
  topTitle: { fontSize: 16, fontWeight: '600', color: '#0f172a', textAlign: 'left' },
  titleLink: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
    textAlign: 'left',
  },
  searchTitleBlock: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 },
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
    paddingVertical: 8,
  },
  searchBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  settingsBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  loading: { padding: 24, alignItems: 'center' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  muted: { fontSize: 15, color: '#64748b' },
  backLink: { marginTop: 12, padding: 10 },
  backLinkText: { fontSize: 15, fontWeight: '700', color: GinitTheme.colors.primary },
  // (헤더 인라인 검색으로 이동: 모달 내 네비 버튼 스타일은 미사용)
  searchBusyRow: {
    position: 'absolute',
    right: 16,
    bottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.08)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  searchBusyText: { fontSize: 12, color: '#475569', fontWeight: '700' },
  searchEmpty: {
    marginTop: 48,
    textAlign: 'center',
    fontSize: 15,
    color: '#94a3b8',
    lineHeight: 22,
    fontWeight: '600',
  },
  // (모달 검색 UI 제거로 미사용)
});
