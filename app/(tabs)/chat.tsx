import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Image } from 'expo-image';

import { ChatMeetingListRow } from '@/components/chat/ChatMeetingListRow';
import { InAppAlarmsBellButton } from '@/components/in-app-alarms/InAppAlarmsBellButton';
import { ScreenShell } from '@/components/ui';
import { GinitTheme } from '@/constants/ginit-theme';
import { filterJoinedMeetings } from '@/src/lib/joined-meetings';
import type { MeetingChatMessage } from '@/src/lib/meeting-chat';
import { subscribeMeetingChatLatestMessage } from '@/src/lib/meeting-chat';
import type { Meeting } from '@/src/lib/meetings';
import { getMeetingRecruitmentPhase } from '@/src/lib/meetings';
import { sweepStalePublicUnconfirmedMeetingsForHost } from '@/src/lib/meeting-expiry-sweep';
import { fetchMeetingsOnceHybrid, subscribeMeetingsHybrid } from '@/src/lib/meetings-hybrid';
import { normalizePhoneUserId } from '@/src/lib/phone-user-id';
import { socialDmRoomId, subscribeMySocialChatRooms, type SocialChatRoomSummary } from '@/src/lib/social-chat-rooms';
import type { UserProfile } from '@/src/lib/user-profile';
import { getUserProfilesForIds, isUserProfileWithdrawn } from '@/src/lib/user-profile';
import { useUserSession } from '@/src/context/UserSessionContext';

function profileForCreatedBy(
  map: Map<string, UserProfile>,
  createdBy: string | null | undefined,
): UserProfile | undefined {
  if (!createdBy?.trim()) return undefined;
  const n = normalizePhoneUserId(createdBy) ?? createdBy.trim();
  const hit = map.get(createdBy) ?? map.get(n);
  if (hit) return hit;
  for (const [k, v] of map) {
    if ((normalizePhoneUserId(k) ?? k.trim()) === n) return v;
  }
  return undefined;
}

type ChatKind = 'gather' | 'social';

export default function ChatTab() {
  const router = useRouter();
  const { userId } = useUserSession();
  const [chatKind, setChatKind] = useState<ChatKind>('gather');
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [latestByMeetingId, setLatestByMeetingId] = useState<
    Record<string, MeetingChatMessage | null | undefined>
  >({});
  const [hostProfiles, setHostProfiles] = useState<Map<string, UserProfile>>(new Map());
  const [socialRooms, setSocialRooms] = useState<SocialChatRoomSummary[]>([]);
  const [socialProfiles, setSocialProfiles] = useState<Map<string, UserProfile>>(new Map());
  const [socialRoomsError, setSocialRoomsError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    const unsub = subscribeMeetingsHybrid(
      (list) => {
        setMeetings(list);
        setListError(null);
        setLoading(false);
      },
      (msg) => {
        setListError(msg);
        setLoading(false);
      },
    );
    return unsub;
  }, []);

  useEffect(() => {
    const uid = userId?.trim();
    if (!uid || meetings.length === 0) return;
    void sweepStalePublicUnconfirmedMeetingsForHost(uid, meetings);
  }, [userId, meetings]);

  const joinedMeetings = useMemo(
    () => filterJoinedMeetings(meetings, userId),
    [meetings, userId],
  );

  const sortedMeetingChats = useMemo(() => {
    const list = joinedMeetings.slice();
    const msgTime = (m: Meeting): number => {
      const msg = latestByMeetingId[m.id];
      if (!msg || !msg.createdAt || typeof msg.createdAt.toDate !== 'function') return 0;
      try {
        return msg.createdAt.toDate().getTime();
      } catch {
        return 0;
      }
    };
    const ongoingRank = (m: Meeting): number => {
      const phase = getMeetingRecruitmentPhase(m);
      return phase === 'recruiting' || phase === 'confirmed' || phase === 'full' ? 1 : 0;
    };
    list.sort((a, b) => {
      const oa = ongoingRank(a);
      const ob = ongoingRank(b);
      if (oa !== ob) return ob - oa;
      const ta = msgTime(a);
      const tb = msgTime(b);
      if (ta !== tb) return tb - ta;
      return String(b.id).localeCompare(String(a.id));
    });
    return list;
  }, [joinedMeetings, latestByMeetingId]);

  const signedIn = Boolean(userId?.trim());

  const chatRowMeetingKey = useMemo(() => sortedMeetingChats.map((m) => m.id).join('\u0001'), [sortedMeetingChats]);

  const socialRoomKey = useMemo(() => socialRooms.map((r) => r.roomId).join('\u0001'), [socialRooms]);

  useEffect(() => {
    if (!signedIn || chatKind !== 'social') {
      return () => {};
    }
    const uid = userId?.trim();
    if (!uid) return () => {};
    const unsub = subscribeMySocialChatRooms(
      uid,
      (rooms) => {
        setSocialRooms(rooms);
        setSocialRoomsError(null);
      },
      (msg) => setSocialRoomsError(msg),
    );
    return unsub;
  }, [signedIn, chatKind, userId]);

  useEffect(() => {
    if (chatKind !== 'social' || socialRooms.length === 0) {
      setSocialProfiles(new Map());
      return;
    }
    const peers = [...new Set(socialRooms.map((r) => r.peerAppUserId))];
    let cancelled = false;
    void getUserProfilesForIds(peers).then((map) => {
      if (!cancelled) setSocialProfiles(map);
    });
    return () => {
      cancelled = true;
    };
  }, [chatKind, socialRoomKey]);

  useEffect(() => {
    if (!signedIn || sortedMeetingChats.length === 0) {
      return () => {};
    }
    const unsubs = sortedMeetingChats.map((m) =>
      subscribeMeetingChatLatestMessage(
        m.id,
        (msg) => {
          setLatestByMeetingId((p) => ({ ...p, [m.id]: msg }));
        },
        () => {
          setLatestByMeetingId((p) => ({ ...p, [m.id]: null }));
        },
      ),
    );
    return () => {
      unsubs.forEach((u) => u());
    };
  }, [chatRowMeetingKey, signedIn]);

  useEffect(() => {
    const hosts = [
      ...new Set(
        sortedMeetingChats
          .map((me) => (me.createdBy?.trim() ? normalizePhoneUserId(me.createdBy) ?? me.createdBy.trim() : ''))
          .filter(Boolean),
      ),
    ] as string[];
    if (hosts.length === 0) {
      setHostProfiles(new Map());
      return;
    }
    let cancelled = false;
    void getUserProfilesForIds(hosts).then((map) => {
      if (!cancelled) setHostProfiles(map);
    });
    return () => {
      cancelled = true;
    };
  }, [chatRowMeetingKey]);

  const onPullRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await fetchMeetingsOnceHybrid();
      if (result.ok) {
        setMeetings(result.meetings);
        setListError(null);
      } else {
        setListError(result.message);
      }
    } finally {
      setRefreshing(false);
    }
  }, []);

  return (
    <ScreenShell padded={false} style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <FlatList
          data={chatKind === 'gather' ? sortedMeetingChats : socialRooms}
          keyExtractor={(item) => (chatKind === 'gather' ? (item as Meeting).id : (item as SocialChatRoomSummary).roomId)}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onPullRefresh}
              tintColor={GinitTheme.colors.primary}
              colors={[GinitTheme.colors.primary]}
            />
          }
          ListHeaderComponent={
            <View style={styles.feedHeader}>
              <View style={styles.chatHeaderRow}>
                <Text style={styles.chatTitle} accessibilityRole="header">
                  채팅
                </Text>
                <View style={styles.headerActions}>
                  <InAppAlarmsBellButton />
                  <Pressable accessibilityRole="button" hitSlop={10} accessibilityLabel="채팅 설정">
                    <Ionicons name="settings-outline" size={24} color="#0f172a" />
                  </Pressable>
                </View>
              </View>

              <View style={styles.kindTabsRow} accessibilityRole="tablist">
                <Pressable
                  onPress={() => setChatKind('gather')}
                  style={({ pressed }) => [
                    styles.kindTab,
                    chatKind === 'gather' && styles.kindTabActive,
                    pressed && styles.kindTabPressed,
                  ]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: chatKind === 'gather' }}
                  accessibilityLabel="모임 채팅 Gather">
                  <Text style={[styles.kindTabText, chatKind === 'gather' && styles.kindTabTextActive]}>Gather(모임)</Text>
                </Pressable>
                <Pressable
                  onPress={() => setChatKind('social')}
                  style={({ pressed }) => [
                    styles.kindTab,
                    chatKind === 'social' && styles.kindTabActive,
                    pressed && styles.kindTabPressed,
                  ]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: chatKind === 'social' }}
                  accessibilityLabel="친구 채팅 Social">
                  <Text style={[styles.kindTabText, chatKind === 'social' && styles.kindTabTextActive]}>Social(친구)</Text>
                </Pressable>
              </View>

              {signedIn && chatKind === 'social' ? (
                <View style={styles.socialShortcuts}>
                  <Pressable
                    style={styles.shortcutBtn}
                    onPress={() => router.push('/social/connections')}
                    accessibilityRole="button"
                    accessibilityLabel="친구 관리">
                    <Text style={styles.shortcutBtnText}>My Connections</Text>
                  </Pressable>
                  <Pressable
                    style={styles.shortcutBtn}
                    onPress={() => router.push('/social/discovery')}
                    accessibilityRole="button"
                    accessibilityLabel="지닛 디스커버리">
                    <Text style={styles.shortcutBtnText}>디스커버리</Text>
                  </Pressable>
                </View>
              ) : null}

              {loading ? (
                <View style={styles.centerRow}>
                  <ActivityIndicator color={GinitTheme.colors.primary} />
                  <Text style={styles.muted}>불러오는 중…</Text>
                </View>
              ) : null}

              {listError ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorTitle}>목록을 불러오지 못했어요</Text>
                  <Text style={styles.errorBody}>{listError}</Text>
                </View>
              ) : null}

              {chatKind === 'social' && socialRoomsError ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorTitle}>Social 목록 오류</Text>
                  <Text style={styles.errorBody}>{socialRoomsError}</Text>
                </View>
              ) : null}

              {!loading && !listError && !signedIn ? (
                <Text style={styles.empty}>로그인하면 채팅 목록이 여기에 표시돼요.</Text>
              ) : null}

              {!loading && !listError && signedIn && chatKind === 'gather' && joinedMeetings.length === 0 ? (
                <Text style={styles.empty}>참여 중인 모임이 없어요. 홈에서 모임에 참여해 보세요.</Text>
              ) : null}

              {!loading && !listError && signedIn && chatKind === 'social' && socialRooms.length === 0 ? (
                <Text style={styles.empty}>Social 대화가 없어요. 디스커버리에서 지닛을 보내 보세요.</Text>
              ) : null}
            </View>
          }
          renderItem={({ item }) => {
            if (chatKind === 'gather') {
              const m = item as Meeting;
              const host = profileForCreatedBy(hostProfiles, m.createdBy);
              const phase = getMeetingRecruitmentPhase(m);
              const ongoing = phase === 'recruiting' || phase === 'full' || phase === 'confirmed';
              return (
                <ChatMeetingListRow
                  meeting={m}
                  hostPhotoUrl={host?.photoUrl ?? null}
                  hostNickname={host?.nickname ?? '주관자'}
                  hostWithdrawn={isUserProfileWithdrawn(host)}
                  latestMessage={latestByMeetingId[m.id]}
                  ongoing={ongoing}
                  onPress={() => router.push(`/meeting-chat/${m.id}`)}
                />
              );
            }
            const row = item as SocialChatRoomSummary;
            const prof = socialProfiles.get(row.peerAppUserId);
            const uri = prof?.photoUrl?.trim();
            const nick = prof?.nickname ?? '친구';
            const rid = userId?.trim() ? socialDmRoomId(userId.trim(), row.peerAppUserId) : row.roomId;
            return (
              <Pressable
                style={({ pressed }) => [styles.socialRow, pressed && styles.socialRowPressed]}
                onPress={() =>
                  router.push(`/social-chat/${encodeURIComponent(rid)}?peerName=${encodeURIComponent(nick)}`)
                }
                accessibilityRole="button"
                accessibilityLabel={`${nick}와 채팅`}>
                {uri ? (
                  <Image source={{ uri }} style={styles.socialAvatar} contentFit="cover" />
                ) : (
                  <View style={styles.socialAvatarFallback}>
                    <Text style={styles.socialAvatarLetter}>{nick.slice(0, 1)}</Text>
                  </View>
                )}
                <View style={styles.socialMid}>
                  <Text style={styles.socialNick} numberOfLines={1}>
                    {nick}
                  </Text>
                  <Text style={styles.socialSub} numberOfLines={1}>
                    1:1 Social
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#94a3b8" />
              </Pressable>
            );
          }}
        />
      </SafeAreaView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: GinitTheme.colors.bg },
  safe: { flex: 1 },
  scroll: {
    paddingHorizontal: 20,
    paddingBottom: 28,
  },
  feedHeader: {
    marginBottom: 16,
    paddingTop: 4,
    gap: 12,
  },
  chatHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  chatTitle: {
    fontSize: 26,
    fontWeight: '900',
    color: '#0f172a',
    letterSpacing: -0.6,
    textShadowColor: 'rgba(255, 255, 255, 0.7)',
    textShadowOffset: { width: 0, height: 0.5 },
    textShadowRadius: 2,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    flexShrink: 0,
  },
  kindTabsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  kindTab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.55)',
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  kindTabActive: {
    borderColor: 'rgba(0, 82, 204, 0.28)',
    backgroundColor: 'rgba(0, 82, 204, 0.10)',
  },
  kindTabPressed: {
    opacity: 0.9,
  },
  kindTabText: {
    fontSize: 13,
    fontWeight: '900',
    color: '#334155',
    letterSpacing: -0.2,
  },
  kindTabTextActive: {
    color: GinitTheme.colors.primary,
  },
  socialShortcuts: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 4,
  },
  shortcutBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(0, 82, 204, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0, 82, 204, 0.18)',
    alignItems: 'center',
  },
  shortcutBtnText: {
    fontSize: 13,
    fontWeight: '900',
    color: GinitTheme.colors.primary,
  },
  socialRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(15, 23, 42, 0.08)',
  },
  socialRowPressed: { opacity: 0.92 },
  socialAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#e2e8f0',
  },
  socialAvatarFallback: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0, 82, 204, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  socialAvatarLetter: { fontSize: 18, fontWeight: '900', color: GinitTheme.colors.primary },
  socialMid: { flex: 1, minWidth: 0, gap: 4 },
  socialNick: { fontSize: 16, fontWeight: '900', color: '#0f172a' },
  socialSub: { fontSize: 13, fontWeight: '600', color: '#64748b' },
  centerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  muted: {
    fontSize: 14,
    color: '#64748b',
  },
  errorBox: {
    marginBottom: 14,
    padding: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(220, 38, 38, 0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(220, 38, 38, 0.25)',
  },
  errorTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#B91C1C',
    marginBottom: 6,
  },
  errorBody: {
    fontSize: 14,
    color: '#7F1D1D',
    lineHeight: 20,
  },
  empty: {
    fontSize: 14,
    color: '#64748b',
    lineHeight: 20,
    marginBottom: 12,
  },
  // 정렬 모달/칩 UI 제거됨
});
