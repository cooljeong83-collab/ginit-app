import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Easing, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  MeetingChatImageViewerGallery,
  type ImageViewerGalleryItem,
} from '@/components/chat/MeetingChatImageViewerGallery';
import { meetingChatBodyStyles } from '@/components/chat/meeting-chat-body-styles';
import { ProfileSquareAvatar } from '@/components/profile/ProfileSquareAvatar';
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
import {
  avatarsObjectPathFromPublicUrlIfOwned,
  deleteProfilePhotoHistoryUrl,
  fetchProfilePhotoHistory,
  isProfilePhotoDeleteDebugEnabled,
  type ProfilePhotoHistoryItem,
} from '@/src/lib/profile-photo-history';
import { PROFILE_META_PHOTO_COVER, parseProfilePhotoCover } from '@/src/lib/profile-photo-cover';
import { pushProfileOpenRegisterInfo } from '@/src/lib/profile-register-info';
import { socialDmRoomId } from '@/src/lib/social-chat-rooms';
import {
  ensureUserProfile,
  getUserProfile,
  isUserProfileWithdrawn,
  meetingDemographicsIncomplete,
  updateUserProfile,
  WITHDRAWN_NICKNAME,
  type UserProfile,
} from '@/src/lib/user-profile';

/** `avatars` 버킷에 앱이 올린 본인 폴더 경로의 공개 URL인지 (가입 시 외부 프로필 사진 URL 제외) */
function isAvatarsStorageUploadedByUser(photoUrl: string, ownerAppUserId: string): boolean {
  return avatarsObjectPathFromPublicUrlIfOwned(photoUrl, ownerAppUserId) != null;
}

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
  const insets = useSafeAreaInsets();
  const { userId } = useUserSession();

  const meRaw = userId?.trim() ?? '';
  const meNorm = meRaw ? normalizeParticipantId(meRaw) : '';
  const targetNorm = targetUserId.trim() ? normalizeParticipantId(targetUserId.trim()) : '';
  const isMe = Boolean(meNorm && targetNorm && meNorm === targetNorm);
  const isAi = targetNorm === 'ginit_ai';

  const [profile, setProfile] = useState<UserProfile | null | undefined>(undefined);
  const [history, setHistory] = useState<ProfilePhotoHistoryItem[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  const [profileImageViewer, setProfileImageViewer] = useState<{ index: number } | null>(null);
  const [profilePhotoDeleteBusy, setProfilePhotoDeleteBusy] = useState(false);
  const [friendRelation, setFriendRelation] = useState<FriendRelationStatusRow>({ status: 'none', friendship_id: null });
  /** `targetNorm`과 같을 때만 관계 기반 CTA(친구 신청 등)를 그린다 — 조회 전 `none`으로 잘못 노출되지 않게 함 */
  const [friendRelResolvedForPeer, setFriendRelResolvedForPeer] = useState<string | null>(null);
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
      setFriendRelResolvedForPeer(null);
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
      setFriendRelResolvedForPeer(peer);
    } else {
      setFriendRelResolvedForPeer(null);
    }

    const markResolved = () => {
      if (!alive || snapshot !== friendFetchGenRef.current) return;
      setFriendRelResolvedForPeer(peer);
    };

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
              .catch(() => {})
              .finally(() => {
                if (!alive || friendFetchGenRef.current !== genAtRetry) return;
                setFriendRelResolvedForPeer(peer);
              });
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
      })
      .finally(markResolved);

    return () => {
      alive = false;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [isAi, meNorm, targetNorm]);

  const withdrawn = isUserProfileWithdrawn(profile ?? undefined);
  const nick = withdrawn ? WITHDRAWN_NICKNAME : (profile?.nickname?.trim() ?? '회원');
  const photo = withdrawn ? '' : (profile?.photoUrl?.trim() ?? '');
  const photoCover = useMemo(() => parseProfilePhotoCover(profile?.metadata), [profile?.metadata]);
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
    if (friendRelResolvedForPeer !== targetNorm) return null;
    if (friendRelation.status === 'accepted')
      return { label: '1:1 채팅 하기', kind: 'chat' as const, icon: 'chatbubbles-outline' as SymbolicIconName };
    if (friendRelation.status === 'pending_in')
      return { label: '친구 요청 수락', kind: 'accept' as const, icon: 'checkmark-done' as SymbolicIconName };
    if (friendRelation.status === 'pending_out')
      return { label: '친구 신청 중', kind: 'pending' as const, icon: 'time' as SymbolicIconName };
    return { label: '친구 신청하기', kind: 'request' as const, icon: 'person-add' as SymbolicIconName };
  }, [friendRelResolvedForPeer, friendRelation.status, hideMyEditCta, isMe, showCta, targetNorm]);

  const profileImageGallery = useMemo<ImageViewerGalleryItem[]>(() => {
    const owner = targetNorm.trim();
    if (!owner) return [];
    const seen = new Set<string>();
    const out: ImageViewerGalleryItem[] = [];
    const push = (id: string, url: string) => {
      const u = url.trim();
      if (!u || seen.has(u)) return;
      if (!isAvatarsStorageUploadedByUser(u, owner)) return;
      seen.add(u);
      out.push({ id, imageUrl: u });
    };
    if (photo) push('current', photo);
    for (let i = 0; i < history.length; i++) {
      push(`h-${i}-${history[i]!.createdAt}`, history[i]!.photoUrl);
    }
    return out;
  }, [history, photo, targetNorm]);

  const openProfileImageAtUrl = useCallback(
    (url: string) => {
      const u = url.trim();
      if (!u) return;
      const ix = profileImageGallery.findIndex((g) => (g.imageUrl ?? '').trim() === u);
      setProfileImageViewer({ index: ix >= 0 ? ix : 0 });
    },
    [profileImageGallery],
  );

  const onProfileViewerIndexChange = useCallback((i: number) => {
    setProfileImageViewer((prev) => (prev ? { index: i } : prev));
  }, []);

  useEffect(() => {
    if (!profileImageViewer) return;
    const n = profileImageGallery.length;
    if (n <= 0) {
      setProfileImageViewer(null);
      return;
    }
    const clamped = Math.min(n - 1, Math.max(0, profileImageViewer.index));
    if (clamped !== profileImageViewer.index) {
      setProfileImageViewer({ index: clamped });
    }
  }, [profileImageGallery, profileImageViewer]);

  const profileImageViewerSafeIndex =
    profileImageViewer != null && profileImageGallery.length > 0
      ? Math.min(profileImageGallery.length - 1, Math.max(0, profileImageViewer.index))
      : 0;

  const profileViewerSlideUrl =
    profileImageViewer != null && profileImageGallery.length > 0
      ? (profileImageGallery[profileImageViewerSafeIndex]?.imageUrl ?? '').trim()
      : '';

  const showProfileViewerDelete =
    isMe &&
    profileImageViewer != null &&
    profileViewerSlideUrl.length > 0 &&
    isAvatarsStorageUploadedByUser(profileViewerSlideUrl, targetNorm);

  const onConfirmDeleteProfilePhotoAtViewer = useCallback(() => {
    const me = targetNorm;
    if (!isMe || !me.trim() || !profileImageViewer || profileImageGallery.length <= 0) return;
    const delIx = Math.min(profileImageGallery.length - 1, Math.max(0, profileImageViewer.index));
    const viewingUrl = (profileImageGallery[delIx]?.imageUrl ?? '').trim();
    if (!viewingUrl) return;
    if (!isAvatarsStorageUploadedByUser(viewingUrl, me)) {
      Alert.alert('삭제 불가', 'Supabase에 올린 사진만 여기서 삭제할 수 있어요.');
      return;
    }
    const isCurrent = viewingUrl === photo.trim();
    Alert.alert(
      isCurrent ? '프로필 사진 삭제' : '과거 사진 삭제',
      isCurrent ? '현재 프로필 사진을 삭제할까요?' : '목록에서 이 사진을 삭제할까요?',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setProfilePhotoDeleteBusy(true);
              try {
                const delRes = await deleteProfilePhotoHistoryUrl(me, viewingUrl);
                if (delRes.ok === false) {
                  if (!('skipped' in delRes && delRes.skipped) && 'message' in delRes) {
                    const detail = [
                      delRes.message,
                      delRes.code ? `code: ${delRes.code}` : '',
                      delRes.details ? `details: ${delRes.details}` : '',
                      delRes.hint ? `hint: ${delRes.hint}` : '',
                    ]
                      .filter(Boolean)
                      .join('\n');
                    Alert.alert(
                      '삭제 실패',
                      isProfilePhotoDeleteDebugEnabled()
                        ? detail
                        : '사진 파일 또는 이력 삭제에 실패했습니다. 잠시 후 다시 시도해 주세요.',
                    );
                  }
                  return;
                }

                setHistory((prev) => prev.filter((h) => h.photoUrl.trim() !== viewingUrl));

                if (isCurrent) {
                  await updateUserProfile(me, {
                    photoUrl: null,
                    metadata: { [PROFILE_META_PHOTO_COVER]: null },
                  });
                  setProfile((prev) =>
                    prev
                      ? { ...prev, photoUrl: null, metadata: { ...(prev.metadata ?? {}), [PROFILE_META_PHOTO_COVER]: null } }
                      : prev,
                  );
                  setProfileImageViewer(null);
                } else {
                  const newLen = profileImageGallery.length - 1;
                  if (newLen <= 0) {
                    setProfileImageViewer(null);
                  } else {
                    const nextIx = delIx >= newLen ? Math.max(0, newLen - 1) : delIx;
                    setProfileImageViewer({ index: Math.min(nextIx, newLen - 1) });
                  }
                }

                void fetchProfilePhotoHistory(targetNorm, 30)
                  .then((rows) => setHistory(rows))
                  .catch(() => {});
                void getUserProfile(targetNorm)
                  .then((p) => setProfile(p ?? null))
                  .catch(() => {});
                if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              } catch (e) {
                Alert.alert('삭제 실패', e instanceof Error ? e.message : '프로필 사진을 삭제하지 못했습니다.');
              } finally {
                setProfilePhotoDeleteBusy(false);
              }
            })();
          },
        },
      ],
    );
  }, [isMe, photo, profileImageGallery, profileImageViewer, targetNorm]);

  const onPressAvatar = useCallback(() => {
    if (withdrawn) return;
    if (isMe) {
      if (onPressMyAvatar) {
        onPressMyAvatar();
        return;
      }
      if (photo) openProfileImageAtUrl(photo);
      return;
    }
    if (photo) openProfileImageAtUrl(photo);
  }, [isMe, onPressMyAvatar, openProfileImageAtUrl, photo, withdrawn]);

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
    <View style={{ paddingTop: padTop, paddingHorizontal: padH, paddingBottom: padH }}>
      <View style={styles.hero}>
        <Pressable
          onPress={onPressAvatar}
          disabled={withdrawn || (isMe && !onPressMyAvatar && !photo) || (!isMe && !photo)}
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
                <ProfileSquareAvatar uri={photo} size={96} borderRadius={48} cover={photoCover} />
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
        {history.filter((h) => isAvatarsStorageUploadedByUser(h.photoUrl, targetNorm)).map((h, i) => {
          const url = h.photoUrl.trim();
          if (!url) return null;
          const isEndOfRow = (i + 1) % 2 === 0;
          return (
            <Pressable
              key={`${url}-${h.createdAt}-${i}`}
              onPress={() => openProfileImageAtUrl(url)}
              style={({ pressed }) => [styles.gridCell, pressed && { opacity: 0.9 }, isEndOfRow && { marginRight: 0 }]}
              accessibilityRole="button"
              accessibilityLabel="프로필 사진 크게 보기">
              <Image source={{ uri: url }} style={styles.gridThumb} contentFit="cover" />
            </Pressable>
          );
        })}
      </View>

      <Modal
        visible={profileImageViewer !== null && profileImageGallery.length > 0}
        transparent
        animationType="fade"
        onRequestClose={() => setProfileImageViewer(null)}>
        <GestureHandlerRootView style={meetingChatBodyStyles.viewerRoot}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => !profilePhotoDeleteBusy && setProfileImageViewer(null)}
            pointerEvents="none"
            accessibilityRole="button"
            accessibilityLabel="닫기"
          />
          <View style={meetingChatBodyStyles.viewerSheet} pointerEvents="box-none">
            <View style={[meetingChatBodyStyles.viewerTopRow, { paddingTop: insets.top + 8 }]}>
              <Pressable
                onPress={() => setProfileImageViewer(null)}
                hitSlop={10}
                disabled={profilePhotoDeleteBusy}
                accessibilityRole="button"
                accessibilityLabel="닫기">
                <GinitSymbolicIcon name="close" size={26} color="#fff" />
              </Pressable>
              <View style={meetingChatBodyStyles.viewerMetaCol} pointerEvents="none">
                <Text style={meetingChatBodyStyles.viewerMetaName} numberOfLines={1}>
                  프로필 사진
                </Text>
                {profileImageGallery.length > 1 && profileImageViewer ? (
                  <Text style={meetingChatBodyStyles.viewerMetaTime} numberOfLines={1}>
                    {profileImageViewerSafeIndex + 1} / {profileImageGallery.length}
                  </Text>
                ) : null}
              </View>
              <View style={meetingChatBodyStyles.viewerActions}>
                {showProfileViewerDelete ? (
                  <Pressable
                    onPress={() => {
                      if (profilePhotoDeleteBusy) return;
                      onConfirmDeleteProfilePhotoAtViewer();
                    }}
                    hitSlop={10}
                    disabled={profilePhotoDeleteBusy}
                    accessibilityRole="button"
                    accessibilityLabel="프로필 사진 삭제">
                    {profilePhotoDeleteBusy ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <GinitSymbolicIcon name="trash-outline" size={24} color="#fff" />
                    )}
                  </Pressable>
                ) : (
                  <View style={{ width: 26 }} />
                )}
              </View>
            </View>
            {profileImageViewer ? (
              <View style={meetingChatBodyStyles.viewerImageWrap}>
                <MeetingChatImageViewerGallery
                  gallery={profileImageGallery}
                  initialIndex={Math.min(
                    profileImageGallery.length - 1,
                    Math.max(0, profileImageViewer.index),
                  )}
                  onIndexChange={onProfileViewerIndexChange}
                />
              </View>
            ) : null}
          </View>
        </GestureHandlerRootView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
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
    width: '50%',
    aspectRatio: 1,
    marginRight: 0,
    marginBottom: 0,
    borderRadius: 0,
    overflow: 'hidden',
    backgroundColor: 'rgba(15, 23, 42, 0.06)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
  },
  gridThumb: { width: '100%', height: '100%' },
});

