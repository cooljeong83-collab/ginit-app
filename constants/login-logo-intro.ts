/**
 * 스플래시 부트 화면(`SplashBootstrapScreen`) 로고 프레임.
 * Android: 시스템 스플래시는 `@mipmap/ic_launcher`(Adaptive) + 부트는 `icon.png`(Expo `icon`과 동일).
 * RN StyleSheet 수치는 논리 픽셀(dp)과 동일 스케일로 취급합니다.
 */
export const SPLASH_LOGO_FRAME_PX = 160;

/** 프레임 안 로고 비트맵(contentFit: contain) — 시스템과 비슷한 채움 비율(~90%) */
export const SPLASH_LOGO_IMAGE_PX = 144;

/** 로그인 히어로 목표 로고 크기 — 비율 유지(contentFit: contain) */
export const LOGIN_LOGO_IMAGE_PX = 152;

/** 스플래시 → 로그인 로고 이동·스케일 */
export const LOGIN_LOGO_INTRO_MS = 700;
