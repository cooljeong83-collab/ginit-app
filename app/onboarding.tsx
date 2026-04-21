import OnboardingScreen from '@/components/onboarding/OnboardingScreen';

export const options = {
  headerShown: false,
  gestureEnabled: false,
  animation: 'fade' as const,
};

export default function OnboardingRoute() {
  return <OnboardingScreen />;
}
