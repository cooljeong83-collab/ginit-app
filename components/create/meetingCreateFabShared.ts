import type { ViewStyle } from 'react-native';

import { GinitTheme } from '@/constants/ginit-theme';

/** 모임 생성 FAB(에이전트·탭바) 공통 — 버튼 면 크기 */
export const MEETING_CREATE_FAB_BTN_SIZE = 56;
/** 시각·레이아웃은 그대로 두고 터치만 넓힘(모임 목록 행 오탭 완화) */
export const MEETING_CREATE_FAB_HIT_SLOP = { top: 16, bottom: 24, left: 18, right: 18 } as const;
/** 버튼 아래 타원 그림자 슬롯 높이 */
export const MEETING_CREATE_FAB_FLOOR_SHADOW_SLOT = 14;
/** 모임 탭 FlashList — FAB·탭바와 겹치지 않도록 `contentContainerStyle.paddingBottom`에 더함 */
export const MEETING_TAB_LIST_SCROLL_BOTTOM_EXTRA =
  MEETING_CREATE_FAB_BTN_SIZE + MEETING_CREATE_FAB_FLOOR_SHADOW_SLOT + MEETING_CREATE_FAB_RISE_FROM + 16;
/** 아래에서 올라오는 거리 */
export const MEETING_CREATE_FAB_RISE_FROM = 52;

/** 모임 탭 생성 FAB — 탭바 기준 settled 위치를 아래로 내리는 거리(px) */
export const MEETING_TAB_CREATE_FAB_DROP_PX = 16;
/** FAB 터치·Android 네이티브 광고 차단 쉴드 — `GinitTabBar` 터치 존과 동일 */
export const MEETING_TAB_FAB_TOUCH_ZONE_W = 132;
export const MEETING_TAB_FAB_TOUCH_ZONE_H =
  MEETING_CREATE_FAB_BTN_SIZE +
  MEETING_CREATE_FAB_FLOOR_SHADOW_SLOT +
  MEETING_CREATE_FAB_RISE_FROM +
  28;

const MEETING_TAB_FAB_ROW_MIN_HEIGHT = 52 + 8;

/** Android: 탭·리스트·AdMob 네이티브 레이어 위 투명 FAB 터치 쉴드(화면 기준) */
export function getMeetingTabFabTouchShieldScreenStyle(insetsBottom: number): ViewStyle {
  const wrapPad = Math.max(insetsBottom, 10);
  const fabSafeBottom = wrapPad + MEETING_TAB_FAB_ROW_MIN_HEIGHT;
  const bottom = fabSafeBottom - MEETING_CREATE_FAB_RISE_FROM - MEETING_TAB_CREATE_FAB_DROP_PX;
  return {
    position: 'absolute',
    right: 0,
    bottom,
    width: MEETING_TAB_FAB_TOUCH_ZONE_W,
    height: MEETING_TAB_FAB_TOUCH_ZONE_H,
    zIndex: 10000,
    elevation: 10000,
  };
}

/** `GinitTabBar` 모임 생성 FAB — `paddingRight` */
export const MEETING_TAB_CREATE_FAB_PADDING_RIGHT = 18;
/** 알약 펼침 시 버튼 면 최대 너비 (`GinitTabBar` `fabMeetingFaceStyle`) */
export const MEETING_TAB_CREATE_FAB_MAX_FACE_WIDTH = 112;
/** 화면 우측에서 FAB 버튼 면 왼쪽까지(px) */
export const MEETING_TAB_CREATE_FAB_FACE_RESERVE_FROM_SCREEN_RIGHT =
  MEETING_TAB_CREATE_FAB_PADDING_RIGHT + MEETING_TAB_CREATE_FAB_MAX_FACE_WIDTH;
/** 모임 홈 피드 `FlashList` `contentContainerStyle.paddingHorizontal` */
export const MEETING_TAB_HOME_FEED_PADDING_HORIZONTAL = 20;
/** 피드 네이티브 광고 — 행 오른쪽에서 FAB 좌측까지 비클릭 스트립(px) */
export const MEETING_TAB_FEED_NATIVE_AD_CLICK_RESERVE_RIGHT =
  MEETING_TAB_CREATE_FAB_FACE_RESERVE_FROM_SCREEN_RIGHT -
  MEETING_TAB_HOME_FEED_PADDING_HORIZONTAL;
/** FAB 스택(버튼 + 바닥 그림자) 높이 — 말풍선 `bottom` 기준(에이전트 FAB 전용) */
export const MEETING_CREATE_FAB_STACK_H =
  MEETING_CREATE_FAB_BTN_SIZE + MEETING_CREATE_FAB_FLOOR_SHADOW_SLOT + 6;
export const MEETING_CREATE_FAB_SHADOW_BLOB = 14;

export const MEETING_CREATE_FAB_RISE_SPRING = { damping: 18, stiffness: 92 } as const;
export const MEETING_CREATE_FAB_FLOOR_SHADOW_SPRING = { damping: 16, stiffness: 140 } as const;

export const MEETING_CREATE_FAB_LOGO = require('@/assets/images/notification_icon_monochrome.png');

export const MEETING_CREATE_FAB_GRADIENT_COLORS: [string, string, string] = [
  '#311B92',
  GinitTheme.colors.deepPurple,
  '#5E35B1',
];

/** 둥둥 idle — 모임 탭 생성 FAB·생성 화면 에이전트 FAB 동일 (세로·호흡·주기) */
export const MEETING_CREATE_FAB_IDLE_BOB_DURATION_MS = 2100;
export const MEETING_CREATE_FAB_IDLE_BOB_DELAY_MS = 48;
/** translateY += base + (phase - 0.5) * phaseMul, phase ∈ [0,1] */
export const MEETING_CREATE_FAB_IDLE_FLOAT_Y_BASE = -6;
export const MEETING_CREATE_FAB_IDLE_FLOAT_Y_PHASE_MUL = 10;
/** scale *= 1 + (phase - 0.5) * breatheMul */
export const MEETING_CREATE_FAB_IDLE_BREATHE_MUL = 0.065;

/**
 * 바닥 그림자: 위치는 고정, 버튼의 translateY(liftY)만 반영해 크기만 변화.
 * liftY가 클수록(아래·상승 직후 등) 커지고, 작을수록(위로 뜸) 작아짐.
 */
export const MEETING_CREATE_FAB_SHADOW_PULSE_LIFT_MIN =
  MEETING_CREATE_FAB_IDLE_FLOAT_Y_BASE - 0.5 * MEETING_CREATE_FAB_IDLE_FLOAT_Y_PHASE_MUL;
export const MEETING_CREATE_FAB_SHADOW_PULSE_LIFT_MAX = MEETING_CREATE_FAB_RISE_FROM + 4;
export const MEETING_CREATE_FAB_SHADOW_PULSE_MUL_MIN = 0.84;
export const MEETING_CREATE_FAB_SHADOW_PULSE_MUL_MAX = 5.18;

/**
 * 상승 중 translateY가 이 값에서 0으로 스프링할 때 바닥 그림자를 opacity·스케일로 페이드인(자리는 처음부터 유지).
 */
export const MEETING_CREATE_FAB_SHADOW_FADE_IN_FROM_TY = 26;

/** 모임 생성 AI FAB·모임 탭 인트로 — 말풍선 등장 지연(FAB 상승과 겹침) */
export const CREATE_MEETING_AGENT_BUBBLE_START_DELAY_MS = 1200;
/** 말풍선 애니 시작 후 첫 타이핑까지 */
export const CREATE_MEETING_AGENT_TYPING_LAG_AFTER_BUBBLE_MS = 120;
export const CREATE_MEETING_AGENT_TYPING_INTERVAL_MS = 17;
export const CREATE_MEETING_AGENT_TYPING_CARET_BLINK_MS = 520;
/** AI 말풍선 등장·퇴장 — opacity 전용(스프링 대신 타이밍) */
export const CREATE_MEETING_AGENT_BUBBLE_FADE_IN_MS = 260;
export const CREATE_MEETING_AGENT_BUBBLE_FADE_OUT_MS = 220;
