import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { BlurView } from 'expo-blur';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { Timestamp } from 'firebase/firestore';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
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
import { KeyboardAwareFlatList } from 'react-native-keyboard-aware-scroll-view';
import { Swipeable } from 'react-native-gesture-handler';

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
import { normalizeParticipantId } from '@/src/lib/app-user-id';
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

export default function MeetingChatRoomScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ meetingId: string | string[] }>();
  const meetingId = Array.isArray(params.meetingId)
    ? (params.meetingId[0] ?? '').trim()
    : typeof params.meetingId === 'string'
      ? params.meetingId.trim()
      : '';
  const { userId } = useUserSession();

  const [meeting, setMeeting] = useState<Meeting | null | undefined>(undefined);
  const [meetingError, setMeetingError] = useState<string | null>(null);
  const [messages, setMessages] = useState<MeetingChatMessage[]>([]);
  const [chatError, setChatError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Map<string, UserProfile>>(new Map());
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [replyTo, setReplyTo] = useState<MeetingChatMessage['replyTo']>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const drawerAnim = useRef(new Animated.Value(0)).current;
  const plusAnim = useRef(new Animated.Value(0)).current;
  /** 키보드 본체 + IME 상단(이모지/툴바 등)까지 포함해 입력창을 올리기 위한 하단 여백 */
  const [keyboardBottomInset, setKeyboardBottomInset] = useState(0);
  const [userCoords, setUserCoords] = useState<LatLng | null>(null);
  /** Android 삼성 등: IME `defaultInputmode=emoji` — 토글 후 포커스 */
  const [androidEmojiIme, setAndroidEmojiIme] = useState(false);
  const listRef = useRef<any>(null);
  const messageInputRef = useRef<TextInput>(null);
  const messagesRef = useRef<MeetingChatMessage[]>([]);
  const lastMarkedReadRef = useRef<{ meetingId: string; messageId: string } | null>(null);
  const { markChatReadUpTo } = useInAppAlarms();

  const myId = useMemo(() => (userId?.trim() ? normalizeParticipantId(userId.trim()) : ''), [userId]);

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
    return isUserJoinedMeeting(meeting, userId);
  }, [meeting, userId]);

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
      requestAnimationFrame(scrollToBottom);
    };
    const clear = () => {
      setKeyboardBottomInset(0);
      requestAnimationFrame(scrollToBottom);
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
  }, []);

  const goMeetingDetail = useCallback(() => {
    if (!meetingId) return;
    router.push(`/meeting/${meetingId}`);
  }, [router, meetingId]);

  const onEmojiToolbarPress = useCallback(() => {
    if (Platform.OS === 'android') {
      setAndroidEmojiIme((v) => !v);
    }
  }, []);

  useEffect(() => {
    Animated.timing(drawerAnim, {
      toValue: drawerOpen ? 1 : 0,
      duration: drawerOpen ? 220 : 180,
      useNativeDriver: true,
    }).start();
  }, [drawerOpen, drawerAnim]);

  useEffect(() => {
    Animated.timing(plusAnim, {
      toValue: plusMenuOpen ? 1 : 0,
      duration: plusMenuOpen ? 180 : 140,
      useNativeDriver: true,
    }).start();
  }, [plusMenuOpen, plusAnim]);

  const onSend = useCallback(async () => {
    if (!meetingId || !userId?.trim()) {
      Alert.alert('안내', '로그인 후 메시지를 보낼 수 있어요.');
      return;
    }
    const body = draft.trim();
    if (!body || sending || uploadingImage) return;
    setSending(true);
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

  const openPlusMenu = useCallback(() => {
    if (uploadingImage || sending) return;
    setPlusMenuOpen(true);
  }, [uploadingImage, sending]);

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

  const renderItem = useCallback(
    ({ item, index }: { item: MeetingChatMessage; index: number }) => {
      const prev = index > 0 ? messages[index - 1] : null;
      const currDate = item.createdAt?.toDate?.() ?? null;
      const prevDate = prev?.createdAt?.toDate?.() ?? null;
      const dateLabel =
        currDate &&
        (!prevDate ||
          currDate.getFullYear() !== prevDate.getFullYear() ||
          currDate.getMonth() !== prevDate.getMonth() ||
          currDate.getDate() !== prevDate.getDate())
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

      const isImage = item.kind === 'image';
      const caption = item.text?.trim();

      if (isMine) {
        const bubble = (
          <View style={styles.rowMine}>
            <Text style={styles.timeMine}>{formatChatTime(item.createdAt)}</Text>
            <View style={[styles.bubbleMineWrap, isImage && styles.bubbleMineMedia]}>
              <BlurView tint="light" intensity={60} style={styles.bubbleMine}>
                {item.replyTo?.messageId ? (
                  <View style={styles.replyQuoteMine}>
                    <Text style={styles.replyQuoteLabelMine}>답장</Text>
                    <Text style={styles.replyQuoteTextMine} numberOfLines={2}>
                      {item.replyTo.text || '메시지'}
                    </Text>
                  </View>
                ) : null}
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
            <Swipeable
              renderLeftActions={() => <View style={{ width: 60 }} />}
              onSwipeableOpen={() => {
                setReplyTo({ messageId: item.id, senderId: item.senderId ?? null, text: item.text });
              }}>
              {bubble}
            </Swipeable>
          </View>
        );
      }

      const otherBubble = (
        <View style={styles.rowOther}>
          <View style={styles.avatarCol} pointerEvents={withdrawn ? 'none' : 'auto'}>
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
          </View>
          <View style={styles.otherBlock} pointerEvents="box-none">
            {showAvatar ? (
              <View style={styles.nameRow} pointerEvents={withdrawn ? 'none' : 'auto'}>
                <Text style={styles.nickname} numberOfLines={1}>
                  {nick}
                </Text>
                {isHost ? <Ionicons name="star" size={14} color="#CA8A04" style={styles.crown} /> : null}
              </View>
            ) : null}
            <View style={styles.bubbleOtherWrap}>
              <View style={[styles.bubbleOtherOuter, isImage && styles.bubbleOtherMedia]}>
                <BlurView tint="light" intensity={60} style={styles.bubbleOther}>
                  {item.replyTo?.messageId ? (
                    <View style={styles.replyQuoteOther}>
                      <Text style={styles.replyQuoteLabelOther}>답장</Text>
                      <Text style={styles.replyQuoteTextOther} numberOfLines={2}>
                        {item.replyTo.text || '메시지'}
                      </Text>
                    </View>
                  ) : null}
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
          <Swipeable
            renderLeftActions={() => <View style={{ width: 60 }} />}
            onSwipeableOpen={() => {
              setReplyTo({ messageId: item.id, senderId: item.senderId ?? null, text: item.text });
            }}>
            {otherBubble}
          </Swipeable>
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
              onPress={() => setDrawerOpen(true)}>
              <Ionicons name="menu-outline" size={24} color="#475569" />
            </Pressable>
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

        <View style={styles.listWrap}>
          {chatError ? (
            <View style={styles.chatErrorBanner}>
              <Text style={styles.chatErrorText}>{chatError}</Text>
            </View>
          ) : null}
          <KeyboardAwareFlatList
            ref={listRef}
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            onContentSizeChange={scrollToBottom}
            keyboardShouldPersistTaps="handled"
            enableOnAndroid
            extraScrollHeight={12}
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
          {replyTo?.messageId ? (
            <View style={styles.replyPreviewRow}>
              <BlurView tint="light" intensity={55} style={styles.replyPreviewCard}>
                <Text style={styles.replyPreviewTitle}>답장</Text>
                <Text style={styles.replyPreviewBody} numberOfLines={1}>
                  {replyTo.text || '메시지'}
                </Text>
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
          <View style={styles.composer}>
            <Pressable
              style={styles.plusBtn}
              onPress={openPlusMenu}
              disabled={uploadingImage}
              accessibilityRole="button"
              accessibilityLabel="퀵 액션 열기">
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

        {/* + 퀵 액션 */}
        {plusMenuOpen ? (
          <Pressable style={styles.overlayDim} onPress={() => setPlusMenuOpen(false)} accessibilityRole="button">
            <Animated.View
              style={[
                styles.plusSheet,
                {
                  opacity: plusAnim,
                  transform: [
                    {
                      translateY: plusAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [14, 0],
                      }),
                    },
                  ],
                },
              ]}>
              <BlurView tint="light" intensity={60} style={styles.plusSheetInner}>
                <Text style={styles.plusTitle}>퀵 액션</Text>
                <View style={styles.plusRow}>
                  <Pressable
                    onPress={() => {
                      setPlusMenuOpen(false);
                      void onPickImage();
                    }}
                    style={({ pressed }) => [styles.plusAction, pressed && styles.pressed]}
                    accessibilityRole="button">
                    <Ionicons name="image-outline" size={18} color="#0052CC" />
                    <Text style={styles.plusActionText}>사진</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      setPlusMenuOpen(false);
                      Alert.alert('AI 장소추천', '곧 채팅에서 바로 추천을 띄워드릴게요.');
                    }}
                    style={({ pressed }) => [styles.plusAction, pressed && styles.pressed]}
                    accessibilityRole="button">
                    <Ionicons name="sparkles-outline" size={18} color="#FF8A00" />
                    <Text style={styles.plusActionText}>AI 장소추천</Text>
                  </Pressable>
                </View>
                <View style={styles.plusRow}>
                  <Pressable
                    onPress={() => {
                      setPlusMenuOpen(false);
                      Alert.alert('투표 만들기', '곧 제공됩니다. (다음 단계: 채팅에서 투표 카드 생성)');
                    }}
                    style={({ pressed }) => [styles.plusAction, pressed && styles.pressed]}
                    accessibilityRole="button">
                    <Ionicons name="bar-chart-outline" size={18} color="#0052CC" />
                    <Text style={styles.plusActionText}>투표 만들기</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      setPlusMenuOpen(false);
                      setDraft((v) => (v.trim() ? v : '정산 요청합니다. 각자 확인 부탁드려요!'));
                    }}
                    style={({ pressed }) => [styles.plusAction, pressed && styles.pressed]}
                    accessibilityRole="button">
                    <Ionicons name="card-outline" size={18} color="#FF8A00" />
                    <Text style={styles.plusActionText}>정산 요청</Text>
                  </Pressable>
                </View>
              </BlurView>
            </Animated.View>
          </Pressable>
        ) : null}

        {/* 우측 드로어: 멤버 리스트 */}
        {drawerOpen ? (
          <Pressable style={styles.overlayDim} onPress={() => setDrawerOpen(false)} accessibilityRole="button">
            <Animated.View
              style={[
                styles.drawer,
                {
                  transform: [
                    {
                      translateX: drawerAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [320, 0],
                      }),
                    },
                  ],
                },
              ]}>
              <BlurView tint="light" intensity={60} style={styles.drawerInner}>
                <View style={styles.drawerHeader}>
                  <Text style={styles.drawerTitle}>참여 멤버</Text>
                  <Pressable onPress={() => setDrawerOpen(false)} hitSlop={10} accessibilityRole="button">
                    <Ionicons name="close" size={20} color="#475569" />
                  </Pressable>
                </View>
                <Text style={styles.drawerHint}>gTrust · gDna</Text>
                <View style={styles.drawerList}>
                  {[...(meeting?.participantIds ?? []), ...(meeting?.createdBy?.trim() ? [meeting.createdBy] : [])]
                    .filter((x, i, arr) => {
                      const n = normalizeParticipantId(String(x)) ?? String(x).trim();
                      return n && arr.findIndex((y) => (normalizeParticipantId(String(y)) ?? String(y).trim()) === n) === i;
                    })
                    .map((pid) => {
                      const n = normalizeParticipantId(String(pid)) ?? String(pid).trim();
                      const p = n ? profileForSender(profiles, n) : undefined;
                      const nick = isUserProfileWithdrawn(p) ? WITHDRAWN_NICKNAME : (p?.nickname ?? '회원');
                      const trust = typeof p?.gTrust === 'number' ? p.gTrust : null;
                      const dna = typeof p?.gDna === 'string' ? p.gDna : '';
                      const isHost = Boolean(hostNorm && n && n === hostNorm);
                      return (
                        <View key={String(pid)} style={styles.drawerRow}>
                          <View style={styles.drawerAvatar}>
                            {p?.photoUrl ? (
                              <Image source={{ uri: p.photoUrl }} style={styles.drawerAvatarImg} contentFit="cover" />
                            ) : (
                              <Text style={styles.drawerAvatarText}>{nick.slice(0, 1)}</Text>
                            )}
                          </View>
                          <View style={{ flex: 1 }}>
                            <View style={styles.drawerNameRow}>
                              <Text style={styles.drawerName} numberOfLines={1}>
                                {nick}
                              </Text>
                              {isHost ? <Ionicons name="star" size={14} color="#CA8A04" /> : null}
                            </View>
                            <Text style={styles.drawerMeta}>
                              {trust != null ? `gTrust ${trust}` : 'gTrust -'}{dna ? ` · ${dna}` : ''}
                            </Text>
                          </View>
                        </View>
                      );
                    })}
                </View>
              </BlurView>
            </Animated.View>
          </Pressable>
        ) : null}
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
  // meetingInfoOuter: 상단 모임 스냅샷(요약 카드) 섹션 제거됨
  listWrap: {
    flex: 1,
    position: 'relative',
    backgroundColor: '#ECEFF1',
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
    paddingLeft: 10,
    borderLeftWidth: 3,
    borderLeftColor: 'rgba(255,255,255,0.55)',
  },
  replyQuoteOther: {
    marginBottom: 8,
    paddingLeft: 10,
    borderLeftWidth: 3,
    borderLeftColor: 'rgba(0, 82, 204, 0.35)',
  },
  replyQuoteLabelMine: { fontSize: 11, fontWeight: '900', color: 'rgba(255,255,255,0.92)' },
  replyQuoteLabelOther: { fontSize: 11, fontWeight: '900', color: '#0052CC' },
  replyQuoteTextMine: { marginTop: 2, fontSize: 12, color: 'rgba(255,255,255,0.92)' },
  replyQuoteTextOther: { marginTop: 2, fontSize: 12, color: '#475569' },
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
  replyPreviewTitle: { fontSize: 12, fontWeight: '900', color: '#0052CC' },
  replyPreviewBody: { flex: 1, fontSize: 12, fontWeight: '800', color: '#0f172a' },
  overlayDim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.25)',
  },
  plusSheet: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 92,
    borderRadius: 16,
    overflow: 'hidden',
  },
  plusSheetInner: {
    padding: 12,
    backgroundColor: 'rgba(255,255,255,0.62)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  plusTitle: { fontSize: 13, fontWeight: '900', color: '#0f172a', marginBottom: 10 },
  plusRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  plusAction: {
    flex: 1,
    minHeight: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    backgroundColor: 'rgba(15, 23, 42, 0.06)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  plusActionText: { fontSize: 13, fontWeight: '900', color: '#0f172a' },
  drawer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: 300,
    borderTopLeftRadius: 18,
    borderBottomLeftRadius: 18,
    overflow: 'hidden',
  },
  drawerInner: {
    flex: 1,
    paddingTop: 14,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.62)',
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(255,255,255,0.22)',
  },
  drawerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  drawerTitle: { fontSize: 15, fontWeight: '900', color: '#0f172a' },
  drawerHint: { fontSize: 12, color: '#64748b', marginBottom: 10, fontWeight: '800' },
  drawerList: { gap: 10 },
  drawerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(15, 23, 42, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  drawerAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(0, 82, 204, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawerAvatarImg: { width: 38, height: 38 },
  drawerAvatarText: { fontSize: 14, fontWeight: '900', color: '#0052CC' },
  drawerNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  drawerName: { fontSize: 13, fontWeight: '900', color: '#0f172a', flexShrink: 1 },
  drawerMeta: { marginTop: 2, fontSize: 12, color: '#475569', fontWeight: '800' },
  pressed: {
    opacity: 0.85,
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
