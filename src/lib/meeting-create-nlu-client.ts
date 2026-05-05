import { supabase } from '@/src/lib/supabase';

export type ParseMeetingCreateIntentParams = {
  text: string;
  todayYmd?: string;
  /** 선택: 멀티턴 누적 JSON(Edge 프롬프트 참고용). 응답은 항상 이번 턴 추출분만 `{ result }`. */
  accumulated?: Record<string, unknown>;
  /** 선택: 최근 2~3턴 대화만(현재 `text` 제외). 토큰 절약·맥락용. */
  history?: string;
};

export type ParseMeetingCreateIntentOk = {
  ok: true;
  result: unknown;
};

export type ParseMeetingCreateIntentErr = { ok: false; error: string; blocked?: boolean };

/**
 * Edge `parse-meeting-create-intent` 호출 — `result`는 이번 발화 추출분(클라이언트에서 누적 병합).
 * 카테고리 목록은 Edge가 DB에서 로드해 시스템 프롬프트에 넣음(요청 본문에 미전송).
 * 정책 차단 시 `{ blocked: true, message }` 본문 → `ok: false`, `blocked: true`.
 */
export async function invokeParseMeetingCreateIntent(
  params: ParseMeetingCreateIntentParams,
): Promise<ParseMeetingCreateIntentOk | ParseMeetingCreateIntentErr> {
  const text = params.text.trim();
  if (!text) {
    return { ok: false, error: '입력 내용이 비어 있습니다.' };
  }

  const body: Record<string, unknown> = {
    text,
    todayYmd: params.todayYmd?.trim() || undefined,
  };
  if (params.accumulated && typeof params.accumulated === 'object' && !Array.isArray(params.accumulated)) {
    body.accumulated = params.accumulated;
  }
  const hist = typeof params.history === 'string' ? params.history.trim() : '';
  if (hist.length > 0) {
    body.history = hist;
  }

  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    const line = JSON.stringify(body);
    const max = 14_000;
    console.log(
      '[parse-meeting-create-intent] client_invoke',
      line.length > max ? `${line.slice(0, max)}…(+${line.length - max} chars)` : line,
    );
  }

  const { data, error } = await supabase.functions.invoke('parse-meeting-create-intent', {
    body,
  });

  if (error) {
    const msg = error.message?.trim() || '의도 분석 요청에 실패했습니다.';
    return { ok: false, error: msg };
  }

  const raw = data as { result?: unknown; error?: string; blocked?: boolean; message?: string } | null;
  if (raw && raw.blocked === true) {
    const msg =
      typeof raw.message === 'string' && raw.message.trim()
        ? raw.message.trim()
        : '이 내용으로는 모임을 만들 수 없어요.';
    return { ok: false, error: msg, blocked: true };
  }
  if (raw && typeof raw.error === 'string' && raw.error.trim()) {
    return { ok: false, error: raw.error.trim() };
  }
  if (raw == null || raw.result === undefined) {
    return { ok: false, error: '의도 분석 응답이 비어 있습니다.' };
  }

  return { ok: true, result: raw.result };
}
