/**
 * 카테고리 마스터.
 * - 기본: Supabase `public.meeting_categories` + Realtime (`hybrid-data-source` · Supabase 구성 시)
 * - `EXPO_PUBLIC_CATEGORIES_SOURCE=firestore`: Firestore `categories` (레거시)
 *
 * Firestore 문서 필드 권장:
 *   label, emoji, order
 *
 * Supabase 컬럼: id, label, emoji, sort_order (`0006_meeting_categories.sql`)
 */
import { collection, onSnapshot, type Unsubscribe } from 'firebase/firestore';

import { categoriesSource } from '@/src/lib/hybrid-data-source';
import { supabase } from '@/src/lib/supabase';

import { getFirebaseFirestore } from './firebase';

export const CATEGORIES_COLLECTION = 'categories';

export type Category = {
  id: string;
  label: string;
  emoji: string;
  order: number;
};

function normalizeCategory(id: string, data: Record<string, unknown>): Category {
  const label = typeof data.label === 'string' && data.label.trim() ? data.label.trim() : '이름 없음';
  const emoji = typeof data.emoji === 'string' && data.emoji.trim() ? data.emoji.trim() : '📌';
  const order = typeof data.order === 'number' && Number.isFinite(data.order) ? data.order : 999;
  return { id, label, emoji, order };
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
  return { id, label, emoji, order };
}

async function fetchMeetingCategoriesFromSupabase(): Promise<
  { ok: true; list: Category[] } | { ok: false; message: string }
> {
  const { data, error } = await supabase
    .from('meeting_categories')
    .select('id,label,emoji,sort_order')
    .order('sort_order', { ascending: true });
  if (error) return { ok: false, message: error.message };
  const list = (data ?? []).map((r) => mapSupabaseCategoryRow(r as Record<string, unknown>)).filter((c) => c.id);
  return { ok: true, list: sortCategories(list) };
}

function subscribeCategoriesSupabase(
  onData: (categories: Category[]) => void,
  onError?: (message: string) => void,
): Unsubscribe {
  let cancelled = false;

  const emit = async () => {
    if (cancelled) return;
    const res = await fetchMeetingCategoriesFromSupabase();
    if (cancelled) return;
    if (!res.ok) {
      onError?.(res.message);
      return;
    }
    onData(res.list);
  };

  void emit();

  /** 채널 토픽은 전역 유일해야 함 — 동일 문자열로 여러 `subscribeCategories`가 동시에 뜨면 이미 subscribe된 채널에 `.on()`을 붙이게 되어 런타임 오류가 납니다. */
  const channelTopic = `meeting_categories:${Date.now()}:${Math.random().toString(36).slice(2, 11)}`;
  const channel = supabase
    .channel(channelTopic)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'meeting_categories' },
      () => {
        void emit();
      },
    )
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR') onError?.('카테고리 Realtime 구독 오류');
    });

  return () => {
    cancelled = true;
    void supabase.removeChannel(channel);
  };
}

export function subscribeCategories(
  onData: (categories: Category[]) => void,
  onError?: (message: string) => void,
): Unsubscribe {
  if (categoriesSource() === 'supabase') {
    return subscribeCategoriesSupabase(onData, onError);
  }

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
