import { Easing } from 'react-native-reanimated';

export const ONBOARDING_SLIDE_COUNT = 6;

/** 슬라이드 전환 opacity 보간 */
export const ONBOARDING_SLIDE_OPACITY_INACTIVE = 0.38;
export const ONBOARDING_SLIDE_OPACITY_ACTIVE = 1;
export const ONBOARDING_SLIDE_SCALE_INACTIVE = 0.92;
export const ONBOARDING_SLIDE_SCALE_ACTIVE = 1;

/** 활성 도트 width */
export const ONBOARDING_DOT_IDLE_W = 8;
export const ONBOARDING_DOT_ACTIVE_W = 22;
export const ONBOARDING_DOT_H = 8;

export const ONBOARDING_HERO_SIZE = 280;

export const ONBOARDING_SPRING_DOT = { damping: 18, stiffness: 220 } as const;

export const ONBOARDING_FADE_MS = 280;
export const ONBOARDING_FADE_EASE = Easing.out(Easing.quad);

export const ONBOARDING_STAGGER_MS = 90;
