import { stripUndefinedDeep } from '@/src/lib/firestore-utils';
import { ledgerWritesToSupabase } from '@/src/lib/hybrid-data-source';
import { isLedgerMeetingId, ledgerMeetingPutRawDoc, ledgerTryLoadMeetingDoc } from '@/src/lib/meetings-ledger';
import type { MeetingLifecycleStatus, MeetingSettlementInfo } from '@/src/lib/meetings';
import { parseMeetingSettlementDraftReceipts } from '@/src/lib/meetings';

function settlementInfoToDocValue(info: MeetingSettlementInfo): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (info.draftTotalWon != null) o.draftTotalWon = info.draftTotalWon;
  if (info.paymentMethod != null) o.paymentMethod = info.paymentMethod;
  if (info.hostAccountText != null) o.hostAccountText = info.hostAccountText;
  if (info.hostBankCode != null) o.hostBankCode = info.hostBankCode;
  if (info.hostAccountNumber != null) o.hostAccountNumber = info.hostAccountNumber;
  if (info.hostAccountHolder != null) o.hostAccountHolder = info.hostAccountHolder;
  if (info.draftReceipts != null) {
    o.draftReceipts = info.draftReceipts.map((r) => ({
      id: r.id,
      imageUrl: r.imageUrl,
      amountWon: r.amountWon,
    }));
  }
  if (info.rawText != null) o.rawText = info.rawText;
  if (info.selectedParticipantIds != null) o.selectedParticipantIds = info.selectedParticipantIds;
  if (info.linkedPlaceChipId != null) o.linkedPlaceChipId = info.linkedPlaceChipId;
  if (info.finalizedAt != null) o.finalizedAt = info.finalizedAt;
  return o;
}

function readSettlementInfoRaw(doc: Record<string, unknown>): MeetingSettlementInfo {
  const raw = doc.settlementInfo ?? doc.settlement_info;
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const out: MeetingSettlementInfo = {};
  const d = o.draftTotalWon ?? o.draft_total_won;
  if (typeof d === 'number' && Number.isFinite(d)) out.draftTotalWon = Math.trunc(d);
  const pm = o.paymentMethod ?? o.payment_method;
  if (pm === 'cash' || pm === 'bank_transfer') out.paymentMethod = pm;
  const h = o.hostAccountText ?? o.host_account_text;
  if (typeof h === 'string') out.hostAccountText = h;
  const bc = o.hostBankCode ?? o.host_bank_code;
  if (typeof bc === 'string') out.hostBankCode = bc;
  const an = o.hostAccountNumber ?? o.host_account_number;
  if (typeof an === 'string') out.hostAccountNumber = an;
  const ah = o.hostAccountHolder ?? o.host_account_holder;
  if (typeof ah === 'string') out.hostAccountHolder = ah;
  const dr = o.draftReceipts ?? o.draft_receipts;
  if (Array.isArray(dr)) {
    out.draftReceipts = parseMeetingSettlementDraftReceipts(dr);
  }
  const r = o.rawText ?? o.raw_text;
  if (typeof r === 'string') out.rawText = r;
  const s = o.selectedParticipantIds ?? o.selected_participant_ids;
  if (Array.isArray(s)) {
    out.selectedParticipantIds = s
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      .map((x) => x.trim());
  }
  const l = o.linkedPlaceChipId ?? o.linked_place_chip_id;
  if (typeof l === 'string') out.linkedPlaceChipId = l;
  const f = o.finalizedAt ?? o.finalized_at;
  if (typeof f === 'string') out.finalizedAt = f;
  return out;
}

function readLocationDataRaw(doc: Record<string, unknown>): Record<string, unknown> | null {
  const raw = doc.locationData ?? doc.location_data;
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return { ...(raw as Record<string, unknown>) };
}

/**
 * `settlementInfo`만 얕게 병합 저장(Supabase 원장만).
 */
export async function persistMeetingSettlementInfoPatch(
  meetingId: string,
  patch: Partial<MeetingSettlementInfo>,
): Promise<void> {
  const mid = meetingId.trim();
  if (!mid) throw new Error('meeting id required');
  const cleaned = stripUndefinedDeep(patch) as Partial<MeetingSettlementInfo>;
  if (Object.keys(cleaned).length === 0) return;

  if (ledgerWritesToSupabase() && isLedgerMeetingId(mid)) {
    const data = await ledgerTryLoadMeetingDoc(mid);
    if (!data) throw new Error('모임을 찾을 수 없어요.');
    const prev = readSettlementInfoRaw(data);
    const nextInfo: MeetingSettlementInfo = { ...prev, ...cleaned };
    const nextDoc = {
      ...data,
      settlementInfo: settlementInfoToDocValue(nextInfo),
    };
    await ledgerMeetingPutRawDoc(mid, stripUndefinedDeep(nextDoc) as Record<string, unknown>);
    return;
  }

  throw new Error('[settlement] Supabase 원장(UUID) 모임만 지원합니다.');
}

export type MeetingLocationDataPatch = {
  confirmedPlaceChipId?: string | null;
  placeNameSnapshot?: string | null;
};

/** 확정 장소와 OCR/수동 상호 연결용 `locationData`만 병합 */
export async function persistMeetingLocationDataPatch(
  meetingId: string,
  patch: MeetingLocationDataPatch,
): Promise<void> {
  const mid = meetingId.trim();
  if (!mid) throw new Error('meeting id required');
  const cleaned = stripUndefinedDeep(patch) as MeetingLocationDataPatch;
  if (Object.keys(cleaned).length === 0) return;

  if (ledgerWritesToSupabase() && isLedgerMeetingId(mid)) {
    const data = await ledgerTryLoadMeetingDoc(mid);
    if (!data) throw new Error('모임을 찾을 수 없어요.');
    const prev = readLocationDataRaw(data) ?? {};
    const nextLd = { ...prev, ...cleaned };
    const nextDoc = { ...data, locationData: nextLd };
    await ledgerMeetingPutRawDoc(mid, stripUndefinedDeep(nextDoc) as Record<string, unknown>);
    return;
  }

  throw new Error('[settlement] Supabase 원장(UUID) 모임만 지원합니다.');
}

/** 앱 푸시 정산 공유 성공 후에만 호출 — `lifecycleStatus` + finalizedAt */
export async function markMeetingLifecycleSettled(meetingId: string): Promise<void> {
  const mid = meetingId.trim();
  if (!mid) throw new Error('meeting id required');
  const finalizedAt = new Date().toISOString();

  if (ledgerWritesToSupabase() && isLedgerMeetingId(mid)) {
    const data = await ledgerTryLoadMeetingDoc(mid);
    if (!data) throw new Error('모임을 찾을 수 없어요.');
    const prev = readSettlementInfoRaw(data);
    const nextInfo: MeetingSettlementInfo = { ...prev, finalizedAt };
    const nextDoc: Record<string, unknown> = {
      ...data,
      lifecycleStatus: 'SETTLED' as MeetingLifecycleStatus,
      settlementInfo: settlementInfoToDocValue(nextInfo),
    };
    await ledgerMeetingPutRawDoc(mid, stripUndefinedDeep(nextDoc) as Record<string, unknown>);
    return;
  }

  throw new Error('[settlement] Supabase 원장(UUID) 모임만 지원합니다.');
}
