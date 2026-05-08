/**
 * 카테고리 마스터.
 * - 기본: Supabase `public.meeting_categories` + Realtime (`MeetingCategoriesProvider`)
 * - `EXPO_PUBLIC_CATEGORIES_SOURCE=firestore`: Firestore `categories` (레거시)
 *
 * Firestore 문서 필드 권장:
 *   label, emoji, order
 *
 * Supabase 컬럼: id, label, emoji, sort_order, major_code (`0006` + `0061`)
 */
import { collection, onSnapshot, type Unsubscribe } from 'firebase/firestore';

import { supabase } from '@/src/lib/supabase';

import { getFirebaseFirestore } from './firebase';

export const CATEGORIES_COLLECTION = 'categories';

export type Category = {
  id: string;
  label: string;
  emoji: string;
  order: number;
  /** `meeting_categories.major_code` — Step 2 특화·정책 키 */
  majorCode?: string | null;
};

export function normalizeCategory(id: string, data: Record<string, unknown>): Category {
  const label = typeof data.label === 'string' && data.label.trim() ? data.label.trim() : '이름 없음';
  const emoji = typeof data.emoji === 'string' && data.emoji.trim() ? data.emoji.trim() : '📌';
  const order = typeof data.order === 'number' && Number.isFinite(data.order) ? data.order : 999;
  const mc =
    (typeof data.major_code === 'string' ? data.major_code.trim() : '') ||
    (typeof data.majorCode === 'string' ? data.majorCode.trim() : '');
  const majorCode = mc.length > 0 ? mc : null;
  return { id, label, emoji, order, majorCode };
}

function sortCategories(list: Category[]): Category[] {
  return [...list].sort((a, b) => (a.order !== b.order ? a.order - b.order : a.label.localeCompare(b.label, 'ko')));
}

function mapSupabaseCategoryRow(row: Record<string, unknown>): Category {
  const id = typeof row.id === 'string' ? row.id.trim() : '';
  const label = typeof row.label === 'string' && row.label.trim() ? row.label.trim() : '이름 없음';
  const emoji = typeof row.emoji === 'string' && row.emoji.trim() ? row.emoji.trim() : '📌';
  const order =
    typeof row.sort_order === 'number' && Number.isFinite(row.sort_order) ? Math.trunc(row.sort_order) : 999;
  const mcRaw = typeof row.major_code === 'string' ? row.major_code.trim() : '';
  const majorCode = mcRaw.length > 0 ? mcRaw : null;
  return { id, label, emoji, order, majorCode };
}

export async function fetchMeetingCategoriesFromSupabase(): Promise<
  { ok: true; list: Category[] } | { ok: false; message: string }
> {
  const { data, error } = await supabase
    .from('meeting_categories')
    .select('id,label,emoji,sort_order,major_code')
    .order('sort_order', { ascending: true });
  if (error) return { ok: false, message: error.message };
  const list = (data ?? [])
    .map((r: unknown) => mapSupabaseCategoryRow(r as Record<string, unknown>))
    .filter((c: Category) => c.id);
  return { ok: true, list: sortCategories(list) };
}

/**
 * Firestore `categories` 구독(레거시 소스 전용).
 * - UI는 `MeetingCategoriesProvider` / `useMeetingCategories` 사용.
 */
export function subscribeFirestoreCategories(
  onData: (categories: Category[]) => void,
  onError?: (message: string) => void,
): Unsubscribe {
  const ref = collection(getFirebaseFirestore(), CATEGORIES_COLLECTION);
  return onSnapshot(
    ref,
    (snap) => {
      const list = snap.docs
        .map((d) => normalizeCategory(d.id, d.data() as Record<string, unknown>))
        .sort((a, b) => (a.order !== b.order ? a.order - b.order : a.label.localeCompare(b.label, 'ko')));
      onData(list);
    },
    (err) => {
      onError?.(err.message ?? '카테고리 구독 오류');
    },
  );
}
