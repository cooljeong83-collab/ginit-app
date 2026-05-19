/**
 * 모임 장소 도착 인증 — 스냅샷 좌표만 사용(실시간 추적 없음).
 *
 * [신뢰도·보안 가이드]
 * - 보상(XP/gTrust) 수치는 클라이언트가 결정하지 않습니다. Supabase RPC가 `app_policies`만 읽어 적용합니다.
 * - 좌표는 OS가 준 값이어도 스푸핑·모의 위치 가능성이 있어 "강한 증명"은 불가합니다. mock·accuracy 검사는 UX·휴리스틱이며, 서버는 시간·거리만 검증합니다.
 *
 * 로컬 리마인더(미인증·예정 시작 경과 후 간격 알림)는 `meeting-arrival-verify-reminders.ts` + `app_policies`의
 * `reminder_interval_min` / `reminder_max_count` / `reminder_after_scheduled_min`을 사용합니다.
 */

import * as Location from 'expo-location';
import { Platform } from 'react-native';

import { assertSupabasePublicReady } from '@/src/lib/hybrid-data-source';
import { presentAppDialogAlert } from '@/src/lib/app-dialog-present';
import { getPolicy } from '@/src/lib/app-policies-store';
import { meetingScheduleStartMs, type MeetingScheduleTimeFields } from '@/src/lib/meeting-schedule-times';
import { ensureForegroundLocationPermissionWithSettingsFallback } from '@/src/lib/location-permission';
import { supabase } from '@/src/lib/supabase';

/** `getPolicy` 폴백과 DB 시드(`0102_meeting_arrival_verify.sql`)와 맞출 것 */
export const MEETING_ARRIVAL_VERIFY_POLICY_FALLBACK = {
  auth_radius_m: 120,
  /** 게스트 하단 장소 인증 pill(시간 외·인증 완료 포함)을 예정 시작 몇 분 전부터 표시할지 — 그 전에는 퇴장만 */
  guest_arrival_pill_visible_before_min: 30,
  /** 상단 장소 인증 공지를 예정 시작 몇 분 전부터 표시할지 — 0이면 시작 시각부터 */
  notice_before_min: 30,
  window_before_min: 30,
  window_after_min: 180,
  min_accuracy_m: 50,
  xp_reward: 15,
  trust_reward: 2,
  trust_cap: 100,
  /** 미인증 시 로컬 알림 간격(분) — DB `0103`과 동기 */
  reminder_interval_min: 30,
  /** 로컬 알림 최대 횟수(1 = 한 번만) */
  reminder_max_count: 1,
  /** 예정 시작(`scheduled_at`) 기준 몇 분 후부터 리마인드 대상(0이면 시작 시각 도달 후) */
  reminder_after_scheduled_min: 0,
} as const;

export type MeetingArrivalVerifyPolicy = {
  auth_radius_m: number;
  guest_arrival_pill_visible_before_min: number;
  notice_before_min: number;
  window_before_min: number;
  window_after_min: number;
  min_accuracy_m: number;
  xp_reward: number;
  trust_reward: number;
  trust_cap: number;
  reminder_interval_min: number;
  reminder_max_count: number;
  reminder_after_scheduled_min: number;
};

function clampInt(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
}

function numFromUnknown(v: unknown, d: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const x = Number(v);
    if (Number.isFinite(x)) return x;
  }
  return d;
}

/** 정책 JSON을 안전하게 숫자 필드로 병합합니다. */
export function parseMeetingArrivalVerifyPolicy(raw: unknown): MeetingArrivalVerifyPolicy {
  const fb = MEETING_ARRIVAL_VERIFY_POLICY_FALLBACK;
  if (!raw || typeof raw !== 'object') return { ...fb };
  const o = raw as Record<string, unknown>;
  return {
    auth_radius_m: clampInt(numFromUnknown(o.auth_radius_m, fb.auth_radius_m), 10, 50_000),
    guest_arrival_pill_visible_before_min: clampInt(
      numFromUnknown(o.guest_arrival_pill_visible_before_min, fb.guest_arrival_pill_visible_before_min),
      0,
      24 * 60,
    ),
    notice_before_min: clampInt(numFromUnknown(o.notice_before_min, fb.notice_before_min), 0, 24 * 60),
    window_before_min: clampInt(numFromUnknown(o.window_before_min, fb.window_before_min), 0, 24 * 60),
    window_after_min: clampInt(numFromUnknown(o.window_after_min, fb.window_after_min), 0, 24 * 60),
    min_accuracy_m: clampInt(numFromUnknown(o.min_accuracy_m, fb.min_accuracy_m), 1, 5000),
    xp_reward: clampInt(numFromUnknown(o.xp_reward, fb.xp_reward), 0, 1_000_000),
    trust_reward: clampInt(numFromUnknown(o.trust_reward, fb.trust_reward), 0, 100),
    trust_cap: clampInt(numFromUnknown(o.trust_cap, fb.trust_cap), 0, 100),
    reminder_interval_min: clampInt(numFromUnknown(o.reminder_interval_min, fb.reminder_interval_min), 5, 24 * 60),
    reminder_max_count: clampInt(numFromUnknown(o.reminder_max_count, fb.reminder_max_count), 1, 20),
    reminder_after_scheduled_min: clampInt(
      numFromUnknown(o.reminder_after_scheduled_min, fb.reminder_after_scheduled_min),
      0,
      24 * 60,
    ),
  };
}

export function getMeetingArrivalVerifyPolicy(): MeetingArrivalVerifyPolicy {
  const raw = getPolicy<unknown>('meeting', 'arrival_verify', MEETING_ARRIVAL_VERIFY_POLICY_FALLBACK);
  return parseMeetingArrivalVerifyPolicy(raw);
}

export function isWithinArrivalVerifyTimeWindow(
  meeting: MeetingScheduleTimeFields,
  nowMs: number,
  pol: MeetingArrivalVerifyPolicy,
): boolean {
  const startMs = meetingScheduleStartMs(meeting);
  if (startMs == null) return false;
  const before = pol.window_before_min * 60_000;
  const after = pol.window_after_min * 60_000;
  return nowMs >= startMs - before && nowMs <= startMs + after;
}

export function formatArrivalDistanceMessageKo(distanceM: number): string {
  if (!Number.isFinite(distanceM) || distanceM < 0) return '확인된 장소와 거리를 계산하지 못했어요.';
  if (distanceM < 1000) return `현재 확정 장소와 약 ${Math.round(distanceM)}m 떨어져 있어요.`;
  return `현재 확정 장소와 약 ${(distanceM / 1000).toFixed(1)}km 떨어져 있어요.`;
}

export type MeetingArrivalRpcSuccess = {
  ok: true;
  distance_m: number;
  xp_granted: number;
  trust_granted: number;
};

export type MeetingArrivalRpcFailure = {
  ok: false;
  code: string;
  distance_m?: number;
  auth_radius_m?: number;
  client_accuracy_m?: number;
  min_accuracy_m?: number;
  message?: string;
};

export type MeetingArrivalRpcResult = MeetingArrivalRpcSuccess | MeetingArrivalRpcFailure;

function parseRpcPayload(data: unknown): MeetingArrivalRpcResult | null {
  if (!data || typeof data !== 'object') return null;
  const o = data as Record<string, unknown>;
  if (o.ok === true) {
    return {
      ok: true,
      distance_m: Number(o.distance_m),
      xp_granted: Number(o.xp_granted),
      trust_granted: Number(o.trust_granted),
    };
  }
  if (o.ok === false) {
    return {
      ok: false,
      code: typeof o.code === 'string' ? o.code : 'unknown',
      distance_m: typeof o.distance_m === 'number' ? o.distance_m : undefined,
      auth_radius_m: typeof o.auth_radius_m === 'number' ? o.auth_radius_m : undefined,
      client_accuracy_m: typeof o.client_accuracy_m === 'number' ? o.client_accuracy_m : undefined,
      min_accuracy_m: typeof o.min_accuracy_m === 'number' ? o.min_accuracy_m : undefined,
      message: typeof o.message === 'string' ? o.message : undefined,
    };
  }
  return null;
}

const RPC_TIMEOUT_MS = 28_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function runVerifyMeetingArrivalRewardRpc(opts: {
  meetingId: string;
  appUserId: string;
  lat: number;
  lng: number;
  clientAccuracyM: number | null;
}): Promise<{ rpc: MeetingArrivalRpcResult | null; errorMessage: string | null }> {
  const meetingId = opts.meetingId.trim();
  const appUserId = opts.appUserId.trim();
  try {
    assertSupabasePublicReady();
  } catch (e) {
    return { rpc: null, errorMessage: e instanceof Error ? e.message : 'Supabase 설정이 없어요.' };
  }
  try {
    const res = await withTimeout(
      Promise.resolve(
        supabase.rpc('verify_meeting_arrival_and_reward', {
          p_meeting_id: meetingId,
          p_app_user_id: appUserId,
          p_lat: opts.lat,
          p_lng: opts.lng,
          p_client_accuracy_m: opts.clientAccuracyM,
        }),
      ),
      RPC_TIMEOUT_MS,
    );
    const { data, error } = res as { data: unknown; error: { message: string } | null };

    if (error) {
      return { rpc: null, errorMessage: error.message };
    }

    const parsed = parseRpcPayload(data);
    if (!parsed) {
      return { rpc: null, errorMessage: '서버 응답을 해석하지 못했어요.' };
    }
    return { rpc: parsed, errorMessage: null };
  } catch (e) {
    const msg =
      e instanceof Error && e.message === 'timeout'
        ? '서버 응답이 지연되고 있어요. 잠시 후 다시 시도해 주세요.'
        : e instanceof Error
          ? e.message
          : '네트워크 오류가 났어요.';
    return { rpc: null, errorMessage: msg };
  }
}

/**
 * 이미 확보한 좌표로 `verify_meeting_arrival_and_reward` RPC만 호출합니다(지도 모달 등).
 * `suppressDiagnosticAlerts`: true면 mock·정확도 부족 시 Alert 대신 코드만 반환.
 */
export async function verifyMeetingArrivalWithCoords(opts: {
  meetingId: string;
  appUserId: string;
  lat: number;
  lng: number;
  clientAccuracyM: number | null;
  isMockLocation?: boolean;
  suppressDiagnosticAlerts?: boolean;
}): Promise<{ rpc: MeetingArrivalRpcResult | null; errorMessage: string | null }> {
  if (Platform.OS === 'web') {
    return { rpc: null, errorMessage: '웹에서는 장소 인증을 지원하지 않아요.' };
  }

  const meetingId = opts.meetingId.trim();
  const appUserId = opts.appUserId.trim();
  if (!meetingId || !appUserId) {
    return { rpc: null, errorMessage: '모임 또는 로그인 정보가 없어요.' };
  }

  const pol = getMeetingArrivalVerifyPolicy();
  const suppress = opts.suppressDiagnosticAlerts === true;

  if (opts.isMockLocation) {
    if (!suppress) {
      presentAppDialogAlert({
        title: '위치 인증 불가',
        body: '모의(mock) 위치가 감지됐어요. 실제 위치에서 다시 시도해 주세요.\n\n(gTrust·XP는 위치 스푸핑 방지를 위해 부여되지 않습니다.)',
      });
    }
    return { rpc: null, errorMessage: 'mock_location' };
  }

  const acc = opts.clientAccuracyM;
  if (acc != null && acc > pol.min_accuracy_m) {
    if (!suppress) {
      presentAppDialogAlert({
        title: '위치 정확도 부족',
        body: `현재 위치 정확도(약 ${Math.round(acc)}m)가 정책 기준(${pol.min_accuracy_m}m)보다 낮아요. GPS가 안정된 뒤 다시 시도해 주세요.`,
      });
    }
    return { rpc: null, errorMessage: 'accuracy_too_low' };
  }

  return runVerifyMeetingArrivalRewardRpc({
    meetingId,
    appUserId,
    lat: opts.lat,
    lng: opts.lng,
    clientAccuracyM: acc,
  });
}

/**
 * 위치 스냅샷을 받아 `verify_meeting_arrival_and_reward` RPC를 호출합니다.
 * (gTrust: 서버만이 신뢰도를 변경 — 클라이언트는 결과 메시지 표시만)
 */
export async function verifyMeetingArrivalAtSnapshot(opts: {
  meetingId: string;
  appUserId: string;
}): Promise<{ rpc: MeetingArrivalRpcResult | null; errorMessage: string | null }> {
  if (Platform.OS === 'web') {
    return { rpc: null, errorMessage: '웹에서는 장소 인증을 지원하지 않아요.' };
  }

  const meetingId = opts.meetingId.trim();
  const appUserId = opts.appUserId.trim();
  if (!meetingId || !appUserId) {
    return { rpc: null, errorMessage: '모임 또는 로그인 정보가 없어요.' };
  }

  const perm = await ensureForegroundLocationPermissionWithSettingsFallback({
    title: '위치 권한이 필요해요',
    message: '장소 인증을 하려면 현재 위치를 한 번 확인해야 해요.\n\n설정에서 위치 권한을 허용해 주세요.',
  });
  if (!perm.granted) {
    return { rpc: null, errorMessage: '위치 권한이 없어 인증할 수 없어요.' };
  }

  let pos: Location.LocationObject;
  try {
    pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Highest,
    });
  } catch (e) {
    return { rpc: null, errorMessage: e instanceof Error ? e.message : '현재 위치를 가져오지 못했어요.' };
  }

  const mockDetected = Boolean((pos.coords as { mocked?: boolean }).mocked);
  const acc =
    typeof pos.coords.accuracy === 'number' && Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null;

  return verifyMeetingArrivalWithCoords({
    meetingId,
    appUserId,
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    clientAccuracyM: acc,
    isMockLocation: mockDetected,
    suppressDiagnosticAlerts: false,
  });
}

/** RPC 실패/성공에 따른 사용자 메시지(알림용) */
export function alertBodyForArrivalRpc(r: MeetingArrivalRpcFailure): string {
  switch (r.code) {
    case 'too_far':
      return formatArrivalDistanceMessageKo(r.distance_m ?? NaN);
    case 'too_early':
      return '아직 인증 가능 시간이 아니에요. 모임 시작에 맞춰 다시 시도해 주세요.';
    case 'too_late':
      return '인증 가능 시간이 지났어요.';
    case 'already_verified':
      return '이미 이 모임에서 장소 인증을 완료했어요.';
    case 'not_participant':
      return '이 모임의 참여자만 인증할 수 있어요.';
    case 'not_confirmed':
      return '일정·장소가 확정된 모임만 인증할 수 있어요.';
    case 'meeting_place_missing':
      return '모임에 저장된 확정 좌표가 없어 인증할 수 없어요.';
    case 'meeting_schedule_missing':
      return '모임 시작 시각을 알 수 없어 인증할 수 없어요.';
    case 'meeting_not_found':
      return '모임 정보를 찾을 수 없어요.';
    case 'profile_not_found':
      return '프로필을 찾을 수 없어요.';
    case 'client_accuracy_rejected':
      return `위치 정확도가 서버 기준을 통과하지 못했어요. (보고된 정확도 약 ${r.client_accuracy_m != null ? Math.round(r.client_accuracy_m) : '?'}m)`;
    default:
      return r.message?.trim() || '인증에 실패했어요.';
  }
}
