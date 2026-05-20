import type { GooglePeopleDemographicField } from '@/src/lib/google-sign-in-result';

export const GOOGLE_OAUTH_SCOPE_GENDER =
  'https://www.googleapis.com/auth/user.gender.read' as const;
export const GOOGLE_OAUTH_SCOPE_BIRTHDAY =
  'https://www.googleapis.com/auth/user.birthday.read' as const;

/** People API 점진적 동의 — 요청할 OAuth 스코프만 반환 */
export function googlePeopleScopesForFields(
  fields: readonly GooglePeopleDemographicField[],
): string[] {
  const scopes: string[] = [];
  if (fields.includes('gender')) scopes.push(GOOGLE_OAUTH_SCOPE_GENDER);
  if (fields.includes('birth')) scopes.push(GOOGLE_OAUTH_SCOPE_BIRTHDAY);
  return scopes;
}
