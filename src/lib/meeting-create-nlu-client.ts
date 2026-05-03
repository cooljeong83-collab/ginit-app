import { supabase } from '@/src/lib/supabase';

export type ParseMeetingCreateIntentParams = {
  text: string;
  categories: { id: string; label: string }[];
  todayYmd?: string;
  /** 생략·`wizard_fill` — 기존 원샷. `chat_turn` — 멀티턴(assistantReply 등). */
  mode?: 'wizard_fill' | 'chat_turn';
  history?: string[];
  accumulated?: Record<string, unknown>;
};

export type ParseMeetingCreateIntentOk = {
  ok: true;
  result: unknown;
  assistantReply?: string | null;
  readyToConfirm?: boolean | null;
};

/**
 * Edge `parse-meeting-create-intent` 호출 — `result`는 `MeetingCreateNluEdgePayload` 형에 가깝게 파싱합니다.
 * `mode: 'chat_turn'`일 때 응답에 `assistantReply`·`readyToConfirm`이 올 수 있습니다.
 */
export async function invokeParseMeetingCreateIntent(
  params: ParseMeetingCreateIntentParams,
): Promise<ParseMeetingCreateIntentOk | { ok: false; error: string }> {
  const text = params.text.trim();
  if (!text) {
    return { ok: false, error: '입력 내용이 비어 있습니다.' };
  }
  const categories = params.categories
    .map((c) => ({
      id: String(c.id ?? '').trim(),
      label: String(c.label ?? '').trim(),
    }))
    .filter((c) => c.id && c.label);

  if (categories.length === 0) {
    return { ok: false, error: '카테고리 목록이 없습니다.' };
  }

  const body: Record<string, unknown> = {
    text,
    categories,
    todayYmd: params.todayYmd?.trim() || undefined,
  };
  if (params.mode === 'chat_turn') {
    body.mode = 'chat_turn';
    body.history = Array.isArray(params.history) ? params.history : [];
    body.accumulated =
      params.accumulated && typeof params.accumulated === 'object' && !Array.isArray(params.accumulated)
        ? params.accumulated
        : {};
  }

  const { data, error } = await supabase.functions.invoke('parse-meeting-create-intent', {
    body,
  });

  if (error) {
    const msg = error.message?.trim() || '의도 분석 요청에 실패했습니다.';
    return { ok: false, error: msg };
  }

  const raw = data as { result?: unknown; error?: string; assistantReply?: string; readyToConfirm?: boolean } | null;
  if (raw && typeof raw.error === 'string' && raw.error.trim()) {
    return { ok: false, error: raw.error.trim() };
  }
  if (raw == null || raw.result === undefined) {
    return { ok: false, error: '의도 분석 응답이 비어 있습니다.' };
  }

  if (params.mode === 'chat_turn') {
    const ar = typeof raw.assistantReply === 'string' ? raw.assistantReply.trim() : '';
    const rtc = raw.readyToConfirm;
    return {
      ok: true,
      result: raw.result,
      assistantReply: ar.length > 0 ? ar : null,
      readyToConfirm: typeof rtc === 'boolean' ? rtc : null,
    };
  }

  return { ok: true, result: raw.result };
}

/** `invokeParseMeetingCreateIntent({ ...params, mode: 'chat_turn' })` 단축 */
export function invokeMeetingCreateAgentTurn(
  params: Omit<ParseMeetingCreateIntentParams, 'mode'>,
): Promise<ParseMeetingCreateIntentOk | { ok: false; error: string }> {
  return invokeParseMeetingCreateIntent({ ...params, mode: 'chat_turn' });
}
