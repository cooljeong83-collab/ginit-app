import type { MeetingReviewPlaceContext } from '@/src/lib/meeting-review/meeting-review-place-context';
import type { Meeting } from '@/src/lib/meetings';
import type { SettlementReceiptAnalysisRecord } from '@/src/lib/settlement-receipt-analysis-storage';

const CORP_SUFFIX_RE =
  /(?:주식회사|\(주\)|㈜|유한회사|사단법인|재단법인|inc\.?|corp\.?|co\.?,?|ltd\.?)/gi;

/** 상호·주소 비교용 정규화 */
export function normalizeSettlementStoreLabel(raw: string): string {
  return raw
    .toLowerCase()
    .replace(CORP_SUFFIX_RE, '')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .trim();
}

function collectPlaceMatchLabels(
  place: MeetingReviewPlaceContext,
  meeting?: Meeting | null,
): string[] {
  const labels = new Set<string>();
  const add = (raw: string | null | undefined) => {
    const t = raw?.trim() ?? '';
    if (!t) return;
    labels.add(t);
    const norm = normalizeSettlementStoreLabel(t);
    if (norm.length >= 2) labels.add(norm);
  };
  add(place.placeName);
  add(place.address);
  add(meeting?.placeName);
  add(meeting?.location);
  add(meeting?.address);
  return [...labels];
}

/** 짧은 상호·지점명도 허용하는 느슨한 포함/부분 문자열 매칭 */
export function settlementStoreLabelsMatch(storeRaw: string, placeLabelRaw: string): boolean {
  const store = normalizeSettlementStoreLabel(storeRaw);
  const place = normalizeSettlementStoreLabel(placeLabelRaw);
  if (!store || !place) return false;
  if (store.length < 2 || place.length < 2) return false;
  if (store === place) return true;
  if (store.includes(place) || place.includes(store)) return true;

  const shorter = store.length <= place.length ? store : place;
  const longer = store.length > place.length ? store : place;
  const minSubLen = shorter.length >= 6 ? 4 : 3;
  for (let len = Math.min(shorter.length, 10); len >= minSubLen; len -= 1) {
    for (let i = 0; i <= shorter.length - len; i += 1) {
      const sub = shorter.slice(i, i + len);
      if (sub.length >= minSubLen && longer.includes(sub)) return true;
    }
  }
  return false;
}

export function doesReceiptStoreMatchPlaceLabels(
  storeName: string | null | undefined,
  placeLabels: readonly string[],
): boolean {
  const store = storeName?.trim() ?? '';
  if (!store) return false;
  return placeLabels.some((label) => settlementStoreLabelsMatch(store, label));
}

export function isSettlementReceiptPlaceVerified(
  receipts: readonly SettlementReceiptAnalysisRecord[],
  place: MeetingReviewPlaceContext,
  meeting?: Meeting | null,
): boolean {
  const labels = collectPlaceMatchLabels(place, meeting);
  if (labels.length === 0) return false;

  return receipts.some((receipt) => {
    if (receipt.status === 'vendor_verified') return true;
    const store =
      receipt.storeName?.trim() ||
      receipt.analysis?.verification.store_name?.trim() ||
      null;
    return doesReceiptStoreMatchPlaceLabels(store, labels);
  });
}
