/**
 * 장소 인증 미완료 시 로컬 알림(expo-notifications) — `reminder_max_count`(기본 1회).
 * - 예약 id가 OS에 남아 있으면 재스케줄하지 않음.
 * - 알림이 이미 울린 뒤 예약만 사라진 경우에도, 동일 일정 지문(`fp`)이면 재스케줄하지 않음(무한 재등록 방지).
 * 원격 FCM이 아닌 기기 스케줄이므로 앱이 설치된 기기에서만 동작합니다.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { assertSupabasePublicReady } from '@/src/lib/hybrid-data-source';
import { ensureGinitInAppAndroidChannel, ensureNotificationsPresentable } from '@/src/lib/in-app-alarm-push';
import type { Meeting } from '@/src/lib/meetings';
import { getMeetingArrivalVerifyPolicy } from '@/src/lib/meeting-arrival-verify';
import { meetingScheduleStartMs } from '@/src/lib/meeting-schedule-times';
import { getExpoNotificationContentSound, getGinitInAppAndroidChannelId } from '@/src/lib/profile-notification-sound-preference';
import { supabase } from '@/src/lib/supabase';

const STORAGE_IDS_PREFIX = 'ginit.arrival_reminder.v1';
const STORAGE_FP_PREFIX = 'ginit.arrival_reminder.fp.v1';

function normUid(appUserId: string): string {
  return normalizeParticipantId(appUserId.trim()) ?? appUserId.trim();
}

function storageKeyIds(meetingId: string, appUserId: string): string {
  return `${STORAGE_IDS_PREFIX}:${meetingId.trim()}:${normUid(appUserId)}`;
}

function storageKeyFp(meetingId: string, appUserId: string): string {
  return `${STORAGE_FP_PREFIX}:${meetingId.trim()}:${normUid(appUserId)}`;
}

function buildReminderFingerprint(opts: {
  meetingId: string;
  scheduledMs: number;
  windowEndMs: number;
  maxCount: number;
  intervalMin: number;
}): string {
  return [
    opts.meetingId.trim(),
    String(opts.scheduledMs),
    String(opts.windowEndMs),
    String(opts.maxCount),
    String(opts.intervalMin),
  ].join('|');
}

async function readStoredIds(meetingId: string, appUserId: string): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(storageKeyIds(meetingId, appUserId));
    if (!raw?.trim()) return [];
    const p = JSON.parse(raw) as unknown;
    if (!Array.isArray(p)) return [];
    return p.filter((x): x is string => typeof x === 'string' && x.length > 0);
  } catch {
    return [];
  }
}

async function writeStoredIds(meetingId: string, appUserId: string, ids: readonly string[]): Promise<void> {
  await AsyncStorage.setItem(storageKeyIds(meetingId, appUserId), JSON.stringify([...ids]));
}

async function readStoredFingerprint(meetingId: string, appUserId: string): Promise<string | null> {
  const v = await AsyncStorage.getItem(storageKeyFp(meetingId, appUserId));
  return v != null && v.trim() !== '' ? v.trim() : null;
}

async function writeStoredFingerprint(meetingId: string, appUserId: string, fp: string): Promise<void> {
  await AsyncStorage.setItem(storageKeyFp(meetingId, appUserId), fp.trim());
}

/** 예약된 장소 인증 리마인더를 모두 취소합니다(인증 성공·조건 이탈 시). */
export async function cancelMeetingArrivalReminderLocalNotifications(
  meetingId: string,
  appUserId: string,
): Promise<void> {
  if (Platform.OS === 'web') return;
  const mid = meetingId.trim();
  const uid = appUserId.trim();
  if (!mid || !uid) return;
  const ids = await readStoredIds(mid, uid);
  for (const id of ids) {
    try {
      await Notifications.cancelScheduledNotificationAsync(id);
    } catch {
      /* ignore */
    }
  }
  await AsyncStorage.removeItem(storageKeyIds(mid, uid));
  await AsyncStorage.removeItem(storageKeyFp(mid, uid));
}

/** 모임에 장소 인증을 마친 참가자의 `profiles.app_user_id` 목록(뷰어는 모임 소속·호스트만). */
export async function fetchLedgerMeetingArrivalVerifiedAppUserIds(
  meetingId: string,
  viewerAppUserId: string,
): Promise<string[]> {
  try {
    assertSupabasePublicReady();
  } catch {
    return [];
  }
  const mid = meetingId.trim();
  const uid = viewerAppUserId.trim();
  if (!mid || !uid) return [];
  const { data, error } = await supabase.rpc('list_meeting_arrival_verified_app_user_ids', {
    p_meeting_id: mid,
    p_viewer_app_user_id: uid,
  });
  if (error) {
    if (__DEV__) console.warn('[arrival] list_meeting_arrival_verified_app_user_ids', error.message);
    return [];
  }
  if (!Array.isArray(data)) return [];
  return data
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

/** 현재 사용자가 해당 모임에 장소 도착 인증을 완료했는지 — RLS와 무관하게 RPC로 조회. */
export async function hasLedgerArrivalVerified(meetingId: string, appUserId: string): Promise<boolean> {
  try {
    assertSupabasePublicReady();
  } catch {
    return false;
  }
  const mid = meetingId.trim();
  const uid = appUserId.trim();
  if (!mid || !uid) return false;
  const { data, error } = await supabase.rpc('has_meeting_arrival_verified_for_app_user', {
    p_meeting_id: mid,
    p_app_user_id: uid,
  });
  if (error) {
    if (__DEV__) console.warn('[arrival] has_meeting_arrival_verified_for_app_user', error.message);
    return false;
  }
  return data === true;
}

/** 현재 사용자가 장소 도착 인증을 완료한 모임 ID 집합 — 여러 후보를 단일 RPC로 조회. */
export async function fetchLedgerArrivalVerifiedMeetingIdSet(
  meetingIds: readonly string[],
  appUserId: string,
): Promise<Set<string>> {
  try {
    assertSupabasePublicReady();
  } catch {
    return new Set();
  }
  const ids = [...new Set(meetingIds.map((id) => id.trim()).filter(Boolean))];
  const uid = appUserId.trim();
  if (ids.length === 0 || !uid) return new Set();
  const { data, error } = await supabase.rpc('list_meeting_arrival_verified_meeting_ids_for_app_user', {
    p_meeting_ids: ids,
    p_app_user_id: uid,
  });
  if (error) {
    if (__DEV__) console.warn('[arrival] list_meeting_arrival_verified_meeting_ids_for_app_user', error.message);
    return new Set();
  }
  if (!Array.isArray(data)) return new Set();
  return new Set(
    data
      .filter((x): x is string => typeof x === 'string')
      .map((x) => x.trim())
      .filter((x) => x.length > 0),
  );
}

/**
 * 조건을 만족하면 로컬 알림을 최대 `reminder_max_count`개까지 예약합니다(간격 `reminder_interval_min`, 기본 1회면 간격 무의미).
 * 예정 시작(`scheduled_at`)이 지난 뒤(`reminder_after_scheduled_min` 반영)이고, 인증 마감(`window_after`) 전이며, 아직 미인증일 때만.
 */
export async function syncMeetingArrivalReminderLocalNotifications(opts: {
  meeting: Meeting;
  appUserId: string;
}): Promise<void> {
  if (Platform.OS === 'web') return;
  const meeting = opts.meeting;
  const appUserId = opts.appUserId.trim();
  const meetingId = meeting.id.trim();
  if (!meetingId || !appUserId) return;
  if (meeting.scheduleConfirmed !== true) {
    await cancelMeetingArrivalReminderLocalNotifications(meetingId, appUserId);
    return;
  }

  const scheduledMs = meetingScheduleStartMs(meeting);
  if (scheduledMs == null) {
    await cancelMeetingArrivalReminderLocalNotifications(meetingId, appUserId);
    return;
  }

  const pol = getMeetingArrivalVerifyPolicy();
  const now = Date.now();
  const windowEndMs = scheduledMs + pol.window_after_min * 60_000;
  const eligibleFromMs = scheduledMs + pol.reminder_after_scheduled_min * 60_000;
  const maxN = pol.reminder_max_count;
  const intervalMin = pol.reminder_interval_min;
  const fp = buildReminderFingerprint({
    meetingId,
    scheduledMs,
    windowEndMs,
    maxCount: maxN,
    intervalMin,
  });

  if (now < eligibleFromMs || now > windowEndMs) {
    await cancelMeetingArrivalReminderLocalNotifications(meetingId, appUserId);
    return;
  }

  const verified = await hasLedgerArrivalVerified(meetingId, appUserId);
  if (verified) {
    await cancelMeetingArrivalReminderLocalNotifications(meetingId, appUserId);
    return;
  }

  let storedFp = await readStoredFingerprint(meetingId, appUserId);
  if (storedFp != null && storedFp !== fp) {
    await AsyncStorage.removeItem(storageKeyFp(meetingId, appUserId));
    storedFp = null;
  }
  if (storedFp === fp) {
    const orphanIds = await readStoredIds(meetingId, appUserId);
    if (orphanIds.length > 0) {
      await AsyncStorage.removeItem(storageKeyIds(meetingId, appUserId));
    }
    return;
  }

  const permOk = await ensureNotificationsPresentable();
  if (!permOk) {
    return;
  }

  let existingIds = await readStoredIds(meetingId, appUserId);
  if (existingIds.length > maxN) {
    await cancelMeetingArrivalReminderLocalNotifications(meetingId, appUserId);
    existingIds = [];
  }
  if (existingIds.length > 0) {
    try {
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      const live = new Set(scheduled.map((r) => r.identifier));
      const allStillScheduled = existingIds.every((id) => live.has(id));
      if (allStillScheduled) {
        await writeStoredFingerprint(meetingId, appUserId, fp);
        return;
      }
    } catch {
      /* fall through */
    }
    for (const id of existingIds) {
      try {
        await Notifications.cancelScheduledNotificationAsync(id);
      } catch {
        /* ignore */
      }
    }
    await AsyncStorage.removeItem(storageKeyIds(meetingId, appUserId));
    /** 이미 울렸거나 OS가 예약을 제거한 뒤 — 같은 일정에 대해 다시 잡지 않음 */
    await writeStoredFingerprint(meetingId, appUserId, fp);
    return;
  }

  await ensureGinitInAppAndroidChannel();
  const contentSound = await getExpoNotificationContentSound();
  const androidChannelId = await getGinitInAppAndroidChannelId();

  const intervalMs = intervalMin * 60_000;
  const title = '장소 인증';
  const mt = meeting.title?.trim() || '모임';
  const body = `「${mt}」확정 장소에 도착했으면 앱에서 장소 도착 인증을 해 주세요.`;

  const newIds: string[] = [];
  const minLeadMs = 3_000;

  let baseMs = Math.max(now + minLeadMs, eligibleFromMs);
  for (let i = 0; i < maxN; i++) {
    const atMs = baseMs + i * intervalMs;
    if (atMs > windowEndMs) break;
    const when = new Date(atMs);
    try {
      const trigger = {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: when,
        ...(Platform.OS === 'android' ? { channelId: androidChannelId } : {}),
      };
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          sound: contentSound,
          data: {
            meetingId,
            action: 'meeting_arrival_reminder',
            url: `ginitapp://meeting/${encodeURIComponent(meetingId)}`,
          },
          ...(Platform.OS === 'android'
            ? { priority: Notifications.AndroidNotificationPriority.HIGH }
            : {}),
        },
        trigger,
      });
      newIds.push(id);
    } catch {
      /* ignore single slot failure */
    }
  }

  if (newIds.length > 0) {
    await writeStoredIds(meetingId, appUserId, newIds);
    await writeStoredFingerprint(meetingId, appUserId, fp);
  }
}
