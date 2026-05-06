
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { GinitTheme } from '@/constants/ginit-theme';
import { useUserSession } from '@/src/context/UserSessionContext';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { isUserJoinedMeeting } from '@/src/lib/joined-meetings';
import type { Meeting } from '@/src/lib/meetings';
import { meetingParticipantCount, subscribeMeetingById } from '@/src/lib/meetings';
import type { UserProfile } from '@/src/lib/user-profile';
import { getUserProfilesForIds, isUserProfileWithdrawn } from '@/src/lib/user-profile';

function RowSep() {
  return <View style={styles.sep} />;
}

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

  const hostNorm = meeting?.createdBy?.trim() ? normalizeParticipantId(meeting.createdBy.trim()) : '';
  const pids = useMemo(() => uniqueParticipantPids(meeting ?? null), [meeting]);
  const myNorm = userId?.trim() ? normalizeParticipantId(userId.trim()) : '';
  const pCount = meeting ? meetingParticipantCount(meeting) : 0;

  const rows = useMemo(() => {
    return pids.map((pid) => {
      const p = profileForSender(profiles, pid);
      const nick = isUserProfileWithdrawn(p) ? '회원' : (p?.nickname ?? '회원');
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
          <Text style={styles.emptyText}>참여 중인 모임만 볼 수 있어요.</Text>
          <Pressable onPress={onBack} style={styles.textBtn}>
            <Text style={styles.textBtnLabel}>돌아가기</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']} accessibilityLabel="참여자">
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.block}>
          <View style={styles.rowStatic}>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>참여자 {pCount}명</Text>
              <Text style={styles.rowSub}>프로필과 gTrust · gDna</Text>
            </View>
          </View>
          <RowSep />
          {rows.map(({ pid, p, nick, trust, dna, isHost }, i) => {
            const isMe = Boolean(myNorm && pid === myNorm);
            const isAi = pid === 'ginit_ai';
            const withdrawn = isUserProfileWithdrawn(p);
            const canOpen = !isMe && !isAi && !withdrawn;
            return (
              <View key={pid}>
                {i > 0 ? <RowSep /> : null}
                <Pressable
                  onPress={() => canOpen && openUserProfile(pid)}
                  disabled={!canOpen}
                  style={({ pressed }) => [styles.row, canOpen && pressed && styles.rowPressed]}
                  accessibilityRole={canOpen ? 'button' : 'text'}
                  accessibilityLabel={canOpen ? `${nick} 프로필` : nick}>
                  <View style={styles.avatarRing}>
                    {p?.photoUrl ? (
                      <Image source={{ uri: p.photoUrl }} style={styles.avatarImg} contentFit="cover" />
                    ) : (
                      <Text style={styles.avatarLetter}>{nick.slice(0, 1)}</Text>
                    )}
                  </View>
                  <View style={styles.rowText}>
                    <View style={styles.nameRow}>
                      <Text style={[styles.rowLabel, styles.nameShrink]} numberOfLines={1}>
                        {nick}
                      </Text>
                      {isHost ? <GinitSymbolicIcon name="star" size={14} color={GinitTheme.colors.warning} /> : null}
                    </View>
                    <Text style={styles.rowSub} numberOfLines={2}>
                      {trust != null ? `gTrust ${trust}` : 'gTrust -'}
                      {dna ? ` · ${dna}` : ''}
                    </Text>
                  </View>
                  {canOpen ? (
                    <GinitSymbolicIcon name="chevron-forward" size={18} color={GinitTheme.colors.textMuted} />
                  ) : (
                    <View style={styles.chevronSpacer} />
                  )}
                </Pressable>
              </View>
            );
          })}
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
  rowSub: { marginTop: 4, fontSize: 12, fontWeight: '600', color: GinitTheme.colors.textMuted, lineHeight: 16 },
  sep: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 20,
    backgroundColor: GinitTheme.colors.border,
  },
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
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  nameShrink: { flexShrink: 1 },
  chevronSpacer: { width: 18, height: 18 },
  emptyWrap: { flex: 1, padding: 24, justifyContent: 'center', alignItems: 'center' },
  emptyText: { fontSize: 15, fontWeight: '700', color: GinitTheme.colors.textMuted, textAlign: 'center' },
  textBtn: { marginTop: 12, paddingVertical: 8, paddingHorizontal: 16 },
  textBtnLabel: { fontSize: 15, fontWeight: '600', color: GinitTheme.colors.primary },
});
