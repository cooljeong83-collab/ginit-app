export type OnboardingSceneKind =
  | 'lifecycle'
  | 'agent'
  | 'schedulePlace'
  | 'connect'
  | 'receipt'
  | 'shareReview';

export type OnboardingSlide = {
  id: string;
  title: string;
  body: string;
  sceneKind: OnboardingSceneKind;
  /** 1번 슬라이드만 로고 병행 */
  showLogo?: boolean;
  /** 선택 서브카피 (1장 Gather+Init 힌트) */
  subtitle?: string;
  lottieAsset: number | null;
  accessibilitySummary: string;
};

/** Lottie JSON — 디자이너 납품 시 교체 */
const LOTTIE = {
  slide01: require('@/assets/lottie/onboarding/slide-01-lifecycle.json'),
  slide02: require('@/assets/lottie/onboarding/slide-02-agent.json'),
  slide03: require('@/assets/lottie/onboarding/slide-03-schedule-place.json'),
  slide04: require('@/assets/lottie/onboarding/slide-04-connect.json'),
  slide05: require('@/assets/lottie/onboarding/slide-05-receipt.json'),
  slide06: require('@/assets/lottie/onboarding/slide-06-share.json'),
} as const;

export const ONBOARDING_SLIDES: readonly OnboardingSlide[] = [
  {
    id: '1',
    title: '모임의 시작과 끝, 지닛',
    subtitle: 'Gather + Init = 지닛',
    body: '생성 → 만남 → 정산 → 후기까지,\n모임 전 과정을 한곳에서.',
    sceneKind: 'lifecycle',
    showLogo: true,
    lottieAsset: LOTTIE.slide01,
    accessibilitySummary:
      '모임의 시작과 끝, 지닛. 생성부터 만남, 정산, 후기까지 모임 전 과정을 한곳에서 준비합니다.',
  },
  {
    id: '2',
    title: '말하면 모임이 잡혀요',
    body: 'AI 에이전트와 대화만으로\n이름·일정·장소 초안이 채워집니다.',
    sceneKind: 'agent',
    lottieAsset: LOTTIE.slide02,
    accessibilitySummary:
      '말하면 모임이 잡혀요. AI 에이전트와 대화만으로 이름, 일정, 장소 초안이 채워집니다.',
  },
  {
    id: '3',
    title: '일정·장소는 지닛이 제안',
    body: '비슷한 관심사로 모이고, 투표·습관 기반으로\n장소를 추천해요.',
    sceneKind: 'schedulePlace',
    lottieAsset: LOTTIE.slide03,
    accessibilitySummary:
      '일정·장소는 지닛이 제안. 비슷한 관심사로 모이고 투표와 습관 기반으로 장소를 추천합니다.',
  },
  {
    id: '4',
    title: '온·오프라인이 이어지는 소통',
    body: '모임 채팅, 친구 연결, 지도에서\n주변 모임까지 이어집니다.',
    sceneKind: 'connect',
    lottieAsset: LOTTIE.slide04,
    accessibilitySummary:
      '온·오프라인이 이어지는 소통. 모임 채팅, 친구 연결, 지도에서 주변 모임까지 이어집니다.',
  },
  {
    id: '5',
    title: '영수증만 올리면 자동 정산',
    body: '촬영·AI 분석으로 금액을 나누고\n정산까지 마무리해요.',
    sceneKind: 'receipt',
    lottieAsset: LOTTIE.slide05,
    accessibilitySummary:
      '영수증만 올리면 자동 정산. 촬영과 AI 분석으로 금액을 나누고 정산까지 마무리합니다.',
  },
  {
    id: '6',
    title: '후기로 나누고, 링크로 초대',
    body: '모임 결과를 피드에 공유하고,\n앱 없이 웹에서도 참여할 수 있어요.',
    sceneKind: 'shareReview',
    lottieAsset: LOTTIE.slide06,
    accessibilitySummary:
      '후기로 나누고, 링크로 초대. 모임 결과를 피드에 공유하고 앱 없이 웹에서도 참여할 수 있습니다.',
  },
] as const;

export function getOnboardingSlideIndex(slideId: string): number {
  const idx = ONBOARDING_SLIDES.findIndex((s) => s.id === slideId);
  return idx >= 0 ? idx : 0;
}
