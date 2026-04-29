import { Ionicons } from '@expo/vector-icons';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ForwardRefExoticComponent, type RefAttributes } from 'react';
import { ActivityIndicator, Alert, FlatList, Keyboard, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  SocialDmChatRoomBody,
  type SocialDmChatRoomBodyHandle,
  type SocialDmChatRoomBodyProps,
} from '@/components/chat/SocialDmChatRoomBody';
import { MeetingPeerProfileModal } from '@/components/meeting/MeetingPeerProfileModal';
import { GinitTheme } from '@/constants/ginit-theme';
import { useInAppAlarms } from '@/src/context/InAppAlarmsContext';
import { useUserSession } from '@/src/context/UserSessionContext';
import { setCurrentChatRoomId } from '@/src/lib/current-chat-room';
import type { SocialChatMessage } from '@/src/lib/social-chat-rooms';
import {
  ensureSocialChatRoomDoc,
  parsePeerFromSocialRoomId,
  searchSocialChatMessages,
  subscribeSocialChatRoom,
  subscribeSocialChatMessages,
  updateSocialChatReadReceipt,
  type SocialChatRoomDoc,
} from '@/src/lib/social-chat-rooms';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { normalizePhoneUserId } from '@/src/lib/phone-user-id';

export default function SocialChatRoomScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const isFocused = useIsFocused();
  const { userId } = useUserSession();
  const { markChatReadUpTo } = useInAppAlarms();
  const params = useLocalSearchParams<{ roomId: string | string[]; peerName?: string }>();
  const rawRoom = Array.isArray(params.roomId) ? params.roomId[0] : params.roomId;
  const roomId = useMemo(() => decodeURIComponent(String(rawRoom ?? '').trim()), [rawRoom]);
  const peerName =
    typeof params.peerName === 'string' && params.peerName.trim()
      ? decodeURIComponent(params.peerName.trim())
      : '친구';

  const peerId = useMemo(() => {
    const me = userId?.trim() ?? '';
    if (!me || !roomId) return '';
    return parsePeerFromSocialRoomId(roomId, me) ?? '';
  }, [roomId, userId]);

  const [messages, setMessages] = useState<SocialChatMessage[]>([]);
  const [chatError, setChatError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [roomDoc, setRoomDoc] = useState<SocialChatRoomDoc | null>(null);
  const dmBodyRef = useRef<SocialDmChatRoomBodyHandle | null>(null);
  const lastMarkedReadMessageIdRef = useRef<string>('');

  const [profileModalUserId, setProfileModalUserId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SocialChatMessage[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<TextInput>(null);

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

  useEffect(() => {
    if (!roomId || !userId?.trim() || !peerId) {
      setReady(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
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

  useEffect(() => {
    lastMarkedReadMessageIdRef.current = '';
  }, [roomId]);

  useEffect(() => {
    if (!roomId || !isFocused) return;
    const last = messages[messages.length - 1];
    const lid = last?.id?.trim() ?? '';
    if (!lid || lastMarkedReadMessageIdRef.current === lid) return;
    lastMarkedReadMessageIdRef.current = lid;
    markChatReadUpTo(roomId, lid);
    void updateSocialChatReadReceipt(roomId, userId?.trim() ?? '', lid).catch(() => {});
  }, [roomId, messages, markChatReadUpTo, isFocused, userId]);

  useEffect(() => {
    if (!ready || !roomId) return () => {};
    const unsub = subscribeSocialChatMessages(
      roomId,
      (list) => {
        setMessages(list);
        setChatError(null);
      },
      (msg) => setChatError(msg),
    );
    return unsub;
  }, [ready, roomId]);

  useEffect(() => {
    if (!ready || !roomId) return () => {};
    const unsub = subscribeSocialChatRoom(
      roomId,
      (d) => setRoomDoc(d),
      () => {},
    );
    return unsub;
  }, [ready, roomId]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery('');
    setSearchResults([]);
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = null;
    }
  }, []);

  const openSearch = useCallback(() => {
    Keyboard.dismiss();
    setSearchOpen(true);
    setSearchQuery('');
    setSearchResults([]);
  }, []);

  const openSettings = useCallback(() => {
    router.push(`/social-chat/${encodeURIComponent(roomId)}/settings?peerName=${encodeURIComponent(peerName)}`);
  }, [router, roomId, peerName]);

  const runSearch = useCallback(
    async (q: string) => {
      const needle = q.trim();
      if (!roomId) {
        setSearchResults([]);
        return;
      }
      if (!needle) {
        setSearchResults([]);
        setSearchBusy(false);
        return;
      }
      setSearchBusy(true);
      try {
        const rows = await searchSocialChatMessages(roomId, needle, { maxDocsScanned: 3000 });
        setSearchResults(rows);
      } catch {
        setSearchResults([]);
        Alert.alert('검색 실패', '네트워크 상태를 확인한 뒤 다시 시도해 주세요.');
      } finally {
        setSearchBusy(false);
      }
    },
    [roomId],
  );

  useEffect(() => {
    if (!searchOpen) return;
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      void runSearch(searchQuery);
    }, 280);
    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
        searchDebounceRef.current = null;
      }
    };
  }, [searchOpen, searchQuery, runSearch]);

  useEffect(() => {
    if (!searchOpen) return;
    const t = setTimeout(() => searchInputRef.current?.focus(), 240);
    return () => clearTimeout(t);
  }, [searchOpen]);

  const jumpToResult = useCallback(
    (msg: SocialChatMessage) => {
      closeSearch();
      setTimeout(() => {
        const ok = dmBodyRef.current?.scrollToMessageId(msg.id) ?? false;
        if (!ok) Alert.alert('위치 이동', '해당 메시지를 목록에서 찾지 못했어요.');
      }, 100);
    },
    [closeSearch],
  );

  const exitSocialChat = useCallback(() => {
    if (navigation.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/chat');
    }
  }, [navigation, router]);

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
        <Pressable onPress={exitSocialChat} style={s.backLink}>
          <Text style={s.backLinkText}>돌아가기</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <View style={s.root}>
      <SafeAreaView edges={['top']} style={s.topSafe}>
        <View style={s.topBar}>
          <Pressable onPress={exitSocialChat} hitSlop={12} accessibilityRole="button" accessibilityLabel="뒤로">
            <Ionicons name="chevron-back" size={28} color={GinitTheme.colors.text} />
          </Pressable>
          <Pressable
            onPress={() => {
              const p = peerId.trim();
              if (!p) return;
              setProfileModalUserId(p);
            }}
            disabled={!peerId.trim()}
            style={({ pressed }) => [s.titlePress, !peerId.trim() && { opacity: 0.6 }, pressed && peerId.trim() && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel="상대 프로필">
            <Text style={s.topTitle} numberOfLines={1}>
              {peerName}
            </Text>
          </Pressable>
          <Pressable
            onPress={openSearch}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="대화 검색"
            style={s.searchBtn}
          >
            <Ionicons name="search-outline" size={22} color="#0f172a" />
          </Pressable>
          <Pressable
            onPress={openSettings}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="채팅방 설정"
            style={s.settingsBtn}
          >
            <Ionicons name="settings-outline" size={22} color="#0f172a" />
          </Pressable>
        </View>
      </SafeAreaView>

      {!ready ? (
        <View style={s.loading}>
          <ActivityIndicator color={GinitTheme.colors.primary} />
        </View>
      ) : (
        <SocialDmChatRoomBodyTyped
          ref={dmBodyRef}
          roomId={roomId}
          peerId={peerId}
          myUserId={userId.trim()}
          messages={messages}
          chatError={chatError}
          peerReadMessageId={(() => {
            const v = pickPeerReadValue<unknown>(roomDoc?.readMessageIdBy as unknown as Record<string, unknown> | undefined, peerId);
            return typeof v === 'string' && v.trim() ? v.trim() : null;
          })()}
          peerReadAt={pickPeerReadValue<unknown>(roomDoc?.readAtBy, peerId)}
          onPeerProfileOpen={(id) => setProfileModalUserId(id.trim() || null)}
        />
      )}

      <Modal visible={searchOpen} animationType="slide" onRequestClose={closeSearch}>
        <SafeAreaView style={s.searchSafe} edges={['top', 'bottom']}>
          <View style={s.searchHeader}>
            <Pressable onPress={closeSearch} hitSlop={12} accessibilityRole="button" accessibilityLabel="닫기">
              <Ionicons name="chevron-back" size={26} color={GinitTheme.colors.text} />
            </Pressable>
            <Text style={s.searchTitle}>대화 검색</Text>
            <View style={s.searchHeaderSpacer} />
          </View>
          <View style={s.searchFieldWrap}>
            <Ionicons name="search-outline" size={20} color="#94a3b8" style={s.searchFieldIcon} />
            <TextInput
              ref={searchInputRef}
              style={s.searchInput}
              placeholder="대화 내용을 입력하세요"
              placeholderTextColor="#94a3b8"
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCorrect={false}
              autoCapitalize="none"
              clearButtonMode="while-editing"
              returnKeyType="search"
            />
          </View>
          <FlatList
            data={searchResults}
            keyExtractor={(it) => it.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={s.searchListContent}
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => [s.searchRow, pressed && s.searchRowPressed]}
                onPress={() => jumpToResult(item)}
                accessibilityRole="button"
                accessibilityLabel="검색 결과"
              >
                <Text style={s.searchRowText} numberOfLines={2}>
                  {item.text}
                </Text>
              </Pressable>
            )}
            ListEmptyComponent={
              <Text style={s.searchEmpty}>
                {searchQuery.trim() ? '검색 결과가 없어요.\n다른 단어로 검색해 보세요.' : '검색할 단어를 입력해 주세요.'}
              </Text>
            }
          />
          {searchBusy ? (
            <View style={s.searchBusyRow}>
              <ActivityIndicator color={GinitTheme.colors.primary} />
              <Text style={s.searchBusyText}>검색 중…</Text>
            </View>
          ) : null}
        </SafeAreaView>
      </Modal>
      <MeetingPeerProfileModal
        visible={Boolean(profileModalUserId?.trim())}
        peerAppUserId={profileModalUserId?.trim() || null}
        onClose={() => setProfileModalUserId(null)}
      />
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
    paddingVertical: 8,
    gap: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(15, 23, 42, 0.08)',
  },
  titlePress: { flex: 1, minWidth: 0, justifyContent: 'center', paddingVertical: 4 },
  topTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a', textAlign: 'center' },
  searchBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  settingsBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  loading: { padding: 24, alignItems: 'center' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  muted: { fontSize: 15, color: '#64748b' },
  backLink: { marginTop: 12, padding: 10 },
  backLinkText: { fontSize: 15, fontWeight: '700', color: GinitTheme.colors.primary },
  searchSafe: { flex: 1, backgroundColor: '#fff' },
  searchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(15, 23, 42, 0.08)',
  },
  searchTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '800', color: '#0f172a' },
  searchHeaderSpacer: { width: 34 },
  searchFieldWrap: {
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
  searchFieldIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 16, color: '#0f172a', paddingVertical: 10 },
  searchListContent: { paddingHorizontal: 14, paddingBottom: 24, flexGrow: 1 },
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
  searchRow: { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(15, 23, 42, 0.06)' },
  searchRowPressed: { backgroundColor: 'rgba(15, 23, 42, 0.04)' },
  searchRowText: { fontSize: 14, lineHeight: 20, color: '#0f172a', fontWeight: '600' },
});
