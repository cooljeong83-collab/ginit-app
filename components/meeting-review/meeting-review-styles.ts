import { StyleSheet } from 'react-native';

import { GinitTheme } from '@/constants/ginit-theme';

/** 정산 화면(`app/settlement`)과 동일한 심플 플랫 토큰 */
export const meetingReviewStyles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: GinitTheme.colors.bg,
  },
  scrollContent: {
    paddingBottom: 24,
    flexGrow: 1,
  },
  formBlock: {
    paddingHorizontal: 20,
    paddingTop: 4,
    gap: 10,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: GinitTheme.colors.textSub,
  },
  sectionHint: {
    fontSize: 12,
    fontWeight: '600',
    color: GinitTheme.colors.textMuted,
    lineHeight: 17,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: GinitTheme.colors.border,
    marginVertical: 12,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GinitTheme.colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: GinitTheme.colors.text,
    backgroundColor: GinitTheme.colors.bg,
    minHeight: 88,
    textAlignVertical: 'top',
    lineHeight: 22,
  },
  primaryBtn: {
    backgroundColor: GinitTheme.colors.primary,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryBtnDisabled: {
    opacity: 0.45,
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  /** 후기 써머리 — 이 장소로 모임 만들기 CTA */
  createMeetingAtPlaceBtn: {
    backgroundColor: GinitTheme.colors.deepPurple,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  createMeetingAtPlaceBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  muted: {
    fontSize: 14,
    color: GinitTheme.colors.textMuted,
    lineHeight: 20,
  },
  emptyHint: {
    fontSize: 13,
    fontWeight: '600',
    color: GinitTheme.colors.textMuted,
    paddingVertical: 6,
  },
});
