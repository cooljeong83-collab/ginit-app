import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GinitTheme } from '@/constants/ginit-theme';
import { useUserSession } from '@/src/context/UserSessionContext';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { isUserJoinedMeeting } from '@/src/lib/joined-meetings';
import type { Meeting } from '@/src/lib/meetings';
import { subscribeMeetingById } from '@/src/lib/meetings';
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

function uniqueParticipantPids(m: Meeting | null | undefined): string[] {
  if (!m) return [];
  const ids = [...(m.participantIds ?? []), ...(m.createdBy?.trim() ? [m.createdBy] : [])];
  return [...new Set(ids.map((x) => normalizeParticipantId(String(x)) ?? String(x).trim()).filter(Boolean))];
}

export default function MeetingChatMembersScreen() {
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

  const hostNorm = meeting?.createdBy?.trim() ? normalizeParticipantId(meeting.createdBy.trim()) : '';
  const pids = useMemo(() => uniqueParticipantPids(meeting ?? null), [meeting]);

  const rows = useMemo(() => {
    return pids.map((pid) => {
      const p = profileForSender(profiles, pid);
      const nick = isUserProfileWithdrawn(p) ? WITHDRAWN_NICKNAME : (p?.nickname ?? '회원');
      const trust = typeof p?.gTrust === 'number' ? p.gTrust : null;
      const dna = typeof p?.gDna === 'string' ? p.gDna : '';
      const isHost = Boolean(hostNorm && pid === hostNorm);
      return { pid, p, nick, trust, dna, isHost };
    });
  }, [pids, profiles, hostNorm]);

  const onBack = useCallback(() => {
    router.back();
  }, [router]);

  if (!meetingId) {
    return (
      <SafeAreaView style={styles.center} edges={['top']}>
        <Text style={styles.muted}>잘못된 주소예요.</Text>
      </SafeAreaView>
    );
  }

  if (meeting === undefined) {
    return (
      <SafeAreaView style={styles.center} edges={['top']}>
        <ActivityIndicator color={GinitTheme.colors.primary} />
      </SafeAreaView>
    );
  }

  if (!meeting || allowed !== true) {
    return (
      <SafeAreaView style={styles.center} edges={['top']}>
        <Text style={styles.muted}>참여 중인 모임만 볼 수 있어요.</Text>
        <Pressable onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backBtnText}>돌아가기</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="뒤로">
          <Ionicons name="chevron-back" size={28} color={GinitTheme.colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>참여자</Text>
        <View style={{ width: 28 }} />
      </View>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.hint}>gTrust · gDna</Text>
        <View style={styles.card}>
          {rows.map(({ pid, p, nick, trust, dna, isHost }, i) => (
            <View key={pid} style={[styles.row, i === rows.length - 1 && styles.rowLast]}>
              <View style={styles.avatar}>
                {p?.photoUrl ? (
                  <Image source={{ uri: p.photoUrl }} style={styles.avatarImg} contentFit="cover" />
                ) : (
                  <Text style={styles.avatarText}>{nick.slice(0, 1)}</Text>
                )}
              </View>
              <View style={styles.rowBody}>
                <View style={styles.nameRow}>
                  <Text style={styles.name} numberOfLines={1}>
                    {nick}
                  </Text>
                  {isHost ? <Ionicons name="star" size={14} color="#CA8A04" /> : null}
                </View>
                <Text style={styles.meta}>
                  {trust != null ? `gTrust ${trust}` : 'gTrust -'}
                  {dna ? ` · ${dna}` : ''}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f2f4f7' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  muted: { fontSize: 14, color: '#64748b', fontWeight: '600' },
  backBtn: { marginTop: 12, paddingVertical: 8, paddingHorizontal: 16 },
  backBtnText: { fontSize: 15, fontWeight: '800', color: GinitTheme.colors.primary },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: '#f2f4f7',
  },
  headerTitle: { fontSize: 17, fontWeight: '900', color: '#0f172a', letterSpacing: -0.3 },
  scroll: { paddingBottom: 24, paddingHorizontal: 16 },
  hint: { fontSize: 12, color: '#64748b', fontWeight: '800', marginBottom: 10, marginTop: 4 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.06)',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(15, 23, 42, 0.06)',
  },
  rowLast: { borderBottomWidth: 0 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: 'rgba(0, 82, 204, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImg: { width: 40, height: 40 },
  avatarText: { fontSize: 15, fontWeight: '900', color: '#0052CC' },
  rowBody: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { fontSize: 15, fontWeight: '900', color: '#0f172a', flexShrink: 1 },
  meta: { marginTop: 2, fontSize: 12, color: '#475569', fontWeight: '700' },
});
