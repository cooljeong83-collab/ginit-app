import { GinitPressable } from '@/components/ui/GinitPressable';

import * as Notifications from 'expo-notifications';
import { Timestamp } from '@/src/lib/ginit-timestamp';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AppState,
  type AppStateStatus,
  DeviceEventEmitter,
  FlatList,
  InteractionManager,
  Modal,
  Platform,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GinitSymbolicIcon } from '@/components/ui/GinitSymbolicIcon';
import { GinitTheme } from '@/constants/ginit-theme';
import { useUserSession } from '@/src/context/UserSessionContext';
import { useWatermelonChatUnreadTotal } from '@/src/hooks/use-watermelon-chat-unread-total';
import { meetingDetailQueryKey } from '@/src/hooks/use-meeting-detail-query';
import { useMyMeetingsFeedSync } from '@/src/hooks/use-my-meetings-feed-sync';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { formatDateTimeWithKoWeekday } from '@/src/lib/date-display';
import { buildMeetingFlowHref } from '@/src/lib/meeting-flow-navigation';
import { useTransitionRouter } from '@/src/lib/screen-transition-navigation';
import {
  fetchFriendsAcceptedList,
  fetchFriendsPendingInbox,
  fetchFriendsPendingOutbox,
  type FriendAcceptedRow,
  type FriendInboxRow,
} from '@/src/lib/friends';
import { ginitNotifyDbg } from '@/src/lib/ginit-notify-debug';
import {
  chatMessageTimeMs,
  defaultInAppAlarmReadState,
  type InAppAlarmReadState,
  type InAppAlarmRow,
  MEETING_INFO_FP_PREFIX,
  meetingInfoFingerprint,
  stableSortedParticipantLine,
} from '@/src/lib/in-app-alarms';
import { loadInAppAlarmReadState, saveInAppAlarmReadState } from '@/src/lib/in-app-alarms-persistence';
import { subscribeNotificationsForUser, type NotificationDoc } from '@/src/lib/notifications';
import {
  fetchUnreadMeetingFriendInviteNotifications,
  filterUnreadMeetingFriendInviteNotifications,
  markMeetingFriendInviteNotificationRead,
  markMeetingFriendInviteNotificationsReadForMeeting,
  meetingFriendInviteAlarmSortMs,
  meetingFriendInviteAlarmSubtitle,
  parseMeetingFriendInvitePayload,
} from '@/src/lib/meeting-friend-invite-notifications';
import {
  fetchUnreadMeetingPlaceReviewNotifications,
  filterUnreadMeetingPlaceReviewNotifications,
  markMeetingPlaceReviewNotificationRead,
  meetingPlaceReviewAlarmSortMs,
  meetingPlaceReviewAlarmSubtitle,
  parseMeetingPlaceReviewPayload,
} from '@/src/lib/meeting-place-review-notifications';
import { GINIT_MEETING_PLACE_REVIEW_SUBMITTED_EVENT } from '@/src/lib/meeting-place-review-dismiss';
import { filterJoinedMeetings, isUserJoinedMeeting } from '@/src/lib/joined-meetings';
import type { MeetingChatMessage } from '@/src/lib/meeting-chat';
import { clearMeetingChatUnreadForUser, candidateUserKeys, type MeetingChatRoomSummaryDoc } from '@/src/lib/meeting-chat-rooms-summary';
import {
  dismissAllMeetingAutoCancelUnconfirmedAlarms,
  dismissMeetingAutoCancelUnconfirmedAlarm,
  loadMeetingAutoCancelUnconfirmedAlarms,
  subscribeMeetingAutoCancelUnconfirmedAlarms,
  type MeetingAutoCancelUnconfirmedAlarm,
} from '@/src/lib/meeting-auto-cancel-unconfirmed-alarm';
import { sweepStalePublicUnconfirmedMeetingsForHost } from '@/src/lib/meeting-expiry-sweep';
import {
  getMeetingById,
  type Meeting,
  isGinitWebGuestParticipantId,
  meetingParticipantCount,
  webGuestDisplayNameFromMeeting,
} from '@/src/lib/meetings';
import { subscribeMeetingsHybrid } from '@/src/lib/meetings-hybrid';
import { runMeetingsListIncrementalReconcile } from '@/src/lib/meetings-feed-incremental-sync-core';
import { sweepStaleSelfMeetingChanges, wasRecentSelfMeetingChange } from '@/src/lib/self-meeting-change';
import type { SocialChatMessage, SocialChatRoomDoc, SocialChatRoomSummary } from '@/src/lib/social-chat-rooms';
import {
  fetchSocialChatRoomDocOnce,
  socialDmPreviewLine,
  socialMessageTimeMs,
  subscribeMySocialChatRooms,
} from '@/src/lib/social-chat-rooms';
import { subscribeUserUnreadBroadcast } from '@/src/lib/user-unread-broadcast-bus';
import { subscribeFriendsPostgresChanged } from '@/src/lib/friends-postgres-sync-bus';
import { getUserProfilesForIds } from '@/src/lib/user-profile';
import { navigateFromNoticeLink } from '@/src/features/notices/notice-link-navigation';
import {
  fetchUnreadNoticeInboxAlarms,
  markNoticeInboxAlarmRead,
  NOTICE_INBOX_ALARMS_REFRESH_EVENT,
  noticeInboxAlarmSortMs,
  noticeInboxAlarmSubtitle,
  noticeInboxAlarmTitle,
} from '@/src/lib/notice-inbox-alarms';
import type { NoticeInboxListItem } from '@/src/features/notices/notices-api';

function previewLine(m: MeetingChatMessage): string {
  if (m.kind === 'system') return m.text?.trim() ? m.text.trim() : '알림';
  if (m.kind === 'image') return m.text?.trim() ? `사진 · ${m.text.trim()}` : '사진';
  const t = m.text?.trim();
  if (t) return t.length > 100 ? `${t.slice(0, 100)}…` : t;
  return '새 메시지';
}

type FriendAcceptQueueItem = { friendshipId: string; peerAppUserId: string; sortMs: number };

function formatAlarmTime(sortMs: number): string {
  if (!sortMs) return '';
  try {
    const d = new Date(sortMs);
    return formatDateTimeWithKoWeekday(d);
  } catch {
    return '';
  }
}

/** `buildMeetingChangePreview`의 순수 참가자 명단 변경 문구 — 호스트는 `hostParticipantEventLog`와 중복되지 않게 fp 알람 행을 생략합니다. */
const MEETING_FP_PREVIEW_PARTICIPANTS_ONLY = new Set([
  '새 참여자가 들어왔어요.',
  '참여자가 나갔어요.',
  '참여자 구성이 바뀌었어요.',
]);

/** 재연결 직후 오래된 스냅샷으로 로컬 알림이 몰리지 않게 — 실시간 건은 송신 측 원격 푸시로 이미 전달됐을 수 있음 */
const HEADS_UP_MAX_EVENT_AGE_MS = 120_000;

function isRecentEnoughForHeadsUp(eventTimeMs: number): boolean {
  if (!eventTimeMs || !Number.isFinite(eventTimeMs)) return true;
  return Date.now() - eventTimeMs <= HEADS_UP_MAX_EVENT_AGE_MS;
}

/** 새 소식에서 모임 상세·채팅으로 보낼 수 있는지(목록에 아직 있는 모임). */
function isMeetingListedForAlarmNavigation(meetingId: string, meetings: readonly Meeting[]): boolean {
  const mid = meetingId.trim();
  if (!mid) return false;
  return meetings.some((m) => m.id === mid);
}

type InAppAlarmsContextValue = {
  hasUnread: boolean;
  alarms: InAppAlarmRow[];
  openAlarmPanel: () => void;
  closeAlarmPanel: () => void;
  alarmPanelVisible: boolean;
  /** 모임 채팅 미읽음 합(탭 배지). 친구 1:1은 미집계 */
  chatTabUnreadTotal: number;
  /** 나에게 온 지닛(친구) 요청 건수(탭 배지). 알람 패널과 동일하게 `friendRequestDismissedIds`에 닫은 건은 제외 */
  friendsTabPendingRequestBadge: number;
  /** 모임별 마지막으로 읽음 처리한 채팅 메시지 id(로컬) — 채팅 탭 미읽음 배지 집계에 사용 */
  meetingChatReadMessageIdMap: Record<string, string>;
  /** 채팅방에서 나갈 때 등 — 마지막으로 본 메시지까지 읽음 처리 */
  markChatReadUpTo: (meetingId: string, messageId: string | undefined) => void;
  /** 모임 상세를 봤을 때 현재 스냅샷을 확인 처리 */
  syncMeetingAckFromMeeting: (meeting: Meeting) => void;
  /**
   * 시스템 푸시(알림)를 "탭해서" 상세로 진입한 경우:
   * - 모임 변경 알람을 읽음 처리(ACK 갱신)
   * - 호스트 참여/퇴장 누적 알람도 해당 모임에 한해 제거
   */
  markMeetingAlarmsReadByPushTap: (meeting: Meeting) => void;
  /** 친구 요청 알람(인앱·로컬 헤드업)을 확인 처리 — 푸시 탭 시 등 */
  markFriendRequestAlarmDismissed: (friendshipId: string) => void;
  /** 상대가 내 보낸 지닛을 수락했을 때 알람 확인 처리 — 푸시 탭 시 등 */
  markFriendAcceptedAlarmDismissed: (friendshipId: string) => void;
  /** 모임 친구 초대 알림(`meeting_friend_invite`) 읽음 — 푸시 탭·모임 상세 진입 시 */
  markMeetingInviteReadByMeetingId: (meetingId: string) => void;
};

const InAppAlarmsContext = createContext<InAppAlarmsContextValue | null>(null);

export function useInAppAlarms(): InAppAlarmsContextValue {
  const v = useContext(InAppAlarmsContext);
  if (!v) {
    throw new Error('useInAppAlarms는 InAppAlarmsProvider 안에서만 사용할 수 있어요.');
  }
  return v;
}

export function InAppAlarmsProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const router = useTransitionRouter();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { userId } = useUserSession();

  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [latestById, setLatestById] = useState<Record<string, MeetingChatMessage | null | undefined>>({});
  const [readState, setReadState] = useState<InAppAlarmReadState>(() => defaultInAppAlarmReadState());
  const [persistReady, setPersistReady] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [meetingAlarmSinceMs, setMeetingAlarmSinceMs] = useState<Record<string, number>>({});
  /** 호스트: 참여자 입장/퇴장 이벤트는 모임별로 누적(새 소식에 계속 쌓임) */
  const [hostParticipantEventLog, setHostParticipantEventLog] = useState<
    Record<string, { id: string; subtitle: string; sortMs: number }[]>
  >({});
  const [friendInbox, setFriendInbox] = useState<FriendInboxRow[]>([]);
  const [friendAcceptQueue, setFriendAcceptQueue] = useState<FriendAcceptQueueItem[]>([]);
  const [friendRequesterNickById, setFriendRequesterNickById] = useState<Map<string, string>>(() => new Map());
  const [friendAcceptPeerNickById, setFriendAcceptPeerNickById] = useState<Map<string, string>>(() => new Map());
  const [socialRooms, setSocialRooms] = useState<SocialChatRoomSummary[]>([]);
  const [socialLatestByRoomId, setSocialLatestByRoomId] = useState<Record<string, SocialChatMessage | null | undefined>>(
    {},
  );
  const [socialRoomDocById, setSocialRoomDocById] = useState<Record<string, import('@/src/lib/social-chat-rooms').SocialChatRoomDoc | null | undefined>>(
    {},
  );
  const [meetingChatSummaryById, setMeetingChatSummaryById] = useState<Record<string, MeetingChatRoomSummaryDoc | null | undefined>>(
    {},
  );
  const [socialPeerNickByRoomId, setSocialPeerNickByRoomId] = useState<Map<string, string>>(() => new Map());
  /** `public.notifications` type=meeting_friend_invite (읽지 않음만) */
  const [meetingInviteInbox, setMeetingInviteInbox] = useState<NotificationDoc[]>([]);
  /** `public.notifications` type=meeting_place_review (읽지 않음만) */
  const [meetingPlaceReviewInbox, setMeetingPlaceReviewInbox] = useState<NotificationDoc[]>([]);
  /** 운영 공지 수신함(`user_notifications` + `notices`, 읽지 않음만) */
  const [noticeInboxAlarms, setNoticeInboxAlarms] = useState<NoticeInboxListItem[]>([]);
  /** 미확정·일시 경과 자동 파기 — 모임 삭제 후에도 새 소식에 남김 */
  const [autoCancelUnconfirmedAlarms, setAutoCancelUnconfirmedAlarms] = useState<
    MeetingAutoCancelUnconfirmedAlarm[]
  >([]);
  const friendHeadsUpNotifiedIdsRef = useRef<Set<string>>(new Set());
  const friendAcceptHeadsUpNotifiedIdsRef = useRef<Set<string>>(new Set());
  const prevOutboxFriendshipIdsRef = useRef<Set<string>>(new Set());
  const friendOutboxBootstrappedRef = useRef(false);
  /**
   * 재설치/첫 로그인 직후: readState가 비어 있는 상태에서 최신 스냅샷이 먼저 들어오면
   * "미확인"으로 오인해 푸시/로컬 헤드업이 한꺼번에 발생하고,
   * 직후 베이스라인을 잡으면서 새 소식은 비어 보이는 레이스가 생길 수 있습니다.
   * 베이스라인(ACK/채팅 읽음 포인터)이 준비된 뒤에만 헤드업을 허용합니다.
   */
  const headsUpReadyRef = useRef(false);
  const [headsUpReady, setHeadsUpReady] = useState(false);
  const meetingsBootstrappedRef = useRef(false);
  const [meetingsBootstrapped, setMeetingsBootstrapped] = useState(false);
  const socialRoomsBootstrappedRef = useRef(false);
  const [socialRoomsBootstrapped, setSocialRoomsBootstrapped] = useState(false);

  const readStateRef = useRef(readState);
  readStateRef.current = readState;
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  /** 동일 메시지·동일 모임 지문에 대한 푸시 중복 방지 */
  const pushDedupeRef = useRef<Set<string>>(new Set());
  const prevParticipantSetRef = useRef<Record<string, string>>({});
  const prevMeetingSnapshotRef = useRef<Record<string, Meeting>>({});
  const meetingChangePreviewRef = useRef<Record<string, string>>({});

  const buildMeetingChangePreview = useCallback((prev: Meeting | null, next: Meeting): string => {
    if (!prev) return '모임 정보가 업데이트되었습니다.';
    if (prev.scheduleConfirmed !== true && next.scheduleConfirmed === true) return '일정이 확정되었습니다.';
    if (prev.scheduleConfirmed === true && next.scheduleConfirmed !== true) return '일정 확정이 취소되었습니다.';
    if ((prev.scheduleDate ?? '') !== (next.scheduleDate ?? '') || (prev.scheduleTime ?? '') !== (next.scheduleTime ?? '')) {
      return '일시가 변경되었습니다.';
    }
    if ((prev.placeName ?? '') !== (next.placeName ?? '') || (prev.address ?? '') !== (next.address ?? '')) {
      return '장소가 변경되었습니다.';
    }
    const prevDates = prev.dateCandidates?.length ?? 0;
    const nextDates = next.dateCandidates?.length ?? 0;
    if (nextDates > prevDates) return `일정 후보가 ${nextDates - prevDates}개 추가되었습니다.`;
    const prevPlaces = prev.placeCandidates?.length ?? 0;
    const nextPlaces = next.placeCandidates?.length ?? 0;
    if (nextPlaces > prevPlaces) return `장소 후보가 ${nextPlaces - prevPlaces}개 추가되었습니다.`;
    if ((prev.title ?? '') !== (next.title ?? '')) return '모임 제목이 변경되었습니다.';
    const prevPart = stableSortedParticipantLine(prev.participantIds);
    const nextPart = stableSortedParticipantLine(next.participantIds);
    if (prevPart !== nextPart) {
      const pc = meetingParticipantCount(prev);
      const nc = meetingParticipantCount(next);
      if (nc > pc) return '새 참여자가 들어왔어요.';
      if (nc < pc) return '참여자가 나갔어요.';
      return '참여자 구성이 바뀌었어요.';
    }
    return '모임 정보가 변경되었습니다.';
  }, []);

  const prevHeadsUpReadyRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (!userId?.trim()) {
      ginitNotifyDbg('InAppAlarms', 'session_reset', {});
      setPersistReady(false);
      setMeetings([]);
      setLatestById({});
      setReadState(defaultInAppAlarmReadState());
      setMeetingAlarmSinceMs({});
      setHostParticipantEventLog({});
      setFriendInbox([]);
      setFriendAcceptQueue([]);
      setFriendRequesterNickById(new Map());
      setFriendAcceptPeerNickById(new Map());
      setSocialRooms([]);
      setSocialLatestByRoomId({});
      setSocialPeerNickByRoomId(new Map());
      setMeetingChatSummaryById({});
      setSocialRoomDocById({});
      setMeetingInviteInbox([]);
      setAutoCancelUnconfirmedAlarms([]);
      friendHeadsUpNotifiedIdsRef.current = new Set();
      friendAcceptHeadsUpNotifiedIdsRef.current = new Set();
      prevOutboxFriendshipIdsRef.current = new Set();
      friendOutboxBootstrappedRef.current = false;
      headsUpReadyRef.current = false;
      setHeadsUpReady(false);
      meetingsBootstrappedRef.current = false;
      setMeetingsBootstrapped(false);
      socialRoomsBootstrappedRef.current = false;
      setSocialRoomsBootstrapped(false);
      setPanelOpen(false);
      pushDedupeRef.current = new Set();
      prevParticipantSetRef.current = {};
      return;
    }
    let cancelled = false;
    void loadInAppAlarmReadState(userId).then((s) => {
      if (cancelled) return;
      ginitNotifyDbg('InAppAlarms', 'persist_loaded', {
        chatReadKeys: Object.keys(s.chatReadMessageId ?? {}).length,
        meetingAckKeys: Object.keys(s.meetingAckFingerprint ?? {}).length,
      });
      setReadState(s);
      setPersistReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const reloadAutoCancelUnconfirmedAlarms = useCallback(() => {
    const uid = userId?.trim();
    if (!uid) {
      setAutoCancelUnconfirmedAlarms([]);
      return;
    }
    void loadMeetingAutoCancelUnconfirmedAlarms(uid).then(setAutoCancelUnconfirmedAlarms);
  }, [userId]);

  useEffect(() => {
    if (!persistReady || !userId?.trim()) {
      setAutoCancelUnconfirmedAlarms([]);
      return;
    }
    reloadAutoCancelUnconfirmedAlarms();
    return subscribeMeetingAutoCancelUnconfirmedAlarms(reloadAutoCancelUnconfirmedAlarms);
  }, [persistReady, userId, reloadAutoCancelUnconfirmedAlarms]);

  // 참여자 변동 알람을 위해, "첫 변동"이 아니라 "첫 관측" 시점에 기준 participantIds를 잡아둡니다.
  useEffect(() => {
    if (!persistReady || !userId?.trim()) return;
    const joined = filterJoinedMeetings(meetings, userId);
    const nextBaseline: Record<string, string> = { ...prevParticipantSetRef.current };
    for (const m of joined) {
      const mid = m.id;
      if (Object.prototype.hasOwnProperty.call(nextBaseline, mid)) continue;
      const line = (Array.isArray(m.participantIds) ? m.participantIds : [])
        .map((x) => normalizeParticipantId(String(x)) || '')
        .filter(Boolean)
        .sort()
        .join('|');
      nextBaseline[mid] = line;
    }
    // 더 이상 참여 중이 아닌 모임은 baseline도 정리
    const joinedSet = new Set(joined.map((m) => m.id));
    for (const k of Object.keys(nextBaseline)) {
      if (!joinedSet.has(k)) delete nextBaseline[k];
    }
    prevParticipantSetRef.current = nextBaseline;
  }, [persistReady, meetings, userId]);

  const { meetings: myMeetingsForChatUnread } = useMyMeetingsFeedSync({
    enabled: persistReady,
    userId,
  });

  useEffect(() => {
    if (!userId?.trim()) return;
    return subscribeMeetingsHybrid(
      (list) => {
        if (!meetingsBootstrappedRef.current) {
          meetingsBootstrappedRef.current = true;
          setMeetingsBootstrapped(true);
          ginitNotifyDbg('InAppAlarms', 'meetings_hybrid_bootstrapped', { count: list.length });
        }
        setMeetings(list);
      },
      () => {
        ginitNotifyDbg('InAppAlarms', 'meetings_hybrid_error', {});
        /* 목록 오류는 각 탭에서 처리 */
      },
    );
  }, [userId]);

  const meetingsForChatUnread = useMemo(() => {
    if (myMeetingsForChatUnread.length === 0) return meetings;
    const uid = userId?.trim() ?? '';
    const normalizedMyMeetings = uid
      ? myMeetingsForChatUnread.map((m) =>
          isUserJoinedMeeting(m, uid)
            ? m
            : {
                ...m,
                participantIds: [...(m.participantIds ?? []), uid],
              },
        )
      : myMeetingsForChatUnread;
    const seen = new Set<string>();
    const out: Meeting[] = [];
    for (const m of meetings) {
      if (!m?.id || seen.has(m.id)) continue;
      seen.add(m.id);
      out.push(m);
    }
    for (const m of normalizedMyMeetings) {
      if (!m?.id || seen.has(m.id)) continue;
      seen.add(m.id);
      out.push(m);
    }
    return out;
  }, [meetings, myMeetingsForChatUnread, userId]);

  const meetingsForChatUnreadRef = useRef(meetingsForChatUnread);
  meetingsForChatUnreadRef.current = meetingsForChatUnread;

  const joinedMeetingRoomIdsForTabBadge = useMemo(
    () => meetingsForChatUnread.map((m) => m.id).filter(Boolean),
    [meetingsForChatUnread],
  );

  const chatTabUnreadTotal = useWatermelonChatUnreadTotal({
    /** `chat.tsx` 목록·세그먼트 배지와 동일 — `candidateUserKeys`에 raw·정규화 id 모두 포함 */
    ownerUserId: userId,
    enabled: Boolean(persistReady && userId?.trim()),
    meetingsFilterReady: meetingsBootstrapped,
    joinedMeetingRoomIds: joinedMeetingRoomIdsForTabBadge,
  });

  /** `user_notifications:{profiles.id}` → 모임/소셜 요약·최신 메시지 스텁(배지 베이스라인)만 갱신. 목록용 per-room Realtime은 사용하지 않습니다. */
  useEffect(() => {
    if (!persistReady) return;
    return subscribeUserUnreadBroadcast((p) => {
      const uid = userIdRef.current?.trim() ?? '';
      if (!uid) return;
      const pk = normalizeParticipantId(uid) ?? uid;
      const nowTs = Timestamp.now();
      const keys = candidateUserKeys(uid);
      const unreadMap: Record<string, number> = {};
      for (const k of keys) unreadMap[k] = p.unreadCount;

      if (p.roomKind === 'meeting') {
        const canonical = p.canonicalRoomId.trim();
        const joined = filterJoinedMeetings(meetingsForChatUnreadRef.current, uid);
        const hit = joined.find((m) => m.id === canonical);
        const mid = (hit?.id ?? canonical).trim();

        setMeetingChatSummaryById((prev) => ({
          ...prev,
          [mid]: {
            id: mid,
            meetingId: mid,
            unreadCountBy: { ...(prev[mid]?.unreadCountBy ?? {}), ...unreadMap },
            lastMessageId: p.lastMessageId || prev[mid]?.lastMessageId || null,
            lastMessagePreview: p.lastMessage || prev[mid]?.lastMessagePreview || null,
            lastMessageAt: nowTs,
            lastSenderId: prev[mid]?.lastSenderId ?? null,
            updatedAt: nowTs,
          },
        }));

        if (p.lastMessageId) {
          setLatestById((prev) => ({
            ...prev,
            [mid]: {
              id: p.lastMessageId,
              senderId: null,
              senderName: null,
              senderAvatarUrl: null,
              text: p.lastMessage,
              kind: p.messageKind,
              imageUrl: null,
              createdAt: nowTs,
              updatedAt: nowTs,
              deletedAt: null,
            },
          }));
        }
      } else {
        const rid = p.canonicalRoomId.trim();

        setSocialRoomDocById((prev) => ({
          ...prev,
          [rid]: {
            id: rid,
            isGroup: false,
            unreadCountBy: { ...(prev[rid]?.unreadCountBy ?? {}), ...unreadMap, [uid]: p.unreadCount, [pk]: p.unreadCount },
            updatedAt: nowTs,
            readMessageIdBy: prev[rid]?.readMessageIdBy,
            readAtBy: prev[rid]?.readAtBy,
            participantIds: prev[rid]?.participantIds,
          },
        }));

        if (p.lastMessageId) {
          setSocialLatestByRoomId((prev) => ({
            ...prev,
            [rid]: {
              id: p.lastMessageId,
              senderId: null,
              text: p.lastMessage,
              kind: p.messageKind,
              imageUrl: null,
              createdAt: nowTs,
              updatedAt: nowTs,
              deletedAt: null,
            },
          }));
        }
      }
    });
  }, [persistReady]);

  /**
   * 친구 수신 인박스·발신 대기·수락 목록은 `persistReady`와 무관하게 로드합니다.
   * 발신 대기(outbox) 스냅샷과 비교해 상대 수락 시 알람 큐에 넣습니다.
   */
  useEffect(() => {
    if (!userId?.trim()) {
      setFriendInbox([]);
      return;
    }
    const uid = userId.trim();
    const load = () => {
      void Promise.all([
        fetchFriendsPendingInbox(uid).catch((e) => {
          ginitNotifyDbg('InAppAlarms', 'friends_pending_inbox_failed', { message: String(e) });
          if (__DEV__) console.warn('[InAppAlarms] friends_pending_inbox failed', e);
          return [] as FriendInboxRow[];
        }),
        fetchFriendsPendingOutbox(uid).catch((e) => {
          ginitNotifyDbg('InAppAlarms', 'friends_pending_outbox_failed', { message: String(e) });
          if (__DEV__) console.warn('[InAppAlarms] friends_pending_outbox failed', e);
          return [] as FriendInboxRow[];
        }),
        fetchFriendsAcceptedList(uid).catch((e) => {
          ginitNotifyDbg('InAppAlarms', 'friends_accepted_list_failed', { message: String(e) });
          if (__DEV__) console.warn('[InAppAlarms] friends_accepted_list failed', e);
          return [] as FriendAcceptedRow[];
        }),
      ]).then(([inbox, outbox, accepted]) => {
        setFriendInbox(inbox);
        const curOut = new Set(outbox.map((r) => String(r.id ?? '').trim()).filter(Boolean));
        const acceptedIdSet = new Set(accepted.map((r) => String(r.id ?? '').trim()).filter(Boolean));
        if (friendOutboxBootstrappedRef.current) {
          for (const prevId of prevOutboxFriendshipIdsRef.current) {
            if (curOut.has(prevId) || !acceptedIdSet.has(prevId)) continue;
            const acc = accepted.find((r) => String(r.id ?? '').trim() === prevId);
            const peerApp = acc?.peer_app_user_id?.trim() ?? '';
            if (!prevId || !peerApp) continue;
            setFriendAcceptQueue((q) => {
              if (q.some((x) => x.friendshipId === prevId)) return q;
              const um = acc?.updated_at ? Date.parse(acc.updated_at) : NaN;
              const sortMs = Number.isFinite(um) ? um : Date.now();
              return [...q, { friendshipId: prevId, peerAppUserId: peerApp, sortMs }];
            });
          }
        }
        prevOutboxFriendshipIdsRef.current = curOut;
        friendOutboxBootstrappedRef.current = true;
      });
    };
    load();
    const unsubRt = subscribeFriendsPostgresChanged(load);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') load();
    });
    /** Realtime 미수신·세션 지연 대비 — 친구 테이블 주기 재조회 */
    const poll = setInterval(load, 28_000);
    return () => {
      clearInterval(poll);
      unsubRt();
      sub.remove();
    };
  }, [userId]);

  useEffect(() => {
    if (friendInbox.length === 0) {
      setFriendRequesterNickById(new Map());
      return;
    }
    const ids = [...new Set(friendInbox.map((r) => r.requester_app_user_id))];
    let cancelled = false;
    void getUserProfilesForIds(ids).then((map) => {
      if (cancelled) return;
      const next = new Map<string, string>();
      for (const id of ids) {
        next.set(id, map.get(id)?.nickname?.trim() || '친구');
      }
      setFriendRequesterNickById(next);
    });
    return () => {
      cancelled = true;
    };
  }, [friendInbox]);

  const refreshMeetingInviteInbox = useCallback(() => {
    const uid = normalizeParticipantId(userIdRef.current?.trim() ?? '') || userIdRef.current?.trim() || '';
    if (!uid) {
      setMeetingInviteInbox([]);
      return;
    }
    void fetchUnreadMeetingFriendInviteNotifications(uid)
      .then((items) => setMeetingInviteInbox(items))
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        ginitNotifyDbg('InAppAlarms', 'meeting_invite_notifications_error', { message: msg });
        if (__DEV__) console.warn('[InAppAlarms] meeting_invite notifications', msg);
      });
  }, []);

  useEffect(() => {
    if (!userId?.trim()) {
      setMeetingInviteInbox([]);
      setMeetingPlaceReviewInbox([]);
      return;
    }
    const uid = normalizeParticipantId(userId.trim()) || userId.trim();
    return subscribeNotificationsForUser(
      uid,
      (items) => {
        setMeetingInviteInbox(filterUnreadMeetingFriendInviteNotifications(items));
        setMeetingPlaceReviewInbox(filterUnreadMeetingPlaceReviewNotifications(items));
      },
      (msg) => {
        ginitNotifyDbg('InAppAlarms', 'app_notifications_realtime_error', { message: msg });
        if (__DEV__) console.warn('[InAppAlarms] app notifications realtime', msg);
      },
    );
  }, [userId]);

  useEffect(() => {
    if (!userId?.trim()) return;
    const poll = setInterval(refreshMeetingInviteInbox, 28_000);
    return () => clearInterval(poll);
  }, [userId, refreshMeetingInviteInbox]);

  const refreshNoticeInboxAlarms = useCallback(() => {
    if (!userIdRef.current?.trim()) {
      setNoticeInboxAlarms([]);
      return;
    }
    void fetchUnreadNoticeInboxAlarms()
      .then((items) => setNoticeInboxAlarms(items))
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        ginitNotifyDbg('InAppAlarms', 'notice_inbox_alarms_error', { message: msg });
        if (__DEV__) console.warn('[InAppAlarms] notice_inbox_alarms', msg);
      });
  }, []);

  useEffect(() => {
    if (!userId?.trim()) {
      setNoticeInboxAlarms([]);
      return;
    }
    refreshNoticeInboxAlarms();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refreshNoticeInboxAlarms();
    });
    const refreshSub = DeviceEventEmitter.addListener(NOTICE_INBOX_ALARMS_REFRESH_EVENT, refreshNoticeInboxAlarms);
    const poll = setInterval(refreshNoticeInboxAlarms, 28_000);
    return () => {
      sub.remove();
      refreshSub.remove();
      clearInterval(poll);
    };
  }, [userId, refreshNoticeInboxAlarms]);

  const refreshMeetingPlaceReviewInbox = useCallback(() => {
    const uid = normalizeParticipantId(userIdRef.current?.trim() ?? '') || userIdRef.current?.trim() || '';
    if (!uid) {
      setMeetingPlaceReviewInbox([]);
      return;
    }
    void fetchUnreadMeetingPlaceReviewNotifications(uid)
      .then((items) => setMeetingPlaceReviewInbox(items))
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        ginitNotifyDbg('InAppAlarms', 'meeting_place_review_notifications_error', { message: msg });
        if (__DEV__) console.warn('[InAppAlarms] meeting_place_review notifications', msg);
      });
  }, []);

  useEffect(() => {
    if (!userId?.trim()) return;
    const poll = setInterval(refreshMeetingPlaceReviewInbox, 28_000);
    return () => clearInterval(poll);
  }, [userId, refreshMeetingPlaceReviewInbox]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(
      GINIT_MEETING_PLACE_REVIEW_SUBMITTED_EVENT,
      () => {
        refreshMeetingPlaceReviewInbox();
      },
    );
    return () => sub.remove();
  }, [refreshMeetingPlaceReviewInbox]);

  useEffect(() => {
    if (friendAcceptQueue.length === 0) {
      setFriendAcceptPeerNickById(new Map());
      return;
    }
    const ids = [...new Set(friendAcceptQueue.map((x) => x.peerAppUserId))];
    let cancelled = false;
    void getUserProfilesForIds(ids).then((map) => {
      if (cancelled) return;
      const next = new Map<string, string>();
      for (const id of ids) {
        next.set(id, map.get(id)?.nickname?.trim() || '친구');
      }
      setFriendAcceptPeerNickById(next);
    });
    return () => {
      cancelled = true;
    };
  }, [friendAcceptQueue]);

  /**
   * 헤드업 알림은 "초기 베이스라인"이 준비된 뒤부터 허용합니다.
   * - 모임: meetingAckFingerprint, chatReadMessageId가 모두 세팅됨
   * - 소셜 DM: chatReadMessageId가 세팅됨
   */
  useEffect(() => {
    if (headsUpReadyRef.current) return;
    if (!persistReady || !userId?.trim()) return;
    if (!meetingsBootstrappedRef.current) return;
    if (!socialRoomsBootstrappedRef.current) return;
    const joined = filterJoinedMeetings(meetings, userId);
    const meetingLatestBootstrapped = joined.every((m) => m.id in latestById);
    const meetingOk = joined.every(
      (m) => readState.meetingAckFingerprint[m.id] !== undefined && readState.chatReadMessageId[m.id] !== undefined,
    );
    const socialLatestBootstrapped = socialRooms.every((r) => r.roomId in socialLatestByRoomId);
    const socialOk = socialRooms.every((r) => readState.chatReadMessageId[r.roomId] !== undefined);
    if (meetingLatestBootstrapped && meetingOk && socialLatestBootstrapped && socialOk) {
      headsUpReadyRef.current = true;
      setHeadsUpReady(true);
      ginitNotifyDbg('InAppAlarms', 'heads_up_gate_passed', {
        joinedCount: joined.length,
        socialRoomsCount: socialRooms.length,
      });
    }
  }, [
    persistReady,
    userId,
    meetings,
    latestById,
    socialRooms,
    socialLatestByRoomId,
    readState.meetingAckFingerprint,
    readState.chatReadMessageId,
    meetingsBootstrapped,
    socialRoomsBootstrapped,
  ]);

  useEffect(() => {
    if (prevHeadsUpReadyRef.current === headsUpReady) return;
    prevHeadsUpReadyRef.current = headsUpReady;
    ginitNotifyDbg('InAppAlarms', headsUpReady ? 'headsUpReady_on' : 'headsUpReady_off', {
      persistReady,
      meetingsBootstrapped,
      socialRoomsBootstrapped,
    });
  }, [headsUpReady, persistReady, meetingsBootstrapped, socialRoomsBootstrapped]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (!persistReady || !userId?.trim() || !headsUpReady) return;

    for (const fr of friendInbox) {
      const frid = String(fr.id ?? '').trim();
      if (!frid) continue;
      if (readState.friendRequestDismissedIds[frid]) continue;
      if (readState.friendRequestHeadsUpSentIds?.[frid]) continue;
      if (friendHeadsUpNotifiedIdsRef.current.has(frid)) continue;
      const createdMs = fr.created_at ? Date.parse(fr.created_at) : 0;
      if (createdMs && !isRecentEnoughForHeadsUp(createdMs)) continue;
      friendHeadsUpNotifiedIdsRef.current.add(frid);
      /** 송신 측 `notifyFriendRequestReceived` 원격 푸시와 중복되므로 헤드업(로컬/2차 원격)은 보내지 않고 소비만 표시합니다. */
      ginitNotifyDbg('InAppAlarms', 'friend_request_skip_heads_up_remote_already_sent', { friendshipId: frid });
      setReadState((p) => ({
        ...p,
        friendRequestHeadsUpSentIds: { ...(p.friendRequestHeadsUpSentIds ?? {}), [frid]: true },
      }));
    }
    const cur = new Set(friendInbox.map((r) => String(r.id ?? '').trim()).filter(Boolean));
    for (const id of [...friendHeadsUpNotifiedIdsRef.current]) {
      if (!cur.has(id)) friendHeadsUpNotifiedIdsRef.current.delete(id);
    }
  }, [
    persistReady,
    userId,
    headsUpReady,
    friendInbox,
    readState.friendRequestDismissedIds,
    readState.friendRequestHeadsUpSentIds,
  ]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (!persistReady || !userId?.trim() || !headsUpReady) return;

    for (const it of friendAcceptQueue) {
      const fid = it.friendshipId.trim();
      if (!fid) continue;
      if (readState.friendAcceptedDismissedIds[fid]) continue;
      if (friendAcceptHeadsUpNotifiedIdsRef.current.has(fid)) continue;
      if (it.sortMs && !isRecentEnoughForHeadsUp(it.sortMs)) continue;
      // 중복 방지: 친구 수락은 새소식 목록/뱃지로만 반영하고 추가 푸시는 보내지 않습니다.
      friendAcceptHeadsUpNotifiedIdsRef.current.add(fid);
    }
    const cur = new Set(friendAcceptQueue.map((x) => x.friendshipId.trim()).filter(Boolean));
    for (const id of [...friendAcceptHeadsUpNotifiedIdsRef.current]) {
      if (!cur.has(id) || readState.friendAcceptedDismissedIds[id]) {
        friendAcceptHeadsUpNotifiedIdsRef.current.delete(id);
      }
    }
  }, [persistReady, userId, headsUpReady, friendAcceptQueue, readState.friendAcceptedDismissedIds, friendAcceptPeerNickById]);

  const joinedKey = useMemo(() => {
    const joined = filterJoinedMeetings(meetings, userId);
    return joined
      .map((m) => m.id)
      .sort()
      .join('\u0001');
  }, [meetings, userId]);

  const socialRoomsKey = useMemo(
    () => socialRooms.map((r) => r.roomId).sort().join('\u0001'),
    [socialRooms],
  );

  useEffect(() => {
    const uid = userId?.trim();
    if (!uid || meetings.length === 0) return;
    void sweepStalePublicUnconfirmedMeetingsForHost(uid, meetings);
  }, [userId, meetings]);

  useEffect(() => {
    if (!userId?.trim() || !persistReady) {
      setSocialRooms([]);
      return;
    }
    const uid = userId.trim();
    return subscribeMySocialChatRooms(
      uid,
      (rooms) => {
        if (!socialRoomsBootstrappedRef.current) {
          socialRoomsBootstrappedRef.current = true;
          setSocialRoomsBootstrapped(true);
          ginitNotifyDbg('InAppAlarms', 'social_rooms_bootstrapped', { count: rooms.length });
        }
        setSocialRooms(rooms);
      },
      () => {
        ginitNotifyDbg('InAppAlarms', 'social_rooms_subscribe_error', {});
        /* 목록 오류는 친구·채팅 탭에서 처리 */
      },
    );
  }, [userId, persistReady]);

  useEffect(() => {
    if (socialRooms.length === 0) {
      setSocialPeerNickByRoomId(new Map());
      return;
    }
    let cancelled = false;
    const ids = [...new Set(socialRooms.map((r) => normalizeParticipantId(r.peerAppUserId) || r.peerAppUserId.trim()))];
    void getUserProfilesForIds(ids).then((map) => {
      if (cancelled) return;
      const next = new Map<string, string>();
      for (const r of socialRooms) {
        const pk = normalizeParticipantId(r.peerAppUserId) || r.peerAppUserId.trim();
        next.set(r.roomId, map.get(pk)?.nickname?.trim() || '친구');
      }
      setSocialPeerNickByRoomId(next);
    });
    return () => {
      cancelled = true;
    };
  }, [socialRooms]);

  useEffect(() => {
    if (!persistReady || !userId?.trim()) return;
    if (socialRooms.length === 0) return;

    setReadState((prev) => {
      let chatReadMessageId = { ...prev.chatReadMessageId };
      let changed = false;
      for (const r of socialRooms) {
        if (!(r.roomId in socialLatestByRoomId)) continue;
        const latest = socialLatestByRoomId[r.roomId];
        const latestId = (latest?.id ?? '').trim();
        const cur = chatReadMessageId[r.roomId];
        /** `''`만 남은 채로는 `undefined`와 달리 이후 스냅샷이 와도 갱신되지 않아 탭 배지가 전체 메시지 수로 고정되는 경우가 있습니다(탈퇴/재가입·최초 null 스냅샷 등). */
        if (cur === undefined || cur === '') {
          if (chatReadMessageId[r.roomId] !== latestId) {
            chatReadMessageId[r.roomId] = latestId;
            changed = true;
          }
        }
      }
      if (!changed) return prev;
      return { ...prev, chatReadMessageId };
    });
  }, [persistReady, userId, socialRooms, socialLatestByRoomId]);

  useEffect(() => {
    if (!persistReady || !userId?.trim()) return;
    const joined = filterJoinedMeetings(meetings, userId);
    if (joined.length === 0) return;

    setReadState((prev) => {
      let chatReadMessageId = { ...prev.chatReadMessageId };
      let meetingAckFingerprint = { ...prev.meetingAckFingerprint };
      let changed = false;

      for (const m of joined) {
        const fpInfo = meetingInfoFingerprint(m);
        const curAck = meetingAckFingerprint[m.id];
        if (curAck === undefined || !curAck.startsWith(MEETING_INFO_FP_PREFIX)) {
          meetingAckFingerprint[m.id] = fpInfo;
          changed = true;
        }
        if (!(m.id in latestById)) continue;
        const latest = latestById[m.id];
        const latestId = (latest?.id ?? '').trim();
        const cur = chatReadMessageId[m.id];
        /** 소셜과 동일: `''` 고착 시 배지/헤드업 로직이 과대 반응할 수 있어, 최신 id로 베이스라인을 잡습니다. */
        if (cur === undefined || cur === '') {
          if (chatReadMessageId[m.id] !== latestId) {
            chatReadMessageId[m.id] = latestId;
            changed = true;
          }
        }
      }

      if (!changed) return prev;
      return { ...prev, chatReadMessageId, meetingAckFingerprint };
    });
  }, [persistReady, userId, meetings, latestById]);

  useEffect(() => {
    if (!persistReady) return;
    const joined = filterJoinedMeetings(meetings, userId);
    const now = Date.now();
    setMeetingAlarmSinceMs((prev) => {
      const next = { ...prev };
      for (const m of joined) {
        const fp = meetingInfoFingerprint(m);
        const ack = readState.meetingAckFingerprint[m.id];
        if (ack === undefined) continue;
        if (fp !== ack) {
          if (next[m.id] == null) next[m.id] = now;
        } else {
          delete next[m.id];
        }
      }
      for (const k of Object.keys(next)) {
        if (!joined.some((x) => x.id === k)) delete next[k];
      }
      return next;
    });
  }, [persistReady, meetings, userId, readState.meetingAckFingerprint]);

  /**
   * `setItem` 완료까지 await — `void`만 호출하면 저장 전에 프로세스가 끊겨 재실행 시 알람이 복구되는 경우가 있습니다.
   * (디버그/릴리스 공통)
   */
  useEffect(() => {
    if (!persistReady || !userId?.trim()) return;
    const uid = userId.trim();
    const snapshot = readState;
    let cancelled = false;
    void (async () => {
      await saveInAppAlarmReadState(uid, snapshot);
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [readState, persistReady, userId]);

  useEffect(() => {
    if (!persistReady) return;
    const flush = (status: AppStateStatus) => {
      if (status !== 'inactive' && status !== 'background') return;
      const uid = userIdRef.current?.trim();
      if (!uid) return;
      void (async () => {
        await saveInAppAlarmReadState(uid, readStateRef.current);
      })();
    };
    const sub = AppState.addEventListener('change', flush);
    return () => sub.remove();
  }, [persistReady]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (!persistReady || !userId?.trim()) return;

    const uid = userId.trim();
    const myPk = normalizeParticipantId(uid);
    const joined = filterJoinedMeetings(meetings, userId);
    const meetingById = new Map(meetings.map((m) => [m.id, m]));

    sweepStaleSelfMeetingChanges();

    for (const j of joined) {
      const mid = j.id;
      const m = meetingById.get(mid);
      if (!m) continue;
      // 1) 호스트: 참여자 입장/퇴장 — headsUpReady 전에도 새 소식에 쌓이게(채팅 최신 구독 지연과 무관)
      const myIsHost = normalizeParticipantId(m.createdBy?.trim() ?? '') === myPk;
      if (myIsHost) {
        const hasPrev = Object.prototype.hasOwnProperty.call(prevParticipantSetRef.current, mid);
        const prevLine = hasPrev ? (prevParticipantSetRef.current[mid] ?? '') : '';
        const nextLine = (Array.isArray(m.participantIds) ? m.participantIds : [])
          .map((x) => normalizeParticipantId(String(x)) || '')
          .filter(Boolean)
          .sort()
          .join('|');
        if (hasPrev && prevLine !== nextLine) {
          const prevSet = new Set(prevLine ? prevLine.split('|').filter(Boolean) : []);
          const nextSet = new Set(nextLine ? nextLine.split('|').filter(Boolean) : []);
          const added = [...nextSet].filter((x) => !prevSet.has(x));
          const removed = [...prevSet].filter((x) => !nextSet.has(x));
          const delta = [...added, ...removed];
          if (delta.length > 0) {
            void (async () => {
              try {
                const map = await getUserProfilesForIds(delta);
                const nick = (id: string) => {
                  if (isGinitWebGuestParticipantId(id)) {
                    const w = webGuestDisplayNameFromMeeting(m, id)?.trim();
                    if (w) return w;
                  }
                  return map.get(id)?.nickname?.trim() || '참여자';
                };
                let msg = '';
                const prevN = prevSet.size;
                const nextN = nextSet.size;
                if (nextN > prevN && added.length > 0) {
                  msg =
                    added.length === 1
                      ? `${nick(added[0]!)}님이 참여하셨습니다.`
                      : `${added.length}명이 참여하셨습니다.`;
                } else if (nextN < prevN && removed.length > 0) {
                  msg =
                    removed.length === 1
                      ? `${nick(removed[0]!)}님이 나갔습니다.`
                      : `${removed.length}명이 나갔습니다.`;
                } else if (added.length > 0 && removed.length === 0) {
                  msg =
                    added.length === 1
                      ? `${nick(added[0]!)}님이 참여하셨습니다.`
                      : `${added.length}명이 참여하셨습니다.`;
                } else if (removed.length > 0 && added.length === 0) {
                  msg =
                    removed.length === 1
                      ? `${nick(removed[0]!)}님이 나갔습니다.`
                      : `${removed.length}명이 나갔습니다.`;
                } else if (added.length > 0 && removed.length > 0) {
                  msg = '참여자가 변경되었습니다.';
                }
                if (msg) {
                  const now = Date.now();
                  const evId = `${mid}:${now}:${Math.random().toString(36).slice(2)}`;
                  setHostParticipantEventLog((prev) => {
                    const cur = prev[mid] ?? [];
                    const nextEv = [{ id: evId, subtitle: msg, sortMs: now }, ...cur].slice(0, 50);
                    return { ...prev, [mid]: nextEv };
                  });
                }
              } catch {
                const now = Date.now();
                const evId = `${mid}:${now}:${Math.random().toString(36).slice(2)}`;
                const msg =
                  added.length && !removed.length
                    ? added.length === 1
                      ? '새 참여자가 들어왔어요.'
                      : `${added.length}명이 참여하셨습니다.`
                    : removed.length && !added.length
                      ? removed.length === 1
                        ? '참여자가 나갔어요.'
                        : `${removed.length}명이 나갔습니다.`
                      : '참여자가 변경되었습니다.';
                setHostParticipantEventLog((prev) => {
                  const cur = prev[mid] ?? [];
                  const nextEv = [{ id: evId, subtitle: msg, sortMs: now }, ...cur].slice(0, 50);
                  return { ...prev, [mid]: nextEv };
                });
              }
            })();
          }
        }
        prevParticipantSetRef.current[mid] = nextLine;
      }

      if (!headsUpReady) {
        prevMeetingSnapshotRef.current[mid] = m;
        continue;
      }

      const fp = meetingInfoFingerprint(m);
      const ack = readState.meetingAckFingerprint[mid];
      if (ack !== undefined && fp !== ack) {
        // 내가 방금(상세 화면에서) 바꾼 모임이면: 알람/푸시는 띄우지 않고 ACK만 갱신합니다.
        if (wasRecentSelfMeetingChange(mid)) {
          setReadState((prev) => ({
            ...prev,
            meetingAckFingerprint: { ...prev.meetingAckFingerprint, [mid]: fp },
          }));
          prevMeetingSnapshotRef.current[mid] = m;
          continue;
        }

        const dedupeKey = `m:${mid}:${fp}`;
        if (pushDedupeRef.current.has(dedupeKey)) continue;
        pushDedupeRef.current.add(dedupeKey);

        const prevSnap = prevMeetingSnapshotRef.current[mid] ?? null;
        const preview = buildMeetingChangePreview(prevSnap, m);
        meetingChangePreviewRef.current[mid] = preview;

        // 중복 방지: 모임 변경은 새소식 패널/배지로만 반영하고 원격 푸시는 보내지 않습니다.
      }

      prevMeetingSnapshotRef.current[mid] = m;
    }
  }, [persistReady, userId, headsUpReady, meetings, readState.meetingAckFingerprint, buildMeetingChangePreview]);

  const alarms = useMemo(() => {
    const joined = filterJoinedMeetings(meetings, userId);
    const meetingById = new Map(meetings.map((m) => [m.id, m]));
    const myPk = userId?.trim() ? normalizeParticipantId(userId.trim()) : '';
    const rows: InAppAlarmRow[] = [];
    for (const j of joined) {
      const mid = j.id;
      const m = meetingById.get(mid);
      if (!m) continue;
      if (mid in latestById) {
        const latest = latestById[mid];
        const readChatId = readState.chatReadMessageId[mid] ?? '';
        const latestId = latest?.id ?? '';
        if (latestId && latestId !== readChatId) {
          const chatTs = chatMessageTimeMs(latest ?? null);
          rows.push({
            id: `chat:${mid}:${latestId}`,
            kind: 'chat',
            meetingId: mid,
            meetingTitle: m.title?.trim() || '모임',
            subtitle: latest ? previewLine(latest) : '새 메시지',
            sortMs: chatTs > 0 ? chatTs : Date.now(),
            latestMessageId: latestId,
          });
        }
      }
      const fp = meetingInfoFingerprint(m);
      const ack = readState.meetingAckFingerprint[mid];
      const isHost = Boolean(myPk) && normalizeParticipantId(m.createdBy?.trim() ?? '') === myPk;
      if (isHost) {
        const evs = hostParticipantEventLog[mid] ?? [];
        for (const ev of evs) {
          rows.push({
            id: `host:${ev.id}`,
            kind: 'meeting_change',
            meetingId: mid,
            meetingTitle: m.title?.trim() || '모임',
            subtitle: ev.subtitle,
            sortMs: ev.sortMs,
          });
        }
      }
      if (ack !== undefined && fp !== ack) {
        const previewRaw = meetingChangePreviewRef.current[mid];
        const preview =
          typeof previewRaw === 'string' && previewRaw.trim()
            ? previewRaw.trim()
            : '참여 중인 모임 정보가 바뀌었어요.';
        const skipFingerprintRow =
          isHost && MEETING_FP_PREVIEW_PARTICIPANTS_ONLY.has(preview);
        if (!skipFingerprintRow) {
          rows.push({
            id: `meeting:${mid}:${fp}`,
            kind: 'meeting_change',
            meetingId: mid,
            meetingTitle: m.title?.trim() || '모임',
            subtitle: preview,
            sortMs: meetingAlarmSinceMs[mid] ?? Date.now(),
          });
        }
      }
    }
    for (const fr of friendInbox) {
      const frid = String(fr.id ?? '').trim();
      if (!frid) continue;
      if (readState.friendRequestDismissedIds[frid]) continue;
      const createdMs = fr.created_at ? Date.parse(fr.created_at) : NaN;
      const sortMs = Number.isFinite(createdMs) ? createdMs : Date.now();
      const nick = friendRequesterNickById.get(fr.requester_app_user_id) ?? '친구';
      rows.push({
        id: `friend:${frid}`,
        kind: 'friend_request',
        meetingId: frid,
        meetingTitle: nick,
        subtitle: '친구 요청이 왔어요. 탭하면 친구 화면에서 수락할 수 있어요.',
        sortMs,
        requesterAppUserId: fr.requester_app_user_id,
      });
    }
    for (const it of friendAcceptQueue) {
      const fid = it.friendshipId.trim();
      if (!fid || readState.friendAcceptedDismissedIds[fid]) continue;
      const nick = friendAcceptPeerNickById.get(it.peerAppUserId) ?? '친구';
      rows.push({
        id: `friend_accepted:${fid}`,
        kind: 'friend_accepted',
        meetingId: fid,
        meetingTitle: nick,
        subtitle: '친구 요청을 수락했어요. 탭하면 친구 화면으로 이동해요.',
        sortMs: it.sortMs,
        peerAppUserId: it.peerAppUserId,
      });
    }
    for (const inv of meetingInviteInbox) {
      const payload = parseMeetingFriendInvitePayload(inv.payload);
      if (!payload) continue;
      const nid = inv.id.trim();
      if (!nid) continue;
      rows.push({
        id: `meeting_invite:${nid}`,
        kind: 'meeting_invite',
        meetingId: payload.meetingId,
        meetingTitle: payload.meetingTitle,
        subtitle: meetingFriendInviteAlarmSubtitle(payload),
        sortMs: meetingFriendInviteAlarmSortMs(inv),
        notificationId: nid,
        inviterAppUserId: payload.inviterAppUserId || undefined,
      });
    }
    for (const rev of meetingPlaceReviewInbox) {
      const payload = parseMeetingPlaceReviewPayload(rev.payload);
      if (!payload) continue;
      const nid = rev.id.trim();
      if (!nid) continue;
      rows.push({
        id: `meeting_place_review:${nid}`,
        kind: 'meeting_place_review',
        meetingId: payload.meetingId,
        meetingTitle: payload.meetingTitle,
        subtitle: meetingPlaceReviewAlarmSubtitle(payload),
        sortMs: meetingPlaceReviewAlarmSortMs(rev),
        placeReviewNotificationId: nid,
      });
    }
    for (const ac of autoCancelUnconfirmedAlarms) {
      rows.push({
        id: ac.id,
        kind: 'meeting_auto_cancelled',
        meetingId: ac.meetingId,
        meetingTitle: ac.meetingTitle,
        subtitle: ac.subtitle,
        sortMs: ac.sortMs,
      });
    }
    for (const n of noticeInboxAlarms) {
      const noticeId = n.noticeId.trim();
      if (!noticeId) continue;
      const inboxId = n.inboxId.trim();
      rows.push({
        id: `notice:${inboxId || noticeId}`,
        kind: 'notice',
        meetingId: noticeId,
        meetingTitle: noticeInboxAlarmTitle(n),
        subtitle: noticeInboxAlarmSubtitle(n),
        sortMs: noticeInboxAlarmSortMs(n),
        noticeInboxId: inboxId || undefined,
        noticeId,
      });
    }
    for (const sr of socialRooms) {
      const rid = sr.roomId.trim();
      if (!rid) continue;
      const latest = socialLatestByRoomId[rid];
      const latestId = latest?.id ?? '';
      const readChatId = readState.chatReadMessageId[rid] ?? '';
      if (!latestId || latestId === readChatId) continue;
      const chatTs = socialMessageTimeMs(latest ?? null);
      const nick = socialPeerNickByRoomId.get(rid) ?? '친구';
      rows.push({
        id: `social:${rid}:${latestId}`,
        kind: 'social_dm',
        meetingId: rid,
        socialRoomId: rid,
        meetingTitle: nick,
        subtitle: socialDmPreviewLine(latest),
        sortMs: chatTs > 0 ? chatTs : Date.now(),
        latestMessageId: latestId,
      });
    }
    rows.sort((a, b) => b.sortMs - a.sortMs);
    return rows;
  }, [
    meetings,
    userId,
    latestById,
    readState,
    meetingAlarmSinceMs,
    hostParticipantEventLog,
    friendInbox,
    friendRequesterNickById,
    friendAcceptQueue,
    friendAcceptPeerNickById,
    socialRooms,
    socialLatestByRoomId,
    socialPeerNickByRoomId,
    meetingInviteInbox,
    meetingPlaceReviewInbox,
    autoCancelUnconfirmedAlarms,
    noticeInboxAlarms,
  ]);

  const hasUnread = alarms.length > 0;

  /**
   * 새 소식 모달: 카드는 헤더·목록만큼만 높이를 쓰고, 화면에 넘치면 목록 영역만 스크롤합니다.
   * (행 실측 대신 고정 추정 — 폰트 스케일과 크게 어긋나지 않도록 여유를 둡니다.)
   */
  const alarmPanelLayout = useMemo(() => {
    const topUsed = insets.top + 8;
    const bottomPad = insets.bottom + 12;
    const cardMaxHeight = Math.max(200, Math.floor(windowHeight - topUsed - bottomPad));
    const headerBlock = 56;
    const markAllBlock = alarms.length > 0 ? 52 : 0;
    const listContentPaddingV = 18; // listContent: paddingVertical 6 + paddingBottom 12
    const alarmRowEstimate = 100;
    const intrinsicListHeight =
      alarms.length > 0 ? listContentPaddingV + alarms.length * alarmRowEstimate : 0;
    const listScrollMax = Math.max(0, cardMaxHeight - headerBlock - markAllBlock);
    const listHeight =
      alarms.length > 0
        ? listScrollMax > 0
          ? Math.min(intrinsicListHeight, listScrollMax)
          : Math.min(intrinsicListHeight, 120)
        : 0;
    const listOverflow = alarms.length > 0 && intrinsicListHeight > listHeight;
    return { cardMaxHeight, listHeight, listOverflow };
  }, [windowHeight, insets.top, insets.bottom, alarms.length]);

  const friendsTabPendingRequestBadge = useMemo(() => {
    if (friendInbox.length === 0) return 0;
    const dismissed = readState.friendRequestDismissedIds;
    return friendInbox.filter((fr) => {
      const fid = String(fr.id ?? '').trim();
      return fid ? !dismissed[fid] : false;
    }).length;
  }, [friendInbox, readState.friendRequestDismissedIds]);

  /** 채팅 미읽음(Watermelon·서버 동기화) + 친구 요청 대기 — 런처 배지 */
  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (!userId?.trim()) {
      void Notifications.setBadgeCountAsync(0).catch(() => {});
      return;
    }
    if (!persistReady) {
      void Notifications.setBadgeCountAsync(0).catch(() => {});
      return;
    }
    const n = chatTabUnreadTotal + friendsTabPendingRequestBadge;
    const badge = n > 0 ? Math.min(n, 999) : 0;
    void Notifications.setBadgeCountAsync(badge).catch(() => {});
  }, [persistReady, userId, chatTabUnreadTotal, friendsTabPendingRequestBadge]);

  // NOTE: 채팅 탭 배지 합계는 Watermelon `chat_rooms.unread_count` 합(`useWatermelonChatUnreadTotal`)이며,
  // owner·룸 필터는 `app/(tabs)/chat.tsx`의 `useChatRoomListEngine`과 동일합니다.

  // social chat room docs — 초기 스냅샷만 RPC. 이후 최신 메시지 스텁은 `user_notifications` 브로드캐스트.
  useEffect(() => {
    const uid = userId?.trim() ?? '';
    if (!persistReady || !uid) {
      setSocialRoomDocById({});
      return;
    }
    if (socialRooms.length === 0) {
      setSocialRoomDocById({});
      return;
    }
    let cancelled = false;
    void (async () => {
      const next: Record<string, SocialChatRoomDoc> = {};
      for (const r of socialRooms) {
        if (cancelled) return;
        const doc = await fetchSocialChatRoomDocOnce(r.roomId, uid);
        if (cancelled) return;
        if (doc) next[r.roomId] = doc;
      }
      if (cancelled) return;
      setSocialRoomDocById((prev) => {
        const out: Record<string, SocialChatRoomDoc | null | undefined> = { ...prev };
        for (const k of Object.keys(out)) {
          if (!socialRooms.some((x) => x.roomId === k)) delete out[k];
        }
        for (const [k, v] of Object.entries(next)) {
          out[k] = v;
        }
        return out;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [persistReady, userId, socialRoomsKey, socialRooms]);

  const markChatReadUpTo = useCallback((meetingId: string, messageId: string | undefined) => {
    const mid = meetingId.trim();
    if (!mid) return;
    const id = messageId?.trim();
    if (!id) return;
    ginitNotifyDbg('InAppAlarms', 'mark_chat_read_up_to', { meetingId: mid, messageIdSuffix: id.slice(-8) });
    setReadState((p) => ({
      ...p,
      chatReadMessageId: { ...p.chatReadMessageId, [mid]: id },
    }));
    const uid = userIdRef.current?.trim() ?? '';
    if (uid && !mid.startsWith('social_')) {
      void clearMeetingChatUnreadForUser(mid, uid).catch(() => {});
    }
  }, []);

  const syncMeetingAckFromMeeting = useCallback((meeting: Meeting) => {
    const mid = meeting.id?.trim();
    if (!mid) return;
    const fp = meetingInfoFingerprint(meeting);
    setReadState((p) => ({
      ...p,
      meetingAckFingerprint: { ...p.meetingAckFingerprint, [mid]: fp },
    }));
  }, []);

  const markMeetingAlarmsReadByPushTap = useCallback((meeting: Meeting) => {
    const mid = meeting.id?.trim();
    if (!mid) return;
    const fp = meetingInfoFingerprint(meeting);
    setReadState((p) => ({
      ...p,
      meetingAckFingerprint: { ...p.meetingAckFingerprint, [mid]: fp },
    }));
    setMeetingAlarmSinceMs((prev) => {
      if (!(mid in prev)) return prev;
      const next = { ...prev };
      delete next[mid];
      return next;
    });
    setHostParticipantEventLog((prev) => {
      if (!prev[mid]?.length) return prev;
      const next = { ...prev };
      delete next[mid];
      return next;
    });
    const uid = userId?.trim();
    if (uid) {
      void markMeetingFriendInviteNotificationsReadForMeeting(mid, uid).catch((e) => {
        if (__DEV__) console.warn('[InAppAlarms] mark meeting invite read', e);
      });
    }
  }, [userId]);

  const markFriendRequestAlarmDismissed = useCallback((friendshipId: string) => {
    const fid = friendshipId.trim();
    if (!fid) return;
    setReadState((p) => ({
      ...p,
      friendRequestDismissedIds: { ...p.friendRequestDismissedIds, [fid]: true },
    }));
  }, []);

  const markFriendAcceptedAlarmDismissed = useCallback((friendshipId: string) => {
    const fid = friendshipId.trim();
    if (!fid) return;
    setReadState((p) => ({
      ...p,
      friendAcceptedDismissedIds: { ...p.friendAcceptedDismissedIds, [fid]: true },
    }));
    setFriendAcceptQueue((q) => q.filter((x) => x.friendshipId !== fid));
  }, []);

  const markMeetingInviteReadByMeetingId = useCallback(
    (meetingId: string) => {
      const mid = meetingId.trim();
      const uid = userId?.trim();
      if (!mid || !uid) return;
      void markMeetingFriendInviteNotificationsReadForMeeting(mid, uid).catch((e) => {
        if (__DEV__) console.warn('[InAppAlarms] mark meeting invite read by meeting', e);
      });
    },
    [userId],
  );

  const reloadFriendInbox = useCallback(() => {
    const uid = normalizeParticipantId(userIdRef.current?.trim() ?? '') || userIdRef.current?.trim() || '';
    if (!uid) {
      setFriendInbox([]);
      return;
    }
    void fetchFriendsPendingInbox(uid)
      .then((inbox) => setFriendInbox(inbox))
      .catch((e) => {
        ginitNotifyDbg('InAppAlarms', 'friends_pending_inbox_failed', { message: String(e) });
        if (__DEV__) console.warn('[InAppAlarms] friends_pending_inbox refresh', e);
      });
  }, []);

  const openAlarmPanel = useCallback(() => {
    setPanelOpen(true);
    reloadFriendInbox();
    refreshMeetingInviteInbox();
    refreshNoticeInboxAlarms();
  }, [reloadFriendInbox, refreshMeetingInviteInbox, refreshNoticeInboxAlarms]);
  const closeAlarmPanel = useCallback(() => setPanelOpen(false), []);

  /** 홈 탐색 피드·내 모임 목록은 증분(summary→변경 ID만 fetch), 해당 모임 상세만 invalidate */
  const requestHomeMeetingsAndDetailRefresh = useCallback(
    (meetingId: string) => {
      const mid = meetingId.trim();
      if (!mid) return;
      void runMeetingsListIncrementalReconcile(queryClient, userId?.trim() ?? null);
      void queryClient.invalidateQueries({ queryKey: meetingDetailQueryKey(mid) });
    },
    [queryClient, userId],
  );

  const markAllAlarmsAsRead = useCallback(() => {
    const joined = filterJoinedMeetings(meetings, userId);
    const meetingById = new Map(meetings.map((m) => [m.id, m]));
    setReadState((prev) => {
      const chatReadMessageId = { ...prev.chatReadMessageId };
      const meetingAckFingerprint = { ...prev.meetingAckFingerprint };
      const friendRequestDismissedIds = { ...prev.friendRequestDismissedIds };
      const friendAcceptedDismissedIds = { ...(prev.friendAcceptedDismissedIds ?? {}) };
      for (const j of joined) {
        const mid = j.id;
        const m = meetingById.get(mid);
        if (!m) continue;
        meetingAckFingerprint[mid] = meetingInfoFingerprint(m);
        if (mid in latestById) {
          const latest = latestById[mid];
          chatReadMessageId[mid] = latest?.id ?? '';
        }
      }
      for (const sr of socialRooms) {
        const rid = sr.roomId.trim();
        if (!rid) continue;
        const latest = socialLatestByRoomId[rid];
        chatReadMessageId[rid] = latest?.id ?? '';
      }
      for (const it of friendAcceptQueue) {
        const fid = it.friendshipId.trim();
        if (fid) friendAcceptedDismissedIds[fid] = true;
      }
      return { ...prev, chatReadMessageId, meetingAckFingerprint, friendRequestDismissedIds, friendAcceptedDismissedIds };
    });
    const uid = userId?.trim() ?? '';
    if (uid) {
      for (const inv of meetingInviteInbox) {
        const nid = inv.id.trim();
        if (!nid) continue;
        void markMeetingFriendInviteNotificationRead(nid, uid).catch(() => {});
      }
      for (const rev of meetingPlaceReviewInbox) {
        const nid = rev.id.trim();
        if (!nid) continue;
        void markMeetingPlaceReviewNotificationRead(nid, uid).catch(() => {});
      }
      for (const n of noticeInboxAlarms) {
        void markNoticeInboxAlarmRead(n).catch(() => {});
      }
      void dismissAllMeetingAutoCancelUnconfirmedAlarms(uid);
    }
    setFriendAcceptQueue([]);
    setHostParticipantEventLog({});
    setNoticeInboxAlarms([]);
  }, [
    meetings,
    userId,
    latestById,
    friendInbox,
    friendAcceptQueue,
    socialRooms,
    socialLatestByRoomId,
    meetingInviteInbox,
    meetingPlaceReviewInbox,
    noticeInboxAlarms,
  ]);

  const onPressAlarmRow = useCallback(
    (row: InAppAlarmRow) => {
      if (row.kind === 'friend_request') {
        const fid = row.meetingId.trim();
        if (fid) markFriendRequestAlarmDismissed(fid);
        closeAlarmPanel();
        router.push('/(tabs)/friends');
        return;
      }
      if (row.kind === 'friend_accepted') {
        const fid = row.meetingId.trim();
        if (fid) markFriendAcceptedAlarmDismissed(fid);
        closeAlarmPanel();
        router.push('/(tabs)/friends');
        return;
      }
      if (row.kind === 'chat') {
        const lid = row.latestMessageId?.trim() ?? '';
        if (lid) {
          setReadState((p) => ({
            ...p,
            chatReadMessageId: { ...p.chatReadMessageId, [row.meetingId]: lid },
          }));
        }
        closeAlarmPanel();
        if (!isMeetingListedForAlarmNavigation(row.meetingId, meetings)) return;
        requestHomeMeetingsAndDetailRefresh(row.meetingId);
        const latest = latestById[row.meetingId];
        const latestId = (latest?.id ?? '').trim();
        const senderRaw = typeof latest?.senderId === 'string' ? latest.senderId.trim() : '';
        const senderNs = senderRaw ? normalizeParticipantId(senderRaw) : '';
        const openMeetingDetailForWebGuestChat =
          Boolean(lid && latestId === lid && senderNs && isGinitWebGuestParticipantId(senderNs));
        InteractionManager.runAfterInteractions(() => {
          if (openMeetingDetailForWebGuestChat) {
            router.push(`/meeting/${row.meetingId}`);
            return;
          }
          router.push(`/meeting-chat/${row.meetingId}`);
        });
        return;
      }
      if (row.kind === 'social_dm') {
        const rid = (row.socialRoomId ?? row.meetingId).trim();
        const lid = row.latestMessageId?.trim() ?? '';
        if (rid && lid) {
          setReadState((p) => ({
            ...p,
            chatReadMessageId: { ...p.chatReadMessageId, [rid]: lid },
          }));
        }
        closeAlarmPanel();
        const peerName = encodeURIComponent(row.meetingTitle.trim() || '친구');
        router.push(`/social-chat/${encodeURIComponent(rid)}?peerName=${peerName}`);
        return;
      }
      if (row.kind === 'meeting_invite') {
        const uid = userId?.trim() ?? '';
        const nid = row.notificationId?.trim() ?? '';
        if (uid && nid) {
          void markMeetingFriendInviteNotificationRead(nid, uid).catch(() => {});
        }
        closeAlarmPanel();
        void (async () => {
          const mid = row.meetingId.trim();
          if (!mid) return;
          const doc = await getMeetingById(mid).catch(() => null);
          if (!doc) return;
          requestHomeMeetingsAndDetailRefresh(mid);
          InteractionManager.runAfterInteractions(() => {
            router.push(`/meeting/${mid}`);
          });
        })();
        return;
      }
      if (row.kind === 'meeting_place_review') {
        const uid = userId?.trim() ?? '';
        const nid = row.placeReviewNotificationId?.trim() ?? '';
        if (uid && nid) {
          void markMeetingPlaceReviewNotificationRead(nid, uid).catch(() => {});
        }
        closeAlarmPanel();
        const mid = row.meetingId.trim();
        if (!mid) return;
        requestHomeMeetingsAndDetailRefresh(mid);
        InteractionManager.runAfterInteractions(() => {
          router.push(buildMeetingFlowHref({ kind: 'meeting-review', meetingId: mid }, '/(tabs)'));
        });
        return;
      }
      if (row.kind === 'meeting_auto_cancelled') {
        const uid = userId?.trim() ?? '';
        if (uid) void dismissMeetingAutoCancelUnconfirmedAlarm(uid, row.id);
        closeAlarmPanel();
        const mid = row.meetingId.trim();
        if (!mid) return;
        requestHomeMeetingsAndDetailRefresh(mid);
        InteractionManager.runAfterInteractions(() => {
          router.push(`/meeting/${mid}`);
        });
        return;
      }
      if (row.kind === 'notice') {
        const noticeId = row.noticeId?.trim() ?? row.meetingId.trim();
        if (!noticeId) return;
        const item = noticeInboxAlarms.find((n) => n.noticeId.trim() === noticeId);
        closeAlarmPanel();
        void (async () => {
          if (item) {
            try {
              await markNoticeInboxAlarmRead(item);
            } catch {
              /* best-effort */
            }
          }
          const linkUrl = item?.linkUrl ?? null;
          InteractionManager.runAfterInteractions(() => {
            navigateFromNoticeLink(router, { noticeId, linkUrl });
          });
        })();
        return;
      }
      const m = meetings.find((x) => x.id === row.meetingId);
      if (m) {
        const fp = meetingInfoFingerprint(m);
        setReadState((p) => ({
          ...p,
          meetingAckFingerprint: { ...p.meetingAckFingerprint, [row.meetingId]: fp },
        }));
      }
      setHostParticipantEventLog((prev) => {
        if (!prev[row.meetingId]?.length) return prev;
        const next = { ...prev };
        delete next[row.meetingId];
        return next;
      });
      delete meetingChangePreviewRef.current[row.meetingId];
      closeAlarmPanel();
      if (!isMeetingListedForAlarmNavigation(row.meetingId, meetings)) return;
      requestHomeMeetingsAndDetailRefresh(row.meetingId);
      InteractionManager.runAfterInteractions(() => {
        router.push(`/meeting/${row.meetingId}`);
      });
    },
    [
      closeAlarmPanel,
      latestById,
      markFriendAcceptedAlarmDismissed,
      markFriendRequestAlarmDismissed,
      meetings,
      noticeInboxAlarms,
      requestHomeMeetingsAndDetailRefresh,
      router,
      userId,
    ],
  );

  const ctx = useMemo<InAppAlarmsContextValue>(
    () => ({
      hasUnread,
      alarms,
      openAlarmPanel,
      closeAlarmPanel,
      alarmPanelVisible: panelOpen,
      chatTabUnreadTotal,
      friendsTabPendingRequestBadge,
      meetingChatReadMessageIdMap: readState.chatReadMessageId,
      markChatReadUpTo,
      syncMeetingAckFromMeeting,
      markMeetingAlarmsReadByPushTap,
      markFriendRequestAlarmDismissed,
      markFriendAcceptedAlarmDismissed,
      markMeetingInviteReadByMeetingId,
    }),
    [
      hasUnread,
      alarms,
      openAlarmPanel,
      closeAlarmPanel,
      panelOpen,
      chatTabUnreadTotal,
      friendsTabPendingRequestBadge,
      readState.chatReadMessageId,
      markChatReadUpTo,
      syncMeetingAckFromMeeting,
      markMeetingAlarmsReadByPushTap,
      markFriendRequestAlarmDismissed,
      markFriendAcceptedAlarmDismissed,
      markMeetingInviteReadByMeetingId,
      noticeInboxAlarms,
    ],
  );

  return (
    <InAppAlarmsContext.Provider value={ctx}>
      {children}
      <Modal
        visible={panelOpen}
        transparent
        animationType="fade"
        onRequestClose={closeAlarmPanel}>
        <GinitPressable style={styles.modalBackdrop} onPress={closeAlarmPanel}>
          <GinitPressable
            style={[
              styles.modalCard,
              { marginTop: insets.top + 8, maxHeight: alarmPanelLayout.cardMaxHeight },
            ]}
            onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>새 소식</Text>
              <GinitPressable hitSlop={12} onPress={closeAlarmPanel} accessibilityRole="button" accessibilityLabel="닫기">
                <GinitSymbolicIcon name="close" size={26} color="#475569" />
              </GinitPressable>
            </View>
            {alarms.length > 0 ? (
              <View style={styles.markAllRow}>
                <GinitPressable
                  onPress={markAllAlarmsAsRead}
                  hitSlop={{ top: 6, bottom: 10, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel="모두 읽음 처리"
                  style={({ pressed }) => [styles.markAllBtn, pressed && styles.markAllBtnPressed]}>
                  <Text style={styles.markAllBtnText}>모두 읽음 처리</Text>
                </GinitPressable>
              </View>
            ) : null}
            {alarms.length === 0 ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyText}>확인하지 않은 새 소식이 없어요.</Text>
              </View>
            ) : (
              <FlatList
                data={alarms}
                keyExtractor={(item) => item.id}
                // 모달 내부는 FlashList(RecyclerView) 측정·재사용 이슈로 행이 비어 보이는 사례가 있어 짧은 목록은 FlatList로 고정합니다.
                style={{ height: alarmPanelLayout.listHeight, flexGrow: 0 }}
                removeClippedSubviews={false}
                contentContainerStyle={styles.listContent}
                keyboardShouldPersistTaps="handled"
                scrollEnabled={alarmPanelLayout.listOverflow}
                nestedScrollEnabled
                renderItem={({ item }) => (
                  <GinitPressable
                    style={({ pressed }) => [styles.alarmRow, pressed && styles.alarmRowPressed]}
                    onPress={() => onPressAlarmRow(item)}>
                    <View style={styles.alarmIconWrap}>
                      <GinitSymbolicIcon
                        name={
                          item.kind === 'notice'
                            ? 'megaphone-outline'
                            : item.kind === 'chat' || item.kind === 'social_dm'
                              ? 'chatbubble-ellipses-outline'
                              : item.kind === 'friend_request' || item.kind === 'meeting_invite'
                                ? 'person-add-outline'
                                : item.kind === 'meeting_place_review'
                                  ? 'pencil'
                                  : item.kind === 'friend_accepted'
                                    ? 'checkmark-done-outline'
                                    : 'calendar-outline'
                        }
                        size={22}
                        color={GinitTheme.themeMainColor}
                      />
                    </View>
                    <View style={styles.alarmTextCol}>
                      <Text style={styles.alarmTitle} numberOfLines={1}>
                        {item.meetingTitle}
                      </Text>
                      <Text style={styles.alarmSub} numberOfLines={2}>
                        {item.subtitle}
                      </Text>
                      <Text style={styles.alarmTime}>{formatAlarmTime(item.sortMs)}</Text>
                    </View>
                    <GinitSymbolicIcon name="chevron-forward" size={20} color="#94a3b8" />
                  </GinitPressable>
                )}
              />
            )}
          </GinitPressable>
        </GinitPressable>
      </Modal>
    </InAppAlarmsContext.Provider>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingHorizontal: 18,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.35)',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(148, 163, 184, 0.4)',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#0f172a',
  },
  markAllRow: {
    paddingHorizontal: 16,
    paddingTop: 0,
    paddingBottom: 10,
    alignItems: 'flex-end',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(148, 163, 184, 0.35)',
  },
  markAllBtn: {
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  markAllBtnPressed: {
    opacity: 0.72,
  },
  markAllBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: GinitTheme.themeMainColor,
  },
  listContent: {
    paddingVertical: 6,
    paddingBottom: 12,
  },
  alarmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  alarmRowPressed: {
    backgroundColor: 'rgba(241, 245, 249, 0.9)',
  },
  alarmIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(59, 130, 246, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  alarmTextCol: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  alarmTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },
  alarmSub: {
    fontSize: 13,
    color: '#475569',
    lineHeight: 18,
  },
  alarmTime: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 2,
  },
  emptyBox: {
    paddingVertical: 28,
    paddingHorizontal: 16,
  },
  emptyText: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
  },
});
