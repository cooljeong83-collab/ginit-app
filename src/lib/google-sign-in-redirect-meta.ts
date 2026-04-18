import type { User } from 'firebase/auth';

/** 웹 `getRedirectResult` 처리 결과(디버깅·UI용). */
export type RedirectConsumeMeta =
  | { status: 'success'; user: User }
  | { status: 'noop'; reason: 'not-browser' | 'native' }
  | { status: 'empty' }
  | { status: 'error'; code?: string; message: string; raw?: unknown };
