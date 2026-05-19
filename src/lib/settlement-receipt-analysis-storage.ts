import { assertSupabasePublicReady } from '@/src/lib/hybrid-data-source';
import { normalizeSettlementReceiptAiAnalysis } from '@/src/lib/settlement-receipt-ai-client';
import type { SettlementReceiptOcrAnalysis } from '@/src/lib/settlement-receipt-ocr-types';
import { supabase } from '@/src/lib/supabase';

export type SettlementReceiptAnalysisSyncInput = {
  receiptId: string;
  imageUrl: string;
  amountWon: number;
  analysis?: SettlementReceiptOcrAnalysis;
};

export type SettlementReceiptAnalysisRpcPayloadItem = {
  receipt_id: string;
  image_url: string;
  amount_won: number;
  analysis: SettlementReceiptOcrAnalysis | Record<string, never>;
};

export type SettlementReceiptAnalysisStatus =
  | 'active'
  | 'inactive'
  | 'vendor_verified'
  | 'vendor_rejected';

export type SettlementReceiptAnalysisRecord = {
  receiptId: string;
  imageUrl: string;
  amountWon: number;
  analysis?: SettlementReceiptOcrAnalysis;
  storeName: string | null;
  bizNum: string | null;
  receiptDateText: string | null;
  isVerified: boolean;
  status: SettlementReceiptAnalysisStatus;
};

function isHttpUrl(raw: string): boolean {
  return /^https?:\/\//i.test(raw.trim());
}

export function buildSettlementReceiptAnalysisRpcPayload(
  receipts: readonly SettlementReceiptAnalysisSyncInput[],
): SettlementReceiptAnalysisRpcPayloadItem[] {
  const out: SettlementReceiptAnalysisRpcPayloadItem[] = [];
  const seen = new Set<string>();
  for (const receipt of receipts) {
    const receiptId = receipt.receiptId.trim();
    const imageUrl = receipt.imageUrl.trim();
    const amountWon = Math.trunc(receipt.amountWon);
    if (!receiptId || seen.has(receiptId)) continue;
    if (!isHttpUrl(imageUrl)) continue;
    if (!Number.isFinite(amountWon) || amountWon < 0 || amountWon > 500_000_000) continue;
    seen.add(receiptId);
    out.push({
      receipt_id: receiptId,
      image_url: imageUrl,
      amount_won: amountWon,
      analysis: receipt.analysis ?? {},
    });
  }
  return out;
}

export async function syncSettlementReceiptAnalysesToSupabase(params: {
  meetingId: string;
  uploaderUserId: string;
  receipts: readonly SettlementReceiptAnalysisSyncInput[];
}): Promise<void> {
  const meetingId = params.meetingId.trim();
  const uploaderUserId = params.uploaderUserId.trim();
  if (!meetingId) throw new Error('모임 정보가 없습니다.');
  if (!uploaderUserId) throw new Error('로그인이 필요합니다.');
  assertSupabasePublicReady();

  const { error } = await supabase.rpc('sync_settlement_receipt_analyses', {
    p_meeting_id: meetingId,
    p_uploader_app_user_id: uploaderUserId,
    p_receipts: buildSettlementReceiptAnalysisRpcPayload(params.receipts),
  });
  if (error) throw new Error(error.message);
}

function asObject(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

function asStringOrNull(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

function asAmountWon(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
}

function asBoolean(raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') {
    const t = raw.trim().toLowerCase();
    return t === 'true' || t === '1' || t === 'yes';
  }
  return false;
}

function asReceiptStatus(raw: unknown): SettlementReceiptAnalysisStatus {
  const t = typeof raw === 'string' ? raw.trim() : '';
  if (t === 'vendor_verified' || t === 'vendor_rejected' || t === 'inactive') return t;
  return 'active';
}

export async function fetchSettlementReceiptAnalysesFromSupabase(meetingIdRaw: string): Promise<SettlementReceiptAnalysisRecord[]> {
  const meetingId = meetingIdRaw.trim();
  if (!meetingId) return [];
  assertSupabasePublicReady();

  const { data, error } = await supabase.rpc('get_settlement_receipt_analyses', {
    p_meeting_id: meetingId,
  });
  if (error) throw new Error(error.message);

  const rows = Array.isArray(data) ? data : [];
  const out: SettlementReceiptAnalysisRecord[] = [];
  const seen = new Set<string>();
  for (const raw of rows) {
    const row = asObject(raw);
    if (!row) continue;
    const receiptId = asStringOrNull(row.receipt_id ?? row.receiptId);
    const imageUrl = asStringOrNull(row.image_url ?? row.imageUrl);
    if (!receiptId || !imageUrl || seen.has(receiptId)) continue;
    seen.add(receiptId);
    const analysis = normalizeSettlementReceiptAiAnalysis(row.analysis);
    out.push({
      receiptId,
      imageUrl,
      amountWon: asAmountWon(row.amount_won ?? row.amountWon),
      analysis: analysis ?? undefined,
      storeName: asStringOrNull(row.store_name ?? row.storeName),
      bizNum: asStringOrNull(row.biz_num ?? row.bizNum),
      receiptDateText: asStringOrNull(row.receipt_date_text ?? row.receiptDateText),
      isVerified: asBoolean(row.is_verified ?? row.isVerified),
      status: asReceiptStatus(row.status),
    });
  }
  return out;
}
