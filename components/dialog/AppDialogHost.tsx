import { useCallback, useEffect, useState } from 'react';

import { AppDialogModal } from '@/components/dialog/AppDialogModal';
import type { AppDialogPayload } from '@/components/dialog/app-dialog-types';
import {
  dismissAppDialog,
  registerAppDialogHandlers,
  unregisterAppDialogHandlers,
} from '@/components/dialog/app-dialog-api';

export function AppDialogHost() {
  const [payload, setPayload] = useState<AppDialogPayload | null>(null);

  useEffect(() => {
    registerAppDialogHandlers(
      (next) => setPayload(next),
      () => setPayload(null),
    );
    return () => unregisterAppDialogHandlers();
  }, []);

  const onDismiss = useCallback(() => {
    dismissAppDialog();
  }, []);

  if (!payload) return null;

  return <AppDialogModal visible payload={payload} onDismiss={onDismiss} />;
}
