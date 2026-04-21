import { StyleSheet } from 'react-native';

import { GinitTheme } from '@/constants/ginit-theme';

/** 회원가입·로그인 화면 공통 — 전화번호 인라인 OTP UI */
export const phoneOtpInlineStyles = StyleSheet.create({
  sendInlineBtn: {
    height: 48,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(31, 42, 68, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(31, 42, 68, 0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendInlineBtnDisabled: { opacity: 0.4 },
  sendInlineText: { fontSize: 13, fontWeight: '900', color: GinitTheme.colors.primary },
  verifiedBadge: {
    marginTop: 8,
    alignSelf: 'stretch',
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '900',
    color: GinitTheme.colors.success,
  },
  otpRow: { marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  otpInput: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.10)',
    backgroundColor: 'rgba(255, 255, 255, 0.65)',
    paddingHorizontal: 12,
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  confirmBtn: {
    height: 48,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: GinitTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnDisabled: { opacity: 0.35 },
  confirmText: { fontSize: 14, fontWeight: '900', color: '#fff' },
  otpError: { marginTop: 8, fontSize: 12, fontWeight: '700', color: GinitTheme.colors.danger },
});
