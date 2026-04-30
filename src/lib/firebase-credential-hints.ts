/**
 * Firebase / FCM 관련 오류 메시지에서 **시크릿 재발급 필요 여부**를 거친 힌트로만 분류합니다.
 * (비밀키·JWT 전체는 절대 로그하지 마세요.)
 */

/** Supabase Edge `fcm-push-send` HTTP 실패 시 */
export function hintForFcmEdgeInvoke(status: number | undefined, bodySnippet: string): string {
  const b = bodySnippet.toLowerCase();
  if (status === 401 || status === 403) {
    return 'http_401_403_check_supabase_anon_or_edge_policy_not_firebase_private_key';
  }
  if (/invalid_grant|invalidjwt|jwt signature|unable to parse|private_key|decoding|credential|malformed/i.test(b)) {
    return 'likely_FIREBASE_SERVICE_ACCOUNT_JSON_invalid_or_expired_reissue_in_gcp_iam';
  }
  if (/missing firebase|missing firebaseserviceaccount|expected property name|unexpected token/i.test(b)) {
    return 'likely_FIREBASE_SERVICE_ACCOUNT_JSON_missing_or_invalid_json_escape_in_supabase_secret';
  }
  if (status === 500 && b.length < 20) {
    return 'edge_500_open_supabase_edge_logs';
  }
  return 'see_body_snippet_and_supabase_function_logs';
}

/** 클라이언트 `getToken` / RN Firebase 메시징 실패 시 */
export function hintForNativeFcmTokenError(message: string, code?: string): string {
  const m = message.toLowerCase();
  const c = (code ?? '').toLowerCase();
  if (c.includes('configuration-not-found') || m.includes('configuration-not-found')) {
    return 'check_google_services_json_or_ios_plist_matches_firebase_project_not_server_secret';
  }
  if (c.includes('auth') || m.includes('google play services')) {
    return 'device_gms_or_firebase_client_config_not_server_secret';
  }
  if (c.includes('invalid') && c.includes('token')) {
    return 'registration_token_invalid_clear_app_data_or_reinstall_not_admin_key';
  }
  return 'not_typically_server_service_account_key_issue';
}

export function extractFirebaseLikeCode(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const o = err as Record<string, unknown>;
  if (typeof o.code === 'string' && o.code.trim()) return o.code.trim();
  if (typeof o.nativeErrorCode === 'string' && o.nativeErrorCode.trim()) return o.nativeErrorCode.trim();
  return undefined;
}
