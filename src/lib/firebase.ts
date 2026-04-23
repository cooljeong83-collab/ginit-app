import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, signInAnonymously, type Auth } from 'firebase/auth';
import { getFirestore, initializeFirestore, type Firestore } from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';
import { Platform } from 'react-native';

import { publicEnv } from '@/src/config/public-env';

const firebaseConfig = {
  apiKey: publicEnv.firebaseApiKey,
  authDomain: publicEnv.firebaseAuthDomain,
  projectId: publicEnv.firebaseProjectId,
  storageBucket: publicEnv.firebaseStorageBucket,
  messagingSenderId: publicEnv.firebaseMessagingSenderId,
  appId: publicEnv.firebaseAppId,
};

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let firestore: Firestore | undefined;
let storage: FirebaseStorage | undefined;

/**
 * Firebase JS SDK 초기화 (Expo 권장 경로).
 * Android 네이티브 설정은 `env/google-services.json` 등으로 별도 구성합니다.
 */
export function getFirebaseApp(): FirebaseApp {
  if (app) return app;
  if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
    throw new Error(
      '[firebase] env/.env의 FIREBASE_*(또는 expo.extra)가 비어 있습니다.',
    );
  }
  if (!getApps().length) {
    app = initializeApp(firebaseConfig);
    return app;
  }
  app = getApps()[0]!;
  return app;
}

/**
 * Firebase Auth
 * - **Web**: `firebase/auth`의 `getAuth`.
 * - **iOS/Android**: `@firebase/auth` RN 번들의 `initializeAuth` + `getReactNativePersistence(AsyncStorage)`  
 *   (`firebase/auth` 타입 번들에는 RN persistence가 없어 `require('@firebase/auth')`로 로드)
 * - 그 외: `getAuth` 메모리 persistence.
 */
export function getFirebaseAuth(): Auth {
  if (auth) return auth;
  const firebaseApp = getFirebaseApp();
  if (Platform.OS === 'web') {
    auth = getAuth(firebaseApp);
    return auth;
  }
  if (Platform.OS === 'ios' || Platform.OS === 'android') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rnAuth = require('@firebase/auth') as {
      initializeAuth: (app: FirebaseApp, deps: { persistence: unknown }) => Auth;
      getReactNativePersistence: (storage: typeof AsyncStorage) => unknown;
      getAuth: (app: FirebaseApp) => Auth;
    };
    try {
      auth = rnAuth.initializeAuth(firebaseApp, {
        persistence: rnAuth.getReactNativePersistence(AsyncStorage),
      });
      return auth;
    } catch (e) {
      const code =
        typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : '';
      if (code === 'auth/already-initialized') {
        auth = rnAuth.getAuth(firebaseApp);
        return auth;
      }
      throw e;
    }
  }
  auth = getAuth(firebaseApp);
  return auth;
}

/**
 * JS `firebase/auth` 세션이 없을 때 Firestore(`firebase/firestore`)가 규칙상 막히는 경우가 많습니다.
 * Phone Auth는 `@react-native-firebase/auth`를 쓰더라도, 모듈형 Firestore는 여기 `getFirebaseAuth()` 토큰을 따릅니다.
 * 로그아웃 직후 로그인 화면에서의 `users` 조회 등에 쓰며, 실패해도 throw 하지 않습니다.
 */
export async function ensureFirestoreReadAuth(): Promise<void> {
  const a = getFirebaseAuth();
  if (a.currentUser) return;
  try {
    await signInAnonymously(a);
  } catch {
    /* 익명 미허용·오프라인 등 — 호출부에서 조회만 실패할 수 있음 */
  }
}

/**
 * 전화번호만 로그인한 경우 `currentUser`가 없어 Storage 토큰을 못 씁니다.
 * 이때 한 번 `signInAnonymously`로 ID 토큰을 만듭니다.
 *
 * Firebase 콘솔 → Authentication → 로그인 제공업체 → **익명** 사용 설정이 필요합니다.
 */
export async function ensureFirebaseAuthUserForStorage(): Promise<void> {
  await ensureFirestoreReadAuth();
  const a = getFirebaseAuth();
  if (a.currentUser) return;
  try {
    await signInAnonymously(a);
  } catch (e) {
    const code =
      typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : '';
    if (code === 'auth/operation-not-allowed' || code === 'auth/admin-restricted-operation') {
      throw new Error(
        '채팅 사진 업로드에는 Firebase「익명」로그인이 필요합니다. Firebase 콘솔 → Authentication → 로그인 제공업체에서 익명을 켠 뒤 다시 시도해 주세요.',
      );
    }
    throw e instanceof Error ? e : new Error(String(e));
  }
}

/** Cloud Firestore */
export function getFirebaseFirestore(): Firestore {
  if (firestore) return firestore;
  const firebaseApp = getFirebaseApp();
  // RN에서 Listen(WebChannel)이 불안정할 수 있어 long polling 자동 감지(필요 시 사용)
  if (process.env.EXPO_OS === 'web') {
    firestore = getFirestore(firebaseApp);
    return firestore;
  }
  try {
    firestore = initializeFirestore(firebaseApp, {
      experimentalAutoDetectLongPolling: true,
    });
  } catch {
    firestore = getFirestore(firebaseApp);
  }
  return firestore;
}

/** Firebase Storage (채팅 이미지 등) — 버킷 문자열이 있으면 `gs://`로 명시(빈 문자열·캐시 앱 불일치 방지). */
export function getFirebaseStorage(): FirebaseStorage {
  if (storage) return storage;
  const firebaseApp = getFirebaseApp();
  const raw = publicEnv.firebaseStorageBucket?.trim();
  if (raw) {
    const bucketUrl = raw.startsWith('gs://') ? raw : `gs://${raw}`;
    storage = getStorage(firebaseApp, bucketUrl);
  } else {
    storage = getStorage(firebaseApp);
  }
  return storage;
}
