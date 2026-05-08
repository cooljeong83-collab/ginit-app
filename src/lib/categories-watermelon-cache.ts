import { Q } from '@nozbe/watermelondb';

import type { Category } from '@/src/lib/categories';
import { CachedMeetingCategory } from '@/src/watermelon/models/CachedMeetingCategory';
import { database } from '@/src/watermelon';

function sortCategories(list: Category[]): Category[] {
  return [...list].sort((a, b) => (a.order !== b.order ? a.order - b.order : a.label.localeCompare(b.label, 'ko')));
}

/** 네이티브: Watermelon에서 카테고리 목록 읽기. 웹은 빈 배열. */
export async function readCachedMeetingCategoriesFromWatermelon(): Promise<Category[]> {
  const db = database;
  if (!db) return [];
  try {
    const col = db.get<CachedMeetingCategory>('cached_meeting_categories');
    const rows = await col.query(Q.sortBy('sort_order', Q.asc)).fetch();
    const list: Category[] = rows
      .map((r) => ({
        id: String(r.id ?? '').trim(),
        label: typeof r.label === 'string' && r.label.trim() ? r.label.trim() : '이름 없음',
        emoji: typeof r.emoji === 'string' && r.emoji.trim() ? r.emoji.trim() : '📌',
        order: typeof r.sortOrder === 'number' && Number.isFinite(r.sortOrder) ? Math.trunc(r.sortOrder) : 999,
        majorCode:
          typeof r.majorCode === 'string' && r.majorCode.trim().length > 0 ? r.majorCode.trim() : null,
      }))
      .filter((c) => c.id.length > 0);
    return sortCategories(list);
  } catch {
    return [];
  }
}

/** 서버 스냅샷으로 로컬 캐시 전체 교체. */
export async function replaceWatermelonMeetingCategoriesCache(list: Category[]): Promise<void> {
  const db = database;
  if (!db) return;
  const safe = (list ?? []).filter((c) => c?.id && String(c.id).trim().length > 0);
  try {
    await db.write(async () => {
      const col = db.get<CachedMeetingCategory>('cached_meeting_categories');
      const existing = await col.query().fetch();
      for (const row of existing) {
        await row.destroyPermanently();
      }
      for (const c of safe) {
        await col.create((rec: any) => {
          rec._raw.id = String(c.id).trim();
          rec.label = typeof c.label === 'string' && c.label.trim() ? c.label.trim() : '이름 없음';
          rec.emoji = typeof c.emoji === 'string' && c.emoji.trim() ? c.emoji.trim() : '📌';
          rec.sortOrder = typeof c.order === 'number' && Number.isFinite(c.order) ? Math.trunc(c.order) : 999;
          const mc = typeof c.majorCode === 'string' ? c.majorCode.trim() : '';
          rec.majorCode = mc.length > 0 ? mc : null;
        });
      }
    });
  } catch {
    /* 로컬 동기화 실패는 앱 크래시보다 무시 */
  }
}
