import { describe, expect, it } from 'vitest';

import {
  computeReceiptBasedSettlementNet,
  formatSettlementNetWonSelfSummary,
  formatSettlementReadonlyParticipantNet,
} from '@/src/lib/settlement-receipt-split';

describe('computeReceiptBasedSettlementNet', () => {
  const ids = ['a@test.com', 'b@test.com', 'c@test.com', 'd@test.com'] as const;

  it('splits by receipt uploads (A=15k, B=25k)', () => {
    const net = computeReceiptBasedSettlementNet(ids, [
      { uploaderAppUserId: 'a@test.com', amountWon: 15_000 },
      { uploaderAppUserId: 'b@test.com', amountWon: 25_000 },
    ]);
    expect(net.get('a@test.com')).toBe(-5_000);
    expect(net.get('b@test.com')).toBe(-15_000);
    expect(net.get('c@test.com')).toBe(10_000);
    expect(net.get('d@test.com')).toBe(10_000);
    const sum = [...net.values()].reduce((s, v) => s + v, 0);
    expect(sum).toBe(0);
  });

  it('returns zeros when no receipts', () => {
    const net = computeReceiptBasedSettlementNet(ids, []);
    for (const id of ids) expect(net.get(id)).toBe(0);
  });
});

describe('settlement net display labels', () => {
  it('maps positive net to pay summary', () => {
    expect(formatSettlementNetWonSelfSummary(10_000)).toEqual({
      label: '내가 지불할 금액',
      value: '10,000원',
    });
  });

  it('maps negative net to receive summary', () => {
    expect(formatSettlementNetWonSelfSummary(-10_000)).toEqual({
      label: '내가 받을 금액',
      value: '10,000원',
    });
  });

  it('formats readonly participant row amounts', () => {
    expect(formatSettlementReadonlyParticipantNet(10_000)).toBe('지불 10,000원');
    expect(formatSettlementReadonlyParticipantNet(-10_000)).toBe('받을 10,000원');
  });
});
