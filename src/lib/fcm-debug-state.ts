type FcmDebugSnapshot = {
  lastToken: string | null;
  lastTokenAtMs: number | null;
  lastError: string | null;
  lastErrorAtMs: number | null;
  lastSaveOk: boolean | null;
  lastSaveAtMs: number | null;
};

const state: FcmDebugSnapshot = {
  lastToken: null,
  lastTokenAtMs: null,
  lastError: null,
  lastErrorAtMs: null,
  lastSaveOk: null,
  lastSaveAtMs: null,
};

export function fcmDebugSetToken(token: string | null): void {
  state.lastToken = token && token.trim() ? token.trim() : null;
  state.lastTokenAtMs = Date.now();
}

export function fcmDebugSetError(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err ?? '').trim();
  state.lastError = msg || 'unknown error';
  state.lastErrorAtMs = Date.now();
}

export function fcmDebugSetSaveOk(ok: boolean): void {
  state.lastSaveOk = ok;
  state.lastSaveAtMs = Date.now();
}

export function fcmDebugGetSnapshot(): FcmDebugSnapshot {
  return { ...state };
}

