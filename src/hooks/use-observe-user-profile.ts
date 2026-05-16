import { Q } from '@nozbe/watermelondb';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { deserializeUserProfileFromJson } from '@/src/lib/user-profile-watermelon-cache';
import type { UserProfile } from '@/src/lib/user-profile';
import { CachedUserProfile } from '@/src/watermelon/models/CachedUserProfile';
import { database } from '@/src/watermelon';

export type ObserveUserProfileState = {
  profile: UserProfile | null | undefined;
  hasLocalRow: boolean;
};

/** 네이티브: Watermelon `cached_user_profiles` observe. 웹: 항상 `profile: undefined`. */
export function useObserveUserProfile(appUserId: string): ObserveUserProfileState {
  const id = typeof appUserId === 'string' ? appUserId.trim() : '';
  const [profile, setProfile] = useState<UserProfile | null | undefined>(undefined);
  const [hasLocalRow, setHasLocalRow] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'web' || !database || !id) {
      setProfile(undefined);
      setHasLocalRow(false);
      return;
    }

    const db = database;
    const col = db.get<CachedUserProfile>('cached_user_profiles');
    const query = col.query(Q.where('id', id));

    const applyRows = (rows: CachedUserProfile[]) => {
      const row = rows[0];
      if (!row) {
        setHasLocalRow(false);
        setProfile(null);
        return;
      }
      setHasLocalRow(true);
      setProfile(deserializeUserProfileFromJson(row.profileJson));
    };

    const sub = query.observeWithColumns(['profile_json', 'synced_at_ms']).subscribe({
      next: applyRows,
      error: () => {
        setHasLocalRow(false);
        setProfile(null);
      },
    });

    return () => sub.unsubscribe();
  }, [id]);

  return { profile, hasLocalRow };
}
