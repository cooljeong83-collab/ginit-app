/**
 * 자연어 → 모임 생성 위저드용 구조화 JSON (Groq Llama 하이브리드).
 *
 * Secret: GROQ_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (금지어 정책 조회)
 * 모델: llama-3.3-70b-versatile → 실패 시 llama-3.1-8b-instant 폴백.
 * Request JSON: { text, categories: [{ id, label }], todayYmd?, accumulated? }
 * Response JSON: { result } | { blocked: true, message }
 * 후처리: 코드펜스/사족 제거 후 JSON 파싱, 요약 스키마 병합, 메뉴 키워드 폴백, 공개 시 ageLimit 기본.
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL_PRIMARY = 'llama-3.3-70b-versatile';
const GROQ_MODEL_FALLBACK = 'llama-3.1-8b-instant';

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

type CategoryRow = { id: string; label: string; majorCode?: string | null; order?: number };

type ReqBody = {
  text?: string;
  categories?: CategoryRow[];
  todayYmd?: string;
  accumulated?: Record<string, unknown>;
};

type NluBlockedPolicy = { phrases?: unknown; userMessage?: unknown };

function normalizeForMatch(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

async function loadNluBlockedFromDb(): Promise<{ phrases: string[]; userMessage: string }> {
  const url = Deno.env.get('SUPABASE_URL')?.trim();
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim();
  const fallbackMsg =
    '이 내용으로는 모임을 만들 수 없어요. 커뮤니티 가이드에 맞는 모임만 만들 수 있어요.';
  const fallbackPhrases = ['마약', '필로폰', '대마', '코카인', '히로뽕', '엑스터시', '게이모임'];
  if (!url || !key) {
    return { phrases: fallbackPhrases, userMessage: fallbackMsg };
  }
  try {
    const u = `${url.replace(/\/$/, '')}/rest/v1/app_policies?policy_group=eq.meeting_create&policy_key=eq.nlu_blocked&select=policy_value&limit=1`;
    const r = await fetch(u, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (!r.ok) return { phrases: fallbackPhrases, userMessage: fallbackMsg };
    const rows = (await r.json()) as { policy_value?: unknown }[];
    const pv = rows?.[0]?.policy_value as NluBlockedPolicy | undefined;
    const phrasesIn = pv && Array.isArray(pv.phrases) ? pv.phrases : [];
    const phrases = phrasesIn
      .map((p) => (typeof p === 'string' ? p.normalize('NFKC').trim() : ''))
      .filter((p) => p.length > 0);
    const userMessage =
      typeof pv?.userMessage === 'string' && pv.userMessage.trim() ? pv.userMessage.trim() : fallbackMsg;
    return { phrases: phrases.length > 0 ? phrases : fallbackPhrases, userMessage };
  } catch {
    return { phrases: fallbackPhrases, userMessage: fallbackMsg };
  }
}

function isTextBlockedByPolicy(text: string, policy: { phrases: string[]; userMessage: string }): boolean {
  const norm = normalizeForMatch(text);
  if (!norm) return false;
  for (const p of policy.phrases) {
    const q = normalizeForMatch(p);
    if (q && norm.includes(q)) return true;
  }
  return false;
}

/** 모델이 한글 키로 내려준 값을 기존 클라이언트(`parseMeetingCreateNluPayload`) 필드로 병합 */
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

  const mv = raw['영화제목'];
  if (typeof mv === 'string' && mv.trim()) {
    const t = mv.trim();
    out.primaryMovieTitle = t;
    out.movieTitleHints = [t];
  } else if (Array.isArray(mv)) {
    const titles = mv.map((x) => String(x ?? '').trim()).filter((t) => t.length > 0);
    if (titles.length > 0) out.movieTitleHints = titles;
  }

  return out;
}

/** 중첩 스키마(inference / extracted_data / missing_fields / response) → 플랫 필드(클라이언트 호환) */
function flattenNestedMeetingCreateIntentResult(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw };

  const pushUnknown = (field: string, reason: string) => {
    const prev = Array.isArray(out.unknowns) ? (out.unknowns as unknown[]) : [];
    if (prev.some((u) => typeof u === 'object' && u && String((u as Record<string, unknown>).field ?? '') === field)) {
      return;
    }
    out.unknowns = [...prev, { field, reason }];
  };

  const ex = raw['extracted_data'];
  if (ex && typeof ex === 'object' && !Array.isArray(ex)) {
    const e = ex as Record<string, unknown>;
    if (typeof e.title === 'string' && e.title.trim() && (out.title == null || String(out.title).trim() === '')) {
      out.title = e.title.trim();
    }
    if (typeof e.category_label === 'string' && e.category_label.trim() && !out.categoryLabel) {
      out.categoryLabel = e.category_label.trim();
    }
    if (typeof e.major_code === 'string' && e.major_code.trim() && !out.majorCodeHint) {
      out.majorCodeHint = e.major_code.trim();
    }
    if (typeof e.schedule_date === 'string' && e.schedule_date.trim() && !out.scheduleYmd) {
      out.scheduleYmd = e.schedule_date.trim();
    }
    if (typeof e.schedule_time === 'string' && e.schedule_time.trim() && !out.scheduleHm) {
      out.scheduleHm = e.schedule_time.trim();
    }
    const pn = e.place_name;
    if (typeof pn === 'string' && pn.trim()) {
      const place = pn.trim();
      if (!out.placeAutoPickQuery) out.placeAutoPickQuery = place;
      if (typeof out['장소'] !== 'string' || !String(out['장소']).trim()) out['장소'] = place;
    }
    const cap = e.capacity;
    if (typeof cap === 'number' && Number.isFinite(cap) && cap >= 1) {
      const n = Math.trunc(cap);
      const hasHeadcount =
        (typeof out.minParticipants === 'number' && Number.isFinite(out.minParticipants)) ||
        (typeof out.maxParticipants === 'number' && Number.isFinite(out.maxParticipants)) ||
        (typeof out['인원'] === 'object' && out['인원'] !== null && !Array.isArray(out['인원']));
      if (!hasHeadcount) {
        out.minParticipants = n;
        out.maxParticipants = n;
        out['인원'] = { 최소: n, 최대: n };
      }
    }
    if (typeof e.is_public === 'boolean' && out.suggestedIsPublic == null) {
      out.suggestedIsPublic = e.is_public;
    }
    const meta = e.meta;
    if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
      const m = meta as Record<string, unknown>;
      const tags = Array.isArray(m.vibe_tags)
        ? (m.vibe_tags as unknown[]).map((x) => String(x ?? '').trim()).filter((t) => t.length > 0)
        : [];
      if (m.is_location_vague === true) {
        pushUnknown('place', '장소 표현이 모호합니다.');
      }
      const base = String(out.placeAutoPickQuery ?? out['장소'] ?? '').trim();
      const suffix = [...new Set(tags)].join(' ');
      if (suffix) {
        const combined = base ? `${base} ${suffix}`.trim() : suffix;
        out.placeAutoPickQuery = combined;
        out['장소'] = combined;
      }
    }
  }

  const resp = raw['response'];
  if (resp && typeof resp === 'object' && !Array.isArray(resp)) {
    const r = resp as Record<string, unknown>;
    if (typeof r.ask_message === 'string' && r.ask_message.trim()) out.nluAskMessage = r.ask_message.trim();
    if (typeof r.confirm_message === 'string' && r.confirm_message.trim()) {
      out.nluConfirmMessage = r.confirm_message.trim();
    }
  }

  const miss = raw['missing_fields'];
  if (Array.isArray(miss)) {
    for (const item of miss) {
      const f = String(item ?? '').trim();
      if (f) pushUnknown(f, 'missing_fields');
    }
  }

  const inf = raw['inference'];
  if (inf && typeof inf === 'object' && !Array.isArray(inf)) {
    out.nluInference = inf;
  }

  return out;
}

function stripNestedMeetingCreateKeys(out: Record<string, unknown>): void {
  delete out.extracted_data;
  delete out.inference;
  delete out.missing_fields;
  delete out.response;
}

/** 마크다운 코드 펜스 또는 본문 앞뒤 사족 제거 */
function stripCodeFences(s: string): string {
  const t = s.trim();
  const m = /^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?```/m.exec(t);
  if (m) return m[1].trim();
  return t;
}

/** 첫 번째 균형 잡힌 `{ ... }` JSON 오브젝트 문자열 (문자열 리터럴 내부 중괄호 무시) */
function extractBalancedJsonObject(s: string): string | null {
  const t = stripCodeFences(s).trim();
  const start = t.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  let q: '"' | "'" | null = null;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) {
        esc = false;
        continue;
      }
      if (c === '\\') {
        esc = true;
        continue;
      }
      if (c === q) {
        inStr = false;
        q = null;
        continue;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = true;
      q = c as '"' | "'";
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return t.slice(start, i + 1);
    }
  }
  return t.slice(start);
}

/**
 * 요약 스키마 `{ intent, data, needs_more_info }` → 기존 플랫 NLU 키로 병합(호환).
 * `data.category`는 categoryLabel 보조로만 쓴다(categoryId는 Allowed 목록으로만).
 */
function normalizeAlternateNluShape(raw: Record<string, unknown>): Record<string, unknown> {
  if (raw.intent !== 'create_meeting' || !raw.data || typeof raw.data !== 'object' || Array.isArray(raw.data)) {
    return raw;
  }
  const d = raw.data as Record<string, unknown>;
  const out: Record<string, unknown> = { ...raw };
  if (typeof d.title === 'string' && d.title.trim() && (out.title == null || String(out.title).trim() === '')) {
    out.title = d.title.trim();
  }
  if (typeof d.category === 'string' && d.category.trim() && (out.categoryLabel == null || String(out.categoryLabel).trim() === '')) {
    out.categoryLabel = d.category.trim();
  }
  if (typeof d.date === 'string' && d.date.trim() && (out.scheduleYmd == null || String(out.scheduleYmd).trim() === '')) {
    out.scheduleYmd = d.date.trim();
  }
  if (typeof d.time === 'string' && d.time.trim() && (out.scheduleHm == null || String(out.scheduleHm).trim() === '')) {
    out.scheduleHm = d.time.trim();
  }
  if (typeof d.location === 'string' && d.location.trim()) {
    const loc = d.location.trim();
    if (out.placeAutoPickQuery == null || String(out.placeAutoPickQuery).trim() === '') out.placeAutoPickQuery = loc;
    if (typeof out['장소'] !== 'string' || !String(out['장소']).trim()) out['장소'] = loc;
  }
  if (typeof d.is_public === 'boolean' && out.suggestedIsPublic == null) {
    out.suggestedIsPublic = d.is_public;
  }
  const nmi = raw.needs_more_info;
  if (Array.isArray(nmi)) {
    const unk = Array.isArray(out.unknowns) ? [...(out.unknowns as unknown[])] : [];
    for (const item of nmi) {
      const f = String(item ?? '').trim();
      if (!f) continue;
      if (
        unk.some((u) => typeof u === 'object' && u !== null && String((u as Record<string, unknown>).field ?? '') === f)
      ) {
        continue;
      }
      unk.push({ field: f, reason: 'needs_more_info' });
    }
    out.unknowns = unk;
  }
  delete out.intent;
  delete out.data;
  delete out.needs_more_info;
  return out;
}

/** menuPreferenceLabel 비었을 때 식사 키워드만 보강(앱 칩 문자열과 동일해야 함) */
function applyMenuPreferenceKeywordFallback(out: Record<string, unknown>, userText: string): void {
  const cur = String(out.menuPreferenceLabel ?? '').trim();
  if (cur) return;
  const hay = normalizeForMatch(
    [userText, String(out.title ?? ''), String(out.placeAutoPickQuery ?? ''), String(out['장소'] ?? '')].join(' '),
  );
  if (!hay) return;
  const rules: { label: string; keys: string[] }[] = [
    { label: '포차', keys: ['포차'] },
    { label: '주점·호프', keys: ['술집', '술자리', '맥주', '소주', '호프', '주점', '안주', '술', '펍'] },
    { label: '카페', keys: ['디저트', '커피', '카페'] },
    { label: '한식', keys: ['삼겹살', '국밥', '한식', '한우', '갈비', '바베큐', 'bbq', 'barbecue'] },
    { label: '일식', keys: ['스시', '초밥', '라멘', '일식', '우동'] },
    { label: '양식', keys: ['피자', '파스타', '양식', '스테이크'] },
  ];
  for (const { label, keys } of rules) {
    if (keys.some((k) => hay.includes(normalizeForMatch(k)))) {
      out.menuPreferenceLabel = label;
      return;
    }
  }
}

/** 지인 전용이 아닌 한 공개 기본값 — null이면 true */
function defaultSuggestedIsPublicWhenUnset(out: Record<string, unknown>): void {
  if (out.suggestedIsPublic == null) out.suggestedIsPublic = true;
}

/**
 * 공개 모임 FCM/피드 결손 방지: ageLimit 없으면 제한 없음으로 명시(앱에서 추가 질문 생략).
 */
function ensurePublicMeetingAgeLimitForPublic(out: Record<string, unknown>): void {
  if (out.suggestedIsPublic !== true) return;
  const pmd = out.publicMeetingDetails;
  if (pmd && typeof pmd === 'object' && !Array.isArray(pmd)) {
    const al = (pmd as Record<string, unknown>).ageLimit;
    if (Array.isArray(al) && al.some((x) => x === 'TWENTIES' || x === 'THIRTIES' || x === 'FORTY_PLUS' || x === 'NONE')) {
      return;
    }
  }
  const base = pmd && typeof pmd === 'object' && !Array.isArray(pmd) ? { ...(pmd as Record<string, unknown>) } : {};
  out.publicMeetingDetails = { ...base, ageLimit: ['NONE'] };
}

function tryParseNluContent(content: string): Record<string, unknown> | null {
  const slice = extractBalancedJsonObject(content);
  if (!slice) return null;
  try {
    const o = JSON.parse(slice) as unknown;
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
    return normalizeAlternateNluShape(o as Record<string, unknown>);
  } catch {
    return null;
  }
}

function extractGroqChatContent(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as {
    choices?: Array<{ message?: { content?: string | null } }>;
    error?: { message?: string; type?: string };
  };
  if (d.error?.message) {
    console.error('[parse-meeting-create-intent] Ginit_AI_Error', 'groq_error_field', JSON.stringify(d.error));
    return null;
  }
  const raw = d.choices?.[0]?.message?.content;
  const t = typeof raw === 'string' ? raw.trim() : '';
  return t.length > 0 ? t : null;
}

type GroqAttemptFail = { ok: false; tag: string; detail: string };
type GroqAttemptOk = { ok: true; content: string };

async function callGroqOnce(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userText: string,
): Promise<GroqAttemptOk | GroqAttemptFail> {
  let res: Response;
  try {
    res = await fetch(GROQ_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userText },
        ],
        temperature: 0.2,
        response_format: { type: 'json_object' },
      }),
    });
  } catch (e) {
    return { ok: false, tag: 'groq_fetch_failed', detail: String(e) };
  }
  if (!res.ok) {
    const t = await res.text();
    return { ok: false, tag: 'groq_http', detail: `${res.status} ${t.slice(0, 800)}` };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch (e) {
    return { ok: false, tag: 'groq_json_read_failed', detail: String(e) };
  }
  const content = extractGroqChatContent(body);
  if (!content) {
    return { ok: false, tag: 'empty_model_text', detail: JSON.stringify(body).slice(0, 600) };
  }
  return { ok: true, content };
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

  const apiKey = Deno.env.get('GROQ_API_KEY')?.trim();
  if (!apiKey) {
    console.error('[parse-meeting-create-intent] Ginit_AI_Error', 'GROQ_API_KEY missing');
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

  const blockedPolicy = await loadNluBlockedFromDb();
  if (isTextBlockedByPolicy(text, blockedPolicy)) {
    return jsonResponse({ blocked: true, message: blockedPolicy.userMessage });
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
    .map((c) => {
      const major =
        c.majorCode != null && String(c.majorCode).trim()
          ? `  major_code: "${String(c.majorCode).trim()}"`
          : '';
      const ord = typeof c.order === 'number' && Number.isFinite(c.order) ? `  sort_order: ${c.order}` : '';
      return `- id: "${String(c.id).trim()}"  label: "${String(c.label).trim()}"${major ? `\n${major}` : ''}${
        ord ? `\n${ord}` : ''
      }`;
    })
    .join('\n');

  const accumulated =
    body.accumulated && typeof body.accumulated === 'object' && !Array.isArray(body.accumulated)
      ? (body.accumulated as Record<string, unknown>)
      : {};

  const hasAccum = Object.keys(accumulated).length > 0;

  const systemPrompt = `You are the Ginit NLU engine — extract structured data for ONE Korean meet-up ("모임") user message.
Respond with a single JSON object only (no markdown). No assistantReply or natural-language coaching — JSON only.

For EVERY field below: fill from the latest user message with maximum reasonable inference. Use JSON null or omit keys for anything NOT inferable from this message alone (do not invent addresses).

[Model / hybrid]
The server calls Llama 3.3 70B first and Llama 3.1 8B Instant on failure (e.g. rate limits). Output the same APP JSON schema in all cases.

[Intent pivoting]
If the dominant intent shifts (e.g. generic food → drinking), immediately realign categoryId, menuPreferenceLabel (주점·호프·포차 등), title, and 장소/placeAutoPickQuery to the new intent; drop mismatched prior assumptions.

[Automatic menuPreferenceLabel hints — Eat & Drink only]
삼겹살·국밥·한우·갈비 → 한식; 스시·초밥·라멘·우동 → 일식; 피자·파스타·스테이크 → 양식; 커피·디저트·카페 → 카페; 맥주·소주·안주·호프·주점·술집·술자리 → 주점·호프; 포차 → 포차.
English / informal aliases (Eat & Drink): BBQ·barbecue·바베큐 → 한식; 펍(Pub, avoid bare English "pub" substring false positives — prefer 펍/주점 맥락) → 주점·호프; cafe·coffee shop → 카페.

[Shorthand data.category — 한식|중식|일식|호프|카페|영화관|기타 스타일]
요약 스키마의 data.category에 위 한글 값을 쓸 때: BBQ류 → 한식; Pub/펍 → 호프 의미면 menuPreferenceLabel은 반드시 앱 칩 "주점·호프"와 일치; Cafe → 카페; Cinema·movie·영화관 → 영화관(해당 카테고리Id)·영화제목 hints 병행; Study·study room·독서실·스터디룸 → Focus&Knowledge면 focusKnowledgeLabel "독서·스터디" 및 장소에 시설 표현 반영, data.category는 스키마에 없으면 기타로 두되 장소·칩은 채운다.
영화관·독서실·PC방·코인노래방·헬스장 등 어떤 시설 유형이든 사용자 표현을 장소/placeAutoPickQuery 검색어에 담는다(주소는 지어내지 않음).

[Forbidden NLU follow-ups]
Never use nluAskMessage, response.ask_message, or unknowns to prompt for: gender ratio (성비), age bands (연령대), or settlement / 더치페이. If the user states them voluntarily, reflect only valid JSON enums; otherwise omit genderRatio and settlement from publicMeetingDetails.

[Default openness]
suggestedIsPublic=false ONLY for clearly invite-only private circles (데이트, 가족만, 확정된 지인 소수, 내부 동료만). Otherwise true — do not ask the user to confirm public vs private.

[Temporal reasoning]
Relative dates (내일, 다음 주 토요일, …) use todayYmd=${todayYmd} as the calendar anchor.

Optional shorthand: you may also return { "intent":"create_meeting", "data":{...}, "needs_more_info":[...] } — the server maps data.title/date/time/location/is_public into the flat APP fields.
When 장소/place is only a geographic name (역·구·동·상권 별칭 등) without 시설 종류·상호·봐둔 곳, add needs_more_info with "location" (또는 unknowns field "place") and set response.ask_message to exactly: "<지명> 어디에서 모이실 건가요? 봐두신 장소나 종류를 알려주세요." where <지명> is the user's location phrase verbatim (예: 영등포역 → "영등포역 어디에서 모이실 건가요? 봐두신 장소나 종류를 알려주세요.").

Deep inference (social + nuance) — apply before filling fields:
- Baseline geography: if the user gives no city/district but the place is vague (역 근처, 근처 카페, 동네), assume their usual activity area is Seoul Yeongdeungpo-gu (서울 영등포구) and reflect that inside "장소" / placeAutoPickQuery (e.g. prepend "영등포구" or "영등포역 근처") without inventing a specific store address.
- Capacity (인원 / minParticipants,maxParticipants):
  - Explicit counts ("3명", "친구 4명과") → set BOTH min and max to that total when it is clearly a fixed-size meet; if "본인 포함" is explicit, respect it.
  - Relationship: 여자친구/남자친구/여친/남친/데이트/둘이서/단둘이 → 2 and 2.
  - "우리 가족(부모님+나)" 등 가족만 언급 → prefer null for both unless a count is clear; put ambiguity in unknowns.
  - "동기들/팀원들/회사 사람들" without a number → null,null and unknowns (ask how many including you); if "팀원 3명" and clearly host+3 guests → 4 and 4 only when unambiguous, else unknowns.
  - Open recruitment ("할 사람?", "누구든", "모집", "사람 구함") with no number → null,null for headcount; set suggestedIsPublic true when recruiting strangers/neighbors.
- Date/time normalization (relative to todayYmd):
  - "내일 퇴근하고" → next calendar day ~18:30 if no better time.
  - "이따 밤" / "밤에" same day → pick one plausible evening hour 21:00–22:00 (prefer 21:00).
  - "점심 번개" → 12:00 same day or next business day if lunch already passed (use judgment from message).
  - "불토" / "이번 주 토요일 밤" → upcoming Saturday after todayYmd, evening from 19:00.
- Place wording: normalize nicknames in queries — e.g. 스벅→스타벅스, 피방→PC방, 한강 산책→한강공원 or "한강 산책로" style text search phrases (no fake URLs).
- Area + venue follow-up (multi-turn): If accumulated "장소"/placeAutoPickQuery is ONLY a station/district (e.g. 영등포역, 강남구) and the latest user message names ONLY a venue type (삼겹살집, 카페, 술집, 헬스장), you MUST output "장소"/placeAutoPickQuery as "<prior area> <venue phrase>" — never drop the prior area by overwriting with the venue-only string. In that same follow-up, do NOT set title/이름 to the venue-only reply; keep accumulated.title if present, otherwise derive a short title from the FIRST user message in this thread (topic + scale), not from the venue word alone.
- Mood / vibe: merge short vibe adjectives from the user (공부하기 좋은, 인스타 감성, 조용한, 왁자지껄한, 가성비 등) into "장소" / placeAutoPickQuery as extra Korean keywords so Places search stays on-theme.
- Public vs private: suggestedIsPublic false only for clear invite-only private circles (데이트, 가족만, 확정된 소규모 지인 모임, 내부 동료만). Otherwise true; open recruitment / 번개 / 지역 모집 / vague topic-only → true without asking.
- needs_confirmation: if time + category feel socially odd (e.g. 새벽 2시 + 카페/커피 without context), add an unknowns entry like { "field": "schedule", "reason": "..." } rather than inventing a different time.

User deferral (위임): If the user says they do not care about a specific choice (e.g. 아무거나, 랜덤, 알아서, 상관없어, 너가 골라줘, 추천해줘, 편한 대로) and the inferred category clearly needs menuPreferenceLabel / movieTitleHints or primaryMovieTitle / activityKindLabel / gameKindLabel / pcGameKindLabel / focusKnowledgeLabel, then output ONE valid value from the allowed enum lists for that slot (pick a sensible default such as 한식 or 카페 for food, or a mainstream movie title only if they also named a film vaguely). Do not leave those specialty fields null when the deferral clearly targets that missing slot.

Korean keys (populate when inferable):
- "이름": short meeting title string or null.
- "영화제목": string OR string[] of movie titles when user clearly names film(s); also mirror to primaryMovieTitle or movieTitleHints in English keys when possible.
- "인원": object with integer "최소" and "최대", or null subfields if unknown.
  CRITICAL headcount from colloquial Korean (set BOTH 최소 and 최대 to the same number when it is a fixed-size meet):
  - 둘이서, 단둘이, 둘이, 둘이 만남, 친구랑 둘이, 두 명, 2명 → 최소=2, 최대=2.
  - 혼자, 한 명, 1명 → 1 and 1.
  - 세 명, 셋이, 3명 → 3 and 3 (unless a range is clearly stated).
  - "4명만" / "4명" only → both 4.
- "날짜": YYYY-MM-DD or null. "시각": HH:mm 24h or null.
- "장소": Korean text suitable as Google Places TEXT search query OR null.
  IMPORTANT: Even WITHOUT a neighborhood or store name, if the user describes venue mood/type (examples: 분위기 좋은 카페, 넓은 카페, 키즈카페, 분위기 좋은 바, 포차, 조용한 카페), you MUST still output a non-empty "장소" string combining those words for search.

English/camelCase (same inference rules):
- categoryId: MUST be exactly one of the listed ids, OR null if impossible to map from the message.
- categoryLabel: optional.
- scheduleYmd, scheduleHm, scheduleText: use scheduleText for vague relative phrases if needed.
- minParticipants, maxParticipants: numbers or null (mirror all "인원" rules above).
- placeAutoPickQuery: same meaning as "장소"; if you set "장소", also mirror to placeAutoPickQuery when possible.
- suggestedIsPublic: boolean; default true unless private-circle cases above. Never add unknowns solely to ask public vs private.
  Rules for suggestedIsPublic:
  - false: strictly invite-only private circles — e.g. 친구와(소수 확정), 회사 동료 내부만, 가족끼리, 여친/남친 데이트 — no stranger recruitment.
  - true: 모집·누구나·번개·지역 네트워킹·주제만 있고 대상이 넓음·공개 성비 모집 등 — do NOT follow up asking 성비/연령/정산 (Forbidden section).
  - If ambiguous and no private-only signal, use true.
- menuPreferenceLabel: for Eat & Drink / 식사·커피 계열(major_code 또는 label로 식별)만 — 반드시 앱 칩과 동일한 한 줄: 한식 일식 중식 양식 분식 퓨전 카페 브런치 주점·호프 이자카야 와인.바 포차 오마카세 중 하나; else null.
- movieTitleHints: string array of inferred movie titles when category is 영화/CINEMA/MOVIE major or label implies cinema; else null or omit.
- primaryMovieTitle: single Korean movie title string when one film is clear; mirrors movieTitleHints[0] if you only have one; else null.
- activityKindLabel: for Active & Life 운동 계열만 — exactly one 앱 Step2 칩과 동일: 러닝·조깅 등산·트레킹 헬스·근력 요가·필라테스 수영 클라이밍 풋살·축구 배드민턴·테니스 자전거·라이딩 산책·워킹 크로스핏 댄스·에어로빅; else null.
- gameKindLabel: for Play & Vibe 게임·놀거리 계열만 — one of: 보드게임 방탈출 볼링 노래방 e스포츠 콘솔 당구 VR체험 카드게임 오락실; else null.
- pcGameKindLabel: when major_code is PcGame (case-insensitive) — one PC game title chip: 델타포스 발로란트 리그 오브 레전드 오버워치 2 배틀그라운드 로스트아크 메이플스토리 몬스터헌터 와일즈 엘든 링 디아블로 IV FC 온라인 마인크래프트 스타크래프트 기타; else null.
- focusKnowledgeLabel: for Focus & Knowledge 스터디 계열만 — one of: 독서·스터디 카공·코워킹 강연·세미나 워크숍·실습 자격증·시험 언어·회화 재테크·투자 커리어·멘토링 글쓰기·기획 취미클래스; else null.
- canAutoCompleteThroughStep3: boolean when inferable; else null.
- publicMeetingDetails: when suggestedIsPublic is true, set ageLimit from speech only if explicit (TWENTIES|THIRTIES|FORTY_PLUS|NONE); otherwise ["NONE"]. Omit genderRatio and settlement (app defaults). Never use these fields to trigger NLU questions.
- unknowns: array of { "field": string, "reason": string } for ambiguity.

Rules:
- Relative dates (내일, 모레, 이번 주 토요일) use todayYmd=${todayYmd} as reference.
- categoryId must be one of the allowed ids or null — never invent an id.

Optional nested JSON (server flattens into the same fields; you may use in addition to flat keys):
- "inference": { "intent_strength", "social_context", "reasoning" } — stored as nluInference.
- "extracted_data": { "title", "major_code", "category_label", "schedule_date", "schedule_time", "place_name", "capacity", "is_public", "meta": { "vibe_tags": string[], "is_location_vague": boolean } } — merged only when flat fields are empty.
- "missing_fields": string[] — appended to unknowns.
- "response": { "confirm_message", "ask_message" } — copied to nluConfirmMessage / nluAskMessage for UI. Prefer filling flat keys directly when possible.

Allowed categories:
${catLines}`;

  const userText = hasAccum
    ? `오늘 날짜(로컬): ${todayYmd}\n이미 수집된 JSON(참고만, 이 메시지에서 새로 못 밝힌 필드는 null로 두어도 됨):\n${JSON.stringify(accumulated)}\n\n이번 사용자 메시지:\n${text}`
    : `오늘 날짜(로컬): ${todayYmd}\n사용자 메시지:\n${text}`;

  const models = [GROQ_MODEL_PRIMARY, GROQ_MODEL_FALLBACK];
  let parsed: Record<string, unknown> | null = null;
  let lastGroqLog: { model: string; tag: string; detail: string } | null = null;

  for (const model of models) {
    const once = await callGroqOnce(apiKey, model, systemPrompt, userText);
    if (!once.ok) {
      lastGroqLog = { model, tag: once.tag, detail: once.detail };
      console.error('[parse-meeting-create-intent] Ginit_AI_Error', once.tag, model, once.detail.slice(0, 400));
      continue;
    }
    const parsedAttempt = tryParseNluContent(once.content);
    if (parsedAttempt) {
      parsed = parsedAttempt;
      break;
    }
    lastGroqLog = { model, tag: 'model_text_not_json', detail: once.content.slice(0, 400) };
    console.error('[parse-meeting-create-intent] Ginit_AI_Error', 'model_text_not_json', model);
  }

  if (!parsed) {
    const unreachable =
      lastGroqLog?.tag === 'groq_fetch_failed' ||
      (lastGroqLog?.tag === 'groq_http' && /^\s*5\d\d/.test(lastGroqLog.detail));
    if (unreachable) {
      return jsonResponse({ error: 'Upstream model unreachable' }, 502);
    }
    if (lastGroqLog?.tag === 'groq_http') {
      return jsonResponse({ error: 'Upstream model error' }, 502);
    }
    if (lastGroqLog?.tag === 'groq_json_read_failed') {
      return jsonResponse({ error: 'Invalid upstream response' }, 502);
    }
    if (lastGroqLog?.tag === 'empty_model_text') {
      return jsonResponse({ error: 'Empty model response' }, 502);
    }
    return jsonResponse({ error: 'Model returned non-JSON' }, 502);
  }

  const flattened = flattenNestedMeetingCreateIntentResult(parsed);
  const merged = mergeKoreanKeysIntoPayload(flattened);
  stripNestedMeetingCreateKeys(merged);
  applyMenuPreferenceKeywordFallback(merged, text);
  defaultSuggestedIsPublicWhenUnset(merged);
  ensurePublicMeetingAgeLimitForPublic(merged);

  return jsonResponse({ result: merged });
});
