import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
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
          <View style={{ width: 28 }} />
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
        />
      )}
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
  errBanner: { padding: 10, backgroundColor: 'rgba(220, 38, 38, 0.08)' },
  errText: { color: '#b91c1c', textAlign: 'center', fontWeight: '600' },
  loading: { padding: 24, alignItems: 'center' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  muted: { fontSize: 15, color: '#64748b' },
  backLink: { marginTop: 12, padding: 10 },
  backLinkText: { fontSize: 15, fontWeight: '700', color: GinitTheme.colors.primary },
});
