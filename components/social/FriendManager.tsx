import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { HomeGlassStyles, homeBlurIntensity, shouldUseStaticGlassInsteadOfBlur } from '@/constants/home-glass-styles';
import { GinitTheme } from '@/constants/ginit-theme';
import type { FriendAcceptedRow, FriendInboxRow } from '@/src/lib/friends';
import { acceptGinitRequest, fetchFriendsAcceptedList, fetchFriendsPendingInbox } from '@/src/lib/friends';
import type { UserProfile } from '@/src/lib/user-profile';
import { getUserProfilesForIds } from '@/src/lib/user-profile';

type Props = {
  /** 현재 로그인 앱 사용자 PK */
  userId: string;
  /** 수락 후 1:1 채팅으로 이동할 때 (표시명은 채팅 헤더에 사용) */
  onOpenChatWithPeer: (peerAppUserId: string, peerDisplayName?: string) => void;
};

function PendingGinitMiniCard({
  title,
  subtitle,
  photoUrl,
  onPress,
}: {
  title: string;
  subtitle: string;
  photoUrl: string | null;
  onPress: () => void;
}) {
  const uri =
    photoUrl?.trim() ||
    'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=400&q=80';
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [HomeGlassStyles.miniCardOuter, pressed && styles.miniPressed]}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${subtitle}`}>
      <Image source={{ uri }} style={HomeGlassStyles.miniThumb} contentFit="cover" />
      {shouldUseStaticGlassInsteadOfBlur() ? (
        <View style={[HomeGlassStyles.miniCardBlurWrap, styles.staticGlass]} />
      ) : (
        <BlurView
          intensity={homeBlurIntensity}
          tint="light"
          style={HomeGlassStyles.miniCardBlurWrap}
          experimentalBlurMethod="dimezisBlurView"
        />
      )}
      <View style={HomeGlassStyles.miniCardVeil} pointerEvents="none" />
      <View style={HomeGlassStyles.miniCardInnerBorder} pointerEvents="none" />
      <View style={HomeGlassStyles.miniCardBody}>
        <View style={[HomeGlassStyles.phasePill, { backgroundColor: 'rgba(0, 82, 204, 0.14)' }]}>
          <Text style={[HomeGlassStyles.phasePillText, { color: GinitTheme.colors.primary }]} numberOfLines={1}>
            지닛
          </Text>
        </View>
        <Text style={HomeGlassStyles.miniTitle} numberOfLines={2}>
          {title}
        </Text>
        <Text style={HomeGlassStyles.miniMeta} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
    </Pressable>
  );
}

function FriendTrustTile({
  profile,
  onPress,
}: {
  profile: UserProfile & { appUserId: string };
  onPress: () => void;
}) {
  const uri = profile.photoUrl?.trim();
  const initials = profile.nickname?.trim()?.slice(0, 1) || '?';
  const trust = profile.gTrust ?? 0;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]} accessibilityRole="button">
      <View style={styles.tileAvatars}>
        {uri ? (
          <Image source={{ uri }} style={styles.tileAvatarImg} contentFit="cover" />
        ) : (
          <View style={styles.tileAvatarFallback}>
            <Text style={styles.tileAvatarLetter}>{initials}</Text>
          </View>
        )}
        <View style={styles.trustBadge}>
          <Text style={styles.trustBadgeText}>{trust}</Text>
        </View>
      </View>
      <Text style={styles.tileNick} numberOfLines={1}>
        {profile.nickname}
      </Text>
      <Text style={styles.tileDna} numberOfLines={1}>
        {profile.gDna ?? '—'}
      </Text>
    </Pressable>
  );
}

/**
 * 친구 관리 — 채팅 탭 미니 카드 UI로 받은 지닛 대기열 + gTrust 순 친구 그리드.
 */
export function FriendManager({ userId, onOpenChatWithPeer }: Props) {
  const me = userId.trim();
  const [pending, setPending] = useState<FriendInboxRow[]>([]);
  const [accepted, setAccepted] = useState<FriendAcceptedRow[]>([]);
  const [profiles, setProfiles] = useState<Map<string, UserProfile>>(new Map());
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!me) return;
    setLoading(true);
    setErr(null);
    try {
      const [p, a] = await Promise.all([fetchFriendsPendingInbox(me), fetchFriendsAcceptedList(me)]);
      setPending(p);
      setAccepted(a);
      const ids = [
        ...p.map((x) => x.requester_app_user_id),
        ...a.map((x) => x.peer_app_user_id),
      ].filter(Boolean);
      const uniq = [...new Set(ids)];
      if (uniq.length) {
        const map = await getUserProfilesForIds(uniq);
        setProfiles(map);
      } else {
        setProfiles(new Map());
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [me]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const sortedFriends = useMemo(() => {
    const rows = accepted.slice();
    rows.sort((a, b) => {
      const pa = profiles.get(a.peer_app_user_id);
      const pb = profiles.get(b.peer_app_user_id);
      const ta = typeof pa?.gTrust === 'number' ? pa.gTrust : 0;
      const tb = typeof pb?.gTrust === 'number' ? pb.gTrust : 0;
      return tb - ta;
    });
    return rows;
  }, [accepted, profiles]);

  const onAcceptPending = useCallback(
    async (row: FriendInboxRow) => {
      try {
        await acceptGinitRequest(me, row.id);
        await reload();
        onOpenChatWithPeer(row.requester_app_user_id);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    },
    [me, onOpenChatWithPeer, reload],
  );

  if (!me) {
    return (
      <View style={styles.pad}>
        <Text style={styles.muted}>로그인 후 친구 목록을 볼 수 있어요.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={GinitTheme.colors.primary} />
        </View>
      ) : null}
      {err ? (
        <View style={styles.errBox}>
          <Text style={styles.errText}>{err}</Text>
        </View>
      ) : null}

      <Text style={styles.sectionTitle}>나에게 온 지닛</Text>
      {pending.length === 0 ? (
        <Text style={styles.muted}>대기 중인 지닛이 없어요.</Text>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.stripContent}>
          {pending.map((row) => {
            const prof = profiles.get(row.requester_app_user_id);
            return (
              <PendingGinitMiniCard
                key={row.id}
                title={prof?.nickname ?? '회원'}
                subtitle="지닛을 보냈어요 · 탭하여 수락"
                photoUrl={prof?.photoUrl ?? null}
                onPress={() => onAcceptPending(row)}
              />
            );
          })}
        </ScrollView>
      )}

      <Text style={[styles.sectionTitle, { marginTop: 20 }]}>친구</Text>
      <Text style={styles.subHint}>gTrust 높은 순 · 홈 모임 카드 하단 배지 톤</Text>
      <View style={styles.grid}>
        {sortedFriends.map((row) => {
          const p = profiles.get(row.peer_app_user_id);
          if (!p) {
            return (
              <View key={row.id} style={[styles.tile, styles.tileGhost]}>
                <Text style={styles.muted}>프로필 로딩…</Text>
              </View>
            );
          }
          return (
            <FriendTrustTile
              key={row.id}
              profile={{ ...p, appUserId: row.peer_app_user_id }}
              onPress={() => onOpenChatWithPeer(row.peer_app_user_id, p.nickname)}
            />
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  scrollContent: { paddingBottom: 24, gap: 8 },
  pad: { padding: 16 },
  center: { paddingVertical: 12, alignItems: 'center' },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#0f172a',
    letterSpacing: -0.3,
  },
  subHint: { fontSize: 12, fontWeight: '600', color: '#64748b', marginBottom: 8 },
  muted: { fontSize: 14, color: '#64748b' },
  errBox: {
    padding: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(220, 38, 38, 0.08)',
    marginBottom: 8,
  },
  errText: { color: '#b91c1c', fontWeight: '700' },
  stripContent: { flexDirection: 'row', gap: 10, paddingVertical: 4 },
  miniPressed: { opacity: 0.92 },
  staticGlass: { backgroundColor: 'rgba(255,255,255,0.55)' },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  tile: {
    width: '31%',
    minWidth: 104,
    flexGrow: 1,
    borderRadius: 16,
    padding: 10,
    backgroundColor: GinitTheme.glassModal.inputFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
  },
  tilePressed: { opacity: 0.94 },
  tileGhost: { minHeight: 88, justifyContent: 'center' },
  tileAvatars: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  tileAvatarImg: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#e2e8f0' },
  tileAvatarFallback: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0, 82, 204, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileAvatarLetter: { fontSize: 15, fontWeight: '900', color: GinitTheme.colors.primary },
  trustBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(134, 211, 183, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(134, 211, 183, 0.45)',
  },
  trustBadgeText: { fontSize: 11, fontWeight: '900', color: GinitTheme.colors.textSub },
  tileNick: { fontSize: 13, fontWeight: '900', color: '#0f172a' },
  tileDna: { fontSize: 11, fontWeight: '700', color: '#64748b', marginTop: 2 },
});
