import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AppState,
  type AppStateStatus,
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GinitTheme } from '@/constants/ginit-theme';
import { useUserSession } from '@/src/context/UserSessionContext';
import {
  chatMessageTimeMs,
  defaultInAppAlarmReadState,
  type InAppAlarmReadState,
  type InAppAlarmRow,
  meetingChangeFingerprint,
} from '@/src/lib/in-app-alarms';
import { notifyInAppAlarmHeadsUpFireAndForget } from '@/src/lib/in-app-alarm-push';
import { loadInAppAlarmReadState, saveInAppAlarmReadState } from '@/src/lib/in-app-alarms-persistence';
import { filterJoinedMeetings } from '@/src/lib/joined-meetings';
import type { MeetingChatMessage } from '@/src/lib/meeting-chat';
import { subscribeMeetingChatLatestMessage } from '@/src/lib/meeting-chat';
import { sweepStalePublicUnconfirmedMeetingsForHost } from '@/src/lib/meeting-expiry-sweep';
import type { Meeting } from '@/src/lib/meetings';
import { subscribeMeetingsHybrid } from '@/src/lib/meetings-hybrid';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { getUserProfilesForIds } from '@/src/lib/user-profile';

function previewLine(m: MeetingChatMessage): string {
  if (m.kind === 'system') return m.text?.trim() ? m.text.trim() : '알림';
  if (m.kind === 'image') return m.text?.trim() ? `사진 · ${m.text.trim()}` : '사진';
  const t = m.text?.trim();
  if (t) return t.length > 100 ? `${t.slice(0, 100)}…` : t;
  return '새 메시지';
}

function formatAlarmTime(sortMs: number): string {
  if (!sortMs) return '';
  try {
    const d = new Date(sortMs);
    return d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

type InAppAlarmsContextValue = {
  hasUnread: boolean;
  alarms: InAppAlarmRow[];
  openAlarmPanel: () => void;
  closeAlarmPanel: () => void;
  alarmPanelVisible: boolean;
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
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
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

  const readStateRef = useRef(readState);
  readStateRef.current = readState;
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  /** 동일 메시지·동일 모임 지문에 대한 푸시 중복 방지 */
  const pushDedupeRef = useRef<Set<string>>(new Set());
  const prevParticipantSetRef = useRef<Record<string, string>>({});

  useEffect(() => {
    if (!userId?.trim()) {
      setPersistReady(false);
      setMeetings([]);
      setLatestById({});
      setReadState(defaultInAppAlarmReadState());
      setMeetingAlarmSinceMs({});
      setHostParticipantEventLog({});
      setPanelOpen(false);
      pushDedupeRef.current = new Set();
      prevParticipantSetRef.current = {};
      return;
    }
    let cancelled = false;
    void loadInAppAlarmReadState(userId).then((s) => {
      if (cancelled) return;
      setReadState(s);
      setPersistReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

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

  useEffect(() => {
    if (!userId?.trim()) return;
    return subscribeMeetingsHybrid(
      (list) => setMeetings(list),
      () => {
        /* 목록 오류는 각 탭에서 처리 */
      },
    );
  }, [userId]);

  const joinedKey = useMemo(() => {
    const joined = filterJoinedMeetings(meetings, userId);
    return joined
      .map((m) => m.id)
      .sort()
      .join('\u0001');
  }, [meetings, userId]);

  useEffect(() => {
    const uid = userId?.trim();
    if (!uid || meetings.length === 0) return;
    void sweepStalePublicUnconfirmedMeetingsForHost(uid, meetings);
  }, [userId, meetings]);

  useEffect(() => {
    if (!userId?.trim() || !persistReady) return;
    const joined = filterJoinedMeetings(meetings, userId);
    if (joined.length === 0) return;
    const unsubs = joined.map((m) =>
      subscribeMeetingChatLatestMessage(
        m.id,
        (msg) => {
          setLatestById((p) => ({ ...p, [m.id]: msg }));
        },
        () => {
          setLatestById((p) => ({ ...p, [m.id]: null }));
        },
      ),
    );
    return () => {
      unsubs.forEach((u) => u());
    };
  }, [userId, persistReady, joinedKey, meetings]);

  useEffect(() => {
    if (!persistReady || !userId?.trim()) return;
    const joined = filterJoinedMeetings(meetings, userId);
    if (joined.length === 0) return;

    setReadState((prev) => {
      let chatReadMessageId = { ...prev.chatReadMessageId };
      let meetingAckFingerprint = { ...prev.meetingAckFingerprint };
      let changed = false;

      for (const m of joined) {
        if (meetingAckFingerprint[m.id] === undefined) {
          meetingAckFingerprint[m.id] = meetingChangeFingerprint(m);
          changed = true;
        }
        if (!(m.id in latestById)) continue;
        const latest = latestById[m.id];
        if (chatReadMessageId[m.id] === undefined) {
          chatReadMessageId[m.id] = latest?.id ?? '';
          changed = true;
        }
      }

      if (!changed) return prev;
      return { chatReadMessageId, meetingAckFingerprint };
    });
  }, [persistReady, userId, meetings, latestById]);

  useEffect(() => {
    if (!persistReady) return;
    const joined = filterJoinedMeetings(meetings, userId);
    const now = Date.now();
    setMeetingAlarmSinceMs((prev) => {
      const next = { ...prev };
      for (const m of joined) {
        const fp = meetingChangeFingerprint(m);
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

    const myPk = normalizeParticipantId(userId.trim());
    const joined = filterJoinedMeetings(meetings, userId);
    const meetingById = new Map(meetings.map((m) => [m.id, m]));

    for (const j of joined) {
      const mid = j.id;
      const m = meetingById.get(mid);
      if (!m) continue;
      // 1) 호스트: 참여자 입장/퇴장 이벤트는 ACK와 무관하게 누적 알림/새소식으로 남깁니다.
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
              const map = await getUserProfilesForIds(delta);
              const nick = (id: string) => map.get(id)?.nickname?.trim() || '참여자';
              let msg = '';
              const prevN = prevSet.size;
              const nextN = nextSet.size;
              if (nextN > prevN && added.length > 0) {
                msg =
                  added.length === 1
                    ? `${nick(added[0])}님이 참여하셨습니다.`
                    : `${added.length}명이 참여하셨습니다.`;
              } else if (nextN < prevN && removed.length > 0) {
                msg =
                  removed.length === 1
                    ? `${nick(removed[0])}님이 나갔습니다.`
                    : `${removed.length}명이 나갔습니다.`;
              } else if (added.length > 0 && removed.length === 0) {
                msg =
                  added.length === 1
                    ? `${nick(added[0])}님이 참여하셨습니다.`
                    : `${added.length}명이 참여하셨습니다.`;
              } else if (removed.length > 0 && added.length === 0) {
                msg =
                  removed.length === 1
                    ? `${nick(removed[0])}님이 나갔습니다.`
                    : `${removed.length}명이 나갔습니다.`;
              } else if (added.length > 0 && removed.length > 0) {
                msg = '참여자가 변경되었습니다.';
              }
              if (msg) {
                const now = Date.now();
                const evId = `${mid}:${now}:${Math.random().toString(36).slice(2)}`;
                setHostParticipantEventLog((prev) => {
                  const cur = prev[mid] ?? [];
                  const next = [{ id: evId, subtitle: msg, sortMs: now }, ...cur].slice(0, 50);
                  return { ...prev, [mid]: next };
                });
                notifyInAppAlarmHeadsUpFireAndForget({
                  userId,
                  kind: 'meeting_change',
                  meetingId: mid,
                  meetingTitle: m.title?.trim() || '모임',
                  preview: msg,
                });
              }
            })();
          }
        }
        prevParticipantSetRef.current[mid] = nextLine;
      }

      // 2) 채팅 헤드업
      if (mid in latestById) {
        const latest = latestById[mid];
        const readChatId = readState.chatReadMessageId[mid] ?? '';
        const latestId = latest?.id ?? '';
        if (latestId && latestId !== readChatId) {
          const senderRaw = latest?.senderId?.trim() ?? '';
          const senderPk = senderRaw ? normalizeParticipantId(senderRaw) : '';
          if (senderPk && senderPk === myPk) continue;

          const dedupeKey = `c:${mid}:${latestId}`;
          if (pushDedupeRef.current.has(dedupeKey)) continue;
          pushDedupeRef.current.add(dedupeKey);

          notifyInAppAlarmHeadsUpFireAndForget({
            userId,
            kind: 'chat',
            meetingId: mid,
            meetingTitle: m.title?.trim() || '모임',
            preview: latest ? previewLine(latest) : undefined,
          });
        }
      }

      const fp = meetingChangeFingerprint(m);
      const ack = readState.meetingAckFingerprint[mid];
      if (ack !== undefined && fp !== ack) {
        const dedupeKey = `m:${mid}:${fp}`;
        if (pushDedupeRef.current.has(dedupeKey)) continue;
        pushDedupeRef.current.add(dedupeKey);

        notifyInAppAlarmHeadsUpFireAndForget({
          userId,
          kind: 'meeting_change',
          meetingId: mid,
          meetingTitle: m.title?.trim() || '모임',
        });
      }
    }
  }, [persistReady, userId, meetings, latestById, readState.chatReadMessageId, readState.meetingAckFingerprint]);

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
      const fp = meetingChangeFingerprint(m);
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
        rows.push({
          id: `meeting:${mid}:${fp}`,
          kind: 'meeting_change',
          meetingId: mid,
          meetingTitle: m.title?.trim() || '모임',
          subtitle: '참여 중인 모임 정보가 바뀌었어요.',
          sortMs: meetingAlarmSinceMs[mid] ?? Date.now(),
        });
      }
    }
    rows.sort((a, b) => b.sortMs - a.sortMs);
    return rows;
  }, [meetings, userId, latestById, readState, meetingAlarmSinceMs, hostParticipantEventLog]);

  const hasUnread = alarms.length > 0;

  const markChatReadUpTo = useCallback((meetingId: string, messageId: string | undefined) => {
    const mid = meetingId.trim();
    if (!mid) return;
    const id = messageId?.trim();
    if (!id) return;
    setReadState((p) => ({
      ...p,
      chatReadMessageId: { ...p.chatReadMessageId, [mid]: id },
    }));
  }, []);

  const syncMeetingAckFromMeeting = useCallback((meeting: Meeting) => {
    const mid = meeting.id?.trim();
    if (!mid) return;
    const fp = meetingChangeFingerprint(meeting);
    setReadState((p) => ({
      ...p,
      meetingAckFingerprint: { ...p.meetingAckFingerprint, [mid]: fp },
    }));
  }, []);

  const markMeetingAlarmsReadByPushTap = useCallback((meeting: Meeting) => {
    const mid = meeting.id?.trim();
    if (!mid) return;
    const fp = meetingChangeFingerprint(meeting);
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
  }, []);

  const openAlarmPanel = useCallback(() => setPanelOpen(true), []);
  const closeAlarmPanel = useCallback(() => setPanelOpen(false), []);

  const markAllAlarmsAsRead = useCallback(() => {
    const joined = filterJoinedMeetings(meetings, userId);
    const meetingById = new Map(meetings.map((m) => [m.id, m]));
    setReadState((prev) => {
      const chatReadMessageId = { ...prev.chatReadMessageId };
      const meetingAckFingerprint = { ...prev.meetingAckFingerprint };
      for (const j of joined) {
        const mid = j.id;
        const m = meetingById.get(mid);
        if (!m) continue;
        meetingAckFingerprint[mid] = meetingChangeFingerprint(m);
        if (mid in latestById) {
          const latest = latestById[mid];
          chatReadMessageId[mid] = latest?.id ?? '';
        }
      }
      return { chatReadMessageId, meetingAckFingerprint };
    });
    setHostParticipantEventLog({});
  }, [meetings, userId, latestById]);

  const onPressAlarmRow = useCallback(
    (row: InAppAlarmRow) => {
      if (row.kind === 'chat') {
        const lid = row.latestMessageId?.trim() ?? '';
        if (lid) {
          setReadState((p) => ({
            ...p,
            chatReadMessageId: { ...p.chatReadMessageId, [row.meetingId]: lid },
          }));
        }
        closeAlarmPanel();
        router.push(`/meeting-chat/${row.meetingId}`);
        return;
      }
      const m = meetings.find((x) => x.id === row.meetingId);
      if (m) {
        const fp = meetingChangeFingerprint(m);
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
      closeAlarmPanel();
      router.push(`/meeting/${row.meetingId}`);
    },
    [closeAlarmPanel, meetings, router],
  );

  const ctx = useMemo<InAppAlarmsContextValue>(
    () => ({
      hasUnread,
      alarms,
      openAlarmPanel,
      closeAlarmPanel,
      alarmPanelVisible: panelOpen,
      markChatReadUpTo,
      syncMeetingAckFromMeeting,
      markMeetingAlarmsReadByPushTap,
    }),
    [
      hasUnread,
      alarms,
      openAlarmPanel,
      closeAlarmPanel,
      panelOpen,
      markChatReadUpTo,
      syncMeetingAckFromMeeting,
      markMeetingAlarmsReadByPushTap,
    ],
  );

  const modalMaxH = Math.min(520, Math.round(width * 0.85));

  return (
    <InAppAlarmsContext.Provider value={ctx}>
      {children}
      <Modal
        visible={panelOpen}
        transparent
        animationType="fade"
        onRequestClose={closeAlarmPanel}>
        <Pressable style={styles.modalBackdrop} onPress={closeAlarmPanel}>
          <Pressable style={[styles.modalCard, { marginTop: insets.top + 8, maxHeight: modalMaxH }]} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>새 소식</Text>
              <Pressable hitSlop={12} onPress={closeAlarmPanel} accessibilityRole="button" accessibilityLabel="닫기">
                <Ionicons name="close" size={26} color="#475569" />
              </Pressable>
            </View>
            {alarms.length > 0 ? (
              <View style={styles.markAllRow}>
                <Pressable
                  onPress={markAllAlarmsAsRead}
                  hitSlop={{ top: 6, bottom: 10, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel="모두 읽음 처리"
                  style={({ pressed }) => [styles.markAllBtn, pressed && styles.markAllBtnPressed]}>
                  <Text style={styles.markAllBtnText}>모두 읽음 처리</Text>
                </Pressable>
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
                contentContainerStyle={styles.listContent}
                renderItem={({ item }) => (
                  <Pressable
                    style={({ pressed }) => [styles.alarmRow, pressed && styles.alarmRowPressed]}
                    onPress={() => onPressAlarmRow(item)}>
                    <View style={styles.alarmIconWrap}>
                      <Ionicons
                        name={item.kind === 'chat' ? 'chatbubble-ellipses-outline' : 'calendar-outline'}
                        size={22}
                        color={GinitTheme.trustBlue}
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
                    <Ionicons name="chevron-forward" size={20} color="#94a3b8" />
                  </Pressable>
                )}
              />
            )}
          </Pressable>
        </Pressable>
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
    fontWeight: '800',
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
    color: GinitTheme.trustBlue,
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
