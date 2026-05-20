import { normalizeParticipantId } from '@/src/lib/app-user-id';
import {
  fetchUserProfilesFromSupabaseRpcBatchDetailed,
  isUserProfileWithdrawn,
  WITHDRAWN_NICKNAME,
  type UserProfile,
} from '@/src/lib/user-profile';

export type AdminReportParticipantSnapshot = {
  appUserId: string;
  nickname: string;
  photoUrl: string | null;
  withdrawn: boolean;
};

function pickProfile(map: Map<string, UserProfile | null>, appUserId: string): UserProfile | null {
  const raw = appUserId.trim();
  if (!raw) return null;
  if (map.has(raw)) return map.get(raw) ?? null;
  const norm = normalizeParticipantId(raw);
  if (norm && map.has(norm)) return map.get(norm) ?? null;
  for (const [k, v] of map) {
    if (normalizeParticipantId(k) === norm) return v;
  }
  return null;
}

function toSnapshot(appUserId: string, profile: UserProfile | null): AdminReportParticipantSnapshot {
  const id = appUserId.trim();
  const withdrawn = isUserProfileWithdrawn(profile);
  const nick = withdrawn ? WITHDRAWN_NICKNAME : profile?.nickname?.trim() || id;
  return {
    appUserId: id,
    nickname: nick,
    photoUrl: withdrawn ? null : profile?.photoUrl?.trim() || null,
    withdrawn,
  };
}

export async function loadAdminReportParticipantSnapshots(
  reportedAppUserId: string,
  reporterAppUserId: string,
): Promise<{
  reported: AdminReportParticipantSnapshot;
  reporter: AdminReportParticipantSnapshot;
}> {
  const reportedId = normalizeParticipantId(reportedAppUserId.trim()) || reportedAppUserId.trim();
  const reporterId = normalizeParticipantId(reporterAppUserId.trim()) || reporterAppUserId.trim();
  const batch = await fetchUserProfilesFromSupabaseRpcBatchDetailed([reportedId, reporterId]);
  if (!batch.ok) {
    return {
      reported: toSnapshot(reportedId, null),
      reporter: toSnapshot(reporterId, null),
    };
  }
  return {
    reported: toSnapshot(reportedId, pickProfile(batch.byId, reportedId)),
    reporter: toSnapshot(reporterId, pickProfile(batch.byId, reporterId)),
  };
}
