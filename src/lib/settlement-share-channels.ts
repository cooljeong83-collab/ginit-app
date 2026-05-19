import { Linking, Platform, Share } from 'react-native';

/** `composeSettlementHostAccountText` 형태(은행·계좌·예금주 공백 구분)에서 마지막 토큰(예금주) 가운데 마스킹 — 공유·푸시 노출용 */
export function maskHolderInHostAccountTextForShare(raw: string): string {
  const t = raw.trim();
  if (!t) return t;
  const parts = t.split(/\s+/).filter((p) => p.length > 0);
  if (parts.length < 3) return t;
  const holder = parts[parts.length - 1] ?? '';
  const masked = maskNameMiddleForShare(holder);
  return [...parts.slice(0, -1), masked].join(' ');
}

function maskNameMiddleForShare(name: string): string {
  const s = name.trim();
  const n = s.length;
  if (n <= 1) return s;
  if (n === 2) return `${s[0]}*`;
  return `${s[0]}${'*'.repeat(n - 2)}${s[n - 1]}`;
}

export type SettlementShareParticipantAmount = {
  displayName: string;
  amountWon: number;
};

export type SettlementShareMessageParams = {
  meetingTitle: string;
  /** `2026-05-19(화) 10:00` — 모임 제목 아래 `일시 : …` 행 */
  scheduleLine?: string | null;
  participantCount: number;
  settlementMethodText: string;
  paymentMethod?: 'cash' | 'bank_transfer' | null;
  bankName?: string | null;
  accountNumber?: string | null;
  accountHolder?: string | null;
  totalWon: number | null;
  participantAmounts?: readonly SettlementShareParticipantAmount[];
  receiptSummaries?: SettlementShareReceiptSummary[];
};

export type SettlementShareReceiptSummary = {
  storeName?: string | null;
  bizNum?: string | null;
  visitedAt?: string | null;
  amountWon?: number | null;
  payerNickname?: string | null;
  tags?: string[] | null;
};

export function formatSignedWonForSettlementShare(won: number): string {
  if (!Number.isFinite(won)) return '0원';
  const n = Math.trunc(won);
  const abs = Math.abs(n).toLocaleString('ko-KR');
  if (n < 0) return `-${abs}원`;
  return `${abs}원`;
}

export function buildSettlementShareMessage(p: SettlementShareMessageParams): string {
  const title = (p.meetingTitle ?? '').trim() || '모임';
  const formatWon = (value: number | null) =>
    value != null && Number.isFinite(value) ? `${Math.trunc(value).toLocaleString('ko-KR')}원` : '';
  const paymentMethodText = buildPaymentMethodText(p);
  const schedule = (p.scheduleLine ?? '').trim();
  const lines = [
    `[지닛 정산] ${title}`,
    ...(schedule ? [`일시 : ${schedule}`] : []),
    `인원 : ${Math.max(0, Math.trunc(p.participantCount)).toLocaleString('ko-KR')}명`,
    `총 금액 : ${formatWon(p.totalWon)}`,
    ...buildParticipantAmountShareLines(p.participantAmounts ?? []),
    `정산 방식 : ${(p.settlementMethodText ?? '').trim()}`,
    `지불 방식 : ${paymentMethodText}`,
  ];
  const receiptLines = buildReceiptSummaryLines(p.receiptSummaries ?? [], formatWon);
  if (receiptLines.length > 0) {
    lines.push('');
    lines.push('[ 영수증 인식 정보 ]');
    lines.push(...receiptLines);
  }
  lines.push('');
  lines.push('영수증 및 상세 내역을 확인하고 싶으시면 어플 모임 상세에서 확인하세요.');
  return lines.join('\n');
}

function buildParticipantAmountShareLines(
  participants: readonly SettlementShareParticipantAmount[],
): string[] {
  return participants.map((participant, index) => {
    const name = (participant.displayName ?? '').trim() || `참여자 ${index + 1}`;
    return `${index + 1}. ${name} : ${formatSignedWonForSettlementShare(participant.amountWon)}`;
  });
}

function buildPaymentMethodText(p: SettlementShareMessageParams): string {
  if (p.paymentMethod === 'cash') return '현금';
  const bankName = (p.bankName ?? '').trim();
  const accountNumber = (p.accountNumber ?? '').replace(/\D/g, '').trim();
  const accountHolder = maskNameMiddleForShare(p.accountHolder ?? '');
  const accountText = [bankName, accountNumber, accountHolder].filter(Boolean).join(' ');
  return accountText ? `계좌 (${accountText})` : '계좌';
}

function buildReceiptSummaryLines(
  receipts: readonly SettlementShareReceiptSummary[],
  formatWon: (value: number | null) => string,
): string[] {
  const lines: string[] = [];
  receipts.forEach((receipt, index) => {
    if (index > 0) lines.push('');
    const storeName = (receipt.storeName ?? '').trim() || `영수증 ${index + 1}`;
    const amount =
      typeof receipt.amountWon === 'number' && Number.isFinite(receipt.amountWon)
        ? formatWon(receipt.amountWon)
        : '';
    lines.push(`${index + 1}. ${storeName}`);
    const bizNum = (receipt.bizNum ?? '').trim();
    const visitedAt = (receipt.visitedAt ?? '').trim();
    const payerNickname = (receipt.payerNickname ?? '').trim();
    if (bizNum) lines.push(`사업자번호 : ${bizNum}`);
    if (visitedAt) lines.push(`결제일시 : ${visitedAt}`);
    if (amount) lines.push(`결제금액 : ${amount}`);
    if (payerNickname) lines.push(`결제자 : ${payerNickname}`);
  });
  return lines;
}

export async function shareSettlementText(message: string): Promise<void> {
  const m = message.trim();
  if (!m) return;
  await Share.share({ message: m });
}

/** 수신인은 사용자가 문자 앱에서 직접 선택(OS 제한). */
export async function openSettlementSmsComposer(message: string): Promise<void> {
  const body = encodeURIComponent(message.trim());
  if (!body) return;
  const url =
    Platform.OS === 'ios'
      ? `sms:&body=${body}`
      : Platform.select({
          android: `sms:?body=${body}`,
          default: `sms:?body=${body}`,
        }) ?? `sms:?body=${body}`;
  const ok = await Linking.canOpenURL(url).catch(() => false);
  if (ok) {
    await Linking.openURL(url);
    return;
  }
  await Share.share({ message: message.trim() });
}
