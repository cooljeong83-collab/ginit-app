/**
 * Ginit 디자인 시스템 토큰 (Linear GIN-8)
 * 2026-04 리디자인: 시안(“Warm & Human Gathering”) 톤으로 팔레트/타이포/라운드 규격을 확장합니다.
 *
 * 기존 키(`themeMainColor`, `pointOrange`)는 레거시 호환을 위해 유지하되,
 * 신규 화면/컴포넌트는 `colors/*` 토큰을 우선 사용합니다.
 */
export const GinitTheme = {
  /** Legacy: 기존 코드 호환용(점진적 마이그레이션) */
  themeMainColor: '#673AB7',
  /** Legacy: 기존 코드 호환용(점진적 마이그레이션) */
  pointOrange: '#ff7b00',

  /** New: 시안 톤 컬러 토큰 */
  colors: {
    // surfaces
    bg: '#FFFFFF',
    bgAlt: '#FFFFFF',
    surface: 'rgba(255, 255, 255)',
    surfaceStrong: '#FFFFFF',
    border: 'rgba(103, 58, 183, 0.1)',
    borderStrong: 'rgb(19, 58, 148)',

    // text
    text: '#0F172A',
    texWhite: '#FFFFFF',
    texBlack: '#000000',
    textSub: '#334155',
    textSubGray: '#686774',
    textMuted: '#64748B',
    textOnDark: '#F8FAFC',

    // brand / actions
    primary: '#673AB7',
    /** Material Deep Purple 800 — 진한 보라 배경(밝은 텍스트 버튼 등) */
    deepPurple: '#4527A0',
    primarySoft: 'rgba(103, 58, 183, 0.1)',
    accent: '#86D3B7',
    accent2: '#F4C84A',
    warning: '#F59E0B',
    danger: '#DC2626',
    success: '#22C55E',
    /** 모임 목록 등 성별 심볼 — 동성 모집(남만/여만) 단독 아이콘 색 (남녀 반반 쌍은 primary·textSub 유지) */
    genderSymbolMale: '#2563EB',
    genderSymbolFemale: '#DB2777',

    // gradients
    // 모임 생성 CTA(네이비 톤) — 선택/완료 포인트와 동일 계열로 맞춤
    brandGradient: ['#673AB7', '#2B3A62'] as const,
    ctaGradient: ['#673AB7', '#2B3A62'] as const,
  },

  /** New: 타이포 스케일(플랫폼 기본 폰트 기반) */
  typography: {
    h1: { fontSize: 30, fontWeight: '600' as const, letterSpacing: -0.8 },
    h2: { fontSize: 22, fontWeight: '600' as const, letterSpacing: -0.4 },
    title: { fontSize: 18, fontWeight: '600' as const, letterSpacing: -0.2 },
    body: { fontSize: 15, fontWeight: '700' as const },
    sub: { fontSize: 13, fontWeight: '600' as const },
    caption: { fontSize: 12, fontWeight: '600' as const },
    chip: { fontSize: 11, fontWeight: '800' as const },
  },

  /** New: 스페이싱(8pt grid) */
  spacing: {
    xs: 6,
    sm: 10,
    md: 14,
    lg: 18,
    xl: 24,
  },

  /** New: 섀도 규격 */
  shadow: {
    card: {
      shadowColor: 'rgba(15, 23, 42, 0.14)',
      shadowOffset: { width: 0, height: 18 },
      shadowOpacity: 1,
      shadowRadius: 28,
      elevation: 14,
    },
    float: {
      shadowColor: 'rgba(15, 23, 42, 0.20)',
      shadowOffset: { width: 0, height: 22 },
      shadowOpacity: 1,
      shadowRadius: 34,
      elevation: 18,
    },
  },
  blur: {
    /** 카드·버튼 글래스 블러 강도 (expo-blur intensity) */
    intensity: 48,
    /** 카드용 약간 더 강한 블러 */
    intensityStrong: 64,
  },
  radius: {
    card: 22,
    button: 16,
    pill: 999,
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
    textPrimary: '#0F172A',
    textSecondary: '#334155',
    textMuted: '#64748B',
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
