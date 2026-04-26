import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { showTransientBottomMessage } from '@/components/ui/TransientBottomMessage';
import { GinitTheme } from '@/constants/ginit-theme';
import { useUserSession } from '@/src/context/UserSessionContext';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import {
  acceptGinitRequest,
  fetchFriendRelationStatus,
  sendGinitRequest,
  type FriendRelationStatusRow,
} from '@/src/lib/friends';
import { notifyFriendRequestReceivedFireAndForget } from '@/src/lib/friend-push-notify';
import { pushProfileOpenRegisterInfo } from '@/src/lib/profile-register-info';
import { socialDmRoomId } from '@/src/lib/social-chat-rooms';
import {
  WITHDRAWN_NICKNAME,
  ensureUserProfile,
  getUserProfile,
  isUserProfileWithdrawn,
  meetingDemographicsIncomplete,
  type UserProfile,
} from '@/src/lib/user-profile';

function nicknameInitial(nickname: string): string {
  const t = nickname.trim();
  return t ? t.slice(0, 1) : '?';
}

export type MeetingPeerProfileModalProps = {
  visible: boolean;
  peerAppUserId: string | null;
  onClose: () => void;
};

/**
 * 모임 채팅 등에서 참여자 프로필 확인 + 지닛(친구) 요청·수락.
 * 모임 상세의 참여자 프로필 모달과 동일한 동작을 유지합니다.
 */
export function MeetingPeerProfileModal({ visible, peerAppUserId, onClose }: MeetingPeerProfileModalProps) {
  const router = useRouter();
  const { userId } = useUserSession();
  const [profile, setProfile] = useState<UserProfile | null | undefined>(undefined);
  const [friendRelation, setFriendRelation] = useState<FriendRelationStatusRow>({
    status: 'none',
    friendship_id: null,
  });
  const [friendRequestBusy, setFriendRequestBusy] = useState(false);
  /** `fetchFriendRelationStatus` 응답 레이스 방지 — 요청 직후 증가시켜 이전 in-flight 무시 */
  const friendsRelationFetchGenRef = useRef(0);
  /** 모달이 닫혀 peer 가 비어도 유지 — 재오픈 시 '신청 중' 등 즉시 복원 */
  const peerRelationCacheRef = useRef<Map<string, FriendRelationStatusRow>>(new Map());

  const peerNorm = peerAppUserId?.trim() ? normalizeParticipantId(peerAppUserId.trim()) : '';

  useEffect(() => {
    if (!visible || !peerNorm) {
      setProfile(undefined);
      return;
    }
    let alive = true;
    setProfile(undefined);
    void getUserProfile(peerNorm).then((p) => {
      if (!alive) return;
      setProfile(p ?? null);
    });
    return () => {
      alive = false;
    };
  }, [visible, peerNorm]);

  useEffect(() => {
    if (!userId?.trim()) {
      peerRelationCacheRef.current.clear();
      setFriendRelation({ status: 'none', friendship_id: null });
    }
  }, [userId]);

  useEffect(() => {
    const me = userId?.trim() ?? '';
    const peer = peerNorm;
    if (!me || !peer) {
      return;
    }
    if (normalizeParticipantId(me) === peer) {
      setFriendRelation({ status: 'none', friendship_id: null });
      return;
    }
    if (!visible) {
      return;
    }

    const cached = peerRelationCacheRef.current.get(peer);
    if (cached?.status === 'pending_out' || cached?.status === 'pending_in' || cached?.status === 'accepted') {
      setFriendRelation(cached);
    }

    friendsRelationFetchGenRef.current += 1;
    const snapshot = friendsRelationFetchGenRef.current;
    let alive = true;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    void fetchFriendRelationStatus(me, peer)
      .then((gr) => {
        if (!alive) return;
        if (snapshot !== friendsRelationFetchGenRef.current) return;

        const prevCached = peerRelationCacheRef.current.get(peer);

        if (gr.status === 'pending_out' || gr.status === 'pending_in' || gr.status === 'accepted') {
          peerRelationCacheRef.current.set(peer, gr);
          setFriendRelation(gr);
          return;
        }

        // RPC/복제 지연으로 잠깐 `none`만 오는 경우: 캐시의 보낸 요청·수신 대기는 유지하고 잠시 뒤 한 번 더 확인
        if (
          gr.status === 'none' &&
          (prevCached?.status === 'pending_out' || prevCached?.status === 'pending_in')
        ) {
          setFriendRelation(prevCached);
          const genAtRetry = friendsRelationFetchGenRef.current;
          retryTimer = setTimeout(() => {
            if (!alive || friendsRelationFetchGenRef.current !== genAtRetry) return;
            void fetchFriendRelationStatus(me, peer)
              .then((gr2) => {
                if (!alive || friendsRelationFetchGenRef.current !== genAtRetry) return;
                if (gr2.status === 'pending_out' || gr2.status === 'pending_in' || gr2.status === 'accepted') {
                  peerRelationCacheRef.current.set(peer, gr2);
                  setFriendRelation(gr2);
                } else {
                  peerRelationCacheRef.current.delete(peer);
                  setFriendRelation(gr2);
                }
              })
              .catch(() => {
                if (!alive || friendsRelationFetchGenRef.current !== genAtRetry) return;
              });
          }, 900);
          return;
        }

        peerRelationCacheRef.current.delete(peer);
        setFriendRelation(gr);
      })
      .catch(() => {
        if (!alive) return;
        if (snapshot !== friendsRelationFetchGenRef.current) return;
        const fallback = peerRelationCacheRef.current.get(peer);
        if (fallback?.status === 'pending_out' || fallback?.status === 'pending_in' || fallback?.status === 'accepted') {
          setFriendRelation(fallback);
        } else {
          setFriendRelation({ status: 'none', friendship_id: null });
        }
      });
    return () => {
      alive = false;
      if (retryTimer != null) clearTimeout(retryTimer);
    };
  }, [visible, peerNorm, userId]);

  const onSendFriendGinit = useCallback(async () => {
    const me = userId?.trim() ?? '';
    const peer = peerNorm;
    if (!peer) return;
    if (!me) {
      Alert.alert('로그인이 필요해요', '친구 요청은 로그인 후 보낼 수 있어요.');
      return;
    }
    if (normalizeParticipantId(me) === peer) return;
    setFriendRequestBusy(true);
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
      const pre = await fetchFriendRelationStatus(me, peer).catch(() => null);
      if (pre?.status === 'pending_out' || pre?.status === 'accepted') {
        friendsRelationFetchGenRef.current += 1;
        peerRelationCacheRef.current.set(peer, pre);
        setFriendRelation(pre);
        showTransientBottomMessage(
          pre.status === 'accepted' ? '이미 친구로 연결되어 있어요.' : '이미 친구 요청을 보냈어요.',
        );
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
      friendsRelationFetchGenRef.current += 1;
      if (resolved.status === 'pending_out' || resolved.status === 'pending_in' || resolved.status === 'accepted') {
        peerRelationCacheRef.current.set(peer, resolved);
      }
      setFriendRelation(resolved);
      showTransientBottomMessage('친구 요청을 보냈어요.');
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
    } catch (e) {
      Alert.alert('전송 실패', e instanceof Error ? e.message : String(e));
    } finally {
      setFriendRequestBusy(false);
    }
  }, [peerNorm, router, userId]);

  const onAcceptFriendGinit = useCallback(async () => {
    const me = userId?.trim() ?? '';
    const peer = peerNorm;
    const fid = friendRelation.friendship_id?.trim();
    if (!me || !peer || !fid) return;
    setFriendRequestBusy(true);
    try {
      await ensureUserProfile(me);
      await acceptGinitRequest(me, fid);
      friendsRelationFetchGenRef.current += 1;
      const next = await fetchFriendRelationStatus(me, peer).catch(() => null);
      if (next) {
        if (next.status === 'accepted') {
          peerRelationCacheRef.current.set(peer, next);
        } else {
          peerRelationCacheRef.current.delete(peer);
        }
        setFriendRelation(next);
      }
      const nick = profile?.nickname?.trim() ?? '친구';
      const rid = socialDmRoomId(me, peer);
      showTransientBottomMessage('친구 요청을 수락했어요.');
      onClose();
      router.push(`/social-chat/${encodeURIComponent(rid)}?peerName=${encodeURIComponent(nick)}`);
    } catch (e) {
      Alert.alert('수락 실패', e instanceof Error ? e.message : String(e));
    } finally {
      setFriendRequestBusy(false);
    }
  }, [friendRelation.friendship_id, onClose, peerNorm, profile?.nickname, router, userId]);

  const withdrawn = isUserProfileWithdrawn(profile ?? undefined);
  const isMe = Boolean(userId?.trim() && peerNorm && normalizeParticipantId(userId.trim()) === peerNorm);
  const isAi = peerNorm === 'ginit_ai';

  const nick = withdrawn ? WITHDRAWN_NICKNAME : (profile?.nickname?.trim() ?? '회원');
  const photo = withdrawn ? '' : (profile?.photoUrl?.trim() ?? '');
  const trust = typeof profile?.gTrust === 'number' ? profile.gTrust : null;
  const dna = withdrawn ? '' : (profile?.gDna?.trim() ?? '');
  const gender = withdrawn ? '' : (profile?.gender?.trim() ?? '');
  const ageBand = withdrawn ? '' : (profile?.ageBand?.trim() ?? '');
  const metaParts = [
    trust != null ? `gTrust ${trust}` : 'gTrust —',
    dna ? dna : '',
    [ageBand, gender].filter(Boolean).join(' · '),
  ].filter(Boolean);
  const isLoading = Boolean(peerNorm) && profile === undefined;

  const friendGinitDisabled =
    friendRequestBusy ||
    withdrawn ||
    isMe ||
    isAi ||
    friendRelation.status === 'accepted' ||
    friendRelation.status === 'pending_out';
  const friendLabel =
    friendRelation.status === 'accepted'
      ? '친구'
      : friendRelation.status === 'pending_out'
        ? '친구 신청 중'
        : friendRelation.status === 'pending_in'
          ? '친구 요청 수락'
          : '친구 신청하기';
  const friendIconName: keyof typeof Ionicons.glyphMap =
    friendRelation.status === 'accepted'
      ? 'checkmark-circle'
      : friendRelation.status === 'pending_out'
        ? 'time'
        : friendRelation.status === 'pending_in'
          ? 'checkmark-done'
          : 'person-add';
  const friendInMissingId = friendRelation.status === 'pending_in' && !friendRelation.friendship_id?.trim();

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.profileModalRoot}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} accessibilityRole="button" accessibilityLabel="프로필 닫기" />
        <View style={styles.profileModalCard}>
          <View style={styles.profileModalTop}>
            <View style={styles.profileAvatarWrap}>
              {photo ? (
                <Image source={{ uri: photo }} style={styles.profileAvatarImg} contentFit="cover" />
              ) : (
                <View style={styles.profileAvatarFallback}>
                  <Text style={styles.profileAvatarLetter}>{nicknameInitial(nick)}</Text>
                </View>
              )}
            </View>
            <View style={styles.profileModalTopText}>
              <Text style={styles.profileModalNick} numberOfLines={1}>
                {nick}
              </Text>
              <Text style={styles.profileModalMeta} numberOfLines={2}>
                {isLoading ? '프로필 불러오는 중…' : metaParts.join(' · ')}
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [styles.profileModalCloseBtn, pressed && { opacity: 0.9 }]}
              accessibilityRole="button"
              accessibilityLabel="닫기">
              <Ionicons name="close" size={18} color={GinitTheme.colors.textMuted} />
            </Pressable>
          </View>

          <View style={styles.profileModalActions}>
            {isMe ? (
              <Pressable
                disabled
                style={[styles.profileActionBtn, styles.profileActionPrimary, { opacity: 0.65 }]}
                accessibilityRole="button"
                accessibilityLabel="내 프로필">
                <Ionicons name="person" size={16} color="#fff" />
                <Text style={styles.profileActionPrimaryText}>내 프로필</Text>
              </Pressable>
            ) : isAi ? (
              <Pressable
                disabled
                style={[styles.profileActionBtn, styles.profileActionPrimary, { opacity: 0.65 }]}
                accessibilityRole="text"
                accessibilityLabel="지닛 도우미">
                <Ionicons name="sparkles" size={16} color="#fff" />
                <Text style={styles.profileActionPrimaryText}>지닛 도우미</Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={friendRelation.status === 'pending_in' ? onAcceptFriendGinit : onSendFriendGinit}
                disabled={(friendGinitDisabled && friendRelation.status !== 'pending_in') || friendInMissingId}
                style={({ pressed }) => [
                  styles.profileActionBtn,
                  styles.profileActionPrimary,
                  ((friendGinitDisabled && friendRelation.status !== 'pending_in') || friendInMissingId) && { opacity: 0.55 },
                  pressed &&
                    !((friendGinitDisabled && friendRelation.status !== 'pending_in') || friendInMissingId) && {
                      opacity: 0.9,
                    },
                ]}
                accessibilityRole="button"
                accessibilityLabel={friendLabel}>
                {friendRequestBusy ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Ionicons name={friendIconName} size={16} color="#fff" />
                )}
                <Text style={styles.profileActionPrimaryText} numberOfLines={1}>
                  {friendLabel}
                </Text>
              </Pressable>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  profileModalRoot: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.48)',
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  profileModalCard: {
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.6)',
    padding: 18,
    ...GinitTheme.shadow.card,
  },
  profileModalTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  profileAvatarWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: 'rgba(226, 232, 240, 0.8)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
  },
  profileAvatarImg: { width: '100%', height: '100%' },
  profileAvatarFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  profileAvatarLetter: { fontSize: 20, fontWeight: '900', color: GinitTheme.colors.primary },
  profileModalTopText: { flex: 1, minWidth: 0, gap: 4 },
  profileModalNick: { fontSize: 18, fontWeight: '900', color: GinitTheme.colors.text, letterSpacing: -0.2 },
  profileModalMeta: { fontSize: 13, fontWeight: '700', color: GinitTheme.colors.textMuted },
  profileModalCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.04)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.08)',
  },
  profileModalActions: { marginTop: 14 },
  profileActionBtn: {
    height: 44,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  profileActionPrimary: { backgroundColor: GinitTheme.colors.primary },
  profileActionPrimaryText: { fontSize: 15, fontWeight: '900', color: '#fff' },
});
