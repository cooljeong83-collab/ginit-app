declare namespace NodeJS {
  interface ProcessEnv {
    EXPO_PUBLIC_SUPABASE_URL?: string;
    EXPO_PUBLIC_SUPABASE_ANON_KEY?: string;
    /** Expo Push / EAS — `getExpoPushTokenAsync({ projectId })` 용 (expo.dev Project ID) */
    EAS_PROJECT_ID?: string;
    EXPO_PUBLIC_EAS_PROJECT_ID?: string;
    /** Expo Push API (선택, remote-push-hub 의 Expo 폴백 전송 시 Authorization) */
    EXPO_ACCESS_TOKEN?: string;
    EXPO_PUBLIC_EXPO_ACCESS_TOKEN?: string;
    EXPO_PUBLIC_NAVER_MAP_CLIENT_ID?: string;
    EXPO_PUBLIC_NAVER_MAPS_API_ORIGIN?: string;
    EXPO_PUBLIC_NAVER_MAPS_GEOCODE_PATH?: string;
    EXPO_PUBLIC_NAVER_SEARCH_CLIENT_ID?: string;
    EXPO_PUBLIC_NAVER_SEARCH_CLIENT_SECRET?: string;
    EXPO_PUBLIC_NAVER_LOCAL_CLIENT_ID?: string;
    EXPO_PUBLIC_NAVER_LOCAL_CLIENT_SECRET?: string;
    EXPO_PUBLIC_NAVER_LOCAL_SEARCH_CORS_PROXY?: string;
    EXPO_PUBLIC_NAVER_LOCAL_SEARCH_API_BASE?: string;
    EXPO_PUBLIC_FIREBASE_API_KEY?: string;
    EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN?: string;
    EXPO_PUBLIC_FIREBASE_PROJECT_ID?: string;
    EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET?: string;
    EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID?: string;
    EXPO_PUBLIC_FIREBASE_APP_ID?: string;
    WEB_CLIENT_ID?: string;
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?: string;
    /** KOBIS 오픈API (kobis.or.kr 발급) */
    EXPO_PUBLIC_KOBIS_KEY?: string;
    KOBIS_KEY?: string;
    /** TMDB v3 (themoviedb.org) */
    EXPO_PUBLIC_TMDB_API_KEY?: string;
    TMDB_API_KEY?: string;
  }
}
