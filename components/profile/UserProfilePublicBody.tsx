import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Easing, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { MeetingChatImageViewerZoomArea } from '@/components/chat/MeetingChatImageViewerZoomArea';
import { GinitSymbolicIcon, type SymbolicIconName } from '@/components/ui/GinitSymbolicIcon';
import { GinitTheme } from '@/constants/ginit-theme';
import { useUserSession } from '@/src/context/UserSessionContext';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { notifyFriendRequestReceivedFireAndForget } from '@/src/lib/friend-push-notify';
import {
  acceptGinitRequest,
  fetchFriendRelationStatus,
  sendGinitRequest,
  type FriendRelationStatusRow,
} from '@/src/lib/friends';
import { effectiveGTrust, levelBarFillColorForTrust, trustTierForUser, xpProgressWithinLevel } from '@/src/lib/ginit-trust';
import { fetchProfilePhotoHistory, type ProfilePhotoHistoryItem } from '@/src/lib/profile-photo-history';
import { pushProfileOpenRegisterInfo } from '@/src/lib/profile-register-info';
import { socialDmRoomId } from '@/src/lib/social-chat-rooms';
import {
  ensureUserProfile,
  getUserProfile,
  isUserProfileWithdrawn,
  meetingDemographicsIncomplete,
  WITHDRAWN_NICKNAME,
  type UserProfile,
} from '@/src/lib/user-profile';

function nicknameInitial(nickname: string): string {
  const t = nickname.trim();
  return t ? t.slice(0, 1) : '?';
}

function safeText(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function rgbaFromRgbString(rgb: string, alpha: number): string {
  const m = rgb.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
  if (!m) return `rgba(255, 138, 0, ${alpha})`;
  return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${alpha})`;
}

export function UserProfilePublicBody({
  targetUserId,
  layout,
  onPressMyAvatar,
  hideMyEditCta,
}: {
  targetUserId: string;
  layout: 'tab' | 'stack';
  onPressMyAvatar?: () => void;
  hideMyEditCta?: boolean;
}) {
  const router = useRouter();
  const { userId } = useUserSession();

  const meNorm = userId?.trim() ? normalizeParticipantId(userId.trim()) : '';
  const targetNorm = targetUserId.trim() ? normalizeParticipantId(targetUserId.trim()) : '';
  const isMe = Boolean(meNorm && targetNorm && meNorm === targetNorm);
  const isAi = targetNorm === 'ginit_ai';

  const [profile, setProfile] = useState<UserProfile | null | undefined>(undefined);
  const [history, setHistory] = useState<ProfilePhotoHistoryItem[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  const [photoViewerUrl, setPhotoViewerUrl] = useState<string | null>(null);
  const [friendRelation, setFriendRelation] = useState<FriendRelationStatusRow>({ status: 'none', friendship_id: null });
  const [friendBusy, setFriendBusy] = useState(false);
  const friendFetchGenRef = useRef(0);
  const peerRelationCacheRef = useRef<Map<string, FriendRelationStatusRow>>(new Map());

  useEffect(() => {
    if (!targetNorm) {
      setProfile(null);
      return;
    }
    let alive = true;
    setProfile(undefined);
    void getUserProfile(targetNorm).then((p) => {
      if (!alive) return;
      setProfile(p ?? null);
    });
    return () => {
      alive = false;
    };
  }, [targetNorm]);

  useEffect(() => {
    let cancelled = false;
    setHistory([]);
    setHistoryLoaded(false);
    if (!targetNorm) return;
    void fetchProfilePhotoHistory(targetNorm, 30)
      .then((rows) => {
        if (cancelled) return;
        setHistory(rows);
      })
      .catch(() => {
        /* noop */
      })
      .finally(() => {
        if (!cancelled) setHistoryLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [targetNorm]);

  useEffect(() => {
    if (!meNorm) {
      peerRelationCacheRef.current.clear();
      setFriendRelation({ status: 'none', friendship_id: null });
    }
  }, [meNorm]);

  useEffect(() => {
    const me = meNorm;
    const peer = targetNorm;
    if (!me || !peer || me === peer || isAi) return;
    friendFetchGenRef.current += 1;
    const snapshot = friendFetchGenRef.current;
    let alive = true;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const cached = peerRelationCacheRef.current.get(peer);
    if (cached?.status === 'pending_out' || cached?.status === 'pending_in' || cached?.status === 'accepted') {
      setFriendRelation(cached);
    }

    void fetchFriendRelationStatus(me, peer)
      .then((gr) => {
        if (!alive) return;
        if (snapshot !== friendFetchGenRef.current) return;

        const prevCached = peerRelationCacheRef.current.get(peer);
        if (gr.status === 'pending_out' || gr.status === 'pending_in' || gr.status === 'accepted') {
          peerRelationCacheRef.current.set(peer, gr);
          setFriendRelation(gr);
          return;
        }
        if (gr.status === 'none' && (prevCached?.status === 'pending_out' || prevCached?.status === 'pending_in')) {
          setFriendRelation(prevCached);
          const genAtRetry = friendFetchGenRef.current;
          retryTimer = setTimeout(() => {
            if (!alive || friendFetchGenRef.current !== genAtRetry) return;
            void fetchFriendRelationStatus(me, peer)
              .then((gr2) => {
                if (!alive || friendFetchGenRef.current !== genAtRetry) return;
                if (gr2.status === 'pending_out' || gr2.status === 'pending_in' || gr2.status === 'accepted') {
                  peerRelationCacheRef.current.set(peer, gr2);
                  setFriendRelation(gr2);
                } else {
                  peerRelationCacheRef.current.delete(peer);
                  setFriendRelation(gr2);
                }
              })
              .catch(() => {});
          }, 900);
          return;
        }
        peerRelationCacheRef.current.delete(peer);
        setFriendRelation(gr);
      })
      .catch(() => {
        if (!alive) return;
        if (snapshot !== friendFetchGenRef.current) return;
        const fallback = peerRelationCacheRef.current.get(peer);
        if (fallback?.status === 'pending_out' || fallback?.status === 'pending_in' || fallback?.status === 'accepted') {
          setFriendRelation(fallback);
        } else {
          setFriendRelation({ status: 'none', friendship_id: null });
        }
      });

    return () => {
      alive = false;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [isAi, meNorm, targetNorm]);

  const withdrawn = isUserProfileWithdrawn(profile ?? undefined);
  const nick = withdrawn ? WITHDRAWN_NICKNAME : (profile?.nickname?.trim() ?? '회원');
  const photo = withdrawn ? '' : (profile?.photoUrl?.trim() ?? '');
  const bio = withdrawn ? '' : (profile?.bio?.trim() ?? '');
  const trust = effectiveGTrust(profile);
  const ringBase = useMemo(() => levelBarFillColorForTrust(trust), [trust]);
  const trustTier = useMemo(() => trustTierForUser(profile), [profile]);
  const gLevel = typeof profile?.gLevel === 'number' && Number.isFinite(profile.gLevel) ? Math.max(1, Math.trunc(profile.gLevel)) : 1;
  const gXp = typeof profile?.gXp === 'number' && Number.isFinite(profile.gXp) ? Math.max(0, Math.trunc(profile.gXp)) : 0;
  const xpBar = useMemo(() => xpProgressWithinLevel({ nickname: '', photoUrl: null, gLevel, gXp } as UserProfile), [gLevel, gXp]);

  const showProgress = isMe;
  const showCta = !withdrawn && !isAi;

  const cta = useMemo(() => {
    if (!showCta) return null;
    if (isMe) {
      if (hideMyEditCta) return null;
      return { label: '프로필 편집', kind: 'edit' as const, icon: 'account-edit-outline' as SymbolicIconName };
    }
    if (friendRelation.status === 'accepted')
      return { label: '1:1 채팅 하기', kind: 'chat' as const, icon: 'chatbubbles-outline' as SymbolicIconName };
    if (friendRelation.status === 'pending_in')
      return { label: '친구 요청 수락', kind: 'accept' as const, icon: 'checkmark-done' as SymbolicIconName };
    if (friendRelation.status === 'pending_out')
      return { label: '친구 신청 중', kind: 'pending' as const, icon: 'time' as SymbolicIconName };
    return { label: '친구 신청하기', kind: 'request' as const, icon: 'person-add' as SymbolicIconName };
  }, [friendRelation.status, hideMyEditCta, isMe, showCta]);

  const onPressAvatar = useCallback(() => {
    if (withdrawn) return;
    if (isMe) {
      onPressMyAvatar?.();
      return;
    }
    if (photo) setPhotoViewerUrl(photo);
  }, [isMe, onPressMyAvatar, photo, withdrawn]);

  const onPressCta = useCallback(async () => {
    if (!cta) return;
    if (cta.kind === 'pending') return;
    if (cta.kind === 'edit') {
      router.push('/profile/edit');
      return;
    }

    const me = meNorm;
    const peer = targetNorm;
    if (!me || !peer) return;

    if (cta.kind === 'chat') {
      const rid = socialDmRoomId(me, peer);
      router.push(`/social-chat/${encodeURIComponent(rid)}?peerName=${encodeURIComponent(nick)}`);
      return;
    }

    if (friendBusy) return;
    setFriendBusy(true);
    try {
      await ensureUserProfile(me);
      const profGate = await getUserProfile(me);
      if (meetingDemographicsIncomplete(profGate, me)) {
        Alert.alert(
          '프로필을 먼저 완성해 주세요',
          '친구 요청은 모임을 위한 사용자 정보 등록(성별·연령대) 완료 후 보낼 수 있어요.',
          [
            { text: '닫기', style: 'cancel' },
            { text: '정보 등록하기', onPress: () => pushProfileOpenRegisterInfo(router) },
          ],
        );
        return;
      }

      if (cta.kind === 'accept') {
        const fid = friendRelation.friendship_id?.trim() ?? '';
        if (!fid) return;
        await acceptGinitRequest(me, fid);
        friendFetchGenRef.current += 1;
        const next = await fetchFriendRelationStatus(me, peer).catch(() => null);
        if (next) {
          if (next.status === 'accepted') peerRelationCacheRef.current.set(peer, next);
          else peerRelationCacheRef.current.delete(peer);
          setFriendRelation(next);
        }
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        const rid = socialDmRoomId(me, peer);
        router.push(`/social-chat/${encodeURIComponent(rid)}?peerName=${encodeURIComponent(nick)}`);
        return;
      }

      const pre = await fetchFriendRelationStatus(me, peer).catch(() => null);
      if (pre?.status === 'pending_out' || pre?.status === 'accepted') {
        friendFetchGenRef.current += 1;
        peerRelationCacheRef.current.set(peer, pre);
        setFriendRelation(pre);
        return;
      }
      const returnedId = (await sendGinitRequest(me, peer)).trim();
      const next = await fetchFriendRelationStatus(me, peer).catch(() => null);
      const resolved: FriendRelationStatusRow =
        next && (next.status === 'pending_out' || next.status === 'pending_in' || next.status === 'accepted')
          ? next
          : returnedId
            ? {
                status: 'pending_out',
                friendship_id: returnedId,
                requester_app_user_id: me,
                addressee_app_user_id: peer,
              }
            : (next ?? { status: 'none', friendship_id: null });
      friendFetchGenRef.current += 1;
      if (resolved.status === 'pending_out' || resolved.status === 'pending_in' || resolved.status === 'accepted') {
        peerRelationCacheRef.current.set(peer, resolved);
      }
      setFriendRelation(resolved);

      void getUserProfile(me)
        .then((p) =>
          notifyFriendRequestReceivedFireAndForget({
            addresseeAppUserId: peer,
            requesterAppUserId: me,
            requesterDisplayName: p?.nickname ?? undefined,
          }),
        )
        .catch(() =>
          notifyFriendRequestReceivedFireAndForget({
            addresseeAppUserId: peer,
            requesterAppUserId: me,
          }),
        );
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      Alert.alert('처리 실패', e instanceof Error ? e.message : safeText(e));
    } finally {
      setFriendBusy(false);
    }
  }, [cta, friendBusy, friendRelation.friendship_id, meNorm, nick, router, targetNorm]);

  const bioText = useMemo(() => {
    if (withdrawn) return '';
    if (bio.trim()) return bio.trim();
    if (isMe) return '아직 소개글이 없어요 프로필 편집에서 변경 가능해요.';
    return '아직 소개글이 없어요.';
  }, [bio, isMe, withdrawn]);

  const isLoading = profile === undefined;
  const padTop = layout === 'tab' ? 10 : 14;
  const padH = layout === 'tab' ? 0 : 20;

  const ringPulse = useRef(new Animated.Value(0)).current;
  const ringSpin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (Platform.OS === 'web') return;
    ringPulse.setValue(0);
    ringSpin.setValue(0);
    const loop = Animated.loop(
      Animated.parallel([
        Animated.timing(ringSpin, {
          toValue: 1,
          duration: 5200,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.timing(ringPulse, {
            toValue: 1,
            duration: 1800,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(ringPulse, {
            toValue: 0,
            duration: 1800,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      ]),
      { resetBeforeIteration: true },
    );
    loop.start();
    return () => loop.stop();
  }, [ringPulse, ringSpin]);
  const ringOpacity = ringPulse.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] });
  const ringRotate = ringSpin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  

  return (
    <View style={[styles.root, { paddingTop: padTop, paddingHorizontal: padH }]}>
      <View style={styles.hero}>
        <Pressable
          onPress={onPressAvatar}
          disabled={withdrawn || (isMe && !onPressMyAvatar) || (!isMe && !photo)}
          style={({ pressed }) => [styles.heroAvatarPress, pressed && { opacity: 0.9 }]}
          accessibilityRole="button"
          accessibilityLabel={isMe ? '내 프로필 사진' : '프로필 사진'}>
          <View style={styles.heroRingOuter}>
            {Platform.OS === 'web' ? (
              <View style={[styles.heroRingStatic, { borderColor: rgbaFromRgbString(ringBase, 0.85) }]} />
            ) : (
              <Animated.View style={[styles.heroRingAnim, { opacity: ringOpacity, transform: [{ rotate: ringRotate }] }]}>
                <LinearGradient
                  colors={[
                    rgbaFromRgbString(ringBase, 0.92),
                    'rgba(255,255,255,0.14)',
                    rgbaFromRgbString(ringBase, 0.80),
                  ]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.heroRingGradient}
                />
              </Animated.View>
            )}
            <View style={styles.heroAvatarWrap}>
              {photo ? (
                <Image source={{ uri: photo }} style={styles.heroAvatar} contentFit="cover" />
              ) : (
                <View style={styles.heroFallback}>
                  <Text style={styles.heroFallbackText}>{nicknameInitial(nick)}</Text>
                </View>
              )}
              {isLoading ? (
                <View style={styles.heroLoadingOverlay} pointerEvents="none">
                  <ActivityIndicator color="#fff" />
                </View>
              ) : null}
            </View>
          </View>
        </Pressable>

        <Text style={styles.heroName} numberOfLines={1}>
          {nick}
        </Text>
        <Text style={styles.heroBio} numberOfLines={3}>
          {isLoading ? '프로필 불러오는 중…' : bioText}
        </Text>
      </View>

      <View style={styles.metricsRow}>
        <View style={styles.metricCell}>
          <Text style={styles.metricValue}>{trust}</Text>
          <Text style={styles.metricLabel}>신뢰도</Text>
        </View>
        <View style={styles.metricDivider} />
        <View style={styles.metricCell}>
          <Text style={styles.metricValue}>{trustTier.label}</Text>
          <Text style={styles.metricLabel}>등급</Text>
        </View>
        <View style={styles.metricDivider} />
        <View style={styles.metricCell}>
          <Text style={styles.metricValue}>Lv {gLevel}</Text>
          <Text style={styles.metricLabel}>레벨</Text>
        </View>
      </View>

      {showProgress ? (
        <View style={styles.levelBarWrap} accessibilityRole="text">
          <View style={styles.levelBarTrack}>
            <View style={[styles.levelBarFill, { width: `${Math.round(xpBar.ratio * 100)}%`, backgroundColor: '#334155' }]} />
          </View>
          <Text style={styles.levelBarMeta}>
            XP {gXp} / {xpBar.nextAt}
          </Text>
        </View>
      ) : null}

      {cta ? (
        <Pressable
          onPress={() => void onPressCta()}
          disabled={friendBusy || cta.kind === 'pending'}
          style={({ pressed }) => [
            styles.ctaBtn,
            (friendBusy || cta.kind === 'pending') && { opacity: 0.6 },
            pressed && !(friendBusy || cta.kind === 'pending') && { opacity: 0.9 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={cta.label}>
          {friendBusy ? <ActivityIndicator size="small" color="#fff" /> : <GinitSymbolicIcon name={cta.icon} size={18} color="#fff" />}
          <Text style={styles.ctaText} numberOfLines={1}>
            {cta.label}
          </Text>
        </Pressable>
      ) : null}

      <View style={styles.grid}>
        {history.map((h, i) => {
          const url = h.photoUrl.trim();
          if (!url) return null;
          const isEndOfRow = (i + 1) % 2 === 0;
          return (
            <Pressable
              key={`${url}-${h.createdAt}-${i}`}
              onPress={() => setPhotoViewerUrl(url)}
              style={({ pressed }) => [styles.gridCell, pressed && { opacity: 0.9 }, isEndOfRow && { marginRight: 0 }]}
              accessibilityRole="button"
              accessibilityLabel="프로필 사진 크게 보기">
              <Image source={{ uri: url }} style={styles.gridThumb} contentFit="cover" />
            </Pressable>
          );
        })}
      </View>

      <Modal visible={photoViewerUrl != null} transparent animationType="fade" onRequestClose={() => setPhotoViewerUrl(null)}>
        <View style={styles.viewerRoot}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setPhotoViewerUrl(null)} accessibilityRole="button" accessibilityLabel="닫기" />
          <View style={styles.viewerCard}>
            <Pressable
              onPress={() => setPhotoViewerUrl(null)}
              style={({ pressed }) => [styles.viewerCloseBtn, pressed && { opacity: 0.9 }]}
              accessibilityRole="button"
              accessibilityLabel="닫기">
              <GinitSymbolicIcon name="close" size={20} color="#fff" />
            </Pressable>
            {photoViewerUrl ? <MeetingChatImageViewerZoomArea uri={photoViewerUrl} /> : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    paddingBottom: 28,
  },
  hero: {
    alignItems: 'center',
    paddingTop: 6,
    paddingBottom: 16,
  },
  heroAvatarPress: {},
  heroRingOuter: {
    width: 104,
    height: 104,
    borderRadius: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroRingStatic: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 52,
    borderWidth: 3,
  },
  heroRingAnim: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 52,
  },
  heroRingGradient: {
    flex: 1,
    borderRadius: 52,
    padding: 2,
  },
  heroAvatarWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    overflow: 'hidden',
    backgroundColor: 'rgba(15, 23, 42, 0.06)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.10)',
  },
  heroAvatar: { width: '100%', height: '100%' },
  heroFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  heroFallbackText: { fontSize: 34, fontWeight: '700', color: '#0f172a' },
  heroLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.22)',
  },
  heroName: { marginTop: 12, fontSize: 20, fontWeight: '800', color: '#0f172a', letterSpacing: -0.2 },
  heroBio: { marginTop: 8, fontSize: 13, fontWeight: '600', color: '#64748b', textAlign: 'center', lineHeight: 18 },

  metricsRow: {
    flexDirection: 'row',
    borderWidth: 0,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#fff',
  },
  metricCell: { flex: 1, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  metricValue: { fontSize: 16, fontWeight: '800', color: '#0f172a' },
  metricLabel: { marginTop: 4, fontSize: 12, fontWeight: '700', color: '#64748b' },
  metricDivider: { width: 0, backgroundColor: 'transparent' },

  levelBarWrap: { marginTop: 12 },
  levelBarTrack: {
    height: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(15, 23, 42, 0.28)',
    overflow: 'hidden',
  },
  levelBarFill: { height: '100%', borderRadius: 8 },
  levelBarMeta: { marginTop: 6, fontSize: 12, fontWeight: '700', color: '#64748b', textAlign: 'right' },

  ctaBtn: {
    marginTop: 16,
    marginBottom: 6,
    height: 58,
    borderRadius: 14,
    backgroundColor: GinitTheme.themeMainColor,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  ctaText: { fontSize: 15, fontWeight: '800', color: '#fff', letterSpacing: -0.1 },

  grid: { marginTop: 18, flexDirection: 'row', flexWrap: 'wrap' },
  gridCell: {
    width: '49.4%',
    aspectRatio: 1.5,
    marginRight: '1.2%',
    marginBottom: '1.2%',
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: 'rgba(15, 23, 42, 0.06)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
  },
  gridThumb: { width: '100%', height: '100%' },

  viewerRoot: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.8)', padding: 14, justifyContent: 'center' },
  viewerCard: {
    width: '100%',
    height: '80%',
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  viewerCloseBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
    zIndex: 5,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
  },
});

