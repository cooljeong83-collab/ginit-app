/**
 * 정산 영수증 OCR 텍스트 → 구조화 분석 JSON.
 *
 * Secrets: GROQ_API_KEY, MISTRAL_API_KEY(선택), GEMINI_API_KEY(선택).
 * Request JSON: { chunks: string[], rawText?: string, locale?: 'ko-KR', currency?: 'KRW' }
 * Response JSON: { ok: true, analysis, totalWon, accountHint } | { ok: false, error }
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MISTRAL_CHAT_URL = 'https://api.mistral.ai/v1/chat/completions';
const MISTRAL_MODEL = 'mistral-small-latest';
const GEMINI_MODEL = 'gemini-1.5-flash';
const GEMINI_GENERATE_CONTENT_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const GROQ_CHAT_MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'gemma2-9b-it',
  'mixtral-8x7b-32768',
] as const;

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type ReqBody = {
  chunks?: unknown;
  rawText?: unknown;
  locale?: unknown;
  currency?: unknown;
};

type AttemptOk = { ok: true; model: string; content: string };
type AttemptFail = { ok: false; model: string; tag: string; detail: string };

type ReceiptReviewItem = {
  name: string;
  tags: string[];
};

type ReceiptAnalysis = {
  verification: {
    biz_num: string | null;
    store_name: string | null;
    datetime: string | null;
  };
  review_source: {
    items: ReceiptReviewItem[];
  };
  billing: {
    total_amount: number | null;
    is_verified: boolean;
  };
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function stripCodeFences(s: string): string {
  return s
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function extractBalancedJsonObject(s: string): string | null {
  const t = stripCodeFences(s);
  const start = t.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < t.length; i += 1) {
    const ch = t[i]!;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return t.slice(start, i + 1);
    }
  }
  return null;
}

function parseModelJson(content: string): Record<string, unknown> | null {
  const slice = extractBalancedJsonObject(content);
  if (!slice) return null;
  try {
    const parsed = JSON.parse(slice) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function asObject(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

function asStringOrNull(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

function asMoneyOrNull(raw: unknown): number | null {
  const n =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim()
        ? Number(raw.trim().replace(/,/g, ''))
        : NaN;
  if (!Number.isFinite(n)) return null;
  const v = Math.trunc(n);
  return v >= 0 && v <= 500_000_000 ? v : null;
}

function asBoolean(raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') {
    const t = raw.trim().toLowerCase();
    return t === 'true' || t === '1' || t === 'yes';
  }
  return false;
}

function normalizeBizNum(raw: unknown): string | null {
  const s = asStringOrNull(raw);
  if (!s) return null;
  const digits = s.replace(/\D/g, '');
  if (digits.length !== 10) return s;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tag of raw) {
    const t = typeof tag === 'string' ? tag.trim() : '';
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t.slice(0, 24));
  }
  return out.slice(0, 8);
}

function normalizeReviewItems(raw: unknown): ReceiptReviewItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ReceiptReviewItem[] = [];
  for (const item of raw) {
    const o = asObject(item);
    if (!o) continue;
    const name = asStringOrNull(o.name) ?? asStringOrNull(o['메뉴명']) ?? '품목';
    out.push({ name, tags: normalizeTags(o.tags) });
  }
  return out.slice(0, 80);
}

function normalizeAnalysis(raw: Record<string, unknown>): ReceiptAnalysis | null {
  const analysisRaw = asObject(raw.analysis) ?? raw;
  const verificationRaw = asObject(analysisRaw.verification) ?? {};
  const reviewSourceRaw = asObject(analysisRaw.review_source) ?? asObject(analysisRaw.reviewSource) ?? {};
  const billingRaw = asObject(analysisRaw.billing) ?? {};
  const legacyStoreInfoRaw = asObject(analysisRaw.store_info) ?? asObject(analysisRaw.storeInfo) ?? {};
  const legacySummaryRaw = asObject(analysisRaw.final_summary) ?? asObject(analysisRaw.finalSummary) ?? {};
  const reviewItems = normalizeReviewItems(reviewSourceRaw.items ?? analysisRaw.items);
  const totalAmount =
    asMoneyOrNull(billingRaw.total_amount ?? billingRaw.totalAmount) ??
    asMoneyOrNull(legacySummaryRaw.actual_payment ?? legacySummaryRaw.actualPayment) ??
    asMoneyOrNull(legacySummaryRaw.calculated_total ?? legacySummaryRaw.calculatedTotal);
  if (totalAmount == null) return null;
  return {
    verification: {
      biz_num: normalizeBizNum(verificationRaw.biz_num ?? verificationRaw.bizNum),
      store_name:
        asStringOrNull(verificationRaw.store_name ?? verificationRaw.storeName) ?? asStringOrNull(legacyStoreInfoRaw.name),
      datetime:
        asStringOrNull(verificationRaw.datetime) ??
        asStringOrNull(verificationRaw.date) ??
        asStringOrNull(legacyStoreInfoRaw.date),
    },
    review_source: {
      items: reviewItems,
    },
    billing: {
      total_amount: totalAmount,
      is_verified: asBoolean(billingRaw.is_verified ?? billingRaw.isVerified ?? legacySummaryRaw.is_verified ?? legacySummaryRaw.isVerified),
    },
  };
}

function extractChatContent(data: unknown): string | null {
  const d = data as { choices?: Array<{ message?: { content?: unknown } }>; error?: { message?: string } };
  if (d?.error?.message) return null;
  const raw = d?.choices?.[0]?.message?.content;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

function extractGeminiContent(data: unknown): string | null {
  const d = data as { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>; error?: { message?: string } };
  if (d?.error?.message) return null;
  const raw = d?.candidates?.[0]?.content?.parts?.[0]?.text;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

async function callOpenAiCompatible(params: {
  url: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userText: string;
}): Promise<AttemptOk | AttemptFail> {
  let res: Response;
  try {
    res = await fetch(params.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${params.apiKey}` },
      body: JSON.stringify({
        model: params.model,
        messages: [
          { role: 'system', content: params.systemPrompt },
          { role: 'user', content: params.userText },
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' },
      }),
    });
  } catch (e) {
    return { ok: false, model: params.model, tag: 'fetch_failed', detail: String(e) };
  }
  if (!res.ok) {
    const t = await res.text();
    return { ok: false, model: params.model, tag: 'http_error', detail: `${res.status} ${t.slice(0, 800)}` };
  }
  try {
    const body = await res.json();
    const content = extractChatContent(body);
    if (!content) return { ok: false, model: params.model, tag: 'empty_content', detail: JSON.stringify(body).slice(0, 800) };
    return { ok: true, model: params.model, content };
  } catch (e) {
    return { ok: false, model: params.model, tag: 'json_read_failed', detail: String(e) };
  }
}

async function callGemini(params: {
  apiKey: string;
  systemPrompt: string;
  userText: string;
}): Promise<AttemptOk | AttemptFail> {
  let res: Response;
  try {
    res = await fetch(GEMINI_GENERATE_CONTENT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': params.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: params.systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: params.userText }] }],
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
      }),
    });
  } catch (e) {
    return { ok: false, model: GEMINI_MODEL, tag: 'gemini_fetch_failed', detail: String(e) };
  }
  if (!res.ok) {
    const t = await res.text();
    return { ok: false, model: GEMINI_MODEL, tag: 'gemini_http_error', detail: `${res.status} ${t.slice(0, 800)}` };
  }
  try {
    const body = await res.json();
    const content = extractGeminiContent(body);
    if (!content) return { ok: false, model: GEMINI_MODEL, tag: 'gemini_empty_content', detail: JSON.stringify(body).slice(0, 800) };
    return { ok: true, model: GEMINI_MODEL, content };
  } catch (e) {
    return { ok: false, model: GEMINI_MODEL, tag: 'gemini_json_read_failed', detail: String(e) };
  }
}

function buildSystemPrompt(): string {
  return `너는 영수증의 라인 순서와 텍스트 간 상관관계를 이해하는 Ginit 정산 데이터 엔지니어다.
입력은 온디바이스 OCR이 추출한 텍스트 chunks이며, 원본 이미지는 받지 않는다. 라인 순서와 인접성을 시각적 레이아웃 힌트로 사용한다.

반드시 단일 JSON 객체만 응답한다. markdown, 설명 문장, 코드펜스는 금지한다.

분석 규칙:
1. verification.biz_num: 사업자등록번호를 찾는다. 000-00-00000 형식으로 정규화하고, 없으면 null이다.
2. verification.store_name: 가게명/상호명을 찾는다. 없으면 null이다.
3. verification.datetime: 방문·결제 시점 증빙 날짜 시간을 YYYY-MM-DD HH:mm 형식으로 추출한다. 없으면 null이다.
4. review_source.items: 후기 자동 태그에 쓸 메뉴명을 추출한다. 각 항목 tags는 짧은 한국어 키워드 배열이다(예: 메인, 치즈, 매운맛, 면, 디저트, 음료).
5. billing.total_amount: 정산에 반영할 최종 결제금액/받을금액/승인금액을 KRW 정수로 추출한다. 공급가액/부가세/적립/거스름돈은 대표 결제금액이 아니다.
6. billing.is_verified: OCR 텍스트 안에서 품목/할인/세금/결제액의 산술 관계가 납득 가능하면 true, 아니면 false다. 사업자번호 유무와는 별개다.
7. 메뉴별 단가, 할인 상세, 세금 상세는 출력하지 않는다. 내부 판단에만 사용한다.

출력 스키마:
{
  "verification": {
    "biz_num": "000-00-00000"|null,
    "store_name": string|null,
    "datetime": "YYYY-MM-DD HH:mm"|null
  },
  "review_source": {
    "items": [{ "name": string, "tags": string[] }]
  },
  "billing": {
    "total_amount": number,
    "is_verified": boolean
  },
  "account_hint": string|null
}`;
}

function normalizeChunks(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => (typeof x === 'string' ? x.normalize('NFKC').trim() : ''))
    .filter((x) => x.length > 0)
    .slice(0, 200);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
  if (!(req.headers.get('Authorization') ?? '').startsWith('Bearer ')) {
    return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
  }

  let body: ReqBody;
  try {
    body = (await req.json()) as ReqBody;
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid JSON' }, 400);
  }

  const chunks = normalizeChunks(body.chunks);
  const rawText = typeof body.rawText === 'string' ? body.rawText.normalize('NFKC').trim() : '';
  const joined = chunks.join('\n').trim() || rawText;
  if (joined.length < 3) return jsonResponse({ ok: false, error: 'OCR text is empty' }, 400);

  const systemPrompt = buildSystemPrompt();
  const userText = `locale=${typeof body.locale === 'string' ? body.locale : 'ko-KR'}
currency=${typeof body.currency === 'string' ? body.currency : 'KRW'}

OCR chunks:
${chunks.map((x, i) => `[${i + 1}] ${x}`).join('\n')}

rawText:
${rawText || joined}`;

  const attempts: AttemptFail[] = [];
  const groqKey = Deno.env.get('GROQ_API_KEY')?.trim();
  if (groqKey) {
    for (const model of GROQ_CHAT_MODELS) {
      const attempt = await callOpenAiCompatible({ url: GROQ_CHAT_URL, apiKey: groqKey, model, systemPrompt, userText });
      if (attempt.ok) {
        const parsed = parseModelJson(attempt.content);
        const analysis = parsed ? normalizeAnalysis(parsed) : null;
        if (analysis) {
          const accountHint = asStringOrNull(parsed?.account_hint ?? parsed?.accountHint);
          return jsonResponse({
            ok: true,
            analysis,
            totalWon: analysis.billing.total_amount,
            accountHint,
            model: attempt.model,
          });
        }
        attempts.push({ ok: false, model, tag: 'unparseable_schema', detail: attempt.content.slice(0, 800) });
      } else {
        attempts.push(attempt);
      }
    }
  }

  const mistralKey = Deno.env.get('MISTRAL_API_KEY')?.trim();
  if (mistralKey) {
    const attempt = await callOpenAiCompatible({ url: MISTRAL_CHAT_URL, apiKey: mistralKey, model: MISTRAL_MODEL, systemPrompt, userText });
    if (attempt.ok) {
      const parsed = parseModelJson(attempt.content);
      const analysis = parsed ? normalizeAnalysis(parsed) : null;
      if (analysis) {
        const accountHint = asStringOrNull(parsed?.account_hint ?? parsed?.accountHint);
        return jsonResponse({
          ok: true,
          analysis,
          totalWon: analysis.billing.total_amount,
          accountHint,
          model: attempt.model,
        });
      }
      attempts.push({ ok: false, model: MISTRAL_MODEL, tag: 'mistral_unparseable_schema', detail: attempt.content.slice(0, 800) });
    } else {
      attempts.push(attempt);
    }
  }

  const geminiKey = Deno.env.get('GEMINI_API_KEY')?.trim();
  if (geminiKey) {
    const attempt = await callGemini({ apiKey: geminiKey, systemPrompt, userText });
    if (attempt.ok) {
      const parsed = parseModelJson(attempt.content);
      const analysis = parsed ? normalizeAnalysis(parsed) : null;
      if (analysis) {
        const accountHint = asStringOrNull(parsed?.account_hint ?? parsed?.accountHint);
        return jsonResponse({
          ok: true,
          analysis,
          totalWon: analysis.billing.total_amount,
          accountHint,
          model: attempt.model,
        });
      }
      attempts.push({ ok: false, model: GEMINI_MODEL, tag: 'gemini_unparseable_schema', detail: attempt.content.slice(0, 800) });
    } else {
      attempts.push(attempt);
    }
  }

  console.error('[analyze-settlement-receipt] all_attempts_failed', JSON.stringify(attempts.slice(-5)));
  return jsonResponse({ ok: false, error: '영수증 AI 분석에 실패했습니다.' }, 502);
});
