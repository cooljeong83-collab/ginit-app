import type { GooglePeopleDemographicField } from '@/src/lib/google-sign-in-result';
import { presentAppDialogButtons } from '@/src/lib/app-dialog-present';
import type { SupportInquiryCategoryId, SupportInquiryFormValues } from '@/src/features/support/support-inquiry';

export type SupportInquiryGoogleAuthParams = {
  fromGoogleAuth?: string;
  appUserId?: string;
  dialogTitle?: string;
  dialogBody?: string;
  stillMissing?: string;
};

export function isSupportInquiryFromGoogleAuth(params: SupportInquiryGoogleAuthParams): boolean {
  const v = params.fromGoogleAuth?.trim();
  return v === '1' || v === 'true';
}

function parseStillMissingParam(raw: string | undefined): GooglePeopleDemographicField[] {
  const s = raw?.trim();
  if (!s) return [];
  return s
    .split(',')
    .map((x) => x.trim())
    .filter((x): x is GooglePeopleDemographicField => x === 'gender' || x === 'birth');
}

export function encodeStillMissingParam(
  fields: readonly GooglePeopleDemographicField[],
): string {
  return fields.join(',');
}

/** Google 인증·동의 거부 안내 팝업 → 문의하기 진입 시 폼 초기값 */
export function supportInquiryPrefillFromGoogleAuth(
  params: SupportInquiryGoogleAuthParams,
): Partial<SupportInquiryFormValues> {
  if (!isSupportInquiryFromGoogleAuth(params)) return {};

  const title = params.dialogTitle?.trim() || 'Google 인증 관련 문의';
  const dialogBody = params.dialogBody?.trim() || '';
  const missing = parseStillMissingParam(params.stillMissing);
  const missingLabel =
    missing.length === 2
      ? '성별·생년월일'
      : missing.includes('gender')
        ? '성별'
        : missing.includes('birth')
          ? '생년월일'
          : null;

  const bodyLines = [
    'Google 계정 연동(성별·생년월일)과 관련해 문의드립니다.',
  ];
  if (missingLabel) bodyLines.push(`받지 못한 항목: ${missingLabel}`);
  if (dialogBody) bodyLines.push('', '--- 안내 내용 ---', dialogBody);
  bodyLines.push('', '문의 내용:');

  return {
    categoryId: 'account' as SupportInquiryCategoryId,
    title,
    body: bodyLines.join('\n'),
  };
}

export type GooglePeopleDemographicsSupportDialogRouter = {
  push: (href: string | { pathname: string; params?: Record<string, string> }) => void;
};

/** Google 인증 진행 어려움 안내 — 1:1 문의하기로 연결 */
export function presentGooglePeopleDemographicsSupportDialog(
  router: GooglePeopleDemographicsSupportDialogRouter,
  opts: {
    appUserId: string;
    title: string;
    body: string;
    stillMissing?: readonly GooglePeopleDemographicField[];
  },
): void {
  const pk = opts.appUserId.trim();
  const stillMissing = opts.stillMissing ?? [];

  presentAppDialogButtons({
    title: opts.title,
    body: opts.body,
    buttons: [
      { label: '닫기', variant: 'secondary' },
      {
        label: '1:1 문의하기',
        variant: 'primary',
        onPress: () => {
          router.push({
            pathname: '/support/inquiry',
            params: {
              fromGoogleAuth: '1',
              appUserId: pk,
              dialogTitle: opts.title,
              dialogBody: opts.body,
              stillMissing: encodeStillMissingParam(stillMissing),
            },
          });
        },
      },
    ],
  });
}
