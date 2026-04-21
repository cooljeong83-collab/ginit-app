type PendingConsentAction = null | (() => void | Promise<void>);

let pending: PendingConsentAction = null;

export function setPendingConsentAction(fn: PendingConsentAction): void {
  pending = fn;
}

export function consumePendingConsentAction(): PendingConsentAction {
  const fn = pending;
  pending = null;
  return fn;
}

