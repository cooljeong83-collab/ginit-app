/**
 * 카테고리 마스터 — Supabase `public.meeting_categories` 단일 소스.
 * Supabase 컬럼: id, label, emoji, sort_order, major_code (`0006` + `0061`)
 */
import { publicEnv } from '@/src/config/public-env';

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

const MEETING_CATEGORIES_FETCH_TIMEOUT_MS = 20_000;

/**
 * 공개 RLS 테이블이지만 기본 Supabase 클라이언트는 REST마다 `auth.getSession()` 락을 밟을 수 있어
 * 로그인·프로필 RPC와 겹치면 카테고리 fetch가 끝나지 않습니다. anon REST만 사용합니다.
 */
export async function fetchMeetingCategoriesFromSupabase(): Promise<
  { ok: true; list: Category[] } | { ok: false; message: string }
> {
  const base = publicEnv.supabaseUrl.trim().replace(/\/$/, '');
  const anon = publicEnv.supabaseAnonKey.trim();
  if (!base || !anon) {
    return { ok: false, message: 'Supabase URL·Anon Key가 설정되지 않았어요.' };
  }

  const url = `${base}/rest/v1/meeting_categories?select=id,label,emoji,sort_order,major_code&order=sort_order.asc`;
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), MEETING_CATEGORIES_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        apikey: anon,
        Authorization: `Bearer ${anon}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, message: body.trim() || `HTTP ${res.status}` };
    }
    const data = (await res.json()) as unknown;
    const rows = Array.isArray(data) ? data : [];
    const list = rows
      .map((r: unknown) => mapSupabaseCategoryRow(r as Record<string, unknown>))
      .filter((c: Category) => c.id);
    return { ok: true, list: sortCategories(list) };
  } catch (e) {
    const msg =
      e instanceof Error && e.name === 'AbortError'
        ? '카테고리 요청 시간이 초과됐어요.'
        : e instanceof Error
          ? e.message
          : '카테고리를 불러오지 못했어요.';
    return { ok: false, message: msg };
  } finally {
    clearTimeout(tid);
  }
}
