import type { AppDialogPayload } from '@/components/dialog/app-dialog-types';

type ShowFn = (payload: AppDialogPayload) => void;
type DismissFn = () => void;

let showImpl: ShowFn | undefined;
let dismissImpl: DismissFn | undefined;

export function registerAppDialogHandlers(show: ShowFn, dismiss: DismissFn): void {
  showImpl = show;
  dismissImpl = dismiss;
}

export function unregisterAppDialogHandlers(): void {
  showImpl = undefined;
  dismissImpl = undefined;
}

export function showAppDialog(payload: AppDialogPayload): void {
  showImpl?.(payload);
}

export function dismissAppDialog(): void {
  dismissImpl?.();
}
