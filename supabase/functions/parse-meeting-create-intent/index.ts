/**
 * 자연어 → 모임 생성 위저드용 구조화 JSON (Google Gemini).
 *
 * Secret: GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (금지어 정책 조회)
 * Request JSON: { text, categories: [{ id, label }], todayYmd?, accumulated? }
 * Response JSON: { result } | { blocked: true, message }
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

  const systemPrompt = `You extract structured data for a Korean meeting ("모임") app from ONE user message.
Respond with a single JSON object only (no markdown). No assistantReply or natural-language coaching — JSON only.

For EVERY field below: fill from the latest user message with maximum reasonable inference. Use JSON null or omit keys for anything NOT inferable from this message alone (do not invent addresses).

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
- Mood / vibe: merge short vibe adjectives from the user (공부하기 좋은, 인스타 감성, 조용한, 왁자지껄한, 가성비 등) into "장소" / placeAutoPickQuery as extra Korean keywords so Places search stays on-theme.
- Public vs private: suggestedIsPublic false for 지인-only / 데이트 / 가족끼리 / 친구랑(소수 확정) 등; true for 모집·누구나·번개·지역 네트워킹. If ambiguous, prefer true and record doubt in unknowns.
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
- suggestedIsPublic: boolean when the openness of the meeting is clear from the message; otherwise null.
  Rules for suggestedIsPublic:
  - false (비공개, invite-only): user clearly meets with a known private circle — e.g. 친구와, 회사 사람들과/동료와, 가족끼리, 여자친구와/남자친구와, 동생과, 형/누나와, 아는 형들과 등 — no open recruitment of strangers.
  - true (공개): recruiting unspecified people, neighborhood/지역 모집, 주제만 있고 대상이 넓음, 번개 모임, 남자 N명 여자 N명 맞추기/성비 맞춰 모집, 처음 보는 사람 환영 등.
  - If ambiguous between the two, prefer true (공개) and list uncertainty in unknowns.
- menuPreferenceLabel: for Eat & Drink / 식사·커피 계열(major_code 또는 label로 식별)만 — 반드시 앱 칩과 동일한 한 줄: 한식 일식 중식 양식 분식 퓨전 카페 브런치 주점·호프 이자카야 와인.바 포차 오마카세 중 하나; else null.
- movieTitleHints: string array of inferred movie titles when category is 영화/CINEMA/MOVIE major or label implies cinema; else null or omit.
- primaryMovieTitle: single Korean movie title string when one film is clear; mirrors movieTitleHints[0] if you only have one; else null.
- activityKindLabel: for Active & Life 운동 계열만 — exactly one 앱 Step2 칩과 동일: 러닝·조깅 등산·트레킹 헬스·근력 요가·필라테스 수영 클라이밍 풋살·축구 배드민턴·테니스 자전거·라이딩 산책·워킹 크로스핏 댄스·에어로빅; else null.
- gameKindLabel: for Play & Vibe 게임·놀거리 계열만 — one of: 보드게임 방탈출 볼링 노래방 e스포츠 콘솔 당구 VR체험 카드게임 오락실; else null.
- pcGameKindLabel: when major_code is PcGame (case-insensitive) — one PC game title chip: 델타포스 발로란트 리그 오브 레전드 오버워치 2 배틀그라운드 로스트아크 메이플스토리 몬스터헌터 와일즈 엘든 링 디아블로 IV FC 온라인 마인크래프트 스타크래프트 기타; else null.
- focusKnowledgeLabel: for Focus & Knowledge 스터디 계열만 — one of: 독서·스터디 카공·코워킹 강연·세미나 워크숍·실습 자격증·시험 언어·회화 재테크·투자 커리어·멘토링 글쓰기·기획 취미클래스; else null.
- canAutoCompleteThroughStep3: boolean when inferable; else null.
- publicMeetingDetails: when suggestedIsPublic is true, prefer filling ageLimit (array: TWENTIES|THIRTIES|FORTY_PLUS|NONE), genderRatio, settlement if inferable; else null/omit subfields.
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

  const flattened = flattenNestedMeetingCreateIntentResult(parsed);
  const merged = mergeKoreanKeysIntoPayload(flattened);
  stripNestedMeetingCreateKeys(merged);

  return jsonResponse({ result: merged });
});
