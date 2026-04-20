type Listener = (docked: boolean) => void;

let listeners: Listener[] = [];
let lastDocked = false;

export function emitTabBarFabDocked(next: boolean) {
  if (next === lastDocked) return;
  lastDocked = next;
  listeners.forEach((l) => {
    try {
      l(next);
    } catch {
      // ignore listener errors
    }
  });
}

export function subscribeTabBarFabDocked(listener: Listener) {
  listeners = [...listeners, listener];
  // sync current state immediately
  listener(lastDocked);
  return () => {
    listeners = listeners.filter((x) => x !== listener);
  };
}

