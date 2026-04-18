/**
 * Ginit 디자인 시스템 토큰 (Linear GIN-8)
 * Trust Blue를 메인 포인트로 사용합니다.
 */
export const GinitTheme = {
  trustBlue: '#0052CC',
  pointOrange: '#FF8A00',
  blur: {
    /** 카드·버튼 글래스 블러 강도 (expo-blur intensity) */
    intensity: 48,
    /** 카드용 약간 더 강한 블러 */
    intensityStrong: 64,
  },
  radius: {
    card: 20,
    button: 14,
  },
  glass: {
    overlayLight: 'rgba(255, 255, 255, 0.22)',
    overlayDark: 'rgba(20, 24, 32, 0.45)',
    borderLight: 'rgba(255, 255, 255, 0.42)',
    borderDark: 'rgba(255, 255, 255, 0.14)',
    shadow: 'rgba(0, 0, 0, 0.12)',
  },
  /**
   * 장소 검색(`/create/details`·`/place-search`)과 모임 등록 상세 입력 — 밝은 글래스 모달 공통 토큰
   * (backdrop-filter 는 RN에서 `expo-blur` BlurView + 반투명 흰색 Veil 로 근사)
   */
  glassModal: {
    textPrimary: '#1A1A1A',
    textSecondary: '#333333',
    textMuted: '#5C6570',
    /** TextInput placeholder — 밝은 박스 위 연한 회색 */
    placeholder: '#A3A3A3',
    veil: 'rgba(255, 255, 255, 0.58)',
    inputFill: 'rgba(255, 255, 255, 0.7)',
    inputBorder: 'rgba(255, 255, 255, 0.35)',
    listCardFill: 'rgba(255, 255, 255, 0.7)',
    blurIntensity: 32,
  },
  /**
   * 모임 등록 상세 입력 베이스 카드 — 카테고리 선택 여부·시스템 다크와 무관하게 항상 밝은 표면
   * (`GinitStyles.fixedGlassCard`에서 참조)
   */
  fixedGlassCard: {
    fill: 'rgba(255, 255, 255, 0.7)',
    border: 'rgba(255, 255, 255, 0.3)',
  },
} as const;
