import { Q } from '@nozbe/watermelondb';

import { Timestamp } from '@/src/lib/ginit-timestamp';
import type { UserProfile } from '@/src/lib/user-profile';
import { CachedUserProfile } from '@/src/watermelon/models/CachedUserProfile';
import { database } from '@/src/watermelon';

const TS_MARKER = '__ginitTs';

function serializeProfileValue(value: unknown): unknown {
  if (value instanceof Timestamp) {
    return { [TS_MARKER]: value.toMillis() };
  }
  if (value instanceof Date) {
    return { [TS_MARKER]: value.getTime() };
  }
  if (Array.isArray(value)) {
    return value.map(serializeProfileValue);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = serializeProfileValue(v);
    }
    return out;
  }
  return value;
}

function deserializeProfileValue(value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    if (typeof o[TS_MARKER] === 'number' && Number.isFinite(o[TS_MARKER])) {
      return Timestamp.fromMillis(o[TS_MARKER] as number);
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      out[k] = deserializeProfileValue(v);
    }
    return out;
  }
  if (Array.isArray(value)) {
    return value.map(deserializeProfileValue);
  }
  return value;
}

export function serializeUserProfileToJson(profile: UserProfile): string {
  return JSON.stringify(serializeProfileValue(profile));
}

export function deserializeUserProfileFromJson(json: string): UserProfile | null {
  if (!json.trim()) return null;
  try {
    const raw = JSON.parse(json) as unknown;
    const revived = deserializeProfileValue(raw) as UserProfile;
    if (!revived || typeof revived !== 'object' || typeof revived.nickname !== 'string') return null;
    return revived;
  } catch {
    return null;
  }
}

function profileRowId(appUserId: string): string {
  return appUserId.trim();
}

export async function readUserProfileFromWatermelon(appUserId: string): Promise<UserProfile | null> {
  const db = database;
  const id = profileRowId(appUserId);
  if (!db || !id) return null;
  try {
    const row = await db.get<CachedUserProfile>('cached_user_profiles').find(id);
    return deserializeUserProfileFromJson(row.profileJson);
  } catch {
    return null;
  }
}

export async function upsertUserProfileToWatermelon(appUserId: string, profile: UserProfile): Promise<void> {
  const db = database;
  const id = profileRowId(appUserId);
  if (!db || !id) return;
  const now = Date.now();
  try {
    await db.write(async () => {
      const col = db.get<CachedUserProfile>('cached_user_profiles');
      try {
        const existing = await col.find(id);
        await existing.update((rec) => {
          rec.profileJson = serializeUserProfileToJson(profile);
          rec.syncedAtMs = now;
        });
        return;
      } catch {
        /* create */
      }
      await col.create((rec: CachedUserProfile) => {
        rec._raw.id = id;
        rec.profileJson = serializeUserProfileToJson(profile);
        rec.syncedAtMs = now;
      });
    });
  } catch {
    /* noop */
  }
}

/** `updateUserProfile` patch를 로컬 스냅샷에 병합(낙관적 UI). */
export function mergeUserProfilePatch(base: UserProfile, patch: Record<string, unknown>): UserProfile {
  const next: UserProfile = { ...base, ...patch } as UserProfile;
  if (patch.metadata && typeof patch.metadata === 'object' && !Array.isArray(patch.metadata)) {
    const prevMeta =
      base.metadata && typeof base.metadata === 'object' && !Array.isArray(base.metadata)
        ? (base.metadata as Record<string, unknown>)
        : {};
    next.metadata = { ...prevMeta, ...(patch.metadata as Record<string, unknown>) };
  }
  return next;
}

export type UserProfileOptimisticPatchResult = {
  previous: UserProfile | null;
  next: UserProfile | null;
};

export async function patchUserProfileInWatermelon(
  appUserId: string,
  updater: (prev: UserProfile) => UserProfile,
): Promise<UserProfileOptimisticPatchResult> {
  const id = profileRowId(appUserId);
  if (!id) return { previous: null, next: null };
  const previous = await readUserProfileFromWatermelon(id);
  if (!previous) return { previous: null, next: null };
  const next = updater(previous);
  await upsertUserProfileToWatermelon(id, next);
  return { previous, next };
}

export async function restoreUserProfileInWatermelon(
  appUserId: string,
  snapshot: UserProfile | null,
): Promise<void> {
  const id = profileRowId(appUserId);
  if (!id) return;
  if (!snapshot) {
    const db = database;
    if (!db) return;
    try {
      await db.write(async () => {
        try {
          const row = await db.get<CachedUserProfile>('cached_user_profiles').find(id);
          await row.destroyPermanently();
        } catch {
          /* noop */
        }
      });
    } catch {
      /* noop */
    }
    return;
  }
  await upsertUserProfileToWatermelon(id, snapshot);
}
