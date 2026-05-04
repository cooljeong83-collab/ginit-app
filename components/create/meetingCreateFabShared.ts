import { GinitTheme } from '@/constants/ginit-theme';

/** 모임 생성 FAB(에이전트·탭바) 공통 — 버튼 면 크기 */
export const MEETING_CREATE_FAB_BTN_SIZE = 56;
/** 시각·레이아웃은 그대로 두고 터치만 넓힘(모임 목록 행 오탭 완화) */
export const MEETING_CREATE_FAB_HIT_SLOP = { top: 16, bottom: 24, left: 18, right: 18 } as const;
/** 버튼 아래 타원 그림자 슬롯 높이 */
export const MEETING_CREATE_FAB_FLOOR_SHADOW_SLOT = 14;
/** 아래에서 올라오는 거리 */
export const MEETING_CREATE_FAB_RISE_FROM = 52;
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
