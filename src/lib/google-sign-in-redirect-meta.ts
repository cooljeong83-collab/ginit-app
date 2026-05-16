import type { User } from '@supabase/supabase-js';

/** 웹 OAuth 리다이렉트 복귀 후 세션 처리 결과(디버깅·UI용). */
export type RedirectConsumeMeta =
  | { status: 'success'; user: User }
  | { status: 'noop'; reason: 'not-browser' | 'native' }
  | { status: 'empty' }
  | { status: 'error'; code?: string; message: string; raw?: unknown };
