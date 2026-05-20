import Constants from 'expo-constants';
import { Linking, Platform } from 'react-native';

import { GINIT_OFFICIAL_SUPPORT_EMAIL } from '@/src/features/support/support-constants';

export type SupportInquiryCategoryId =
  | 'account'
  | 'meeting'
  | 'payment'
  | 'bug'
  | 'other';

export type SupportInquiryCategory = {
  id: SupportInquiryCategoryId;
  label: string;
};

export const SUPPORT_INQUIRY_CATEGORIES: readonly SupportInquiryCategory[] = [
  { id: 'account', label: '계정/로그인' },
  { id: 'meeting', label: '모임/참여' },
  { id: 'payment', label: '결제/정산' },
  { id: 'bug', label: '오류/버그' },
  { id: 'other', label: '기타' },
] as const;

export const SUPPORT_INQUIRY_BODY_MAX = 300;

export type SupportInquiryFormValues = {
  name: string;
  categoryId: SupportInquiryCategoryId | null;
  title: string;
  body: string;
};

export type SupportInquiryMailContext = {
  appUserId?: string | null;
  userEmail?: string | null;
  /** 이용 중지·탈퇴 안내 화면에서 진입한 문의 */
  accountGateReason?: string | null;
  inquirySource?: 'account_gate' | 'google_auth' | null;
};

function categoryLabel(id: SupportInquiryCategoryId | null): string {
  if (!id) return '';
  return SUPPORT_INQUIRY_CATEGORIES.find((c) => c.id === id)?.label ?? id;
}

export function buildSupportInquiryMailtoUrl(
  values: SupportInquiryFormValues,
  ctx?: SupportInquiryMailContext,
): string {
  const cat = categoryLabel(values.categoryId);
  const subject = `[지닛 문의] ${cat} - ${values.title.trim()}`;
  const appVersion =
    Constants.expoConfig?.version?.trim() ||
    (typeof Constants.nativeAppVersion === 'string' ? Constants.nativeAppVersion : '') ||
    'unknown';
  const lines = [
    `이름: ${values.name.trim()}`,
    `상담분류: ${cat}`,
    `제목: ${values.title.trim()}`,
    '',
    '--- 문의 내용 ---',
    values.body.trim(),
    '',
    '--- 앱 정보 ---',
    `앱 버전: ${appVersion}`,
    `플랫폼: ${Platform.OS}`,
  ];
  const uid = ctx?.appUserId?.trim();
  const email = ctx?.userEmail?.trim();
  if (uid) lines.push(`사용자 ID: ${uid}`);
  if (email) lines.push(`계정 이메일: ${email}`);
  const gateReason = ctx?.accountGateReason?.trim();
  if (gateReason) {
    lines.push(
      `계정 상태: ${gateReason === 'withdrawn' ? '탈퇴' : gateReason === 'suspended' ? '이용 중지' : gateReason}`,
    );
  }
  const inquirySource = ctx?.inquirySource?.trim();
  if (inquirySource === 'google_auth') {
    lines.push('문의 경로: Google 인증·동의');
  } else if (inquirySource === 'account_gate') {
    lines.push('문의 경로: 이용 중지·탈퇴 안내');
  }
  const body = lines.join('\n');
  return `mailto:${encodeURIComponent(GINIT_OFFICIAL_SUPPORT_EMAIL)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export async function openSupportInquiryMail(
  values: SupportInquiryFormValues,
  ctx?: SupportInquiryMailContext,
): Promise<'opened' | 'unavailable'> {
  const url = buildSupportInquiryMailtoUrl(values, ctx);
  const can = await Linking.canOpenURL(url);
  if (!can) return 'unavailable';
  await Linking.openURL(url);
  return 'opened';
}
