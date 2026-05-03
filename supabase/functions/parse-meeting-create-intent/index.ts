/**
 * 자연어 → 모임 생성 위저드용 구조화 JSON (Google Gemini).
 *
 * Secret: GEMINI_API_KEY
 * Request JSON: { text, categories: [{ id, label }], todayYmd?: string }
 * Response JSON: { result } — 클라이언트 파서용 필드 + 모델 출력에 반드시 포함: 이름, 인원, 날짜, 장소 (시각 권장)
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const GEMINI_MODEL = 'gemini-2.5-flash';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

type CategoryRow = { id: string; label: string };

type ReqBody = {
  text?: string;
  categories?: CategoryRow[];
  todayYmd?: string;
};

/** Gemini가 한글 키로 내려준 값을 기존 클라이언트(`parseMeetingCreateNluPayload`) 필드로 병합 */
function mergeKoreanKeysIntoPayload(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw };

  if (typeof raw['이름'] === 'string' && raw['이름'].trim()) {
    out.title = raw['이름'].trim();
  }

  const crew = raw['인원'];
  if (crew && typeof crew === 'object' && !Array.isArray(crew)) {
    const c = crew as Record<string, unknown>;
    if (typeof c['최소'] === 'number' && Number.isFinite(c['최소'])) {
      out.minParticipants = Math.trunc(c['최소'] as number);
    }
    if (typeof c['최대'] === 'number' && Number.isFinite(c['최대'])) {
      out.maxParticipants = Math.trunc(c['최대'] as number);
    }
  }

  if (typeof raw['날짜'] === 'string' && raw['날짜'].trim()) {
    out.scheduleYmd = raw['날짜'].trim();
  }
  if (typeof raw['시각'] === 'string' && raw['시각'].trim()) {
    out.scheduleHm = raw['시각'].trim();
  }

  if (typeof raw['장소'] === 'string') {
    out.placeAutoPickQuery = raw['장소'].trim() || null;
  }

  return out;
}

function extractGeminiText(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
    error?: { message?: string; code?: number };
  };
  if (d.error?.message) {
    console.error('[parse-meeting-create-intent] Ginit_AI_Error', 'gemini_error_field', JSON.stringify(d.error));
    return null;
  }
  const parts = d.candidates?.[0]?.content?.parts;
  const t = parts?.[0]?.text?.trim();
  return t && t.length > 0 ? t : null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const apiKey = Deno.env.get('GEMINI_API_KEY')?.trim();
  if (!apiKey) {
    console.error('[parse-meeting-create-intent] Ginit_AI_Error', 'GEMINI_API_KEY missing');
    return jsonResponse({ error: 'Server misconfigured' }, 500);
  }

  let body: ReqBody;
  try {
    body = (await req.json()) as ReqBody;
  } catch (e) {
    console.error('[parse-meeting-create-intent] Ginit_AI_Error', 'invalid_request_json', String(e));
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  const text = String(body.text ?? '').trim();
  const categories = Array.isArray(body.categories) ? body.categories : [];
  if (!text || categories.length === 0) {
    return jsonResponse({ error: 'text and categories required' }, 400);
  }

  const todayYmd =
    String(body.todayYmd ?? '').trim() ||
    (() => {
      const d = new Date();
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    })();

  const catLines = categories
    .map((c) => `- id: "${String(c.id).trim()}"  label: "${String(c.label).trim()}"`)
    .join('\n');

  const systemPrompt = `You are a strict JSON generator for a Korean meeting ("모임") creation wizard.
Respond with a single JSON object only (no markdown).

You MUST include these keys (Korean), populated from the user message:
- "이름": string — short meeting title in Korean.
- "인원": object with "최소" and "최대" (integers). Private meetings often same min=max.
- "날짜": string — YYYY-MM-DD (local).
- "시각": string — HH:mm 24h.
- "장소": string — Korean search query for Google Places (area + venue type). Use "" if unknown.

Also include (English/camelCase) for the app pipeline:
- categoryId: MUST be exactly one of the ids listed below.
- categoryLabel: optional string.
- suggestedIsPublic: boolean when user clearly wants public vs private; else null.
- menuPreferenceLabel: only for food — one of: 한식 일식 중식 양식 카페 주점·호프. Else null.
- canAutoCompleteThroughStep3: boolean (food + menu set, no extra specialty).
- publicMeetingDetails: only when public; optional keys ageLimit, genderRatio, settlement, minGLevel, minGTrust, approvalType.
- unknowns: array of { "field": string, "reason": string }.

Rules:
- Relative dates (내일, 모레, 이번 주 토요일) use todayYmd=${todayYmd} as reference.

Allowed categories:
${catLines}`;

  const userText = `오늘 날짜(로컬): ${todayYmd}\n사용자 입력:\n${text}`;

  const geminiUrl =
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${
      encodeURIComponent(apiKey)
    }`;

  let geminiRes: Response;
  try {
    geminiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userText }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
        },
      }),
    });
  } catch (e) {
    console.error('[parse-meeting-create-intent] Ginit_AI_Error', 'gemini_fetch_failed', String(e));
    return jsonResponse({ error: 'Upstream model unreachable' }, 502);
  }

  if (!geminiRes.ok) {
    const t = await geminiRes.text();
    console.error('[parse-meeting-create-intent] Ginit_AI_Error', 'gemini_http', geminiRes.status, t.slice(0, 800));
    return jsonResponse({ error: 'Upstream model error' }, 502);
  }

  let geminiJson: unknown;
  try {
    geminiJson = await geminiRes.json();
  } catch (e) {
    console.error('[parse-meeting-create-intent] Ginit_AI_Error', 'gemini_json_read_failed', String(e));
    return jsonResponse({ error: 'Invalid upstream response' }, 502);
  }

  const content = extractGeminiText(geminiJson);
  if (!content) {
    console.error('[parse-meeting-create-intent] Ginit_AI_Error', 'empty_model_text', JSON.stringify(geminiJson).slice(0, 600));
    return jsonResponse({ error: 'Empty model response' }, 502);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch (e) {
    console.error('[parse-meeting-create-intent] Ginit_AI_Error', 'model_text_not_json', String(e), content.slice(0, 400));
    return jsonResponse({ error: 'Model returned non-JSON' }, 502);
  }

  const merged = mergeKoreanKeysIntoPayload(parsed);

  return jsonResponse({ result: merged });
});
