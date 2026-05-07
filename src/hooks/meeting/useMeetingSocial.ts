import { acceptGinitRequest, fetchFriendRelationStatus, sendGinitRequest, type FriendRelationStatusRow } from '@/src/lib/friends';
import { notifyFriendRequestReceivedFireAndForget } from '@/src/lib/friend-push-notify';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import type { Meeting } from '@/src/lib/meetings';
import { listMeetingJoinRequests } from '@/src/lib/meetings';
import { pushProfileOpenRegisterInfo } from '@/src/lib/profile-register-info';
import { socialDmRoomId } from '@/src/lib/social-chat-rooms';
import { showTransientBottomMessage } from '@/components/ui/TransientBottomMessage';
import {
  ensureUserProfile,
  getUserProfile,
  getUserProfilesForIds,
  meetingDemographicsIncomplete,
  type UserProfile,
} from '@/src/lib/user-profile';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';

function orderedParticipantIds(m: Meeting): string[] {
  const hostRaw = m.createdBy?.trim() ?? '';
  const host = hostRaw ? normalizeParticipantId(hostRaw) : '';
  const listRaw = m.participantIds ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  if (host) {
    seen.add(host);
    out.push(host);
  }
  for (const x of listRaw) {
    const id = normalizeParticipantId(String(x));
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

type UseMeetingSocialArgs = {
  meeting: Meeting | null;
  userId: string | null;
  router: any;
};

export function useMeetingSocial({ meeting, userId, router }: UseMeetingSocialArgs) {
  const [participantProfiles, setParticipantProfiles] = useState<Record<string, UserProfile>>({});
  const [profilePopupUserId, setProfilePopupUserId] = useState<string | null>(null);
  const [friendRequestBusy, setFriendRequestBusy] = useState(false);
  const [friendRelation, setFriendRelation] = useState<FriendRelationStatusRow>({
    status: 'none',
    friendship_id: null,
  });
  const friendsRelationFetchGenRef = useRef(0);

  useEffect(() => {
    if (!meeting) {
      setParticipantProfiles({});
      return;
    }
    const base = orderedParticipantIds(meeting);
    const jrIds = listMeetingJoinRequests(meeting)
      .map((r) => normalizeParticipantId(r.userId) ?? r.userId.trim())
      .filter((x) => Boolean(x));
    const ids = [...new Set([...base, ...jrIds])];
    if (ids.length === 0) {
      setParticipantProfiles({});
      return;
    }
    let cancelled = false;
    void getUserProfilesForIds(ids).then((map) => {
      if (cancelled) return;
      const rec: Record<string, UserProfile> = {};
      map.forEach((v, k) => {
        rec[k] = v;
      });
      setParticipantProfiles(rec);
    });
    return () => {
      cancelled = true;
    };
  }, [meeting]);

  const openParticipantProfile = useCallback(
    (peerAppUserId: string) => {
      const pid = peerAppUserId.trim();
      if (!pid) return;
      router.push(`/profile/user/${encodeURIComponent(pid)}`);
    },
    [router],
  );

  const closeParticipantProfile = useCallback(() => {
    setProfilePopupUserId(null);
    setFriendRelation({ status: 'none', friendship_id: null });
  }, []);

  useEffect(() => {
    const pid = profilePopupUserId?.trim() ?? '';
    if (!pid) return;
    if (participantProfiles[pid]) return;
    let alive = true;
    void getUserProfile(pid).then((p) => {
      if (!alive) return;
      if (!p) return;
      setParticipantProfiles((prev) => (prev[pid] ? prev : { ...prev, [pid]: p }));
    });
    return () => {
      alive = false;
    };
  }, [participantProfiles, profilePopupUserId]);

  useEffect(() => {
    const me = userId?.trim() ?? '';
    const peer = profilePopupUserId?.trim() ?? '';
    if (!me || !peer) {
      setFriendRelation({ status: 'none', friendship_id: null });
      return;
    }
    if (normalizeParticipantId(me) === normalizeParticipantId(peer)) {
      setFriendRelation({ status: 'none', friendship_id: null });
      return;
    }
    const snapshot = friendsRelationFetchGenRef.current;
    let alive = true;
    void fetchFriendRelationStatus(me, peer)
      .then((gr) => {
        if (!alive) return;
        if (snapshot !== friendsRelationFetchGenRef.current) return;
        setFriendRelation(gr);
      })
      .catch(() => {
        if (!alive) return;
        if (snapshot !== friendsRelationFetchGenRef.current) return;
        setFriendRelation({ status: 'none', friendship_id: null });
      });
    return () => {
      alive = false;
    };
  }, [profilePopupUserId, userId]);

  const onSendFriendGinit = useCallback(async () => {
    const me = userId?.trim() ?? '';
    const peer = profilePopupUserId?.trim() ?? '';
    if (!peer) return;
    if (!me) {
      Alert.alert('로그인이 필요해요', '친구 요청은 로그인 후 보낼 수 있어요.');
      return;
    }
    if (normalizeParticipantId(me) === normalizeParticipantId(peer)) return;
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
        setFriendRelation(pre);
        showTransientBottomMessage(pre.status === 'accepted' ? '이미 친구로 연결되어 있어요.' : '이미 친구 요청을 보냈어요.');
        return;
      }
      const returnedId = (await sendGinitRequest(me, peer)).trim();
      friendsRelationFetchGenRef.current += 1;
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
  }, [profilePopupUserId, router, userId]);

  const onAcceptFriendGinit = useCallback(async () => {
    const me = userId?.trim() ?? '';
    const peer = profilePopupUserId?.trim() ?? '';
    const fid = friendRelation.friendship_id?.trim();
    if (!me || !peer || !fid) return;
    setFriendRequestBusy(true);
    try {
      await ensureUserProfile(me);
      await acceptGinitRequest(me, fid);
      friendsRelationFetchGenRef.current += 1;
      const next = await fetchFriendRelationStatus(me, peer).catch(() => null);
      if (next) setFriendRelation(next);
      const nick = participantProfiles[normalizeParticipantId(peer) ?? peer]?.nickname?.trim() ?? '친구';
      const rid = socialDmRoomId(me, peer);
      showTransientBottomMessage('친구 요청을 수락했어요.');
      closeParticipantProfile();
      router.push(`/social-chat/${encodeURIComponent(rid)}?peerName=${encodeURIComponent(nick)}`);
    } catch (e) {
      Alert.alert('수락 실패', e instanceof Error ? e.message : String(e));
    } finally {
      setFriendRequestBusy(false);
    }
  }, [closeParticipantProfile, friendRelation.friendship_id, participantProfiles, profilePopupUserId, router, userId]);

  return {
    participantProfiles,
    setParticipantProfiles,

    profilePopupUserId,
    setProfilePopupUserId,
    openParticipantProfile,
    closeParticipantProfile,

    friendRequestBusy,
    friendRelation,
    friendsRelationFetchGenRef,
    onSendFriendGinit,
    onAcceptFriendGinit,
  };
}

