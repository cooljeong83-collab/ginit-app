import { useCallback, useEffect, useState } from 'react';

import { GamificationStatChangeModal } from '@/components/gamification/GamificationStatChangeModal';
import type { GamificationStatChangePayload } from '@/components/gamification/gamification-stat-change-types';
import {
  dismissGamificationStatChange,
  registerGamificationStatChangeHandlers,
  unregisterGamificationStatChangeHandlers,
} from '@/components/gamification/gamification-stat-change-api';

export function GamificationStatChangeHost() {
  const [payload, setPayload] = useState<GamificationStatChangePayload | null>(null);

  useEffect(() => {
    registerGamificationStatChangeHandlers(
      (next) => setPayload(next),
      () => setPayload(null),
    );
    return () => unregisterGamificationStatChangeHandlers();
  }, []);

  const onDismiss = useCallback(() => {
    dismissGamificationStatChange();
  }, []);

  if (!payload) return null;

  return <GamificationStatChangeModal visible payload={payload} onDismiss={onDismiss} />;
}
