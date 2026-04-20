import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { Timestamp } from 'firebase/firestore';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Keyboard,
  type KeyboardEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { MeetingFeedRow } from '@/components/feed/MeetingFeedRow';
import { GinitTheme } from '@/constants/ginit-theme';
import { useInAppAlarms } from '@/src/context/InAppAlarmsContext';
import { useUserSession } from '@/src/context/UserSessionContext';
import { resolveFeedLocationContext } from '@/src/lib/feed-display-location';
import { loadFeedLocationCache } from '@/src/lib/feed-location-cache';
import type { LatLng } from '@/src/lib/geo-distance';
import { isUserJoinedMeeting } from '@/src/lib/joined-meetings';
import type { MeetingChatMessage } from '@/src/lib/meeting-chat';
import {
  sendMeetingChatImageMessage,
  sendMeetingChatTextMessage,
  subscribeMeetingChatMessages,
} from '@/src/lib/meeting-chat';
import type { Meeting } from '@/src/lib/meetings';
import { meetingParticipantCount, subscribeMeetingById } from '@/src/lib/meetings';
import { normalizePhoneUserId } from '@/src/lib/phone-user-id';
import type { UserProfile } from '@/src/lib/user-profile';
import { getUserProfilesForIds } from '@/src/lib/user-profile';

function profileForSender(map: Map<string, UserProfile>, senderId: string): UserProfile | undefined {
  const n = normalizePhoneUserId(senderId) ?? senderId.trim();
  const hit = map.get(senderId) ?? map.get(n);
  if (hit) return hit;
  for (const [k, v] of map) {
    if ((normalizePhoneUserId(k) ?? k.trim()) === n) return v;
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

export default function MeetingChatRoomScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ meetingId: string | string[] }>();
  const meetingId = Array.isArray(params.meetingId)
    ? (params.meetingId[0] ?? '').trim()
    : typeof params.meetingId === 'string'
      ? params.meetingId.trim()
      : '';
  const { phoneUserId } = useUserSession();

  const [meeting, setMeeting] = useState<Meeting | null | undefined>(undefined);
  const [meetingError, setMeetingError] = useState<string | null>(null);
  const [messages, setMessages] = useState<MeetingChatMessage[]>([]);
  const [chatError, setChatError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Map<string, UserProfile>>(new Map());
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  /** 키보드 본체 + IME 상단(이모지/툴바 등)까지 포함해 입력창을 올리기 위한 하단 여백 */
  const [keyboardBottomInset, setKeyboardBottomInset] = useState(0);
  const [userCoords, setUserCoords] = useState<LatLng | null>(null);
  /** Android 삼성 등: IME `defaultInputmode=emoji` — 토글 후 포커스 */
  const [androidEmojiIme, setAndroidEmojiIme] = useState(false);
  const listRef = useRef<FlatList<MeetingChatMessage>>(null);
  const messageInputRef = useRef<TextInput>(null);
  const messagesRef = useRef<MeetingChatMessage[]>([]);
  const lastMarkedReadRef = useRef<{ meetingId: string; messageId: string } | null>(null);
  const { markChatReadUpTo } = useInAppAlarms();

  const myId = useMemo(() => (phoneUserId?.trim() ? normalizePhoneUserId(phoneUserId) ?? phoneUserId.trim() : ''), [
    phoneUserId,
  ]);

  messagesRef.current = messages;

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
    return isUserJoinedMeeting(meeting, phoneUserId);
  }, [meeting, phoneUserId]);

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
        const last = list[list.length - 1];
        if (!last?.id) return;
        markChatReadUpTo(meetingId, last.id);
      };
    }, [allowed, meetingId, markChatReadUpTo]),
  );

  useEffect(() => {
    if (allowed !== true || !meetingId) return;
    const last = messages[messages.length - 1];
    if (!last?.id) return;
    const prev = lastMarkedReadRef.current;
    if (prev && prev.meetingId === meetingId && prev.messageId === last.id) return;
    lastMarkedReadRef.current = { meetingId, messageId: last.id };
    markChatReadUpTo(meetingId, last.id);
  }, [allowed, meetingId, messages, markChatReadUpTo]);

  useEffect(() => {
    if (!meetingId || allowed !== true) return;
    const unsub = subscribeMeetingChatMessages(
      meetingId,
      (list) => {
        setMessages(list);
        setChatError(null);
      },
      (msg) => setChatError(msg),
    );
    return unsub;
  }, [meetingId, allowed]);

  useEffect(() => {
    if (!meeting || allowed !== true) return;
    const ids = [...(meeting.participantIds ?? [])];
    if (meeting.createdBy?.trim()) ids.push(meeting.createdBy);
    void getUserProfilesForIds(ids).then(setProfiles);
  }, [meeting, allowed]);

  const scrollToBottom = useCallback(() => {
    if (messages.length === 0) return;
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated: true });
    });
  }, [messages.length]);

  useEffect(() => {
    scrollToBottom();
  }, [messages.length, scrollToBottom]);

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
    };
    const clear = () => setKeyboardBottomInset(0);

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
  }, []);

  const goMeetingDetail = useCallback(() => {
    if (!meetingId) return;
    router.push(`/meeting/${meetingId}`);
  }, [router, meetingId]);

  const onEmojiToolbarPress = useCallback(() => {
    if (Platform.OS === 'android') {
      setAndroidEmojiIme((v) => !v);
    }
    requestAnimationFrame(() => {
      messageInputRef.current?.focus();
    });
  }, []);

  const onSend = useCallback(async () => {
    if (!meetingId || !phoneUserId?.trim()) {
      Alert.alert('안내', '로그인 후 메시지를 보낼 수 있어요.');
      return;
    }
    const body = draft.trim();
    if (!body || sending || uploadingImage) return;
    setSending(true);
    try {
      await sendMeetingChatTextMessage(meetingId, phoneUserId, body);
      setDraft('');
    } catch (e) {
      Alert.alert('전송 실패', e instanceof Error ? e.message : '다시 시도해 주세요.');
    } finally {
      setSending(false);
    }
  }, [meetingId, phoneUserId, draft, sending, uploadingImage]);

  const onPickImage = useCallback(async () => {
    if (!meetingId || !phoneUserId?.trim()) {
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
      await sendMeetingChatImageMessage(meetingId, phoneUserId, asset.uri, {
        caption: caption || undefined,
        naturalWidth: typeof asset.width === 'number' && asset.width > 0 ? asset.width : undefined,
      });
      if (caption) setDraft('');
    } catch (e) {
      Alert.alert('전송 실패', e instanceof Error ? e.message : '다시 시도해 주세요.');
    } finally {
      setUploadingImage(false);
    }
  }, [meetingId, phoneUserId, draft, uploadingImage]);

  const hostNorm = meeting?.createdBy?.trim()
    ? normalizePhoneUserId(meeting.createdBy) ?? meeting.createdBy.trim()
    : '';

  const renderItem = useCallback(
    ({ item, index }: { item: MeetingChatMessage; index: number }) => {
      if (item.kind === 'system') {
        return (
          <View style={styles.systemRow}>
            <Text style={styles.systemText}>{item.text}</Text>
          </View>
        );
      }
      const sid = item.senderId?.trim() ? normalizePhoneUserId(item.senderId) ?? item.senderId.trim() : '';
      const isMine = Boolean(myId && sid && sid === myId);
      const prev = index > 0 ? messages[index - 1] : null;
      const prevSid =
        prev && prev.kind !== 'system'
          ? normalizePhoneUserId(prev.senderId ?? '') ?? prev.senderId?.trim() ?? ''
          : '';
      const sameSenderAsPrev = Boolean(sid && prevSid && prevSid === sid);
      const showAvatar = !isMine && sid && (index === 0 || !prev || prev.kind === 'system' || !sameSenderAsPrev);

      const prof = sid ? profileForSender(profiles, sid) : undefined;
      const nick = prof?.nickname ?? '회원';
      const isHost = Boolean(hostNorm && sid && sid === hostNorm);

      const isImage = item.kind === 'image';
      const caption = item.text?.trim();

      if (isMine) {
        return (
          <View style={styles.rowMine}>
            <Text style={styles.timeMine}>{formatChatTime(item.createdAt)}</Text>
            <View style={[styles.bubbleMine, isImage && styles.bubbleMineMedia]}>
              {isImage ? (
                item.imageUrl ? (
                  <Image source={{ uri: item.imageUrl }} style={styles.chatImage} contentFit="cover" />
                ) : (
                  <Text style={styles.bubbleMineText}>이미지를 불러올 수 없어요.</Text>
                )
              ) : (
                <Text style={styles.bubbleMineText}>{item.text}</Text>
              )}
              {isImage && caption ? <Text style={styles.imageCaptionMine}>{caption}</Text> : null}
            </View>
          </View>
        );
      }

      return (
        <View style={styles.rowOther}>
          <View style={styles.avatarCol}>
            {showAvatar ? (
              prof?.photoUrl ? (
                <Image source={{ uri: prof.photoUrl }} style={styles.avatar} contentFit="cover" />
              ) : (
                <View style={styles.avatarFallback}>
                  <Text style={styles.avatarFallbackText}>{nick.slice(0, 1)}</Text>
                </View>
              )
            ) : (
              <View style={styles.avatarSpacer} />
            )}
          </View>
          <View style={styles.otherBlock}>
            {showAvatar ? (
              <View style={styles.nameRow}>
                <Text style={styles.nickname} numberOfLines={1}>
                  {nick}
                </Text>
                {isHost ? <Ionicons name="star" size={14} color="#CA8A04" style={styles.crown} /> : null}
              </View>
            ) : null}
            <View style={styles.bubbleOtherWrap}>
              <View style={[styles.bubbleOther, isImage && styles.bubbleOtherMedia]}>
                {isImage ? (
                  item.imageUrl ? (
                    <Image source={{ uri: item.imageUrl }} style={styles.chatImage} contentFit="cover" />
                  ) : (
                    <Text style={styles.bubbleOtherText}>이미지를 불러올 수 없어요.</Text>
                  )
                ) : (
                  <Text style={styles.bubbleOtherText}>{item.text}</Text>
                )}
                {isImage && caption ? <Text style={styles.imageCaptionOther}>{caption}</Text> : null}
              </View>
              <Text style={styles.timeOther}>{formatChatTime(item.createdAt)}</Text>
            </View>
          </View>
        </View>
      );
    },
    [myId, messages, profiles, hostNorm],
  );

  if (!meetingId) {
    return (
      <SafeAreaView style={styles.centerFill} edges={['top']}>
        <Text style={styles.muted}>잘못된 주소예요.</Text>
        <Pressable onPress={() => router.back()} style={styles.backLink}>
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
        <Pressable onPress={() => router.back()} style={styles.backLink}>
          <Text style={styles.backLinkText}>돌아가기</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  if (allowed === false) {
    return (
      <SafeAreaView style={styles.centerFill} edges={['top']}>
        <Text style={styles.errorText}>참여 중인 모임의 채팅방만 들어갈 수 있어요.</Text>
        <Pressable onPress={() => router.back()} style={styles.backLink}>
          <Text style={styles.backLinkText}>돌아가기</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const title = meeting.title?.trim() || '모임 채팅';
  const pCount = meetingParticipantCount(meeting);

  const composerBottomPad = keyboardBottomInset > 0 ? keyboardBottomInset : Math.max(insets.bottom, 8);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.flexColumn}>
        <View style={styles.topBar}>
          <Pressable
            onPress={() => router.back()}
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
            <Pressable
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="검색"
              onPress={() => Alert.alert('안내', '채팅 검색은 곧 제공됩니다.')}>
              <Ionicons name="search-outline" size={22} color="#475569" />
            </Pressable>
            <Pressable
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="메뉴"
              onPress={() => Alert.alert('안내', '채팅 메뉴는 곧 제공됩니다.')}>
              <Ionicons name="menu-outline" size={24} color="#475569" />
            </Pressable>
          </View>
        </View>

        <View style={styles.meetingInfoOuter}>
          <MeetingFeedRow meeting={meeting} userCoords={userCoords} onPress={goMeetingDetail} />
        </View>

        <View style={styles.listWrap}>
          {chatError ? (
            <View style={styles.chatErrorBanner}>
              <Text style={styles.chatErrorText}>{chatError}</Text>
            </View>
          ) : null}
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            onContentSizeChange={scrollToBottom}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <Text style={styles.emptyChat}>첫 메시지를 남겨 보세요.</Text>
            }
          />
          <Pressable
            style={[styles.jumpFab, { bottom: 12 + composerBottomPad }]}
            onPress={scrollToBottom}
            accessibilityRole="button"
            accessibilityLabel="최신 메시지로">
            <Ionicons name="chevron-down" size={22} color="#334155" />
          </Pressable>
        </View>

        <View style={[styles.composerDock, { paddingBottom: composerBottomPad }]}>
          <View style={styles.composer}>
            <Pressable
              style={styles.plusBtn}
              onPress={() => void onPickImage()}
              disabled={uploadingImage}
              accessibilityRole="button"
              accessibilityLabel="사진 보내기">
              {uploadingImage ? (
                <ActivityIndicator size="small" color="#475569" />
              ) : (
                <Ionicons name="add" size={28} color="#475569" />
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
                editable={!sending && !uploadingImage}
                {...(Platform.OS === 'android'
                  ? ({
                      privateImeOptions: androidEmojiIme ? 'defaultInputmode=emoji' : undefined,
                    } as Record<string, unknown>)
                  : {})}
              />
              <Pressable
                style={styles.emojiBtn}
                onPress={onEmojiToolbarPress}
                accessibilityRole="button"
                accessibilityLabel={
                  Platform.OS === 'android' && androidEmojiIme
                    ? '글자 키보드로 전환'
                    : '이모지 키보드'
                }
                accessibilityHint={
                  Platform.OS === 'android'
                    ? androidEmojiIme
                      ? '한글·영문 입력으로 돌아갑니다.'
                      : '삼성 키보드 이모지 입력으로 전환합니다.'
                    : undefined
                }>
                <Ionicons
                  name={Platform.OS === 'android' && androidEmojiIme ? 'keypad-outline' : 'happy-outline'}
                  size={22}
                  color={Platform.OS === 'android' && androidEmojiIme ? GinitTheme.colors.primary : '#64748b'}
                />
              </Pressable>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#ECEFF1' },
  flexColumn: { flex: 1, flexDirection: 'column' },
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
    gap: 10,
    flexShrink: 0,
  },
  participantCount: {
    fontSize: 14,
    fontWeight: '700',
    color: '#94a3b8',
    minWidth: 22,
    textAlign: 'right',
  },
  meetingInfoOuter: {
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 4,
    backgroundColor: '#ECEFF1',
  },
  listWrap: {
    flex: 1,
    position: 'relative',
    backgroundColor: '#ECEFF1',
  },
  chatErrorBanner: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(220, 38, 38, 0.12)',
  },
  chatErrorText: { fontSize: 12, color: '#991b1b' },
  listContent: {
    paddingHorizontal: 12,
    paddingTop: 8,
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
  bubbleMine: {
    maxWidth: '76%',
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 16,
    borderTopRightRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0, 82, 204, 0.2)',
  },
  bubbleMineMedia: {
    paddingHorizontal: 6,
    paddingVertical: 6,
  },
  bubbleMineText: {
    fontSize: 15,
    color: '#0f172a',
    lineHeight: 20,
  },
  chatImage: {
    width: 220,
    height: 220,
    borderRadius: 12,
    backgroundColor: '#e2e8f0',
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
  bubbleOther: {
    maxWidth: '78%',
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 16,
    borderTopLeftRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.08)',
  },
  bubbleOtherMedia: {
    paddingHorizontal: 6,
    paddingVertical: 6,
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
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 8,
  },
  plusBtn: {
    paddingBottom: 10,
    paddingHorizontal: 2,
  },
  inputShell: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f1f5f9',
    borderRadius: 20,
    paddingLeft: 14,
    paddingRight: 6,
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
  emojiBtn: {
    padding: 6,
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
