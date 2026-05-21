import { StyleSheet } from 'react-native';

import { GinitTheme } from '@/constants/ginit-theme';
import { FEED_NATIVE_AD_ROW_HEIGHT } from '@/src/constants/adsConfig';

/** 심플 플랫 — shadow/elevation 없음 */
export const ginitNativeAdStyles = StyleSheet.create({
  card: {
    minHeight: FEED_NATIVE_AD_ROW_HEIGHT,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
    padding: 18,
    marginBottom: 0,
    overflow: 'hidden',
  },
  adLabel: {
    position: 'absolute',
    top: 10,
    right: 12,
    zIndex: 2,
    fontSize: 10,
    fontWeight: '600',
    color: GinitTheme.colors.textMuted,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.12)',
    borderRadius: 4,
  },
  media: {
    width: '100%',
    height: 140,
    borderRadius: 12,
    marginBottom: 10,
    backgroundColor: 'rgba(15, 23, 42, 0.04)',
  },
  headline: {
    fontSize: 16,
    fontWeight: '600',
    color: GinitTheme.colors.text,
    letterSpacing: -0.2,
    marginBottom: 4,
  },
  body: {
    fontSize: 13,
    fontWeight: '500',
    color: GinitTheme.colors.textSub,
    lineHeight: 18,
    marginBottom: 12,
  },
  cta: {
    alignSelf: 'flex-start',
    backgroundColor: GinitTheme.colors.primary,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  ctaText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  placeholder: {
    minHeight: FEED_NATIVE_AD_ROW_HEIGHT,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    fontSize: 13,
    color: GinitTheme.colors.textMuted,
  },
});
