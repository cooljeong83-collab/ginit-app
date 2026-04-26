import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SocialChat } from '@/components/social/SocialChat';
import { GinitTheme } from '@/constants/ginit-theme';
import { useUserSession } from '@/src/context/UserSessionContext';
import type { SocialChatMessage } from '@/src/lib/social-chat-rooms';
import {
  ensureSocialChatRoomDoc,
  parsePeerFromSocialRoomId,
  sendSocialChatTextMessage,
  subscribeSocialChatMessages,
} from '@/src/lib/social-chat-rooms';

export default function SocialChatRoomScreen() {
  const router = useRouter();
  const { userId } = useUserSession();
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
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [ready, setReady] = useState(false);
  const listRef = useRef<FlatList<SocialChatMessage>>(null);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SocialChatMessage[]>([]);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<TextInput>(null);

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

  const onSend = useCallback(async () => {
    const uid = userId?.trim();
    if (!uid || !roomId || !draft.trim()) return;
    setSending(true);
    try {
      await sendSocialChatTextMessage(roomId, uid, draft);
      setDraft('');
    } catch (e) {
      Alert.alert('전송 실패', e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }, [userId, roomId, draft]);

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
    setSearchOpen(true);
    setSearchQuery('');
    setSearchResults([]);
  }, []);

  const runSearch = useCallback(
    (q: string) => {
      const needle = q.trim().toLowerCase();
      if (!needle) {
        setSearchResults([]);
        return;
      }
      const hits = messages.filter((m) => (m.text ?? '').toLowerCase().includes(needle));
      setSearchResults(hits);
    },
    [messages],
  );

  useEffect(() => {
    if (!searchOpen) return;
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => runSearch(searchQuery), 220);
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
      const idx = messages.findIndex((m) => m.id === msg.id);
      // 모달 닫힘/레이아웃 안정화 이후에 점프 (즉시 호출하면 ref/레이아웃 타이밍으로 실패하는 케이스가 있음)
      setTimeout(() => {
        if (idx < 0) return;
        try {
          listRef.current?.scrollToIndex({ index: idx, viewPosition: 0.35, animated: true });
        } catch {
          requestAnimationFrame(() => {
            listRef.current?.scrollToIndex?.({ index: idx, viewPosition: 0.35, animated: true });
          });
        }
      }, 60);
    },
    [messages, closeSearch],
  );

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
        <Pressable onPress={() => router.back()} style={s.backLink}>
          <Text style={s.backLinkText}>돌아가기</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <View style={s.root}>
      <SafeAreaView edges={['top']} style={s.topSafe}>
        <View style={s.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="뒤로">
            <Ionicons name="chevron-back" size={28} color={GinitTheme.colors.text} />
          </Pressable>
          <Text style={s.topTitle} numberOfLines={1}>
            {peerName}
          </Text>
          <Pressable
            onPress={openSearch}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="대화 검색"
            style={s.searchBtn}
          >
            <Ionicons name="search-outline" size={22} color="#0f172a" />
          </Pressable>
        </View>
      </SafeAreaView>

      {chatError ? (
        <View style={s.errBanner}>
          <Text style={s.errText}>{chatError}</Text>
        </View>
      ) : null}

      {!ready ? (
        <View style={s.loading}>
          <ActivityIndicator color={GinitTheme.colors.primary} />
        </View>
      ) : (
        <SocialChat
          title={peerName}
          noticeLine="약속·공통 취향은 여기에 고정해 두세요"
          messages={messages}
          myUserId={userId.trim()}
          draft={draft}
          onChangeDraft={setDraft}
          onSend={onSend}
          sending={sending}
          onPressNotice={() => Alert.alert('공지', '친구와의 약속이나 공통 태그를 이 영역에 표시할 수 있어요.')}
          listRef={listRef}
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
        </SafeAreaView>
      </Modal>
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
  topTitle: { flex: 1, fontSize: 16, fontWeight: '800', color: '#0f172a', textAlign: 'center' },
  searchBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  errBanner: { padding: 10, backgroundColor: 'rgba(220, 38, 38, 0.08)' },
  errText: { color: '#b91c1c', textAlign: 'center', fontWeight: '600' },
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
