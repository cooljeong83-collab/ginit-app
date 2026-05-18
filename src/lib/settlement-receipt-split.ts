import { normalizeParticipantId } from '@/src/lib/app-user-id';

export type SettlementReceiptForSplit = {
  amountWon: number;
  uploaderAppUserId?: string | null;
};

/** 영수증 기준 순정산액 — 음수=받을 금액, 양수=보낼 금액 */
export function computeReceiptBasedSettlementNet(
  participantIds: readonly string[],
  receipts: readonly SettlementReceiptForSplit[],
): Map<string, number> {
  const out = new Map<string, number>();
  const ids = participantIds.map((id) => normalizeParticipantId(id) ?? id.trim()).filter(Boolean);
  if (ids.length === 0) return out;

  const allowed = new Set(ids);
  const spent = new Map<string, number>();
  for (const id of ids) spent.set(id, 0);

  for (const r of receipts) {
    const amount = typeof r.amountWon === 'number' && Number.isFinite(r.amountWon) ? Math.max(0, Math.trunc(r.amountWon)) : 0;
    if (amount <= 0) continue;
    const uploaderRaw = (r.uploaderAppUserId ?? '').trim();
    const uploader = uploaderRaw ? normalizeParticipantId(uploaderRaw) ?? uploaderRaw : '';
    const target = uploader && allowed.has(uploader) ? uploader : ids[0]!;
    spent.set(target, (spent.get(target) ?? 0) + amount);
  }

  const total = [...spent.values()].reduce((s, v) => s + v, 0);
  const avgMap = distributeTotalWonEven(total, ids);
  for (const id of ids) {
    const avg = avgMap.get(id) ?? 0;
    const pay = spent.get(id) ?? 0;
    out.set(id, avg - pay);
  }
  return out;
}

/** 총액을 `ids` 순서대로 원 단위 균등 분배(나머지는 앞쪽부터 1원씩). */
function distributeTotalWonEven(total: number, ids: readonly string[]): Map<string, number> {
  const m = new Map<string, number>();
  const n = ids.length;
  if (n === 0 || !Number.isFinite(total) || total < 0) return m;
  const tt = Math.trunc(total);
  const base = Math.floor(tt / n);
  let rem = tt - base * n;
  for (let i = 0; i < n; i++) {
    const extra = rem > 0 ? 1 : 0;
    if (rem > 0) rem -= 1;
    m.set(ids[i]!, base + extra);
  }
  return m;
}

export function formatSettlementNetWonLabel(netWon: number): string {
  if (!Number.isFinite(netWon) || netWon === 0) return '0원';
  const abs = Math.abs(Math.trunc(netWon)).toLocaleString('ko-KR');
  if (netWon < 0) return `−${abs}원 받음`;
  return `+${abs}원 보냄`;
}

/** 순정산액 양수=지불, 음수=수령 — 정산 완료 화면 본인 요약용 */
export function formatSettlementNetWonSelfSummary(netWon: number): { label: string; value: string } {
  const n = Math.trunc(netWon);
  const abs = Math.abs(n).toLocaleString('ko-KR');
  if (n > 0) return { label: '내가 지불할 금액', value: `${abs}원` };
  if (n < 0) return { label: '내가 받을 금액', value: `${abs}원` };
  return { label: '내가 지불할 금액', value: '0원' };
}

/** 정산 완료 화면 참여자 행 — 양수=지불, 음수=받을 */
export function formatSettlementReadonlyParticipantNet(netWon: number): string {
  const n = Math.trunc(netWon);
  if (!Number.isFinite(n) || n === 0) return '0원';
  const abs = Math.abs(n).toLocaleString('ko-KR');
  if (n > 0) return `지불 ${abs}원`;
  return `받을 ${abs}원`;
}
