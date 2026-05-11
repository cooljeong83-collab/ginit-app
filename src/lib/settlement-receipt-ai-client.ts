import { assertSupabasePublicReady } from '@/src/lib/hybrid-data-source';
import type { SettlementReceiptOcrAnalysis, SettlementReceiptOcrReviewSourceItem } from '@/src/lib/settlement-receipt-ocr-types';
import { supabase } from '@/src/lib/supabase';

export type SettlementReceiptAiAnalysisOk = {
  ok: true;
  analysis: SettlementReceiptOcrAnalysis;
  totalWon: number;
  accountHint: string | null;
};

export type SettlementReceiptAiAnalysisErr = {
  ok: false;
  message: string;
};

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

function normalizeReviewItems(raw: unknown): SettlementReceiptOcrReviewSourceItem[] {
  if (!Array.isArray(raw)) return [];
  const out: SettlementReceiptOcrReviewSourceItem[] = [];
  for (const item of raw) {
    const o = asObject(item);
    if (!o) continue;
    out.push({ name: asStringOrNull(o.name) ?? '품목', tags: normalizeTags(o.tags) });
  }
  return out.slice(0, 80);
}

export function normalizeSettlementReceiptAiAnalysis(raw: unknown): SettlementReceiptOcrAnalysis | null {
  const root = asObject(raw);
  const analysis = asObject(root?.analysis) ?? root;
  if (!analysis) return null;
  const verification = asObject(analysis.verification) ?? {};
  const reviewSource = asObject(analysis.review_source) ?? asObject(analysis.reviewSource) ?? {};
  const billing = asObject(analysis.billing) ?? {};
  const legacyStoreInfo = asObject(analysis.store_info) ?? asObject(analysis.storeInfo) ?? {};
  const legacySummary = asObject(analysis.final_summary) ?? asObject(analysis.finalSummary) ?? {};
  const totalAmount =
    asMoneyOrNull(billing.total_amount ?? billing.totalAmount) ??
    asMoneyOrNull(legacySummary.actual_payment ?? legacySummary.actualPayment) ??
    asMoneyOrNull(legacySummary.calculated_total ?? legacySummary.calculatedTotal);
  if (totalAmount == null) return null;
  return {
    verification: {
      biz_num: normalizeBizNum(verification.biz_num ?? verification.bizNum),
      store_name: asStringOrNull(verification.store_name ?? verification.storeName) ?? asStringOrNull(legacyStoreInfo.name),
      datetime:
        asStringOrNull(verification.datetime) ??
        asStringOrNull(verification.date) ??
        asStringOrNull(legacyStoreInfo.date),
    },
    review_source: {
      items: normalizeReviewItems(reviewSource.items ?? analysis.items),
    },
    billing: {
      total_amount: totalAmount,
      is_verified: asBoolean(billing.is_verified ?? billing.isVerified ?? legacySummary.is_verified ?? legacySummary.isVerified),
    },
  };
}

export function normalizeSettlementReceiptAiResponse(raw: unknown): SettlementReceiptAiAnalysisOk | SettlementReceiptAiAnalysisErr {
  const o = asObject(raw);
  if (!o) return { ok: false, message: '영수증 AI 분석 응답이 비어 있습니다.' };
  if (o.ok === false) {
    return { ok: false, message: asStringOrNull(o.error) ?? '영수증 AI 분석에 실패했습니다.' };
  }
  const analysis = normalizeSettlementReceiptAiAnalysis(o.analysis ?? o);
  if (!analysis) return { ok: false, message: '영수증 AI 분석 결과를 해석하지 못했습니다.' };
  const totalWon =
    asMoneyOrNull(o.totalWon) ??
    analysis.billing.total_amount;
  if (totalWon == null) return { ok: false, message: '영수증 결제 금액을 찾지 못했습니다.' };
  return {
    ok: true,
    analysis,
    totalWon,
    accountHint: asStringOrNull(o.accountHint ?? o.account_hint),
  };
}

export async function analyzeSettlementReceiptOcrTextWithAi(chunks: string[]): Promise<SettlementReceiptAiAnalysisOk | SettlementReceiptAiAnalysisErr> {
  const cleanChunks = chunks.map((x) => (typeof x === 'string' ? x.trim() : '')).filter((x) => x.length > 0);
  if (cleanChunks.length === 0) return { ok: false, message: '영수증에서 읽은 텍스트가 없어요.' };
  assertSupabasePublicReady();

  const { data, error } = await supabase.functions.invoke('analyze-settlement-receipt', {
    body: {
      chunks: cleanChunks,
      rawText: cleanChunks.join('\n'),
      locale: 'ko-KR',
      currency: 'KRW',
    },
  });
  if (error) {
    return { ok: false, message: error.message?.trim() || '영수증 AI 분석 요청에 실패했습니다.' };
  }
  return normalizeSettlementReceiptAiResponse(data);
}
