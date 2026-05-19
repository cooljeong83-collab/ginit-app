import type { OnboardingSceneKind } from '@/components/onboarding/onboarding-slides';
import { OnboardingSceneAgent } from '@/components/onboarding/scenes/OnboardingSceneAgent';
import { OnboardingSceneConnect } from '@/components/onboarding/scenes/OnboardingSceneConnect';
import { OnboardingSceneLifecycle } from '@/components/onboarding/scenes/OnboardingSceneLifecycle';
import { OnboardingSceneReceipt } from '@/components/onboarding/scenes/OnboardingSceneReceipt';
import { OnboardingSceneSchedulePlace } from '@/components/onboarding/scenes/OnboardingSceneSchedulePlace';
import { OnboardingSceneShareReview } from '@/components/onboarding/scenes/OnboardingSceneShareReview';

type Props = {
  sceneKind: OnboardingSceneKind;
  isActive: boolean;
  showLogo?: boolean;
};

export function OnboardingSlideScene({ sceneKind, isActive, showLogo }: Props) {
  switch (sceneKind) {
    case 'lifecycle':
      return <OnboardingSceneLifecycle isActive={isActive} showLogo={showLogo} />;
    case 'agent':
      return <OnboardingSceneAgent isActive={isActive} />;
    case 'schedulePlace':
      return <OnboardingSceneSchedulePlace isActive={isActive} />;
    case 'connect':
      return <OnboardingSceneConnect isActive={isActive} />;
    case 'receipt':
      return <OnboardingSceneReceipt isActive={isActive} />;
    case 'shareReview':
      return <OnboardingSceneShareReview isActive={isActive} />;
    default:
      return null;
  }
}
