/**
 * 자연어 → 모임 생성 위저드용 구조화 JSON (Groq Llama 하이브리드).
 *
 * Secret: GROQ_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (금지어 정책 조회)
 * Groq 송신 로그: 기본(user+길이 메타)은 항상 출력. `GROQ_DEBUG_MESSAGES=1|true|yes`이면 system 프롬프트 전문 추가.
 * 끄려면 `GROQ_DEBUG_MESSAGES=0|false|no|off`(또는 `GROQ_DEBUG_SILENT=1`).
 * 모델: llama-3.3-70b-versatile → 실패 시 llama-3.1-8b-instant 폴백.
 * Request JSON: { text, todayYmd?, accumulated?, history? } — history는 최근 2~3턴 대화(현재 text 제외). 카테고리는 DB 캐시·시스템 프롬프트. 레거시: cats+ids 등.
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
type CategoryPair = { id: string; label: string };

type ReqBody = {
  text?: string;
  /** 권장: `0:라벨,1:라벨2,...`(번호:이름만). 같은 순서의 id는 `ids` CSV로 전달. */
  cats?: string;
  /** cats가 라벨만일 때 필수: `id0,id1,...`(cats 항목과 동일 개수·순서). Groq 프롬프트에 포함하지 않음. */
  ids?: string;
  /** 레거시: 라벨 CSV + id CSV */
  categoryLabelsCsv?: string;
  categoryIdsCsv?: string;
  categoryPairs?: CategoryPair[];
  categories?: CategoryRow[];
  todayYmd?: string;
  accumulated?: Record<string, unknown>;
  /** 최근 대화 슬라이딩(현재 `text` 제외) — 맥락용, 짧게 유지 */
  history?: string;
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

type MeetingCategoryDbRow = { id?: string; label?: string; sort_order?: number };

let nluMeetingCategoryPairsCache: CategoryPair[] | null = null;
let nluMeetingCategoryPairsCacheAt = 0;
const NLU_MEETING_CAT_CACHE_MS = 10 * 60 * 1000;

/** 앱 `subscribeCategories`(Supabase)와 동일: sort_order → label(ko) */
async function loadMeetingCategoriesFromDb(): Promise<CategoryPair[] | null> {
  const url = Deno.env.get('SUPABASE_URL')?.trim();
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim();
  if (!url || !key) return null;
  try {
    const u = `${url.replace(/\/$/, '')}/rest/v1/meeting_categories?select=id,label,sort_order&order=sort_order.asc`;
    const r = await fetch(u, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (!r.ok) return null;
    const rows = (await r.json()) as MeetingCategoryDbRow[];
    rows.sort((a, b) => {
      const ao =
        typeof a.sort_order === 'number' && Number.isFinite(a.sort_order) ? Math.trunc(a.sort_order) : 999;
      const bo =
        typeof b.sort_order === 'number' && Number.isFinite(b.sort_order) ? Math.trunc(b.sort_order) : 999;
      if (ao !== bo) return ao - bo;
      return String(a.label ?? '').localeCompare(String(b.label ?? ''), 'ko');
    });
    const out: CategoryPair[] = [];
    for (const row of rows) {
      const id = String(row?.id ?? '').trim();
      const label = String(row?.label ?? '').trim();
      if (id && label) out.push({ id, label });
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

/** 요청 본문에 카탈로그가 없으면 DB(캐시) 기준. 레거시 본문 cats/ids 등은 우선 적용. */
async function resolveMeetingNluCategoryPairs(body: ReqBody): Promise<CategoryPair[] | null> {
  const fromBody = normalizeCategoryPairs(body);
  if (fromBody?.length) return fromBody;

  const now = Date.now();
  if (
    nluMeetingCategoryPairsCache &&
    nluMeetingCategoryPairsCache.length > 0 &&
    now - nluMeetingCategoryPairsCacheAt < NLU_MEETING_CAT_CACHE_MS
  ) {
    return nluMeetingCategoryPairsCache;
  }

  const fresh = await loadMeetingCategoriesFromDb();
  if (fresh?.length) {
    nluMeetingCategoryPairsCache = fresh;
    nluMeetingCategoryPairsCacheAt = now;
    return fresh;
  }

  return nluMeetingCategoryPairsCache;
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

/** 라벨 CSV — 쉼표 분리(라벨 내부 쉼표는 미지원). */
function splitCategoryLabelsCsv(s: string): string[] {
  return s
    .split(',')
    .map((x) => x.normalize('NFKC').trim())
    .filter((x) => x.length > 0);
}

function splitCategoryIdsCsv(s: string): string[] {
  return s
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

/** `0:라벨|id,1:...` — 레거시 단일 문자열(쉼표는 항목 구분만). */
function parseCatsCatalogPiped(raw: string): CategoryPair[] | null {
  const t = raw.normalize('NFKC').trim();
  if (!t) return null;
  const segments = t.split(',').map((s) => s.trim()).filter(Boolean);
  const out: CategoryPair[] = [];
  for (const seg of segments) {
    const head = /^(\d+):/.exec(seg);
    if (!head) return null;
    const idx = parseInt(head[1]!, 10);
    const rest = seg.slice(head[0].length).trim();
    const pipeIdx = rest.lastIndexOf('|');
    if (pipeIdx < 0) return null;
    const label = rest.slice(0, pipeIdx).trim();
    const id = rest.slice(pipeIdx + 1).trim();
    if (!label || !id || idx !== out.length) return null;
    out.push({ id, label });
  }
  return out.length > 0 ? out : null;
}

/** `0:라벨,1:라벨2,...` — 문자열에 `|` 없음(라벨·이름 내부 `|` 미지원). id는 `body.ids`로 합침. */
function parseCatsLabelsOnly(raw: string): CategoryPair[] | null {
  const t = raw.normalize('NFKC').trim();
  if (!t || t.includes('|')) return null;
  const segments = t.split(',').map((s) => s.trim()).filter(Boolean);
  const out: CategoryPair[] = [];
  for (const seg of segments) {
    const head = /^(\d+):/.exec(seg);
    if (!head) return null;
    const idx = parseInt(head[1]!, 10);
    const label = seg.slice(head[0].length).trim();
    if (!label || idx !== out.length) return null;
    out.push({ id: '', label });
  }
  return out.length > 0 ? out : null;
}

function isNluOmittableAccumValue(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string' && v.trim() === '') return true;
  if (Array.isArray(v) && v.length === 0) return true;
  if (typeof v === 'object' && !Array.isArray(v) && v !== null && Object.keys(v as Record<string, unknown>).length === 0) {
    return true;
  }
  return false;
}

/** NLU user 블록용: 빈 값·기본 ageLimit 등 제거 */
function slimAccumulatedForNlu(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (
      k === 'ageLimit' &&
      Array.isArray(v) &&
      v.length === 1 &&
      String(v[0] ?? '') === 'NONE'
    ) {
      continue;
    }
    if (isNluOmittableAccumValue(v)) continue;
    if (k === 'publicMeetingDetails' && typeof v === 'object' && v !== null && !Array.isArray(v)) {
      const pm = { ...(v as Record<string, unknown>) };
      const al = pm.ageLimit;
      if (Array.isArray(al) && al.length === 1 && String(al[0]) === 'NONE') {
        delete pm.ageLimit;
      }
      if (Object.keys(pm).length === 0) continue;
      let allOmit = true;
      for (const vv of Object.values(pm)) {
        if (!isNluOmittableAccumValue(vv)) {
          allOmit = false;
          break;
        }
      }
      if (allOmit) continue;
      out[k] = pm;
      continue;
    }
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      const slimInner = slimAccumulatedForNlu(v as Record<string, unknown>);
      if (Object.keys(slimInner).length === 0) continue;
      out[k] = slimInner;
      continue;
    }
    out[k] = v;
  }
  return out;
}

function normalizeCategoryPairs(body: ReqBody): CategoryPair[] | null {
  const catsRaw = typeof body.cats === 'string' ? body.cats.trim() : '';
  if (catsRaw.length > 0) {
    const piped = parseCatsCatalogPiped(catsRaw);
    if (piped) return piped;
    const labelOnly = parseCatsLabelsOnly(catsRaw);
    if (labelOnly) {
      const idsRaw = typeof body.ids === 'string' ? body.ids.trim() : '';
      const ids = idsRaw ? splitCategoryIdsCsv(idsRaw) : [];
      if (ids.length !== labelOnly.length || !labelOnly.every((_, i) => String(ids[i] ?? '').trim())) {
        return null;
      }
      return labelOnly.map((p, i) => ({ id: String(ids[i]).trim(), label: p.label }));
    }
  }

  const lc = typeof body.categoryLabelsCsv === 'string' ? body.categoryLabelsCsv.trim() : '';
  const ic = typeof body.categoryIdsCsv === 'string' ? body.categoryIdsCsv.trim() : '';
  if (lc.length > 0 && ic.length > 0) {
    const labels = splitCategoryLabelsCsv(lc);
    const ids = splitCategoryIdsCsv(ic);
    if (labels.length === 0 || ids.length === 0 || labels.length !== ids.length) return null;
    const out: CategoryPair[] = [];
    for (let i = 0; i < labels.length; i++) {
      out.push({ id: ids[i]!, label: labels[i]! });
    }
    return out;
  }

  const rawPairs = body.categoryPairs;
  if (Array.isArray(rawPairs) && rawPairs.length > 0) {
    const out: CategoryPair[] = [];
    for (const x of rawPairs) {
      if (!x || typeof x !== 'object' || Array.isArray(x)) continue;
      const o = x as Record<string, unknown>;
      const id = String(o.id ?? '').trim();
      const label = String(o.label ?? '').trim();
      if (id && label) out.push({ id, label });
    }
    return out.length > 0 ? out : null;
  }
  const cats = body.categories;
  if (Array.isArray(cats) && cats.length > 0) {
    const out: CategoryPair[] = [];
    for (const c of cats) {
      if (!c || typeof c !== 'object') continue;
      const row = c as CategoryRow;
      const id = String(row.id ?? '').trim();
      const label = String(row.label ?? '').trim();
      if (id && label) out.push({ id, label });
    }
    return out.length > 0 ? out : null;
  }
  return null;
}

/** 응답: categoryIndex(우선) 또는 categoryLabel·categoryId → 앱 id/라벨 정규화 */
function applyCategoryResolution(merged: Record<string, unknown>, pairs: CategoryPair[]): void {
  const idSet = new Set(pairs.map((p) => p.id));
  const idxRaw = merged.categoryIndex;
  let idx: number | null = null;
  if (typeof idxRaw === 'number' && Number.isInteger(idxRaw)) idx = idxRaw;
  else if (typeof idxRaw === 'string' && /^\d+$/.test(idxRaw.trim())) idx = parseInt(idxRaw.trim(), 10);
  if (idx !== null && idx >= 0 && idx < pairs.length) {
    merged.categoryId = pairs[idx]!.id;
    merged.categoryLabel = pairs[idx]!.label;
    delete merged.categoryIndex;
    return;
  }
  delete merged.categoryIndex;

  const byNormLabel = new Map<string, string>();
  for (const p of pairs) {
    const k = normalizeForMatch(p.label);
    if (k) byNormLabel.set(k, p.id);
  }

  const lab = typeof merged.categoryLabel === 'string' ? merged.categoryLabel.trim() : '';
  if (lab) {
    const n = normalizeForMatch(lab);
    let resolved: string | undefined = byNormLabel.get(n);
    if (!resolved) {
      for (const p of pairs) {
        const pn = normalizeForMatch(p.label);
        if (!pn) continue;
        if (pn === n || pn.includes(n) || n.includes(pn)) {
          resolved = p.id;
          break;
        }
      }
    }
    if (resolved) {
      merged.categoryId = resolved;
      const hit = pairs.find((p) => p.id === resolved);
      if (hit) merged.categoryLabel = hit.label;
      return;
    }
  }

  const rawId = merged.categoryId;
  if (typeof rawId === 'string' && idSet.has(rawId.trim())) {
    const hit = pairs.find((x) => x.id === rawId.trim());
    if (hit && (!lab || String(merged.categoryLabel ?? '').trim() === '')) merged.categoryLabel = hit.label;
    return;
  }

  if (typeof merged.categoryId === 'string' && !idSet.has(merged.categoryId.trim())) {
    delete merged.categoryId;
  }
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
  const dCi = d.category_index ?? d.categoryIndex;
  if (out.categoryIndex == null) {
    if (typeof dCi === 'number' && Number.isInteger(dCi)) {
      out.categoryIndex = dCi;
    } else if (typeof dCi === 'string' && /^\d+$/.test(dCi.trim())) {
      out.categoryIndex = parseInt(dCi.trim(), 10);
    }
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
    { label: '주점·호프', keys: ['술집', '술자리', '맥주', '소주', '호프', '주점', '안주', '술'] },
    { label: '카페', keys: ['디저트', '커피', '카페'] },
    { label: '한식', keys: ['삼겹살', '국밥', '한식', '한우', '갈비'] },
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

function accumScheduleYmdFromSlim(accum: Record<string, unknown>): string {
  const y = typeof accum.scheduleYmd === 'string' ? accum.scheduleYmd.trim() : '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(y)) return y;
  const ko = typeof accum['날짜'] === 'string' ? accum['날짜'].trim() : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(ko) ? ko : '';
}

function userExplicitlyRequestsScheduleOrTodayChange(norm: string): boolean {
  if (!norm) return false;
  if (
    /(날짜|일정|약속|만남).{0,14}(바꿔|바꿔줘|변경|미뤄|미루|앞당|뒤로|옮겨|옮기)|당일로|오늘로\s*바꿔|내일\s*말고|모레\s*말고|다른\s*날|다음\s*주로|일정만|언제\s*다시|오늘\s*로|당일\s*로|오늘은|오늘에\s*하자/.test(
      norm,
    )
  ) {
    return true;
  }
  return false;
}

/**
 * 누적 scheduleYmd가 오늘이 아니면, 사용자가 날짜·당일 전환을 분명히 하기 전까지 오늘로 접거나 비우는 출력을 누적값으로 되돌림.
 */
function applyStickyScheduleFromAccumulated(
  merged: Record<string, unknown>,
  accumSlim: Record<string, unknown>,
  rawText: string,
  todayYmd: string,
): void {
  const accY = accumScheduleYmdFromSlim(accumSlim);
  if (!accY || accY === todayYmd) return;
  const norm = normalizeForMatch(rawText);
  if (userExplicitlyRequestsScheduleOrTodayChange(norm)) return;

  const mergedY = typeof merged.scheduleYmd === 'string' ? merged.scheduleYmd.trim() : '';

  if (mergedY && mergedY !== accY) {
    if (mergedY === todayYmd) {
      // 오늘로만 바뀐 경우는 명시적 요청이 있을 때만 위에서 return됨 — 여기선 누적 유지
    } else {
      return;
    }
  }

  merged.scheduleYmd = accY;
  const prevKo = typeof merged['날짜'] === 'string' ? merged['날짜'].trim() : '';
  if (!prevKo || prevKo === todayYmd) merged['날짜'] = accY;
  const accHm = typeof accumSlim.scheduleHm === 'string' ? accumSlim.scheduleHm.trim() : '';
  const mergedHm = typeof merged.scheduleHm === 'string' ? merged.scheduleHm.trim() : '';
  if (accHm && !mergedHm) merged.scheduleHm = accHm;
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

function isGroqOutboundLogSilent(): boolean {
  const silent = Deno.env.get('GROQ_DEBUG_SILENT')?.trim().toLowerCase();
  if (silent === '1' || silent === 'true' || silent === 'yes') return true;
  const v = Deno.env.get('GROQ_DEBUG_MESSAGES')?.trim().toLowerCase();
  return v === '0' || v === 'false' || v === 'no' || v === 'off';
}

/** system 프롬프트 전문까지 로그(용량 큼) — 기본은 user만. */
function isGroqFullPromptLogEnabled(): boolean {
  const v = Deno.env.get('GROQ_DEBUG_MESSAGES')?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/**
 * Groq `fetch` body의 `messages`와 동일 순서(system → user).
 * Supabase 대시보드·`supabase functions logs`에서 `[parse-meeting-create-intent] groq_outbound`로 검색.
 */
function logGroqOutboundMessages(model: string, systemPrompt: string, userText: string): void {
  if (isGroqOutboundLogSilent()) return;
  console.log(
    '[parse-meeting-create-intent] groq_outbound_meta',
    JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      systemChars: systemPrompt.length,
      userChars: userText.length,
      systemLogged: isGroqFullPromptLogEnabled(),
    }),
  );
  console.log('[parse-meeting-create-intent] groq_outbound_user\n', userText);
  if (isGroqFullPromptLogEnabled()) {
    console.log('[parse-meeting-create-intent] groq_outbound_system\n', systemPrompt);
  }
}

async function callGroqOnce(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userText: string,
): Promise<GroqAttemptOk | GroqAttemptFail> {
  logGroqOutboundMessages(model, systemPrompt, userText);
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
  const pairs = await resolveMeetingNluCategoryPairs(body);
  if (!text || !pairs?.length) {
    return jsonResponse(
      {
        error:
          'text required; category catalog unavailable (meeting_categories empty or DB error). Legacy: cats+ids or categoryPairs or categories in body.',
      },
      400,
    );
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

  const catsForPrompt = pairs.map((p, i) => `${i}:${p.label}`).join(', ');

  const accumulated =
    body.accumulated && typeof body.accumulated === 'object' && !Array.isArray(body.accumulated)
      ? (body.accumulated as Record<string, unknown>)
      : {};

  const accumSlim = slimAccumulatedForNlu(accumulated);
  const hasAccum = Object.keys(accumSlim).length > 0;

  const systemPrompt = `todayYmd=${todayYmd}
이 한 줄의 todayYmd는 사용자 기기 로컬 기준 오늘(YYYY-MM-DD)이다. 모든 상대 날짜·요일·「오늘/내일/모레/이번 주 ○요일」 계산은 이 날짜만 달력 앵커로 사용한다. 다른 임의의 «오늘»을 상상하지 마라. JSON에는 반드시 계산된 절대 날짜만 넣는다: scheduleYmd·한글 "날짜"는 YYYY-MM-DD만(상대 표현 문자열 금지). 필요 시 scheduleHm(HH:mm)·한글 "시각"에 시각을 반영한다.

You are the Ginit NLU engine — extract structured data for ONE Korean meet-up ("모임") user message.
Respond with a single JSON object only (no markdown). No assistantReply or natural-language coaching — JSON only.

For EVERY field below: fill from the latest user message with maximum reasonable inference. Use JSON null or omit keys for anything NOT inferable from this message alone (do not invent addresses). Multi-turn exception: if the user message includes prior accumulated JSON, **omit keys** for slots that already have concrete values there unless this latest utterance clearly revises that slot — never set those keys to null just to mean "unchanged".

[누적 유지 — 멀티턴]
user 블록에 누적 JSON이 있으면: 이미 채워진 필드는 이번 한 마디로 **명확히 바꿀 내용이 아니면** JSON에 **키를 넣지 마라**(null로 지우지 마라). 새로 추론한 필드만 최소 키로 내도 된다.

[Sticky 날짜 — 누적이 오늘이 아닐 때]
누적 JSON에 scheduleYmd(또는 "날짜")가 **todayYmd(${todayYmd})가 아닌 값**으로 이미 있으면, 사용자가 **날짜·일정·당일 전환을 명시적으로 바꾸겠다고 말하기 전까지** 그 scheduleYmd는 **고정**이다. 이번 메시지가 시간·장소·인원·동의만 다루면 scheduleYmd·"날짜" 키는 **출력에서 생략**해라(오늘로 다시 계산해 덮어쓰지 마라). history 필드에 과거 상대 표현이 있어도 **누적 scheduleYmd가 있으면 그걸 우선**한다.

[부정·교정 — 카테고리 등]
"A가 아니라 B", "A 말고 B", "A 아니고 B", "A 대신 B", "A 말고 B로" → **B만** 의도에 반영한다. A는 거절된 후보라 **categoryIndex**와 주변 슬롯에 **A를 쓰지 마라**.

[역할 · 날짜 — 한국어; 앵커는 위 첫 줄 todayYmd만]
너는 모임 생성 도우미(NLU)다. 아래 규칙의 «오늘»은 항상 위의 todayYmd와 동일하다.

1. '오늘' → scheduleYmd는 반드시 **${todayYmd}** (한글 "날짜"·scheduleYmd 동일).
2. '내일' → **${todayYmd}** 에서 달력으로 정확히 +1일 된 날짜를 scheduleYmd에 넣는다.
3. '모레' → **${todayYmd}** 에서 달력으로 정확히 +2일 된 날짜를 scheduleYmd에 넣는다.
4. 날짜 언급 없이 시각만(예: 오후 6시, 18시) 있는 경우 → scheduleYmd는 우선 **${todayYmd}** 로 두고 scheduleHm에 반영한다. 다만 그날 그 시각이 **이미 지난 시각**으로만 해석되면(당일 모임으로는 불가능한 과거) 자동으로 **내일**(위 2번과 같이 ${todayYmd}+1일)을 scheduleYmd로 쓴다.

그 밖의 상대 표현(이번 주 토요일 등)도 반드시 **${todayYmd}** 를 달력 앵커로 삼아 계산한다. scheduleYmd·한글 "날짜"는 **반드시 YYYY-MM-DD** 만 사용한다(다른 형식 금지). 앵커를 무시하고 임의 날짜로 퉁치지 마라.

[카테고리 — 서버 고정 목록]
너가 선택할 수 있는 카테고리 번호와 이름은 다음과 같아: ${catsForPrompt}
categoryIndex는 위 번호(정수 0 .. ${pairs.length - 1}) 중 정확히 하나이거나, 불가하면 null.

[Model / hybrid]
The server calls Llama 3.3 70B first and Llama 3.1 8B Instant on failure (e.g. rate limits). Output the same APP JSON schema in all cases.

[Intent pivoting]
If the dominant intent shifts (e.g. generic food → drinking), immediately realign categoryIndex (위 [카테고리] 목록의 인덱스), menuPreferenceLabel (주점·호프·포차 등), title, and 장소/placeAutoPickQuery to the new intent; drop mismatched prior assumptions.

[Automatic menuPreferenceLabel hints — Eat & Drink only]
삼겹살·국밥·한우·갈비 → 한식; 스시·초밥·라멘·우동 → 일식; 피자·파스타·스테이크 → 양식; 커피·디저트·카페 → 카페; 맥주·소주·안주·호프·주점·술집·술자리 → 주점·호프; 포차 → 포차.

[Forbidden NLU follow-ups]
Never use nluAskMessage, response.ask_message, or unknowns to prompt for: gender ratio (성비), age bands (연령대), or settlement / 더치페이. If the user states them voluntarily, reflect only valid JSON enums; otherwise omit genderRatio and settlement from publicMeetingDetails.

[Default openness]
suggestedIsPublic=false ONLY for clearly invite-only private circles (데이트, 가족만, 확정된 지인 소수, 내부 동료만). Otherwise true — do not ask the user to confirm public vs private.

[Temporal reasoning]
Relative dates (내일, 모레, 이번 주 토요일, …) MUST be computed strictly from calendar anchor todayYmd=${todayYmd}. Never set scheduleYmd to todayYmd when the user clearly asked for another relative day; output precise YYYY-MM-DD (and HH:mm when inferable).

[Few-shot 날짜 — 고정 예시; 실제 호출에서는 동일 규칙으로 todayYmd=${todayYmd}를 앵커로 쓴다]
예시 1: 앵커 todayYmd=2026-05-05, 사용자「내일 오후 6시」→ scheduleYmd 2026-05-06, scheduleHm 18:00 (ISO 2026-05-06T18:00:00).
예시 2: 앵커 todayYmd=2026-05-05, 사용자「이번 주 토요일」(시간 없음) → scheduleYmd 2026-05-09, scheduleHm 19:00 기본 (ISO 2026-05-09T19:00:00).

Optional shorthand: you may also return { "intent":"create_meeting", "data":{...}, "needs_more_info":[...] } — the server maps data.title/date/time/location/is_public into the flat APP fields.

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
- Mood / vibe: merge **short** vibe adjectives (공부하기 좋은, 인스타 감성, 조용한 등) into "장소" / placeAutoPickQuery as **compact** keywords only — never paste the user's whole story sentence.
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
- "장소": **짧은** Google Places 텍스트 검색용 한국어 구문만(지명·역·동 + 업종·음식·분위기 3~10어절). 사용자 발화 **전체를 길게 복붙하지 마라**. 분위기·업종만 있어도 비어 있지 않게 **핵심 키워드만** 조합해라.

English/camelCase (same inference rules):
- categoryIndex: integer index 0..${pairs.length - 1} matching the numbered list in [카테고리 — 서버 고정 목록] above (best-matching 모임 category for this message), OR null if impossible. The server maps this index to categoryId/categoryLabel — do NOT output categoryId (UUID) or categoryLabel in JSON (omit them; index only).
- scheduleYmd, scheduleHm, scheduleText: use scheduleText for vague relative phrases if needed.
- minParticipants, maxParticipants: numbers or null (mirror all "인원" rules above).
- placeAutoPickQuery: same intent as "장소" — **compact search keywords only** (no full-sentence dump; strip filler, backstory, repeated 조사). If you set "장소", mirror the same trimmed phrase to placeAutoPickQuery.
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
- Relative dates (내일, 모레, 이번 주 토요일) use ONLY todayYmd=${todayYmd} as the calendar reference (same as the first line of this system prompt).
- categoryIndex must match one row in [카테고리 — 서버 고정 목록] above, or be null.
- Accumulated JSON in the user message: keep prior filled fields by **omitting** their keys from your output unless this message clearly changes them (do not null-fill unchanged slots).
- Sticky schedule: if accumulated already has scheduleYmd ≠ todayYmd, do not move it back to today unless the user clearly requests a date/today change (see [Sticky 날짜]).
- Negation: "A not B" / "A 말고 B" patterns → follow **B only** for categoryIndex and related slots.
- placeAutoPickQuery / "장소": **keyword-style** queries only — never echo the entire user message.

Optional nested JSON (server flattens into the same fields; you may use in addition to flat keys):
- "inference": { "intent_strength", "social_context", "reasoning" } — stored as nluInference.
- "extracted_data": { "title", "major_code", "category_label", "schedule_date", "schedule_time", "place_name", "capacity", "is_public", "meta": { "vibe_tags": string[], "is_location_vague": boolean } } — merged only when flat fields are empty.
- "missing_fields": string[] — appended to unknowns.
- "response": { "confirm_message", "ask_message" } — copied to nluConfirmMessage / nluAskMessage for UI. Prefer filling flat keys directly when possible.`;

  const histRaw = typeof body.history === 'string' ? body.history.trim() : '';
  const historyBlock = histRaw.length > 0 ? `history:\n${histRaw}\n\n` : '';
  const userText =
    historyBlock +
    (hasAccum
      ? `누적(JSON, 빈·기본값 제외):\n${JSON.stringify(accumSlim)}\n\n메시지:\n${text}`
      : `메시지:\n${text}`);

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
  applyCategoryResolution(merged, pairs);
  stripNestedMeetingCreateKeys(merged);
  applyMenuPreferenceKeywordFallback(merged, text);
  defaultSuggestedIsPublicWhenUnset(merged);
  ensurePublicMeetingAgeLimitForPublic(merged);
  applyStickyScheduleFromAccumulated(merged, accumSlim, text, todayYmd);

  return jsonResponse({ result: merged });
});
