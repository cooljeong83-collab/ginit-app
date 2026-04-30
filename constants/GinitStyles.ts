import { Platform, StyleSheet } from 'react-native';

import { GinitTheme } from '@/constants/ginit-theme';

/** 공통 — TextInput `placeholderTextColor` */
export const GinitPlaceholderColor = GinitTheme.glassModal.placeholder;

/**
 * 앱 전역 글래스모피즘·타이포·주요 버튼 스타일.
 * 화면 파일의 `StyleSheet` 중복을 줄이기 위해 `장소검색` / `모임등록` / `공통` 단위로 주석을 달았습니다.
 */
export const GinitStyles = StyleSheet.create({
  // 장소검색/모임등록 - 스크린 루트(그라데이션 아래 기본 배경)
  screenRoot: {
    flex: 1,
    backgroundColor: GinitTheme.colors.bg,
  },

  // 장소검색/모임등록 - 네이티브 블러 위 반투명 흰색 베일
  frostVeil: {
    backgroundColor: GinitTheme.glassModal.veil,
  },

  // 장소검색/모임등록 - 웹에서 블러 대체 밝은 베일
  webVeil: {
    backgroundColor: 'rgba(255, 255, 255, 0.88)',
  },

  // 공통/장소검색/모임등록 - 밝은 투명 글래스 카드(컨테이너·패널)
  glassCard: {
    borderRadius: GinitTheme.radius.card,
    backgroundColor: GinitTheme.colors.surface,
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
    padding: GinitTheme.spacing.md,
    shadowColor: GinitTheme.shadow.card.shadowColor,
    shadowOffset: GinitTheme.shadow.card.shadowOffset,
    shadowOpacity: GinitTheme.shadow.card.shadowOpacity,
    shadowRadius: GinitTheme.shadow.card.shadowRadius,
    elevation: GinitTheme.shadow.card.elevation,
  },

  // 모임등록상세 - 베이스 카드 셸(GinitCard, padding 없음 — 선택/다크와 무관 항상 밝음)
  fixedGlassCard: {
    borderRadius: GinitTheme.radius.card,
    backgroundColor: GinitTheme.fixedGlassCard.fill,
    borderWidth: 1,
    borderColor: GinitTheme.fixedGlassCard.border,
    overflow: 'hidden',
    shadowColor: 'rgba(15, 23, 42, 0.10)',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 10,
  },

  // 모임등록상세 - 폼 본문 텍스트 색 고정(가독성)
  detailFormText: {
    color: '#1A1A1A',
  },

  // 공통 - 세로 플렉스 채우기
  flexFill: {
    flex: 1,
  },

  // 장소검색 - SafeArea 내부 좌우 16 패딩
  safeAreaPadded: {
    flex: 1,
    paddingHorizontal: 16,
  },

  // 모임등록 - SafeArea(패딩은 스크롤·탑바에서 처리)
  safeAreaPlain: {
    flex: 1,
  },

  // 장소검색 - 상단 바 행
  topBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },

  // 모임등록 - 상단 바 행(좌우 패딩 포함)
  topBarRowPadded: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },

  // 장소검색/모임등록 - 뒤로/닫기 링크
  backLink: {
    fontSize: 16,
    fontWeight: '700',
    color: GinitTheme.colors.primary,
  },

  // 장소검색 - 화면 제목(장소 검색)
  screenTitleLarge: {
    fontSize: 18,
    fontWeight: '900',
    color: GinitTheme.colors.text,
    letterSpacing: -0.3,
  },

  // 모임등록 - 화면 제목(모임 만들기 / 상세 입력)
  screenTitle: {
    fontSize: 17,
    fontWeight: '900',
    color: GinitTheme.colors.text,
    letterSpacing: -0.2,
  },

  // 모임등록 - 상단 스텝 뱃지(1/2)
  stepBadge: {
    fontSize: 13,
    fontWeight: '700',
    color: GinitTheme.colors.textMuted,
  },

  // 장소검색 - 검색어 + 검색 버튼 한 줄
  searchRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },

  // 장소검색/모임등록상세 - 글래스 입력 필드 기본
  glassInput: {
    borderRadius: GinitTheme.radius.button,
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
    backgroundColor: GinitTheme.colors.surface,
    paddingHorizontal: GinitTheme.spacing.md,
    paddingVertical: 12,
    fontSize: 16,
    color: GinitTheme.colors.textSub,
    fontWeight: '600',
    shadowColor: 'rgba(15, 23, 42, 0.08)',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.14,
    shadowRadius: 18,
    elevation: 8,
  },

  // 장소검색 - 검색창만 가로 확장
  glassInputFlex: {
    flex: 1,
  },

  // 장소검색/모임등록상세 - 입력 포커스(Trust Blue)
  glassInputFocused: {
    borderColor: GinitTheme.colors.accent,
    shadowColor: GinitTheme.colors.accent,
    shadowOpacity: 0.22,
    shadowRadius: 10,
    elevation: 3,
  },

  // 모임등록상세 - 멀티라인 입력 최소 높이
  glassInputMultiline: {
    minHeight: 120,
  },

  // 모임등록상세 - 반쪽 너비(날짜/시간)
  glassInputHalf: {
    flex: 1,
  },

  // 장소검색 - Trust Blue 주요 버튼(검색)
  primaryButton: {
    borderRadius: GinitTheme.radius.button,
    backgroundColor: 'transparent',
    overflow: 'hidden',
    paddingHorizontal: 18,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.72)',
    shadowColor: GinitTheme.glass.shadow,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 1,
    shadowRadius: 18,
    elevation: 8,
  },

  // 장소검색/모임등록 - 주요 버튼 라벨(흰색)
  primaryButtonLabel: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 15,
  },

  // 장소검색/모임등록 - CTA 오렌지 버튼 본체
  ctaButton: {
    borderRadius: GinitTheme.radius.button,
    backgroundColor: 'transparent',
    overflow: 'hidden',
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.72)',
    shadowColor: GinitTheme.glass.shadow,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 1,
    shadowRadius: 22,
    elevation: 10,
  },

  // 장소검색 - 하단 확인 버튼 여백
  ctaButtonIsland: {
    marginTop: 8,
    marginBottom: 8,
  },

  // 모임등록 - 카드 안 CTA 상단 여백
  ctaButtonStacked: {
    marginTop: 8,
  },

  // 장소검색/모임등록 - CTA 비활성
  ctaButtonDisabled: {
    opacity: 0.38,
  },

  // 장소검색/모임등록 - CTA 프레스
  ctaButtonPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.99 }],
  },

  // 모임등록 - 다음 단계 CTA(조금 다른 그림자)
  ctaButtonWideShadow: {
    marginTop: 8,
    borderRadius: GinitTheme.radius.button,
    backgroundColor: 'transparent',
    overflow: 'hidden',
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.72)',
    shadowColor: GinitTheme.glass.shadow,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 1,
    shadowRadius: 22,
    elevation: 10,
  },

  // 공통 - 버튼 그라데이션 BG (absolute)
  buttonGradientBg: {
    ...StyleSheet.absoluteFillObject,
  },

  ctaButtonWideDisabled: {
    opacity: 0.45,
  },

  ctaButtonWidePressed: {
    opacity: 0.92,
    transform: [{ scale: 0.99 }],
  },

  // 장소검색/모임등록 - CTA 라벨
  ctaButtonLabel: {
    fontSize: 17,
    fontWeight: '800',
    color: '#FFFFFF',
  },

  // 공통 - 본문 강조 텍스트(#1A1A1A)
  mainText: {
    color: '#1A1A1A',
  },

  // 공통 - 보조 본문(#333)
  subText: {
    color: '#333333',
  },

  // 공통 - 부가 설명·뱃지
  mutedText: {
    fontSize: 14,
    color: GinitTheme.glassModal.textMuted,
    fontWeight: '600',
  },

  // 모임등록 - 본문 보조 문단(여백 포함)
  mutedBlock: {
    fontSize: 14,
    color: GinitTheme.glassModal.textMuted,
    fontWeight: '600',
    lineHeight: 20,
    marginBottom: 8,
  },

  // 장소검색/모임등록 - 로딩·안내 한 줄
  rowCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },

  // 모임등록 - 로딩·안내(여백 포함)
  centerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },

  // 장소검색 - 에러 배너
  errorBanner: {
    padding: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: 'rgba(220, 38, 38, 0.28)',
    marginBottom: 8,
  },

  // 장소검색 - 에러 문구
  errorBannerText: {
    color: '#B91C1C',
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },

  // 모임등록 - 폼 검증 에러 한 줄
  formErrorText: {
    marginTop: 8,
    marginBottom: 10,
    fontSize: 14,
    fontWeight: '600',
    color: '#DC2626',
  },

  // 장소검색 - 결과 리스트 영역
  listWrap: {
    flex: 1,
    minHeight: 120,
  },

  // 장소검색 - FlatList 콘텐츠 간격
  listContent: {
    paddingBottom: 12,
    gap: 10,
  },

  // 장소검색 - 행+지도 래퍼
  itemWrap: {
    flexShrink: 0,
  },

  // 장소검색 - 인라인 지도 슬롯
  inlineMapSlot: {
    marginTop: 8,
    width: '100%',
    flexShrink: 0,
    overflow: 'hidden',
  },

  // 장소검색 - 결과 행 글래스 카드
  glassListRowWrap: {
    borderRadius: 15,
    backgroundColor: Platform.OS === 'android' ? '#FFFFFF' : 'transparent',
    shadowColor: GinitTheme.glass.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 10,
    elevation: 2,
  },
  glassListRow: {
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 15,
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
    overflow: 'hidden',
  },

  // 장소검색 - 선택된 결과 행
  glassListRowSelected: {
    borderColor: GinitTheme.colors.accent,
    backgroundColor: GinitTheme.colors.primarySoft,
    shadowColor: GinitTheme.colors.accent,
    shadowOpacity: 0.18,
  },

  listRowInner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },

  listTextCol: {
    flex: 1,
    minWidth: 0,
  },

  listTrailCol: {
    width: 36,
    alignItems: 'flex-end',
    paddingTop: 2,
  },

  checkPlaceholder: {
    width: 28,
    height: 28,
  },

  // 장소검색 - 선택 체크 원형
  checkBubble: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: 'rgba(148, 163, 184, 0.6)',
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  checkBubbleDone: {
    borderColor: GinitTheme.colors.primary,
    backgroundColor: 'rgba(31, 42, 68, 0.14)',
  },

  checkMark: {
    fontSize: 15,
    fontWeight: '900',
    color: GinitTheme.colors.primary,
    marginTop: -1,
  },

  // 장소검색 - 장소명
  listItemTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1A1A1A',
    marginBottom: 4,
  },

  // 장소검색 - 주소
  listItemAddress: {
    fontSize: 13,
    color: '#333333',
    lineHeight: 18,
    fontWeight: '600',
  },

  // 장소검색 - 카테고리
  listItemCategory: {
    marginTop: 6,
    fontSize: 11,
    fontWeight: '700',
    color: GinitTheme.glassModal.textMuted,
  },

  // 모임등록 - 스크롤 콘텐츠 패딩
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 36,
  },

  // 모임등록 - 히어로 제목
  heroTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: GinitTheme.trustBlue,
    marginBottom: 16,
    letterSpacing: -0.5,
  },

  // 모임등록 - 섹션 라벨
  sectionLabel: {
    fontSize: 14,
    fontWeight: '900',
    color: '#1A1A1A',
    marginBottom: 10,
  },

  privacyLabelSpacer: {
    marginTop: 8,
  },

  templateRow: {
    gap: 10,
    paddingVertical: 4,
    marginBottom: 18,
  },

  // 모임등록 - AI 템플릿 칩
  glassChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 15,
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    shadowColor: 'rgba(15, 23, 42, 0.06)',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 2,
  },

  glassChipText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#333333',
  },

  gridOuter: {
    position: 'relative',
    marginBottom: 8,
  },

  gridWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 14,
  },

  // 모임등록 - 카테고리 그리드 카드
  glassGridCard: {
    width: '48%',
    aspectRatio: 1,
    borderRadius: 15,
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
    shadowColor: 'rgba(15, 23, 42, 0.06)',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 3,
    position: 'relative',
    overflow: 'visible',
  },

  glassGridCardActive: {
    borderColor: GinitTheme.colors.accent,
    backgroundColor: GinitTheme.colors.primarySoft,
  },

  gridEmoji: {
    fontSize: 34,
    marginBottom: 8,
  },

  gridLabel: {
    fontSize: 15,
    fontWeight: '800',
    color: GinitTheme.colors.text,
  },

  // 모임등록 - 마스코트 플로팅 박스
  glassMascotFloat: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 48,
    height: 48,
    borderRadius: 15,
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: 'rgba(15, 23, 42, 0.06)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 2,
  },

  mascotEmoji: {
    fontSize: 22,
  },

  privacyCardSpacer: {
    marginBottom: 16,
  },

  // 모임등록 - 공개/비공개 세그먼트 트랙
  glassSegment: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderRadius: 15,
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    minHeight: 88,
    position: 'relative',
    shadowColor: 'rgba(15, 23, 42, 0.06)',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 2,
  },

  segmentSide: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 10,
    justifyContent: 'center',
    gap: 4,
  },

  segmentSideActivePrivate: {
    backgroundColor: 'rgba(31, 42, 68, 0.10)',
  },

  segmentSideActivePublic: {
    backgroundColor: 'rgba(134, 211, 183, 0.16)',
  },

  segmentTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#333333',
  },

  segmentTitleOn: {
    color: '#1A1A1A',
  },

  segmentSub: {
    fontSize: 11,
    fontWeight: '600',
    color: '#666666',
    lineHeight: 14,
  },

  segmentKnobWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
  },

  segmentKnob: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.45)',
    shadowColor: 'rgba(15, 23, 42, 0.08)',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.14,
    shadowRadius: 8,
    elevation: 4,
    position: 'absolute',
    top: 18,
  },

  // 모임등록상세 - 스텝2 제목
  step2Title: {
    fontSize: 22,
    fontWeight: '900',
    color: '#1A1A1A',
    marginBottom: 14,
    letterSpacing: -0.4,
  },

  cardSpacer: {
    marginTop: 4,
  },

  // 모임등록상세 - 필드 라벨
  fieldLabel: {
    fontSize: 13,
    fontWeight: '900',
    color: '#1A1A1A',
    marginBottom: 8,
  },

  fieldLabelSpaced: {
    marginTop: 4,
  },

  row2: {
    flexDirection: 'row',
    gap: 10,
  },

  hintSmall: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: '600',
    color: '#1A1A1A',
  },

  // 모임등록상세 - 요약 박스
  glassSummary: {
    marginTop: 12,
    padding: 12,
    borderRadius: 15,
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    gap: 4,
    marginBottom: 4,
    shadowColor: 'rgba(15, 23, 42, 0.05)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 1,
  },

  summaryLine: {
    fontSize: 13,
    fontWeight: '800',
    color: '#1A1A1A',
  },

  inputPressable: {
    justifyContent: 'center',
  },

  inputPressableLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#1A1A1A',
    marginBottom: 4,
  },

  inputPressableValue: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1A1A1A',
  },

  // 모임등록상세 - 장소 선택 박스
  glassPlaceBox: {
    borderRadius: 15,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
    paddingHorizontal: 14,
    paddingVertical: 14,
    shadowColor: 'rgba(15, 23, 42, 0.06)',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 2,
  },

  placeTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1A1A1A',
  },

  // 모임등록상세 - 장소 미선택 시 타이틀 보조(색은 detailFormText·placeTitle로 통일)
  placePlaceholder: {
    fontWeight: '600',
    opacity: 0.82,
  },

  placeAddr: {
    marginTop: 6,
    fontSize: 13,
    color: '#1A1A1A',
    lineHeight: 18,
    fontWeight: '600',
  },

  // 모임등록상세 - 지도 래퍼
  glassMapWrap: {
    marginTop: 12,
    marginBottom: 4,
    width: '100%',
    height: 180,
    alignSelf: 'stretch',
    flexShrink: 0,
    zIndex: 0,
    borderRadius: 15,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
    shadowColor: 'rgba(15, 23, 42, 0.06)',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 3,
  },

  // 모임등록 - 경고 박스(카테고리 로드 실패)
  warnBox: {
    marginBottom: 12,
    padding: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(244, 200, 74, 0.18)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(244, 200, 74, 0.55)',
  },

  warnTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: GinitTheme.colors.primary,
    marginBottom: 4,
  },

  warnBody: {
    fontSize: 13,
    color: GinitTheme.colors.textSub,
    lineHeight: 18,
  },

  // 모임등록 - iOS 모달 루트
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },

  // 모임등록 - 모달 딤
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: GinitTheme.glass.overlayDark,
  },

  modalSheet: {
    backgroundColor: GinitTheme.colors.surfaceStrong,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingBottom: 24,
    paddingHorizontal: 12,
  },

  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(15, 23, 42, 0.08)',
    marginBottom: 8,
  },

  modalTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: GinitTheme.colors.text,
  },

  modalCancel: {
    fontSize: 16,
    fontWeight: '600',
    color: GinitTheme.colors.textMuted,
  },

  modalDone: {
    fontSize: 16,
    fontWeight: '800',
    color: GinitTheme.colors.primary,
  },

  spinner: {
    marginTop: 12,
  },
});
