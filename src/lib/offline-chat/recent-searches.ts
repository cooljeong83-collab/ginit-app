import { Q } from '@nozbe/watermelondb';

import { database } from '@/src/watermelon';

export type RecentSearchScope = 'room' | 'global';

export async function recordRecentSearch(args: {
  scope: RecentSearchScope;
  roomId?: string | null;
  query: string;
}): Promise<void> {
  const db = database;
  if (!db) return;
  const q = String(args.query ?? '').trim();
  if (!q) return;
  const scope = args.scope === 'global' ? 'global' : 'room';
  const roomId = args.roomId?.trim() ? args.roomId.trim() : null;
  const now = Date.now();

  const tbl = db.get('recent_searches');
  await db.write(async () => {
    const existing = await tbl
      .query(Q.where('scope', scope), ...(roomId ? [Q.where('room_id', roomId)] : []), Q.where('query', q))
      .fetch();
    const row = existing[0];
    if (row) {
      await row.update((x: any) => {
        x.lastUsedAtMs = now;
        x.useCount = (typeof x.useCount === 'number' ? x.useCount : 0) + 1;
      });
      return;
    }
    await tbl.create((x: any) => {
      x.scope = scope;
      x.roomId = roomId;
      x.query = q;
      x.lastUsedAtMs = now;
      x.useCount = 1;
    });
  });
}

export async function listRecentSearches(args: {
  scope: RecentSearchScope;
  roomId?: string | null;
  limit?: number;
}): Promise<Array<{ query: string; lastUsedAtMs: number }>> {
  const db = database;
  if (!db) return [];
  const scope = args.scope === 'global' ? 'global' : 'room';
  const roomId = args.roomId?.trim() ? args.roomId.trim() : null;
  const lim = Math.min(Math.max(5, args.limit ?? 12), 50);
  const tbl = db.get('recent_searches');

  const rows = await tbl
    .query(Q.where('scope', scope), ...(roomId ? [Q.where('room_id', roomId)] : []), Q.sortBy('last_used_at_ms', Q.desc), Q.take(lim))
    .fetch();

  return rows.map((r: any) => ({ query: String(r.query ?? ''), lastUsedAtMs: Number(r.lastUsedAtMs ?? 0) || 0 }));
}

