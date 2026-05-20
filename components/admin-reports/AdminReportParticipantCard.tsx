import { Image } from 'expo-image';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { GinitPressable } from '@/components/ui/GinitPressable';
import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { GinitTheme } from '@/constants/ginit-theme';
import type { AdminReportParticipantSnapshot } from '@/src/features/admin-reports/admin-report-participant-profile';

function nicknameInitial(nickname: string): string {
  const t = nickname.trim();
  return t ? t.slice(0, 1) : '?';
}

type AdminReportParticipantCardProps = {
  roleLabel: string;
  participant: AdminReportParticipantSnapshot;
  loading?: boolean;
  disabled?: boolean;
  onPressProfile: () => void;
};

export function AdminReportParticipantCard({
  roleLabel,
  participant,
  loading = false,
  disabled = false,
  onPressProfile,
}: AdminReportParticipantCardProps) {
  const canOpen = Boolean(participant.appUserId.trim()) && !participant.withdrawn && !disabled;

  return (
    <View style={styles.wrap}>
      <Text style={styles.roleLabel}>{roleLabel}</Text>
      <GinitPressable
        onPress={onPressProfile}
        disabled={!canOpen || loading}
        style={({ pressed }) => [styles.row, canOpen && pressed && styles.rowPressed]}
        accessibilityRole="button"
        accessibilityLabel={`${roleLabel} ${participant.nickname} 프로필 보기`}>
        <View style={styles.avatarWrap}>
          {loading ? (
            <View style={styles.avatarLoading}>
              <ActivityIndicator color={GinitTheme.colors.primary} />
            </View>
          ) : participant.withdrawn ? (
            <View style={styles.avatarWithdrawn}>
              <GinitSymbolicIcon name="person" size={22} color="#94a3b8" />
            </View>
          ) : participant.photoUrl ? (
            <Image
              source={{ uri: participant.photoUrl }}
              style={styles.avatarImg}
              contentFit="cover"
              cachePolicy="disk"
              recyclingKey={participant.photoUrl}
            />
          ) : (
            <View style={styles.avatarFallback}>
              <Text style={styles.avatarLetter}>{nicknameInitial(participant.nickname)}</Text>
            </View>
          )}
        </View>
        <View style={styles.textCol}>
          <Text style={styles.nickname} numberOfLines={1}>
            {loading ? '불러오는 중…' : participant.nickname}
          </Text>
          <Text style={styles.subId} numberOfLines={1}>
            {participant.appUserId}
          </Text>
        </View>
        {canOpen && !loading ? (
          <GinitSymbolicIcon name="chevron-forward" size={18} color={GinitTheme.colors.textMuted} />
        ) : null}
      </GinitPressable>
    </View>
  );
}

const AVATAR = 52;

const styles = StyleSheet.create({
  wrap: { marginTop: 16 },
  roleLabel: { fontSize: 12, fontWeight: '700', color: GinitTheme.colors.textMuted, marginBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.04)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.08)',
  },
  rowPressed: { opacity: 0.88 },
  avatarWrap: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    overflow: 'hidden',
    backgroundColor: '#e2e8f0',
  },
  avatarImg: { width: AVATAR, height: AVATAR },
  avatarFallback: {
    width: AVATAR,
    height: AVATAR,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(69, 39, 160, 0.12)',
  },
  avatarLetter: { fontSize: 20, fontWeight: '700', color: GinitTheme.colors.primary },
  avatarWithdrawn: {
    width: AVATAR,
    height: AVATAR,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f5f9',
  },
  avatarLoading: {
    width: AVATAR,
    height: AVATAR,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textCol: { flex: 1, minWidth: 0 },
  nickname: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  subId: { marginTop: 4, fontSize: 12, color: GinitTheme.colors.textMuted },
});
