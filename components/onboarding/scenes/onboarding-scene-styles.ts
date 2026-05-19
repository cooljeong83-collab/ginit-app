import { StyleSheet } from 'react-native';

import { GinitTheme } from '@/constants/ginit-theme';
import { ONBOARDING_HERO_SIZE } from '@/components/onboarding/onboarding-motion';

export const onboardingSceneStyles = StyleSheet.create({
  hero: {
    width: ONBOARDING_HERO_SIZE,
    height: ONBOARDING_HERO_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  glassCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
    backgroundColor: 'rgba(255, 255, 255, 0.82)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    shadowColor: GinitTheme.shadow.card.shadowColor,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 4,
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: GinitTheme.colors.primarySoft,
    borderWidth: 1,
    borderColor: GinitTheme.colors.border,
  },
  chipText: {
    fontSize: 11,
    fontWeight: '700',
    color: GinitTheme.colors.primary,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: GinitTheme.colors.textSub,
  },
  accent: {
    fontSize: 13,
    fontWeight: '700',
    color: GinitTheme.colors.primary,
  },
});
