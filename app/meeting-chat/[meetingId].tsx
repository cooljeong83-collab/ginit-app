import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
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

import { GinitTheme } from '@/constants/ginit-theme';
import { useUserSession } from '@/src/context/UserSessionContext';
import { isUserJoinedMeeting } from '@/src/lib/joined-meetings';
import type { MeetingChatMessage } from '@/src/lib/meeting-chat';
import { sendMeetingChatTextMessage, subscribeMeetingChatMessages } from '@/src/lib/meeting-chat';
import type { Meeting } from '@/src/lib/meetings';
import { getMeetingRecruitmentPhase, subscribeMeetingById } from '@/src/lib/meetings';
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

function participantCount(m: Meeting): number {
  const ids = m.participantIds ?? [];
  const set = new Set(ids.map((x) => normalizePhoneUserId(String(x)) ?? String(x).trim()).filter(Boolean));
  const host = m.createdBy?.trim() ? normalizePhoneUserId(m.createdBy) ?? m.createdBy.trim() : '';
  if (host) set.add(host);
  return Math.max(set.size, ids.length > 0 ? ids.length : host ? 1 : 0);
}

function scheduleSummary(m: Meeting): string {
  if (m.scheduleDate?.trim() && m.scheduleTime?.trim()) {
    return `${m.scheduleDate} ${m.scheduleTime}`;
  }
  if (m.scheduleDate?.trim()) return m.scheduleDate;
  return '일정 미정';
}

function voteSummary(m: Meeting): string {
  const phase = getMeetingRecruitmentPhase(m);
  if (m.scheduleConfirmed) return '일정 확정됨';
  if (phase === 'full') return '모집 완료';
  return '투표·조율 중';
}

function placeOneLine(m: Meeting): string {
  const p = m.placeName?.trim() || m.location?.trim() || m.address?.trim();
  return p || '장소 미정';
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
  const [meetingInfoExpanded, setMeetingInfoExpanded] = useState(false);
  /** 키보드 본체 + IME 상단(이모지/툴바 등)까지 포함해 입력창을 올리기 위한 하단 여백 */
  const [keyboardBottomInset, setKeyboardBottomInset] = useState(0);
  const listRef = useRef<FlatList<MeetingChatMessage>>(null);

  const myId = useMemo(() => (phoneUserId?.trim() ? normalizePhoneUserId(phoneUserId) ?? phoneUserId.trim() : ''), [
    phoneUserId,
  ]);

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

  const meetingInfoSummaryLine = useMemo(() => {
    if (!meeting) return '';
    const cat = meeting.categoryLabel?.trim();
    const sched = scheduleSummary(meeting);
    const place = placeOneLine(meeting);
    const status = `${voteSummary(meeting)} · 참가 ${participantCount(meeting)}명`;
    return [cat, sched, place, status].filter(Boolean).join(' · ');
  }, [meeting]);

  const onSend = useCallback(async () => {
    if (!meetingId || !phoneUserId?.trim()) {
      Alert.alert('안내', '로그인 후 메시지를 보낼 수 있어요.');
      return;
    }
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await sendMeetingChatTextMessage(meetingId, phoneUserId, body);
      setDraft('');
    } catch (e) {
      Alert.alert('전송 실패', e instanceof Error ? e.message : '다시 시도해 주세요.');
    } finally {
      setSending(false);
    }
  }, [meetingId, phoneUserId, draft, sending]);

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
      const showAvatar =
        !isMine &&
        sid &&
        (index === 0 ||
          !prev ||
          prev.kind === 'system' ||
          (prev.kind === 'text' &&
            (normalizePhoneUserId(prev.senderId ?? '') ?? prev.senderId) !== sid));

      const prof = sid ? profileForSender(profiles, sid) : undefined;
      const nick = prof?.nickname ?? '회원';
      const isHost = Boolean(hostNorm && sid && sid === hostNorm);

      if (isMine) {
        return (
          <View style={styles.rowMine}>
            <Text style={styles.timeMine}>{formatChatTime(item.createdAt)}</Text>
            <View style={styles.bubbleMine}>
              <Text style={styles.bubbleMineText}>{item.text}</Text>
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
              <View style={styles.bubbleOther}>
                <Text style={styles.bubbleOtherText}>{item.text}</Text>
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
        <ActivityIndicator color={GinitTheme.trustBlue} />
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
  const pCount = participantCount(meeting);

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
            <Ionicons name="chevron-back" size={28} color="#0f172a" />
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
          <View style={[styles.meetingInfoCard, !meetingInfoExpanded && styles.meetingInfoCardCollapsed]}>
            <View style={styles.meetingInfoCardHeader}>
              <Text style={styles.meetingInfoTitle}>모임 정보</Text>
              <Pressable
                onPress={goMeetingDetail}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="모임 상세로 이동">
                <Ionicons name="chevron-forward" size={20} color="#94a3b8" />
              </Pressable>
            </View>

            {!meetingInfoExpanded ? (
              <>
                <Pressable
                  onPress={goMeetingDetail}
                  style={({ pressed }) => [
                    styles.meetingInfoCollapsedTap,
                    pressed && styles.meetingInfoCollapsedTapPressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="모임 요약. 탭하면 모임 상세로 이동">
                  <Text style={styles.meetingInfoDesc} numberOfLines={1} ellipsizeMode="tail">
                    {meetingInfoSummaryLine}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setMeetingInfoExpanded(true)}
                  style={styles.meetingInfoSheetHandleHit}
                  accessibilityRole="button"
                  accessibilityLabel="모임 정보 펼치기"
                  accessibilityHint="지도 목록과 같이 탭하면 전체 정보를 볼 수 있어요">
                  <View style={styles.meetingInfoSheetHandle} />
                </Pressable>
              </>
            ) : (
              <>
                <Pressable
                  onPress={goMeetingDetail}
                  style={({ pressed }) => [
                    styles.meetingInfoExpandedTap,
                    pressed && styles.meetingInfoExpandedTapPressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="모임 정보. 탭하면 모임 상세로 이동">
                  {meeting.description?.trim() ? (
                    <Text style={styles.meetingInfoDesc}>{meeting.description.trim()}</Text>
                  ) : (
                    <Text style={styles.meetingInfoDescMuted}>등록된 소개가 없어요.</Text>
                  )}
                  <View style={styles.meetingInfoDivider} />
                  <View style={styles.meetingInfoLine}>
                    <Text style={styles.meetingInfoMetaLabel}>카테고리</Text>
                    <Text style={styles.meetingInfoMetaValue} numberOfLines={1}>
                      {meeting.categoryLabel?.trim() || '—'}
                    </Text>
                  </View>
                  <View style={styles.meetingInfoLine}>
                    <Text style={styles.meetingInfoMetaLabel}>일정</Text>
                    <Text style={styles.meetingInfoMetaValue} numberOfLines={2}>
                      {scheduleSummary(meeting)}
                    </Text>
                  </View>
                  <View style={styles.meetingInfoLine}>
                    <Text style={styles.meetingInfoMetaLabel}>장소</Text>
                    <Text style={styles.meetingInfoMetaValue} numberOfLines={2}>
                      {placeOneLine(meeting)}
                    </Text>
                  </View>
                  <View style={styles.meetingInfoLine}>
                    <Text style={styles.meetingInfoMetaLabel}>상태</Text>
                    <Text style={styles.meetingInfoMetaValue} numberOfLines={1}>
                      {voteSummary(meeting)} · 참가 {pCount}명
                    </Text>
                  </View>
                </Pressable>
                <Pressable
                  onPress={() => setMeetingInfoExpanded(false)}
                  style={styles.meetingInfoSheetHandleHit}
                  accessibilityRole="button"
                  accessibilityLabel="모임 정보 접기"
                  accessibilityHint="지도 목록과 같이 탭하면 요약만 표시돼요">
                  <View style={styles.meetingInfoSheetHandle} />
                </Pressable>
              </>
            )}
          </View>
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
              onPress={() => Alert.alert('안내', '사진·파일 첨부는 곧 제공됩니다.')}
              accessibilityRole="button"
              accessibilityLabel="첨부">
              <Ionicons name="add" size={28} color="#475569" />
            </Pressable>
            <View style={styles.inputShell}>
              <TextInput
                style={styles.input}
                placeholder="메시지 보내기"
                placeholderTextColor="#94a3b8"
                value={draft}
                onChangeText={setDraft}
                multiline
                maxLength={4000}
                editable={!sending}
              />
              <Pressable
                style={styles.emojiBtn}
                onPress={() => Alert.alert('안내', '이모지 피커는 곧 연결됩니다.')}
                accessibilityRole="button"
                accessibilityLabel="이모지">
                <Ionicons name="happy-outline" size={22} color="#64748b" />
              </Pressable>
            </View>
            <Pressable
              onPress={() => void onSend()}
              style={[styles.sendBtn, sending && styles.sendBtnDisabled]}
              disabled={sending || !draft.trim()}
              accessibilityRole="button"
              accessibilityLabel="보내기">
              {sending ? (
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
  backLinkText: { fontSize: 15, fontWeight: '700', color: GinitTheme.trustBlue },
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
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#ECEFF1',
  },
  meetingInfoCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.1)',
    gap: 8,
  },
  meetingInfoCardCollapsed: {
    paddingVertical: 8,
    gap: 4,
  },
  meetingInfoCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  meetingInfoTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
  },
  meetingInfoCollapsedTap: {
    paddingVertical: 2,
  },
  meetingInfoCollapsedTapPressed: {
    opacity: 0.85,
  },
  meetingInfoExpandedTap: {
    gap: 8,
  },
  meetingInfoExpandedTapPressed: {
    opacity: 0.92,
  },
  /** `MapScreen` `sheetHandleHit` / `sheetHandle` 과 동일 계열 — 하단 목록 확장 핸들 */
  meetingInfoSheetHandleHit: {
    alignSelf: 'stretch',
    paddingTop: 4,
    paddingBottom: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  meetingInfoSheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(15, 23, 42, 0.15)',
  },
  meetingInfoDesc: {
    fontSize: 14,
    lineHeight: 20,
    color: '#334155',
  },
  meetingInfoDescMuted: {
    fontSize: 13,
    lineHeight: 18,
    color: '#94a3b8',
  },
  meetingInfoDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(15, 23, 42, 0.08)',
    marginVertical: 2,
  },
  meetingInfoLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  meetingInfoMetaLabel: {
    width: 56,
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
    paddingTop: 1,
  },
  meetingInfoMetaValue: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#0f172a',
    lineHeight: 18,
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
  bubbleMineText: {
    fontSize: 15,
    color: '#0f172a',
    lineHeight: 20,
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
    color: GinitTheme.trustBlue,
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
  bubbleOtherText: {
    fontSize: 15,
    color: '#0f172a',
    lineHeight: 20,
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
    backgroundColor: GinitTheme.trustBlue,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  sendBtnDisabled: {
    opacity: 0.5,
  },
});
