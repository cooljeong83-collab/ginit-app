/**
 * 회원 탈퇴 — Firestore `users` 문서만 익명화하고, 모임·채팅·투표 등 활동 데이터는 유지합니다.
 * 방장으로 진행 중인 모임이 있으면 탈퇴를 막습니다.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { deleteAsync, cacheDirectory } from 'expo-file-system/legacy';
import { Image } from 'expo-image';
import { deleteUser } from 'firebase/auth';
import { getAuth } from '@react-native-firebase/auth';

import { getFirebaseAuth } from '@/src/lib/firebase';
import { normalizeParticipantId } from '@/src/lib/app-user-id';
import { fetchMeetingsOnceHybrid } from '@/src/lib/meetings-hybrid';
import type { Meeting } from '@/src/lib/meetings';
import { deleteMeetingDocumentByHostForce, leaveMeeting, transferMeetingHost } from '@/src/lib/meetings';
import { purgeAllFollowRelations } from '@/src/lib/follow';
import { withdrawAnonymizeUserProfile, withdrawAnonymizeUserProfileByFirebaseUid } from '@/src/lib/user-profile';

function isMeetingHost(meeting: Meeting, sessionUserIdNorm: string): boolean {
  const c = meeting.createdBy?.trim() ?? '';
  if (!c) return false;
  return normalizeParticipantId(c) === sessionUserIdNorm;
}

export type AccountDeletionResult =
  | { ok: true }
  | { ok: false; message: string };

function pickNextHostFromParticipants(m: Meeting, nsHost: string): string | null {
  const list = Array.isArray(m.participantIds) ? m.participantIds : [];
  for (const raw of list) {
    const ns = normalizeParticipantId(raw) ?? raw.trim();
    if (ns && ns !== nsHost) return raw.trim();
  }
  return null;
}

/**
 * 서버(Firestore)에서 계정 프로필을 익명화합니다.
 * 로컬 초기화·Auth·구글 로그아웃은 호출 측에서 처리합니다.
 */
export async function purgeUserAccountRemote(phoneUserId: string): Promise<AccountDeletionResult> {
  const raw = phoneUserId.trim();
  if (!raw) return { ok: false, message: '로그인 정보가 없습니다.' };
  const ns = normalizeParticipantId(raw);

  const listRes = await fetchMeetingsOnceHybrid();
  if (!listRes.ok) {
    return { ok: false, message: listRes.message };
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
    const msg = e instanceof Error ? e.message : '모임 정리 중 오류가 발생했습니다.';
    return { ok: false, message: msg };
  }

  // 2) 팔로우 관계 삭제
  try {
    await purgeAllFollowRelations(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '팔로우 관계 삭제에 실패했습니다.';
    return { ok: false, message: msg };
  }

  try {
    await withdrawAnonymizeUserProfile(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '프로필 익명화에 실패했습니다.';
    return { ok: false, message: msg };
  }

  return { ok: true };
}

/**
 * 구글/UID 로그인 사용자용 서버 탈퇴 처리.
 * - 진행 중 모임 방장(firebaseUid 기반) 이면 차단
 * - users 문서는 firebaseUid로 역조회 후 익명화 (없으면 no-op)
 */
export async function purgeUserAccountRemoteByFirebaseUid(firebaseUid: string): Promise<AccountDeletionResult> {
  const uid = firebaseUid.trim();
  if (!uid) return { ok: false, message: '로그인 정보가 없습니다.' };

  const listRes = await fetchMeetingsOnceHybrid();
  if (!listRes.ok) {
    return { ok: false, message: listRes.message };
  }
  const meetings = listRes.meetings;
  const hosted = meetings.filter((m) => (m.createdBy?.trim() ?? '') === uid);
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
    const msg = e instanceof Error ? e.message : '모임 정리 중 오류가 발생했습니다.';
    return { ok: false, message: msg };
  }

  try {
    await purgeAllFollowRelations(uid);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '팔로우 관계 삭제에 실패했습니다.';
    return { ok: false, message: msg };
  }

  try {
    await withdrawAnonymizeUserProfileByFirebaseUid(uid);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '프로필 익명화에 실패했습니다.';
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
  return message || 'Firebase 인증 계정 삭제에 실패했습니다.';
}

/**
 * Firebase Auth 인증 정보를 삭제합니다.
 * - JS(firebase/auth)와 RN Firebase(@react-native-firebase/auth) 세션이 공존할 수 있어 둘 다 시도합니다.
 * - 실패 시 ok:false 로 반환해서 호출부에서 탈퇴를 중단할 수 있게 합니다.
 */
export async function deleteFirebaseAuthUserStrict(): Promise<AccountDeletionResult> {
  let lastErr: unknown = null;

  try {
    const jsUser = getFirebaseAuth().currentUser;
    if (jsUser) {
      await deleteUser(jsUser);
    }
  } catch (e) {
    lastErr = e;
  }

  try {
    const rnUser = getAuth().currentUser;
    if (rnUser) {
      await (rnUser as unknown as { delete: () => Promise<void> }).delete();
    }
  } catch (e) {
    lastErr = lastErr ?? e;
  }

  if (lastErr) return { ok: false, message: humanizeAuthDeleteError(lastErr) };
  // 세션이 없으면 서버 익명화 후 signOut으로 충분합니다.
  return { ok: true };
}

/** Firebase Auth 현재 사용자가 있으면 삭제합니다(익명·일반). 실패는 무시합니다. */
export async function deleteFirebaseAuthUserBestEffort(): Promise<void> {
  void (await deleteFirebaseAuthUserStrict());
}

/** AsyncStorage 전체·이미지 디스크 캐시를 비웁니다. */
export async function wipeLocalAppData(): Promise<void> {
  try {
    await AsyncStorage.clear();
  } catch {
    /* */
  }
  try {
    await Image.clearDiskCache();
    await Image.clearMemoryCache();
  } catch {
    /* */
  }
  try {
    const dir = cacheDirectory;
    if (dir) {
      await deleteAsync(dir, { idempotent: true });
    }
  } catch {
    /* 캐시 전체 삭제는 기기·OS에 따라 실패할 수 있음 */
  }
}
