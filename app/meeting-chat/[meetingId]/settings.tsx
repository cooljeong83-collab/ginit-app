
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { GinitTheme } from '@/constants/ginit-theme';
import { useUserSession } from '@/src/context/UserSessionContext';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { isUserJoinedMeeting } from '@/src/lib/joined-meetings';
import {
  getMeetingChatImageUploadQuality,
  setMeetingChatImageUploadQuality,
} from '@/src/lib/meeting-chat-image-quality-preference';
import {
  getMeetingChatNotifyEnabledForUser,
  setMeetingChatNotifyEnabledForUser,
} from '@/src/lib/meeting-chat-notify-preference';
import { meetingParticipantCount, subscribeMeetingById, type Meeting } from '@/src/lib/meetings';
import type { UserProfile } from '@/src/lib/user-profile';
import { getUserProfilesForIds, isUserProfileWithdrawn } from '@/src/lib/user-profile';

function RowSep() {
  return <View style={styles.sep} />;
}

/** `app/social/friends-settings` 스위치 트랙과 동일 */
const meetingCreateSwitchTrack = { false: '#cbd5e1', true: GinitTheme.themeMainColor } as const;

function profileForSender(map: Map<string, UserProfile>, senderId: string): UserProfile | undefined {
  const n = normalizeParticipantId(senderId);
  const hit = map.get(senderId) ?? map.get(n);
  if (hit) return hit;
  for (const [k, v] of map) {
    if (normalizeParticipantId(k) === n) return v;
  }
  return undefined;
}

function uniqueParticipantPids(m: Meeting | null | undefined): string[] {
  if (!m) return [];
  const ids = [...(m.participantIds ?? []), ...(m.createdBy?.trim() ? [m.createdBy] : [])];
  return [...new Set(ids.map((x) => normalizeParticipantId(String(x)) ?? String(x).trim()).filter(Boolean))];
}

function ChevronRow({
  label,
  sub,
  onPress,
  destructive,
}: {
  label: string;
  sub?: string;
  onPress: () => void;
  destructive?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      accessibilityRole="button">
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, destructive && styles.rowLabelDanger]}>{label}</Text>
        {sub ? (
          <Text style={[styles.rowSub, destructive && styles.rowSubDanger]} numberOfLines={2}>
            {sub}
          </Text>
        ) : null}
      </View>
      <GinitSymbolicIcon name="chevron-forward" size={18} color={GinitTheme.colors.textMuted} />
    </Pressable>
  );
}

export default function MeetingChatSettingsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ meetingId: string | string[] }>();
  const meetingId = Array.isArray(params.meetingId)
    ? (params.meetingId[0] ?? '').trim()
    : typeof params.meetingId === 'string'
      ? params.meetingId.trim()
      : '';
  const { userId } = useUserSession();

  const [meeting, setMeeting] = useState<Meeting | null | undefined>(undefined);
  const [profiles, setProfiles] = useState<Map<string, UserProfile>>(new Map());
  const [notifyOn, setNotifyOn] = useState(true);
  const [notifyLoaded, setNotifyLoaded] = useState(false);
  const [imageHighQuality, setImageHighQuality] = useState(false);
  const [imageQualityLoaded, setImageQualityLoaded] = useState(false);
  const openUserProfile = useCallback(
    (id: string) => {
      const t = id.trim();
      if (!t) return;
      router.push(`/profile/user/${encodeURIComponent(t)}`);
    },
    [router],
  );

  useEffect(() => {
    if (!meetingId) {
      setMeeting(null);
      return;
    }
    return subscribeMeetingById(
      meetingId,
      (m) => setMeeting(m),
      () => {},
    );
  }, [meetingId]);

  const allowed = useMemo(() => {
    if (meeting === undefined) return null;
    if (!meeting) return false;
    return isUserJoinedMeeting(meeting, userId);
  }, [meeting, userId]);

  useEffect(() => {
    if (!meeting || allowed !== true) return;
    const ids = uniqueParticipantPids(meeting);
    void getUserProfilesForIds(ids).then(setProfiles);
  }, [meeting, allowed]);

  useEffect(() => {
    if (!meetingId || !userId?.trim()) return;
    let cancelled = false;
    void (async () => {
      try {
        const v = await getMeetingChatNotifyEnabledForUser(meetingId, userId.trim());
        if (cancelled) return;
        setNotifyOn(v);
      } catch {
        /* noop */
      } finally {
        if (!cancelled) setNotifyLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [meetingId, userId]);

  useEffect(() => {
    if (!meetingId) return;
    let cancelled = false;
    void (async () => {
      try {
        const q = await getMeetingChatImageUploadQuality(meetingId);
        if (cancelled) return;
        setImageHighQuality(q === 'high');
      } catch {
        /* noop */
      } finally {
        if (!cancelled) setImageQualityLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [meetingId]);

  const onToggleNotify = useCallback(
    async (next: boolean) => {
      setNotifyOn(next);
      if (!meetingId || !userId?.trim()) return;
      try {
        await setMeetingChatNotifyEnabledForUser(meetingId, userId.trim(), next);
      } catch {
        setNotifyOn((prev) => !prev);
      }
    },
    [meetingId, userId],
  );

  const onToggleImageQuality = useCallback(
    async (high: boolean) => {
      setImageHighQuality(high);
      if (!meetingId) return;
      await setMeetingChatImageUploadQuality(meetingId, high ? 'high' : 'low');
    },
    [meetingId],
  );

  const title = meeting?.title?.trim() || '모임';
  const pCount = meeting ? meetingParticipantCount(meeting) : 0;
  const pids = useMemo(() => uniqueParticipantPids(meeting ?? null), [meeting]);
  const myNorm = userId?.trim() ? normalizeParticipantId(userId.trim()) : '';

  const onBack = useCallback(() => {
    router.back();
  }, [router]);

  const openMembers = useCallback(() => {
    router.push(`/meeting-chat/${meetingId}/members`);
  }, [router, meetingId]);

  const openChatPhotos = useCallback(() => {
    router.push(`/meeting-chat/${meetingId}/media`);
  }, [router, meetingId]);

  const openMeetingDetail = useCallback(() => {
    router.push(`/meeting/${meetingId}`);
  }, [router, meetingId]);

  const openLeaveInfo = useCallback(() => {
    Alert.alert(
      '모임 나가기',
      '채팅방을 나가려면 모임 상세 화면에서 나가기를 진행해 주세요. 일정이 확정된 모임은 패널티 안내가 있을 수 있어요.',
      [
        { text: '닫기', style: 'cancel' },
        { text: '모임 상세로', onPress: () => router.push(`/meeting/${meetingId}`) },
      ],
    );
  }, [router, meetingId]);

  if (!meetingId) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>잘못된 주소예요.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (meeting === undefined) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.emptyWrap}>
          <ActivityIndicator color={GinitTheme.colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!meeting || allowed !== true) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>참여 중인 모임만 설정할 수 있어요.</Text>
          <Pressable onPress={onBack} style={styles.textBtn}>
            <Text style={styles.textBtnLabel}>돌아가기</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']} accessibilityLabel="채팅방 설정">
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.block}>
          <View style={styles.rowStatic}>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel} numberOfLines={2}>
                「{title}」
              </Text>
              <Text style={styles.rowSub}>
                참여자 {pCount}명 · 모임 채팅
              </Text>
            </View>
          </View>
          <RowSep />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.avatarStrip}>
            {pids.map((pid) => {
              const p = profileForSender(profiles, pid);
              const nick = isUserProfileWithdrawn(p) ? '회원' : (p?.nickname ?? '회원');
              const isMe = Boolean(myNorm && pid === myNorm);
              const isAi = pid === 'ginit_ai';
              const canOpen = !isMe && !isAi && !isUserProfileWithdrawn(p);
              return (
                <Pressable
                  key={pid}
                  style={styles.avatarItem}
                  disabled={!canOpen}
                  onPress={() => canOpen && openUserProfile(pid)}
                  accessibilityRole={canOpen ? 'button' : 'text'}
                  accessibilityLabel={canOpen ? `${nick} 프로필` : nick}>
                  <View style={styles.avatarRing}>
                    {p?.photoUrl ? (
                      <Image source={{ uri: p.photoUrl }} style={styles.avatarImg} contentFit="cover" />
                    ) : (
                      <Text style={styles.avatarLetter}>{nick.slice(0, 1)}</Text>
                    )}
                  </View>
                  <Text style={styles.avatarNick} numberOfLines={1}>
                    {nick}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <RowSep />
          <ChevronRow label="전체 멤버 보기" sub="프로필과 gTrust · gDna" onPress={openMembers} />
          <RowSep />
          <ChevronRow label="사진" sub="이 채팅방에서 주고받은 사진을 모아서 볼 수 있어요" onPress={openChatPhotos} />
          <RowSep />
          <ChevronRow label="모임 정보" sub="일정·장소·참여자 관리" onPress={openMeetingDetail} />
        </View>

        <View style={[styles.block, styles.blockGap]}>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>알림</Text>
              <Text style={styles.rowSub}>이 모임 채팅 알림(앱 내·푸시)</Text>
            </View>
            {notifyLoaded ? (
              <Switch
                value={notifyOn}
                onValueChange={(v) => void onToggleNotify(v)}
                trackColor={meetingCreateSwitchTrack}
                thumbColor={notifyOn ? '#FFFFFF' : '#f1f5f9'}
                ios_backgroundColor="#cbd5e1"
                accessibilityLabel="채팅 알림"
              />
            ) : (
              <ActivityIndicator size="small" color={GinitTheme.colors.textMuted} />
            )}
          </View>
          <RowSep />
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>고화질로 사진 보내기</Text>
              <Text style={styles.rowSub}>기본은 저화질(최대한 압축)이고, 켜면 더 선명하게 보낼 수 있어요.</Text>
            </View>
            {imageQualityLoaded ? (
              <Switch
                value={imageHighQuality}
                onValueChange={(v) => void onToggleImageQuality(v)}
                trackColor={meetingCreateSwitchTrack}
                thumbColor={imageHighQuality ? '#FFFFFF' : '#f1f5f9'}
                ios_backgroundColor="#cbd5e1"
                accessibilityLabel="고화질 사진 전송"
              />
            ) : (
              <ActivityIndicator size="small" color={GinitTheme.colors.textMuted} />
            )}
          </View>
        </View>

        <View style={[styles.block, styles.blockGap]}>
          <ChevronRow
            label="채팅방 나가기"
            sub="모임 상세에서 나가기를 진행해 주세요"
            onPress={openLeaveInfo}
            destructive
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: GinitTheme.colors.bg },
  scroll: { paddingTop: 8, paddingBottom: 32 },
  block: {
    backgroundColor: 'transparent',
  },
  blockGap: { marginTop: 20 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    gap: 12,
  },
  rowStatic: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  rowPressed: { opacity: 0.82 },
  rowText: { flex: 1, minWidth: 0 },
  rowLabel: { fontSize: 16, fontWeight: '600', color: GinitTheme.colors.text, letterSpacing: -0.2 },
  rowLabelDanger: { color: GinitTheme.colors.danger },
  rowSub: { marginTop: 4, fontSize: 12, fontWeight: '600', color: GinitTheme.colors.textMuted, lineHeight: 16 },
  rowSubDanger: { color: GinitTheme.colors.danger },
  sep: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 20,
    backgroundColor: GinitTheme.colors.border,
  },
  avatarStrip: { paddingVertical: 12, paddingHorizontal: 20, gap: 14, flexDirection: 'row', alignItems: 'flex-start' },
  avatarItem: { width: 56, alignItems: 'center' },
  avatarRing: {
    width: 48,
    height: 48,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: GinitTheme.colors.primarySoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImg: { width: 48, height: 48 },
  avatarLetter: { fontSize: 18, fontWeight: '600', color: GinitTheme.colors.primary },
  avatarNick: {
    marginTop: 6,
    fontSize: 11,
    fontWeight: '700',
    color: GinitTheme.colors.textSub,
    maxWidth: 56,
    textAlign: 'center',
  },
  emptyWrap: { flex: 1, padding: 24, justifyContent: 'center', alignItems: 'center' },
  emptyText: { fontSize: 15, fontWeight: '700', color: GinitTheme.colors.textMuted, textAlign: 'center' },
  textBtn: { marginTop: 12, paddingVertical: 8, paddingHorizontal: 16 },
  textBtnLabel: { fontSize: 15, fontWeight: '600', color: GinitTheme.colors.primary },
});
