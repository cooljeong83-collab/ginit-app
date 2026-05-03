import { supabase } from '@/src/lib/supabase';

export type ParseMeetingCreateIntentParams = {
  text: string;
  categories: { id: string; label: string }[];
  todayYmd?: string;
};

/**
 * Edge `parse-meeting-create-intent` 호출 — `result`는 `MeetingCreateNluEdgePayload` 형에 가깝게 파싱합니다.
 */
export async function invokeParseMeetingCreateIntent(
  params: ParseMeetingCreateIntentParams,
): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  const text = params.text.trim();
  if (!text) {
    return { ok: false, error: '입력 내용이 비어 있습니다.' };
  }
  const categories = params.categories.map((c) => ({
    id: String(c.id ?? '').trim(),
    label: String(c.label ?? '').trim(),
  })).filter((c) => c.id && c.label);

  if (categories.length === 0) {
    return { ok: false, error: '카테고리 목록이 없습니다.' };
  }

  const { data, error } = await supabase.functions.invoke('parse-meeting-create-intent', {
    body: {
      text,
      categories,
      todayYmd: params.todayYmd?.trim() || undefined,
    },
  });

  if (error) {
    const msg = error.message?.trim() || '의도 분석 요청에 실패했습니다.';
    return { ok: false, error: msg };
  }

  const raw = data as { result?: unknown; error?: string } | null;
  if (raw && typeof raw.error === 'string' && raw.error.trim()) {
    return { ok: false, error: raw.error.trim() };
  }
  if (raw == null || raw.result === undefined) {
    return { ok: false, error: '의도 분석 응답이 비어 있습니다.' };
  }

  return { ok: true, result: raw.result };
}
