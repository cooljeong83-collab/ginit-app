/**
 * 회원 탈퇴 — 프로필 익명화 전에 모임·팔로우 관계를 정리합니다.
 * - 방장인 모임: 단독이면 삭제, 복수면 이관 후 나가기
 * - 게스트로만 참여 중인 모임: `leaveMeeting`으로 나가기
 */
import { wipeLocalAppToFreshInstallState } from '@/src/lib/local-app-fresh-install-wipe';

import { normalizeParticipantId, normalizeUserId } from '@/src/lib/app-user-id';
import { signOutSupabase, supabase } from '@/src/lib/supabase';
import { fetchMeetingsForAccountDeletionHybrid } from '@/src/lib/meetings-hybrid';
import type { Meeting } from '@/src/lib/meetings';
import { isUserJoinedMeeting } from '@/src/lib/joined-meetings';
import { deleteMeetingDocumentByHostForce, leaveMeeting, transferMeetingHost } from '@/src/lib/meetings';
import { purgeAllFollowRelations } from '@/src/lib/follow';
import {
  getUserProfile,
  withdrawAnonymizeUserProfile,
  withdrawAnonymizeUserProfileByFirebaseUid,
} from '@/src/lib/user-profile';
import { normalizePhoneUserId } from '@/src/lib/phone-user-id';
import { getPolicyNumeric } from '@/src/lib/app-policies-store';
import { purgeProfilePhotosForWithdrawal } from '@/src/lib/profile-photo-history';
import { toUserFacingErrorMessage } from '@/src/lib/user-facing-error-message';

function isMeetingHost(meeting: Meeting, sessionUserIdNorm: string): boolean {
  const c = meeting.createdBy?.trim() ?? '';
  if (!c) return false;
  return normalizeParticipantId(c) === sessionUserIdNorm;
}

export type AccountDeletionResult =
  | { ok: true }
  | { ok: false; message: string };

/** 탈퇴 버튼 직전 검증 — 정상 탈퇴 또는 서버 탈퇴 후 앱만 어긋난 로컬 정리 */
export type AccountDeletionPreflight =
  | { ok: true; mode: 'full_deletion' }
  | { ok: true; mode: 'local_session_cleanup_only' }
  | { ok: false; message: string };

const RECENT_LOGIN_MAX_AGE_MS = 4 * 60 * 1000;

export function accountDeletionRejoinPolicyNotice(): string {
  const daysRaw = getPolicyNumeric('account', 'withdraw_rejoin_wait_days', 0);
  const days = Math.max(0, Math.floor(Number.isFinite(daysRaw) ? daysRaw : 0));
  if (days <= 0) {
    return '• 재가입 정책: 현재는 탈퇴 후 바로 재가입할 수 있습니다.';
  }
  return `• 재가입 정책: 탈퇴 후 ${days}일 동안 같은 계정으로 재가입할 수 없습니다.`;
}

type AuthDeletionSnap = {
  uid: string;
  email: string;
  phone: string;
  lastSignInMs: number | null;
};

async function currentAuthDeletionSnapshot(): Promise<AuthDeletionSnap | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const u = session?.user;
  if (!u) return null;
  const uid = (u.id ?? '').trim();
  const email = (u.email ?? '').trim();
  const phone = (u.phone ?? '').trim();
  const lastRaw = u.last_sign_in_at;
  const lastSignInMs =
    typeof lastRaw === 'string' && lastRaw ? Date.parse(lastRaw) : typeof lastRaw === 'number' ? lastRaw : null;
  if (!uid && !email && !phone) return null;
  return {
    uid,
    email,
    phone,
    lastSignInMs: typeof lastSignInMs === 'number' && Number.isFinite(lastSignInMs) ? lastSignInMs : null,
  };
}

function authSnapshotMatchesDeletionTarget(snap: AuthDeletionSnap, sessionUserId: string, fallbackAuthUid: string): boolean {
  const target = sessionUserId.trim();
  const fallbackUid = fallbackAuthUid.trim();
  if (fallbackUid && snap.uid && snap.uid !== fallbackUid) return false;
  if (!target && fallbackUid && snap.uid === fallbackUid) return true;
  if (!target) return false;
  if (snap.uid && target === snap.uid) return true;
  const targetEmail = normalizeUserId(target);
  const authEmail = snap.email ? normalizeUserId(snap.email) : null;
  if (targetEmail && authEmail && targetEmail === authEmail) return true;
  const targetPhone = normalizePhoneUserId(target);
  const authPhone = snap.phone ? normalizePhoneUserId(snap.phone) : null;
  if (targetPhone && authPhone && targetPhone === authPhone) return true;
  return false;
}

/**
 * 원격 익명화 전에 현재 Supabase Auth 사용자와 앱 세션 대상이 같은 계정인지, 최근 로그인 상태인지 확인합니다.
 *
 * Auth 세션이 없어도 `get_profile_public_by_app_user_id`로 서버 프로필이 이미 탈퇴(`isWithdrawn`)이면
 * `local_session_cleanup_only` — 원격 탈퇴는 건너뛰고 로컬·세션만 정리합니다(탈퇴 중 앱 강제 종료 등).
 */
export async function validateAccountDeletionPreflight(
  sessionUserId: string,
  fallbackAuthUid: string,
): Promise<AccountDeletionPreflight> {
  const snap = await currentAuthDeletionSnapshot();
  if (!snap) {
    const pk = sessionUserId.trim() || fallbackAuthUid.trim();
    if (!pk) {
      return { ok: false, message: '현재 로그인 인증 정보를 확인하지 못했습니다. 다시 로그인한 뒤 탈퇴를 시도해 주세요.' };
    }
    try {
      const prof = await getUserProfile(pk);
      if (prof?.isWithdrawn === true) {
        return { ok: true, mode: 'local_session_cleanup_only' };
      }
    } catch {
      /* 공개 프로필 조회 실패 시 아래 일반 안내 */
    }
    return { ok: false, message: '현재 로그인 인증 정보를 확인하지 못했습니다. 다시 로그인한 뒤 탈퇴를 시도해 주세요.' };
  }
  if (!authSnapshotMatchesDeletionTarget(snap, sessionUserId, fallbackAuthUid)) {
    return {
      ok: false,
      message:
        '현재 로그인 인증 정보와 앱 세션의 계정이 일치하지 않습니다.\n\n다른 계정 정보가 남아 있을 수 있으니 로그아웃 후 탈퇴할 계정으로 다시 로그인해 주세요.',
    };
  }
  if (snap.lastSignInMs == null || Date.now() - snap.lastSignInMs > RECENT_LOGIN_MAX_AGE_MS) {
    return {
      ok: false,
      message: '보안을 위해 최근 로그인 확인이 필요합니다.\n로그아웃 후 다시 로그인한 뒤, 회원 탈퇴를 다시 시도해 주세요.',
    };
  }
  return { ok: true, mode: 'full_deletion' };
}

function pickNextHostFromParticipants(m: Meeting, nsHost: string): string | null {
  const list = Array.isArray(m.participantIds) ? m.participantIds : [];
  for (const raw of list) {
    const ns = normalizeParticipantId(raw) ?? raw.trim();
    if (ns && ns !== nsHost) return raw.trim();
  }
  return null;
}

/** Firebase UID 로그인 계정: `createdBy`가 세션 UID와 같은지(호스트 여부) */
function isMeetingHostByFirebaseUid(m: Meeting, firebaseUid: string): boolean {
  const c = m.createdBy?.trim() ?? '';
  const u = firebaseUid.trim();
  if (!c || !u) return false;
  if (c === u) return true;
  return normalizeParticipantId(c) === (normalizeParticipantId(u) ?? u);
}

async function leaveGuestMeetingsForUser(meetings: readonly Meeting[], userRaw: string, isHost: (m: Meeting) => boolean): Promise<void> {
  const uid = userRaw.trim();
  if (!uid) return;
  const asGuest = meetings.filter((m) => isUserJoinedMeeting(m, uid) && !isHost(m));
  for (const m of asGuest) {
    const mid = m.id?.trim();
    if (!mid) continue;
    try {
      await leaveMeeting(mid, uid);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // 목록 스냅샷 직후 모임이 삭제·정리된 경우 등은 탈퇴 전체를 막지 않습니다.
      if (/모임을 찾을 수 없|찾을 수 없어요|not found/i.test(msg)) continue;
      throw e;
    }
  }
}

/**
 * 서버(Firestore)에서 계정 프로필을 익명화합니다.
 * 로컬 초기화·Auth·구글 로그아웃은 호출 측에서 처리합니다.
 */
export async function purgeUserAccountRemote(phoneUserId: string): Promise<AccountDeletionResult> {
  const raw = phoneUserId.trim();
  if (!raw) return { ok: false, message: '로그인 정보가 없습니다.' };
  const ns = normalizeParticipantId(raw);

  const listRes = await fetchMeetingsForAccountDeletionHybrid(raw);
  if (!listRes.ok) {
    return { ok: false, message: toUserFacingErrorMessage(listRes.message) };
  }
  const meetings = listRes.meetings;

  // 1) 내가 방장인 모임 처리
  const hosted = meetings.filter((m) => isMeetingHost(m, ns));
  try {
    for (const m of hosted) {
      const mid = m.id?.trim();
      if (!mid) continue;
      const participants = Array.isArray(m.participantIds) ? m.participantIds : [];
      const uniqueNs = Array.from(
        new Set(
          participants
            .map((x) => (normalizeParticipantId(x) ?? x.trim()))
            .filter((x) => x.trim().length > 0),
        ),
      );
      // 방에 본인만 있으면 모임 자동 삭제(확정 여부와 무관)
      if (uniqueNs.length <= 1) {
        await deleteMeetingDocumentByHostForce(mid, raw);
        continue;
      }
      // 두 명 이상이면 방장 이관 후 본인은 탈퇴
      const nextHost = pickNextHostFromParticipants(m, ns);
      if (!nextHost) {
        await deleteMeetingDocumentByHostForce(mid, raw);
        continue;
      }
      await transferMeetingHost(mid, raw, nextHost);
      await leaveMeeting(mid, raw);
    }
  } catch (e) {
    const msg = toUserFacingErrorMessage(
      e instanceof Error ? e.message : '모임 정리 중 오류가 발생했습니다.',
    );
    return { ok: false, message: msg };
  }

  // 2) 게스트로만 참여 중인 모임에서 나가기
  try {
    await leaveGuestMeetingsForUser(meetings, raw, (m) => isMeetingHost(m, ns));
  } catch (e) {
    const msg = toUserFacingErrorMessage(
      e instanceof Error ? e.message : '참여 모임에서 나가는 중 오류가 발생했습니다.',
    );
    return { ok: false, message: msg };
  }

  // 3) 팔로우 관계 삭제
  try {
    await purgeAllFollowRelations(raw);
  } catch (e) {
    const msg = toUserFacingErrorMessage(
      e instanceof Error ? e.message : '팔로우 관계 삭제에 실패했습니다.',
    );
    return { ok: false, message: msg };
  }

  // 4) Supabase Storage 프로필 사진 삭제 + 이력 정리
  try {
    const photos = await purgeProfilePhotosForWithdrawal(raw);
    if (!photos.ok) {
      return { ok: false, message: toUserFacingErrorMessage(photos.message) };
    }
  } catch (e) {
    const msg = toUserFacingErrorMessage(
      e instanceof Error ? e.message : '프로필 사진 삭제에 실패했습니다.',
    );
    return { ok: false, message: msg };
  }

  try {
    await withdrawAnonymizeUserProfile(raw);
  } catch (e) {
    const msg = toUserFacingErrorMessage(
      e instanceof Error ? e.message : '프로필 익명화에 실패했습니다.',
    );
    return { ok: false, message: msg };
  }

  return { ok: true };
}

/**
 * 구글/UID 로그인 사용자용 서버 탈퇴 처리.
 * - 방장·게스트 모임 정리 후 프로필 익명화
 */
export async function purgeUserAccountRemoteByFirebaseUid(firebaseUid: string): Promise<AccountDeletionResult> {
  const uid = firebaseUid.trim();
  if (!uid) return { ok: false, message: '로그인 정보가 없습니다.' };

  const listRes = await fetchMeetingsForAccountDeletionHybrid(uid);
  if (!listRes.ok) {
    return { ok: false, message: toUserFacingErrorMessage(listRes.message) };
  }
  const meetings = listRes.meetings;
  const hosted = meetings.filter((m) => isMeetingHostByFirebaseUid(m, uid));
  const nsUid = normalizeParticipantId(uid) ?? uid;
  try {
    for (const m of hosted) {
      const mid = m.id?.trim();
      if (!mid) continue;
      const participants = Array.isArray(m.participantIds) ? m.participantIds : [];
      const uniqueNs = Array.from(
        new Set(
          participants
            .map((x) => (normalizeParticipantId(x) ?? x.trim()))
            .filter((x) => x.trim().length > 0),
        ),
      );
      if (uniqueNs.length <= 1) {
        await deleteMeetingDocumentByHostForce(mid, uid);
        continue;
      }
      const nextHost = pickNextHostFromParticipants(m, nsUid);
      if (!nextHost) {
        await deleteMeetingDocumentByHostForce(mid, uid);
        continue;
      }
      await transferMeetingHost(mid, uid, nextHost);
      await leaveMeeting(mid, uid);
    }
  } catch (e) {
    const msg = toUserFacingErrorMessage(
      e instanceof Error ? e.message : '모임 정리 중 오류가 발생했습니다.',
    );
    return { ok: false, message: msg };
  }

  try {
    await leaveGuestMeetingsForUser(meetings, uid, (m) => isMeetingHostByFirebaseUid(m, uid));
  } catch (e) {
    const msg = toUserFacingErrorMessage(
      e instanceof Error ? e.message : '참여 모임에서 나가는 중 오류가 발생했습니다.',
    );
    return { ok: false, message: msg };
  }

  try {
    await purgeAllFollowRelations(uid);
  } catch (e) {
    const msg = toUserFacingErrorMessage(
      e instanceof Error ? e.message : '팔로우 관계 삭제에 실패했습니다.',
    );
    return { ok: false, message: msg };
  }

  try {
    const photos = await purgeProfilePhotosForWithdrawal(uid);
    if (!photos.ok) {
      return { ok: false, message: toUserFacingErrorMessage(photos.message) };
    }
  } catch (e) {
    const msg = toUserFacingErrorMessage(
      e instanceof Error ? e.message : '프로필 사진 삭제에 실패했습니다.',
    );
    return { ok: false, message: msg };
  }

  try {
    await withdrawAnonymizeUserProfileByFirebaseUid(uid);
  } catch (e) {
    const msg = toUserFacingErrorMessage(
      e instanceof Error ? e.message : '프로필 익명화에 실패했습니다.',
    );
    return { ok: false, message: msg };
  }
  return { ok: true };
}

function humanizeAuthDeleteError(e: unknown): string {
  const code =
    typeof e === 'object' && e !== null && 'code' in e ? String((e as { code?: unknown }).code) : '';
  const message = e instanceof Error ? e.message : String(e);
  const hay = `${code} ${message}`.toLowerCase();
  if (hay.includes('requires-recent-login')) {
    return '보안을 위해 최근 로그인 확인이 필요합니다.\n로그아웃 후 다시 로그인한 뒤, 회원 탈퇴를 다시 시도해 주세요.';
  }
  return toUserFacingErrorMessage(message || '인증 세션 종료에 실패했습니다.');
}

/**
 * 클라이언트에서 로그아웃해 로컬 세션을 정리합니다.
 * `auth.users` 행 삭제는 서비스 롤(Edge 등)이 필요해 이 단계에서는 수행하지 않습니다.
 */
export async function deleteFirebaseAuthUserStrict(): Promise<AccountDeletionResult> {
  try {
    await signOutSupabase();
    return { ok: true };
  } catch (e) {
    return { ok: false, message: humanizeAuthDeleteError(e) };
  }
}

/** Supabase 세션이 있으면 종료합니다(실패는 무시). */
export async function deleteFirebaseAuthUserBestEffort(): Promise<void> {
  void (await deleteFirebaseAuthUserStrict());
}

/** AsyncStorage 전체·Watermelon·이미지 캐시를 비웁니다(최초 설치에 가깝게). */
export async function wipeLocalAppData(): Promise<void> {
  await wipeLocalAppToFreshInstallState();
}
