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

export type SettlementShareMessageParams = {
  meetingTitle: string;
  meetingId: string;
  perPersonWon: number | null;
  totalWon: number | null;
  hostAccountText: string;
};

export function buildSettlementShareMessage(p: SettlementShareMessageParams): string {
  const title = (p.meetingTitle ?? '').trim() || '모임';
  const lines = [
    `[지닛 정산] ${title}`,
    `모임 ID: ${p.meetingId}`,
    p.totalWon != null && Number.isFinite(p.totalWon) ? `총액: ${Math.trunc(p.totalWon).toLocaleString()}원` : null,
    p.perPersonWon != null && Number.isFinite(p.perPersonWon)
      ? `인당: ${Math.trunc(p.perPersonWon).toLocaleString()}원`
      : null,
    p.hostAccountText.trim()
      ? `입금 계좌: ${maskHolderInHostAccountTextForShare(p.hostAccountText.trim())}`
      : null,
    '앱에서 모임 상세를 확인해 주세요.',
  ].filter((x): x is string => typeof x === 'string' && x.length > 0);
  return lines.join('\n');
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
