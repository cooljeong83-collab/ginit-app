/**
 * 홈 피드와 동일한 글래스·칩·말풍선 토큰 (채팅/프로필 참가 모임 UI에서 공유)
 */
import { Platform, StyleSheet } from 'react-native';

import { GinitTheme } from '@/constants/ginit-theme';

export const HomeGlassStyles = StyleSheet.create({
  /** 홈 상단 그라데이션과 동일 */
  screenGradient: {
    flex: 1,
  },
  scrollPad: {
    paddingHorizontal: 20,
    paddingBottom: 28,
  },
  sectionLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 12,
    textShadowColor: 'rgba(255, 255, 255, 0.65)',
    textShadowOffset: { width: 0, height: 0.5 },
    textShadowRadius: 2,
  },
  /** 카테고리 칩과 동일 계열 — 미니 카드 래퍼 */
  miniCardOuter: {
    borderRadius: 22,
    overflow: 'hidden',
    width: 152,
    minHeight: 108,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.55)',
    shadowColor: 'rgba(15, 23, 42, 0.55)',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 18,
    elevation: 5,
  },
  miniCardBlurWrap: {
    ...StyleSheet.absoluteFillObject,
  },
  miniCardVeil: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 255, 255, 0.52)',
  },
  miniCardInnerBorder: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.45)',
  },
  miniCardBody: {
    padding: 10,
    gap: 6,
    justifyContent: 'flex-end',
    minHeight: 108,
  },
  miniThumb: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.35,
  },
  miniTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0b1220',
    lineHeight: 17,
    textShadowColor: 'rgba(255, 255, 255, 0.9)',
    textShadowOffset: { width: 0, height: 0.5 },
    textShadowRadius: 3,
  },
  miniMeta: {
    fontSize: 11,
    fontWeight: '700',
    color: GinitTheme.themeMainColor,
    textShadowColor: 'rgba(255, 255, 255, 0.85)',
    textShadowOffset: { width: 0, height: 0.5 },
    textShadowRadius: 2,
  },
  /** 홈 AI 히어로 패널과 유사한 말풍선 */
  agentBubble: {
    maxWidth: 200,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.78)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 2,
  },
  agentBubbleText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    lineHeight: 17,
  },
  stripRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
  },
  stripScroll: {
    flex: 1,
    minWidth: 0,
  },
  stripContent: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
    paddingVertical: 2,
    paddingRight: 4,
  },
  /** 대시보드 풀블리드 카드 */
  dashboardCard: {
    borderRadius: 22,
    overflow: 'hidden',
    marginBottom: 14,
    minHeight: 168,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.55)',
    shadowColor: 'rgba(15, 23, 42, 0.55)',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 22,
    elevation: 6,
  },
  dashboardImage: {
    ...StyleSheet.absoluteFillObject,
  },
  dashboardVeil: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
  },
  dashboardInnerBorder: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.42)',
  },
  dashboardBody: {
    flex: 1,
    padding: 16,
    justifyContent: 'flex-end',
    gap: 8,
  },
  dashboardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#0b1220',
    letterSpacing: -0.3,
    textShadowColor: 'rgba(255, 255, 255, 0.95)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  dashboardSub: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1e293b',
    textShadowColor: 'rgba(255, 255, 255, 0.9)',
    textShadowOffset: { width: 0, height: 0.5 },
    textShadowRadius: 3,
  },
  phasePill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 82, 204, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(0, 82, 204, 0.28)',
  },
  phasePillText: {
    fontSize: 11,
    fontWeight: '600',
    color: GinitTheme.themeMainColor,
  },
  phasePillOrange: {
    backgroundColor: 'rgba(255, 138, 0, 0.16)',
    borderColor: 'rgba(255, 138, 0, 0.35)',
  },
  phasePillOrangeText: {
    color: GinitTheme.pointOrange,
  },
});

export const homeBlurIntensity = GinitTheme.glassModal.blurIntensity;

export function shouldUseStaticGlassInsteadOfBlur(): boolean {
  return Platform.OS === 'android' || Platform.OS === 'web';
}
