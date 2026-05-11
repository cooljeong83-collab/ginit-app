/**
 * 정산 화면 입금 은행 선택 — 시중 5대 → 인터넷전문은행 → 기타(가나다 순).
 * 로고는 `faviconDomain` 기준 Google favicon 프록시(실패 시 UI에서 색상 글리프로 폴백).
 */
export type SettlementBankTier = 'major5' | 'internet' | 'other';

export type SettlementBankChoice = {
  id: string;
  label: string;
  /** favicon용 도메인(스킴 없이 호스트만) */
  faviconDomain: string;
  tier: SettlementBankTier;
  /** 로고 실패 시 원형 배경색 */
  brandColor: string;
};

const MAJOR5: SettlementBankChoice[] = [
  { id: 'kb', label: 'KB국민은행', faviconDomain: 'kbstar.com', tier: 'major5', brandColor: '#604EA7' },
  { id: 'shinhan', label: '신한은행', faviconDomain: 'shinhan.com', tier: 'major5', brandColor: '#0046FF' },
  { id: 'woori', label: '우리은행', faviconDomain: 'wooribank.com', tier: 'major5', brandColor: '#0064FF' },
  { id: 'hana', label: '하나은행', faviconDomain: 'hanabank.com', tier: 'major5', brandColor: '#008485' },
  { id: 'nh', label: 'NH농협은행', faviconDomain: 'nonghyup.com', tier: 'major5', brandColor: '#00A651' },
];

const INTERNET: SettlementBankChoice[] = [
  { id: 'kakao', label: '카카오뱅크', faviconDomain: 'kakaobank.com', tier: 'internet', brandColor: '#FEE500' },
  { id: 'toss', label: '토스뱅크', faviconDomain: 'tossbank.com', tier: 'internet', brandColor: '#0064FF' },
  { id: 'kbank', label: '케이뱅크', faviconDomain: 'kbanknow.com', tier: 'internet', brandColor: '#502FD7' },
];

const OTHER_BASE: SettlementBankChoice[] = [
  { id: 'ibk', label: 'IBK기업은행', faviconDomain: 'ibk.co.kr', tier: 'other', brandColor: '#004887' },
  { id: 'sc', label: 'SC제일은행', faviconDomain: 'sc.com', tier: 'other', brandColor: '#0473EA' },
  { id: 'citi', label: '한국씨티은행', faviconDomain: 'citibank.co.kr', tier: 'other', brandColor: '#056EAE' },
  { id: 'busan', label: '부산은행', faviconDomain: 'busanbank.co.kr', tier: 'other', brandColor: '#005BAC' },
  { id: 'daegu', label: '대구은행', faviconDomain: 'daegubank.co.kr', tier: 'other', brandColor: '#007AC2' },
  { id: 'kyongnam', label: '경남은행', faviconDomain: 'kyongnambank.co.kr', tier: 'other', brandColor: '#00529B' },
  { id: 'kwangju', label: '광주은행', faviconDomain: 'kjbank.com', tier: 'other', brandColor: '#00529C' },
  { id: 'jeonbuk', label: '전북은행', faviconDomain: 'jbkbank.co.kr', tier: 'other', brandColor: '#004B87' },
  { id: 'jeju', label: '제주은행', faviconDomain: 'jejubank.co.kr', tier: 'other', brandColor: '#004C97' },
  { id: 'suhyup', label: 'Sh수협은행', faviconDomain: 'suhyup-bank.com', tier: 'other', brandColor: '#0066B3' },
  { id: 'cu', label: '신협', faviconDomain: 'cu.co.kr', tier: 'other', brandColor: '#E60012' },
  { id: 'mg', label: '새마을금고', faviconDomain: 'mg.co.kr', tier: 'other', brandColor: '#00833D' },
  { id: 'epost', label: '우체국예금', faviconDomain: 'epostbank.go.kr', tier: 'other', brandColor: '#D31F26' },
  { id: 'sbi', label: 'SBI저축은행', faviconDomain: 'sbisb.com', tier: 'other', brandColor: '#004B9D' },
];

const OTHER_SORTED = [...OTHER_BASE].sort((a, b) => a.label.localeCompare(b.label, 'ko'));

/** UI·검색용 평탄 목록(이미 정렬됨) */
export const SETTLEMENT_BANK_CHOICES: SettlementBankChoice[] = [...MAJOR5, ...INTERNET, ...OTHER_SORTED];

const BANK_BY_ID = new Map(SETTLEMENT_BANK_CHOICES.map((b) => [b.id, b]));

export function getSettlementBankById(id: string | null | undefined): SettlementBankChoice | null {
  const k = typeof id === 'string' ? id.trim() : '';
  if (!k) return null;
  return BANK_BY_ID.get(k) ?? null;
}

export function settlementBankFaviconUrl(domain: string): string {
  const d = domain.trim().replace(/^https?:\/\//i, '').split('/')[0] ?? '';
  if (!d) return '';
  return `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(d)}`;
}

export function composeSettlementHostAccountText(opts: {
  bankLabel: string;
  accountNumberDigits: string;
  holder: string;
}): string {
  const bank = opts.bankLabel.trim();
  const num = opts.accountNumberDigits.replace(/\D/g, '').trim();
  const holder = opts.holder.trim();
  const parts = [bank, num, holder].filter((p) => p.length > 0);
  return parts.join(' ');
}

/**
 * 예전 한 줄 `hostAccountText`에서 은행·계좌·예금주 추정(하이드레이트용).
 */
export function parseSettlementLegacyHostAccountText(text: string): {
  bankId: string | null;
  accountNumber: string;
  holder: string;
} {
  const raw = text.trim();
  if (!raw) return { bankId: null, accountNumber: '', holder: '' };
  const byLen = [...SETTLEMENT_BANK_CHOICES].sort((a, b) => b.label.length - a.label.length);
  for (const b of byLen) {
    if (!raw.includes(b.label)) continue;
    const rest = raw.split(b.label).join(' ').replace(/\s+/g, ' ').trim();
    const digitRun = rest.match(/[\d\s-]+/)?.[0] ?? '';
    const accountNumber = digitRun.replace(/\D/g, '');
    const holder = rest.replace(digitRun, '').replace(/\s+/g, ' ').trim();
    return { bankId: b.id, accountNumber, holder };
  }
  const onlyDigits = raw.replace(/\D/g, '');
  return { bankId: null, accountNumber: onlyDigits, holder: '' };
}
