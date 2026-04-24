/**
 * Firestore `users` 문서의 신뢰/패널티 필드 갱신.
 * 프로덕션에서는 Cloud Functions 등 백엔드가 호출하고, 클라이언트에서는 호출하지 않는 것이 안전합니다.
 */
import { doc, runTransaction, serverTimestamp, type Firestore } from 'firebase/firestore';

import { getFirebaseFirestore } from '@/src/lib/firebase';
import { USERS_COLLECTION, mapUserDoc, type UserProfile } from '@/src/lib/user-profile';
import { clampTrust } from '@/src/lib/ginit-trust';

export type TrustPenaltyKind = 'no_show' | 'late_cancel' | 'report_approved';

function db(): Firestore {
  return getFirebaseFirestore();
}

function capDedupeIds(ids: string[], max = 40): string[] {
  if (ids.length <= max) return ids;
  return ids.slice(ids.length - max);
}

/**
 * 패널티 적용 (원자적). no_show: trust -50, xp -100, penalty+1, streak 리셋, trust<30 → restricted.
 */
export async function applyTrustPenaltyFirestore(
  phoneUserId: string,
  kind: TrustPenaltyKind,
  dedupeKey?: string | null,
): Promise<UserProfile> {
  const uid = phoneUserId.trim();
  if (!uid) throw new Error('사용자 ID가 없습니다.');
  const uref = doc(db(), USERS_COLLECTION, uid);

  return runTransaction(db(), async (tx) => {
    const snap = await tx.get(uref);
    if (!snap.exists()) throw new Error('프로필을 찾을 수 없어요.');
    const d = snap.data() as Record<string, unknown>;

    const dedupeField =
      kind === 'no_show'
        ? 'trustPenaltyDedupeNoShow'
        : kind === 'late_cancel'
          ? 'trustPenaltyDedupeLateCancel'
          : 'trustPenaltyDedupeReport';
    const prevDedupe = typeof d[dedupeField] === 'string' ? (d[dedupeField] as string).trim() : '';
    if (dedupeKey && prevDedupe === dedupeKey.trim()) {
      return mapUserDoc(d);
    }

    let gTrust = typeof d.gTrust === 'number' ? clampTrust(d.gTrust) : 100;
    let gXp = typeof d.gXp === 'number' && Number.isFinite(d.gXp) ? Math.trunc(d.gXp) : 0;
    let penaltyCount = typeof d.penaltyCount === 'number' && Number.isFinite(d.penaltyCount) ? Math.max(0, Math.trunc(d.penaltyCount)) : 0;
    let isRestricted = d.isRestricted === true;

    if (kind === 'no_show') {
      gTrust = clampTrust(gTrust - 50);
      gXp -= 100;
      penaltyCount += 1;
    } else if (kind === 'late_cancel') {
      gTrust = clampTrust(gTrust - 10);
      gXp -= 30;
    } else {
      gTrust = clampTrust(gTrust - 20);
      penaltyCount += 1;
    }

    if (gTrust < 30) isRestricted = true;

    const patch: Record<string, unknown> = {
      gTrust,
      gXp,
      penaltyCount,
      isRestricted,
      trustRecoveryStreak: 0,
      updatedAt: serverTimestamp(),
    };
    if (dedupeKey?.trim()) patch[dedupeField] = dedupeKey.trim();

    tx.update(uref, patch);
    return mapUserDoc({ ...d, ...patch } as Record<string, unknown>);
  });
}

/**
 * 체크인 완료 모임 1건 기록. 3회 연속(중복 meetingId 제외)마다 gTrust +5 (상한 100).
 */
export async function recordTrustRecoveryCheckInFirestore(phoneUserId: string, meetingId: string): Promise<UserProfile> {
  const uid = phoneUserId.trim();
  const mid = meetingId.trim();
  if (!uid || !mid) throw new Error('사용자 또는 모임 정보가 없습니다.');
  const uref = doc(db(), USERS_COLLECTION, uid);

  return runTransaction(db(), async (tx) => {
    const snap = await tx.get(uref);
    if (!snap.exists()) throw new Error('프로필을 찾을 수 없어요.');
    const d = snap.data() as Record<string, unknown>;

    const rawList = Array.isArray(d.trustRecoveryMeetingIds) ? (d.trustRecoveryMeetingIds as unknown[]) : [];
    const seen = rawList.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim());
    if (seen.includes(mid)) {
      return mapUserDoc(d);
    }

    let gTrust = typeof d.gTrust === 'number' ? clampTrust(d.gTrust) : 100;
    let streak = typeof d.trustRecoveryStreak === 'number' && Number.isFinite(d.trustRecoveryStreak) ? Math.max(0, Math.trunc(d.trustRecoveryStreak)) : 0;

    streak += 1;
    let recovered = false;
    if (streak >= 3) {
      gTrust = clampTrust(gTrust + 5);
      streak = 0;
      recovered = true;
    }

    const nextSeen = capDedupeIds([...seen, mid]);
    const patch: Record<string, unknown> = {
      gTrust,
      trustRecoveryStreak: streak,
      trustRecoveryMeetingIds: nextSeen,
      updatedAt: serverTimestamp(),
    };
    if (recovered && gTrust >= 30 && d.isRestricted === true) {
      // 자동 해제는 운영 정책에 맡기고, 점수 회복만으로는 제한 해제하지 않음
    }
    tx.update(uref, patch);
    return mapUserDoc({ ...d, ...patch } as Record<string, unknown>);
  });
}
