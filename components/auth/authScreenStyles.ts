import { Platform, StyleSheet } from 'react-native';

import { GinitTheme } from '@/constants/ginit-theme';

/** 로그인 / 회원가입 화면 공통 UI (테마·카드·입력·소셜 버튼) */
export const authScreenStyles = StyleSheet.create({
  rootWrap: { flex: 1 },
  /** 로그인·가입: 비즈니스 톤의 밝은 흰 배경 */
  screen: { backgroundColor: '#FFFFFF' },
  flex: { flex: 1 },
  bootCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    gap: 12,
  },
  bootHint: { fontSize: 14, fontWeight: '600', color: GinitTheme.colors.textMuted },
  safe: { flex: 1 },
  scroll: {
    paddingHorizontal: GinitTheme.spacing.xl,
    paddingTop: 18,
    paddingBottom: 34,
    flexGrow: 1,
    gap: 14,
  },

  topBrand: { alignItems: 'center', paddingTop: 10, paddingBottom: 6 },
  brandSymbol: { width: 92, height: 92 },
  brandName: {
    fontSize: 32,
    fontWeight: '900',
    color: GinitTheme.colors.primary,
    letterSpacing: -1.0,
    marginTop: 6,
  },
  greeting: {
    textAlign: 'center',
    marginTop: 10,
    fontSize: 18,
    fontWeight: '900',
    color: GinitTheme.colors.text,
    lineHeight: 24,
  },

  authCard: {
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.08)',
    backgroundColor: '#FFFFFF',
    padding: 18,
    shadowColor: GinitTheme.shadow.card.shadowColor,
    shadowOffset: GinitTheme.shadow.card.shadowOffset,
    shadowOpacity: GinitTheme.shadow.card.shadowOpacity,
    shadowRadius: GinitTheme.shadow.card.shadowRadius,
    elevation: GinitTheme.shadow.card.elevation,
  },
  /** Blur/장식 레이어 위로 입력·버튼이 확실히 포커스·터치를 받도록 */
  authCardContent: {
    position: 'relative',
    zIndex: 1,
  },
  /** Android: expo-blur가 터치/IME를 가로막는 경우가 있어 단색으로 대체 */
  authCardBackdropAndroid: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 255, 255, 0.86)',
  },
  cardGlow: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(134, 211, 183, 0.08)' },
  cardBorder: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.70)',
    pointerEvents: 'none',
  },

  expoGoBannerCompact: {
    borderRadius: 14,
    backgroundColor: 'rgba(255, 248, 230, 0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255, 138, 0, 0.35)',
    padding: 12,
    marginBottom: 12,
    gap: 6,
  },
  expoGoTitle: { fontSize: 14, fontWeight: '900', color: '#9a3412' },
  expoGoBody: { fontSize: 12, fontWeight: '600', color: '#7c2d12', lineHeight: 18 },
  expoGoMono: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontWeight: '800' },

  checkingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  checkingLabel: { fontSize: 13, fontWeight: '700', color: '#475569' },
  memberBadge: { fontSize: 13, fontWeight: '700', color: GinitTheme.trustBlue, marginBottom: 12, lineHeight: 19 },

  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  countryCodeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 48,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.65)',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.10)',
  },
  countryCodeText: { fontSize: 15, fontWeight: '600', color: '#0f172a' },
  countryCodeArrow: { fontSize: 14, fontWeight: '900', color: '#334155', marginTop: -2 },
  phoneInputNew: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.10)',
    backgroundColor: 'rgba(255, 255, 255, 0.65)',
    paddingHorizontal: 14,
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },
  /** 가입 화면 등: 전화번호 고정 표시용 */
  phoneInputReadOnly: {
    backgroundColor: 'rgba(241, 245, 249, 0.98)',
    borderColor: 'rgba(15, 23, 42, 0.08)',
    color: '#64748b',
  },
  countryCodeBtnReadOnly: {
    opacity: 0.92,
  },

  fieldBlock: { marginTop: 12, gap: 6 },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: '#475569' },
  fullWidthInput: {
    alignSelf: 'stretch',
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.10)',
    backgroundColor: 'rgba(255, 255, 255, 0.65)',
    paddingHorizontal: 14,
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },

  /** 성별 필수: MaterialButtonToggleGroup 스타일 2분할 */
  genderBinaryWrap: {
    marginTop: 4,
    alignSelf: 'stretch',
    flexDirection: 'row',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.12)',
    backgroundColor: 'rgba(248, 250, 252, 0.95)',
    padding: 4,
    gap: 4,
  },
  genderBinaryBtn: {
    flex: 1,
    height: 46,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  genderBinaryBtnSelected: {
    // CTA 버튼(프로필 저장 등) 톤에 맞춘 하이라이트(민트 글래스)
    backgroundColor: 'rgba(134, 211, 183, 0.22)',
    borderWidth: 1,
    borderColor: 'rgba(134, 211, 183, 0.55)',
    shadowColor: 'rgba(134, 211, 183, 0.25)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 3,
  },
  genderBinaryBtnIdle: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.06)',
  },
  genderBinaryLabel: { fontSize: 15, fontWeight: '600', color: '#64748b' },
  genderBinaryLabelSelected: { fontSize: 15, fontWeight: '900', color: GinitTheme.colors.primary },

  registerLinkRow: { marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, flexWrap: 'wrap' },
  registerLinkMuted: { fontSize: 13, fontWeight: '600', color: '#64748b' },
  registerLinkAccent: { fontSize: 13, fontWeight: '900', color: GinitTheme.colors.primary },

  /** 가입하기 → 회원가입 화면 이동(인라인 가입과 구분) */
  signupNavHint: { marginTop: 8, fontSize: 12, fontWeight: '600', color: '#94a3b8', textAlign: 'center', lineHeight: 17 },
  signupNavBtn: {
    marginTop: 14,
    alignSelf: 'stretch',
    minHeight: 50,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(31, 42, 68, 0.22)',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  signupNavBtnLabel: { fontSize: 16, fontWeight: '900', color: GinitTheme.colors.primary, letterSpacing: -0.3 },

  /** 회원가입 화면: 정보 입력 후 제출 */
  signUpSubmitBtn: {
    marginTop: 20,
    alignSelf: 'stretch',
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: GinitTheme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  signUpSubmitBtnLabel: { fontSize: 16, fontWeight: '900', color: '#FFFFFF', letterSpacing: -0.3 },
  signUpSubmitHint: {
    marginTop: 10,
    fontSize: 12,
    fontWeight: '600',
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 17,
  },

  /** 하단 구글 섹션 */
  googleSectionTitle: {
    marginTop: 20,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  googleSectionPad: { marginTop: 10, alignSelf: 'stretch' },

  topBar: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.65)',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.10)',
  },
  backBtnText: { fontSize: 20, fontWeight: '900', color: '#0f172a', marginTop: -2 },
  topBarTitle: { fontSize: 17, fontWeight: '900', color: GinitTheme.colors.text },

  footerRule: { height: 1, backgroundColor: 'rgba(148, 163, 184, 0.55)', marginTop: 10 },
  footerCredit: { marginTop: 10, textAlign: 'center', fontSize: 12, fontWeight: '600', color: '#64748b' },

  btnDisabled: { opacity: 0.48 },
  pressed: { opacity: 0.9 },
  errorText: { marginTop: 12, fontSize: 13, fontWeight: '700', color: '#DC2626', lineHeight: 18 },
});
